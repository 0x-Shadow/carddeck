# Carddeck v2 — Images, Animations, MCP Agent Server, Self-Hosting

**Date:** 2026-10-17
**Status:** Approved for implementation (partner pre-approved all gates: "brainstorm and proceed without asking").
**Predecessor:** `2026-10-16-gamma-clone-design.md` (v1, fully implemented and reviewed).

## Intent

The partner uses Carddeck locally and wants it to become an **agent-driven,
fully self-hosted presentation studio**:

1. An AI agent (OpenCode or any MCP client) creates and refines decks on
   their behalf through **MCP tools**.
2. Decks can carry **real images** — uploaded from their folder or pulled
   from a URL — and those images must survive into the exported PowerPoint
   and PDF.
3. The AI "**gets into**" the deck: **crazy-looking animations** inside the
   .pptx itself (transitions + entrance animations in PowerPoint) and in the
   web present mode.
4. The whole product stays **self-hostable** — one container, one volume, no
   cloud dependencies.

Success looks like: from OpenCode, "make me a 6-card deck about X with
cinematic animations and drop this photo on the cover" returns a finished
deck id; opening the exported .pptx in PowerPoint plays transitions and
staggered entrance animations with the real image on the cover.

**Out of scope (v1 of v2):** video/audio blocks, animated GIF playback in
PPTX, image search services, MCP resources/prompts (tools only), multi-user
MCP identity, Kubernetes manifests, SVG uploads (rasterize client-side
instead).

---

## 0. AbortError hardening (prerequisite)

Client fetch effects abort in-flight requests on unmount / StrictMode
double-mount; the rejection currently surfaces as a Next dev overlay
("Runtime AbortError", `present/page.tsx:39`). Fix pattern:

- `lib/abort.ts`: `isAbortError(err)` — true for `DOMException`/`Error`
  with `name === "AbortError"` (covers fetch and manual aborts).
- Every client `useEffect` fetch with an `AbortController` (present, /new,
  deck page, dashboard) wraps its body in try/catch that swallows aborts and
  ignores state updates after abort.
- Regression test: render `PresentPage` with a fetch mock rejecting with
  `AbortError`, unmount immediately, assert no unhandled rejection and no
  state update warning.

---

## 1. Images (assets)

### Data

- New table `asset`: `id` (text pk), `deckId` (fk → deck, cascade delete),
  `mime` (text), `sizeBytes` (int), `originalName` (text), `createdAt` (int).
- Filesystem: `DATA_DIR/assets/<deckId>/<assetId>.<ext>` (anchored via
  `resolveDataDir`, like everything else). DB rows describe; files store.
- Migration 0004 via drizzle-kit (existing lazy-migrate flow picks it up).

### API

- `POST /api/deck/[id]/assets` — owner-gated, `multipart/form-data` field
  `file`. Accepts `image/png`, `image/jpeg`, `image/webp`, `image/gif`;
  **10 MB cap**; extension derived from detected MIME (not the filename).
  Responds `{ asset: { id, url } }` with `url = /api/deck/<id>/assets/<assetId>`.
  Any other content type or oversize → 400/413.
- `GET /api/deck/[id]/assets/[assetId]` — serves bytes with correct
  `Content-Type`, `Cache-Control: public, max-age=31536000, immutable`.
  Access: deck owner **or** anyone when `deck.isPublic` (so public readers
  and PDF export can render images); otherwise 404 (no existence leak).

### Blocks

- `image` block unchanged in shape (`src`, `caption?`, `layout`), but `src`
  is now meaningful: either `http(s)://…` (hotlink) or `/api/deck/…/assets/…`
  (uploaded). Empty `src` still renders the placeholder.

### Editor UI

- `ImageBlock` (editor variant) gains a compact toolbar: **Upload** (hidden
  `<input type=file>`), **URL** field + "Use", caption input, layout cycle
  (full/side/behind). Upload POSTs FormData to the assets route, then writes
  the block's `src` through the existing `onChange` → card PATCH flow.
- Upload failures render inline (`role=alert`), input preserved.

### Export

- **PPTX** (`packages/pptx`): new resolver `resolveImage(src)` —
  - `/api/…/assets/…` → read from `DATA_DIR/assets/…` (path traversal
    impossible: only `(deckId, assetId)` pairs from the DB are read);
  - `http(s)://…` → `fetch` with 5 s timeout, 10 MB cap, only
    `image/*` content types;
  - returns `{ dataUrl }` or `null`.
  `buildPptxBuffer(slides, opts)` accepts an optional `resolveImage`; when
  present, image blocks call `slide.addImage({ data })` positioned per
  `layout` (full-width band / side column / behind-title at 20 % height);
  when absent or resolution fails → current captioned placeholder (export
  never breaks).
- **PDF**: unchanged pipeline (browser prints `<img src>`); assets route is
  public-for-public-decks, remote URLs fetch in the browser. No work.

### MCP parity

`add_image` (§3) reuses the same storage functions directly (no HTTP hop).

---

## 2. Animations (motion)

### Plan model (`packages/core`)

```ts
type MotionPreset = "none" | "subtle" | "punchy" | "cinematic";
type TransitionKind = "fade" | "push" | "wipe" | "cover" | "split";
type EntranceKind = "fade" | "wipeUp" | "flyLeft" | "zoom";
type SlideShapeCount = { shapes: number };      // shapes on one slide
type SlideMotion = { transition: TransitionKind;
                     builds: Array<{ effect: EntranceKind; delayMs: number }> };
type MotionPlan = { preset: MotionPreset; slides: SlideMotion[] };
```

- `planMotion(preset, counts: { slides: number; shapes: SlideShapeCount[] },
  seed)` — pure, deterministic (hash-seeded) expansion of a preset into a
  full plan; `none` → empty plan. Per slide: transition chosen from the
  preset's palette; first shape (title) gets a strong entrance, remaining
  shapes stagger 250–450 ms apart; `cinematic` uses longer delays +
  fly/zoom, `punchy` short + wipe/zoom, `subtle` fade-only.
- Deck row gains `motion` (text, JSON `MotionPlan | null`). `deck.motion`
  null ⇒ treat as `{ preset: "none", slides: [] }`.
- Deck PATCH contract (two explicit shapes):
  - `{ motionPreset: "subtle" }` — server derives the full plan with
    `planMotion` from the deck's current card shape counts (this is what
    MotionPicker and MCP `set_motion` send);
  - `{ motion: MotionPlan }` — full plan (AI / MCP power users), validated
    with `validateMotionPlan` against the deck's current card count.

### Validation (packages/ai + PATCH)

- `validateMotionPlan(raw, slideCount)` — whitelists preset/transition/
  entrance values, caps `slides` at slideCount, caps builds per slide at
  shapeCount + 2, clamps delays 0–5000 ms; throws `AIValidationError` on
  non-object junk. Deck `PATCH` accepts either `motionPreset` (server
  derives the plan) or a full `motion` plan (validated) — see §2.

### UI

- **MotionPicker** in the deck topbar (next to ThemePicker): None / Subtle /
  Punchy / Cinematic; PATCHes the deck, keeps local state optimistic like
  ThemePicker.
- **Present mode**: `PresentStage` maps the active slide's plan to CSS
  (`.motion-fade/.wipeUp/.flyLeft/.zoom` keyframes + `animation-delay` per
  block group); replay on slide change. All motion wrapped in
  `@media (prefers-reduced-motion: reduce) { animation: none }`.
- **Generation**: when a deck's cards settle and `motion.preset !== "none"`
  but no plan exists yet, the deck page derives one via `planMotion` and
  PATCHes it (deterministic; works keyless). OpenAI path: see below.

### PPTX (the headline)

- `packages/pptx` gains `applyMotion(zip, plan)` post-processing step in
  `buildPptxBuffer` (after html2pptx + zip load, alongside the POTX step):
  - For slide *i* with a non-empty plan entry:
    - inject `<p:transition spd="med" advClick="1"><p:fade/></p:transition>`
      (or `p:push dir=…` / `p:wipe dir=…` / `p:cover dir=…` / `p:split …`)
      into `ppt/slides/slide{i+1}.xml` right after `<p:clrMapOvr>`;
    - collect shape ids (`<p:cNvPr id=…>`) in document order and inject a
      `<p:timing>` skeleton: one click-par group containing `withEffect`
      par nodes whose `stCondLst` delay equals the plan's `delayMs`;
      entrance effects map to `animEffect` transitions
      (`fade` → `filter="fade"`, `wipeUp` → `filter="wipe(down)"`,
      `zoom` → `animEffect fade` + `animScale` 60→100 %) or `p:anim` on
      `ppt_x`/`ppt_y` (`flyLeft`); every animated shape also gets the
      mandatory `<p:set>` visibility=visible node.
  - Slides without plan entries are untouched.
- Compatibility target: PowerPoint 2016+/M365. All injected XML is built by
  a pure serializer (`motion-xml.ts`) with unit tests asserting
  well-formedness (strict XML parse), balanced ids, and structure; LibreOffice
  degradation is acceptable and documented.
- POTX export reuses the same injection (template carries animations).

### AI (OpenAI provider)

- Cards job response schema gains optional `motion: MotionPlan` (same
  whitelist; validated with `validateMotionPlan`). Present but invalid →
  fall back to `planMotion(preset, …)` with the deck's requested preset.
  StubProvider: always deterministic `planMotion` expansion of the deck's
  preset (zero-key parity).

---

## 3. MCP agent server (`apps/mcp`)

### Runtime

- New workspace `@carddeck/mcp`: stdio Model Context Protocol server using
  `@modelcontextprotocol/sdk`. Entry `src/index.ts` (`McpServer` + stdio
  transport), tools registered from `src/tools.ts`.
- Boots against the same `DATA_DIR` (shared `getDb`, lazy migrations) —
  no HTTP, no session auth: a local stdio server is as trusted as the
  worker process. Optional `CARDDECK_MCP_USER` (default
  `mcp@carddeck.local`, display name "Deck Agent"); provisioned on boot
  (argon2 random password, session never used). All tools operate as this
  user; `list_decks` shows their decks.
- Jobs: tool calls that need generation enqueue via the existing queue lib
  and **poll the DB** (250 ms) until terminal or timeout (120 s), then
  return partial state + a `note`.

### Tools

| Tool | Input | Behavior |
| --- | --- | --- |
| `create_deck` | `prompt` (req), `numCards` 1–30?, `format`?, `tone`?, `theme`? (preset name), `motion`? (preset) | deck + outline job + cards job; waits; returns `{ deckId, url, status, cards: [{id,title}] }`. |
| `create_deck_from_cards` | `title`, `cards: [{ title, content?: string[] }]`, `theme`?, `motion`? | Direct create, status `ready`, one paragraph block per content line. No waiting. |
| `add_cards` | `deckId`, `cards[]` | Appends ready cards with content (or outline-only when content omitted). |
| `get_deck` | `deckId` | Full deck JSON: title, theme, motion, cards with parsed blocks. |
| `list_decks` | — | `{ deckId, title, status, cardCount, updatedAt }[]` for the agent user. |
| `set_theme` | `deckId`, `theme` | Preset name or id; 400s on unknown. |
| `set_motion` | `deckId`, `preset` | Whitelisted preset; plan derived server-side. |
| `add_image` | `deckId`, `source` (`{ url }` \| `{ path }`), `cardId`?, `caption`?, `layout`? | Stores asset (download / file copy, same limits as upload route), inserts image block into the target card (default: first card). Local path must exist and be an accepted image type. |
| `export_deck` | `deckId`, `format` (`pptx` \| `pdf` \| `potx`), `outDir`? | Renders via `packages/pptx` (+ Playwright for PDF) into `outDir ?? DATA_DIR/exports`; returns absolute file path. |

- Every tool returns structured `content: [{ type: "text", text: JSON }]`
  with a stable envelope `{ ok, ... }`; errors return `{ ok: false, error }`
  with `isError: true` (no throws across the protocol boundary).

### Agent config

- `docs/MCP.md`: what the server does, tool reference, and copy-paste
  configs. Repo `opencode.json` gains the MCP entry (stdio, `tsx` dev form)
  so running OpenCode inside this repo has the tools immediately.

---

## 4. Self-hosting

- **`Dockerfile`** (multi-stage):
  1. `deps`: node:20-slim, `npm ci`;
  2. `build`: copy source, `npm run build`;
  3. `runtime`: node:20-slim + `npx playwright install --with-deps chromium`
     (PDF), non-root `node` user, `ENV DATA_DIR=/data`, `EXPOSE 3000`,
     `CMD ["npm", "run", "start"]` (turbo runs web + worker).
- **`.dockerignore`**: node_modules, .git, data, e2e/.data, .next, .turbo.
- **`docker-compose.yml`**: one service `carddeck`, `ports: "3000:3000"`,
  `volumes: [carddeck-data:/data]`, `environment: SESSION_SECRET
  (${CARDDECK_SESSION_SECRET:?set it}), DATA_DIR=/data`,
  `restart: unless-stopped`.
- **README**: Self-hosting section (build/run/compose, backup = copy the
  volume, MCP pointer).

---

## Testing strategy

- **Unit/integration (vitest):** abort helper; assets routes (upload ok,
  type/size rejects, public vs owner serving, traversal impossibility);
  image block editor (upload happy path + failure); `planMotion`
  determinism + preset shapes; `validateMotionPlan` coercions; deck PATCH
  motion; `resolveImage` (local + remote + failure); motion XML serializer
  (well-formedness, ids, per-effect structure); zip-level test: built pptx
  with motion contains `<p:timing>` on planned slides and none on unplanned;
  POTX carries animations too; MCP tools via `Client` + `InMemoryTransport`
  against a temp DATA_DIR (create/get/list/add_image/set_theme/set_motion/
  export pptx); OpenAI motion parsing.
- **E2E (playwright):** image upload roundtrip (upload → block shows image →
  reader shows `<img>`); motion picker persists across reload; export still
  green with images present.
- **Manual gates:** open produced .pptx in PowerPoint when available (XML
  well-formedness tests are the CI proxy); `docker compose config` validates
  the compose file.

## Risks & mitigations

- **OOXML animation correctness** — highest risk. Mitigation: pure
  serializer + strict structural tests + id-binding to real shapes; unknown
  shapes skipped; slides without plan untouched; feature flag
  `CARDDECK_MOTION=off` disables injection wholesale.
- **Remote image fetching (SSRF)** — export/MCP fetches are capped (5 s,
  10 MB, `image/*` only) and never follow the app's own auth; block
  `file://` and non-http schemes.
- **MCP tool latency** — generation waits are bounded with partial returns.
- **Image size in PPTX** — 10 MB upload cap × base64 keeps decks sane;
  resolver recompresses nothing (documented).

## Rollout order (see implementation plan)

Abort fix → motion model/validation → assets → editor images → PPTX images →
motion UI/present → PPTX motion XML → OpenAI motion → MCP server → agent
config + Docker + docs → E2E + review.
