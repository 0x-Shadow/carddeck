# Gamma Clone ("Carddeck") — Design Spec

Date: 2026-10-16
Status: Approved for build (user directed: PowerPoint-first, proceed without asking)
Companion: `2026-10-16-gamma-reverse-engineering-findings.md`

## What we're building

A self-hostable web app that reproduces Gamma's core loop:

> **prompt → editable outline → AI-generated, themed deck of cards → refine →
> present / share / export.**

Not a pixel copy — a clean-room implementation of the *model and UX* observed
in the findings doc, with the same conceptual architecture (card/block document,
two-stage AI generation, theme system, vertical reader + present mode).

## Explicitly out of scope (v1)

- Real billing / credits / workspaces / SSO / multi-tenant admin.
- PowerPoint **import** (`GenerateDocFromImport`) and template remix. (PowerPoint
  **export** is a first-class v1 feature — see below.)
- Realtime multi-user Yjs collaboration (design leaves a seam for it).
- Custom domains / site publishing.
- AI **image** generation (v1 uses a curated stock/placeholder image picker;
  the provider interface leaves room to add an image model later).

These are named so we don't accidentally gold-plate. Each has a clear seam to
extend later.

## Success criteria

1. Sign up / sign in, land on a dashboard of your decks.
2. Click **Create new**, type a prompt (or paste text / pick a template),
   choose format (presentation / document) and card count.
3. Get an **editable outline**; rename / reorder / add / remove cards; pick a
   theme; click **Generate**.
4. Watch cards generate (streamed); each card is a themed layout of blocks.
5. Edit any card inline; use an **AI chat** panel to rewrite a card or the doc.
6. Switch theme and see the whole deck re-skin instantly.
7. **Present** full-screen, **Share** via public link.
8. **Export to PowerPoint (.pptx)** — the primary export. Real, editable .pptx
   that opens in PowerPoint / Google Slides / LibreOffice, one slide per card,
   preserving theme fonts/colors and block layout. Also **Export to PDF**.
9. A public reader URL renders the deck without auth.

## Architecture

Monorepo, two runtime apps + shared packages.

```
gamma-clone/
  apps/
    web/                 Next.js (App Router) client + BFF route handlers
    worker/              Node long-running generation worker (queue consumer)
  packages/
    core/                shared types + block/theme model + pure logic
    ai/                  LLM provider interface + prompts + stub provider
  data/                  SQLite (dev) — Drizzle schema + migrations
  docs/superpowers/      specs + plans
```

**Why this split:** the two-stage AI flow is slow and must not block the web
request. The web app enqueues a generation job and subscribes to progress; the
worker runs the pipeline and persists incremental card results. In dev the
"queue" is a DB table + polling; the interface leaves room for Redis/BullMQ.

### Data model (packages/core + Drizzle)

- `user` — id, email, name, passwordHash, createdAt.
- `deck` — id, userId, title, format (`presentation|document`), themeId,
  status (`draft|outline|generating|ready`), createdAt, updatedAt, isPublic,
  shareSlug.
- `card` — id, deckId, position, title, blocks (JSON), status, genJobId.
- `theme` — id, name, isPreset, fonts{display,body}, colors{page,surface,ink,
  accent,muted}, radius, shadow.
- `generationJob` — id, deckId, stage (`outline|cards|chat`), status, input,
  result, error, progress, createdAt, updatedAt.
- `chatMessage` — id, deckId, cardId?, role, content, createdAt.

`card.blocks` is a typed block tree (mirrors Gamma's renderer model):

```ts
type Block =
  | { type: "heading"; level: 1|2|3; text: Inline[] }
  | { type: "paragraph"; text: Inline[] }
  | { type: "bulletList"; items: Inline[][] }
  | { type: "numberedList"; items: Inline[][] }
  | { type: "image"; src: string; caption?: string; layout: "full"|"side"|"behind" }
  | { type: "quote"; text: Inline[]; attribution?: string }
  | { type: "divider" }
  | { type: "columns"; columns: Block[][] }
  | { type: "callout"; tone: "info"|"warn"|"success"; text: Inline[] }
  | { type: "chart"; kind: "bar"|"line"|"donut"; data: ChartData };
type Inline = string | { text: string; bold?: boolean; italic?: boolean; link?: string };
```

A card also carries a `layout` hint (`cover`, `section`, `content`, `twoUp`,
`closing`) that drives which renderer composes the blocks.

### AI pipeline (packages/ai)

Provider interface so models are swappable:

```ts
interface AIProvider {
  name: string;
  generateOutline(req: OutlineRequest): Promise<Outline>;       // stage 1
  generateCard(req: CardRequest): Promise<Block[]>;            // stage 2 (per card)
  revise(req: ReviseRequest): Promise<ReviseResult>;           // chat
}
```

Two shipped providers:
- `StubProvider` — deterministic, offline, returns a realistic outline + cards
  for any prompt. **This is what tests and `npm run dev` use by default**, so
  the app is fully usable with zero API keys.
- `OpenAIProvider` — uses `OPENAI_API_KEY` + `OPENAI_MODEL` (any
  OpenAI-compatible endpoint via `OPENAI_BASE_URL`). JSON-schema-constrained
  outputs so blocks parse reliably.

**Outline stage** produces `CardOutline[] = { title, intent }[]`.
**Card stage** runs **one card at a time, in parallel with a small concurrency
limit**, writing each finished card to the DB so the UI can render cards as they
land (Gamma's signature behavior). Progress = cardsDone / cardsTotal.

### Theme system

A `Theme` is a flat token object applied via CSS custom properties on the
document root, so switching a theme re-skins instantly with no re-render of
block content:

```css
.deck { --page:…; --surface:…; --ink:…; --accent:…; --font-display:…; --font-body:…; }
```

Ship ~8 preset themes (Light, Dark, "Midnight" navy/cornflower like the
observed deck, Sunset, Forest, Mono, Paper, Neon). Block renderers consume only
tokens — never hard-coded colors/fonts.

### Frontend routes (apps/web)

- `/` marketing landing (hero, sample deck strip, CTA) — mirrors gamma.app shell.
- `/dashboard` — grid of the user's decks + **Create new**.
- `/new` — creation modal flow: mode (Generate / Paste / Template) →
  options (format, card count, tone, theme) → generate outline.
- `/deck/[id]` — **editor**: left outline rail, center card canvas (vertical),
  right AI/theme panel. Top bar: title, theme picker, Present, Share, Export.
- `/deck/[id]/present` — full-screen present mode (arrow keys, progress bar).
- `/view/[slug]` — **public reader** (vertical scroll, Present + Share buttons,
  no auth). Matches the observed reader chrome.
- `/api/*` — BFF route handlers: auth, decks, cards, generation (enqueue +
  poll/SSE), chat, theme, export.

**Generation UX:** `/deck/[id]` subscribes to job progress via SSE
(`/api/generation/[jobId]/stream`). Cards appear one-by-one, each with a
skeleton shimmer until its blocks land. A stop button cancels remaining cards.

### Editor

Inline editing with a lightweight contenteditable + block toolbar (bold, italic,
link, list, image, columns, chart, callout). Selecting a card opens the AI
chat scoped to that card ("rewrite shorter", "make it a bullet list", "add an
example"). No ProseMirror in v1 — a simpler controlled block editor keeps the
clone buildable; the `Block[]` shape is ProseMirror-compatible so it can be
swapped in later.

### Export — PowerPoint is the headline

The core deliverable is a **real, editable .pptx** (same as Gamma's PowerPoint
export). Implementation, mirroring Gamma's HTML→PowerPoint path:

- **.pptx (primary)** — render each themed card to HTML/CSS offscreen
  (16:9, `1280×720`), then convert that DOM into real PowerPoint shapes via
  `html2pptx`. Each card becomes one slide; theme fonts/colors map to slide
  theme + text runs; blocks map to text boxes / pictures / tables / charts.
  Output reopens in PowerPoint, Google Slides, and LibreOffice Impress.
- **Theme template (.potx)** — the active theme exported as a PowerPoint
  template so a deck reopens with the right fonts/colors as its master.
- **PDF (secondary)** — headless Chromium (Playwright) print-to-PDF of the
  reader route, one page per card.
- **Share** — flip `isPublic` + mint `shareSlug`; reader at `/view/[slug]`.

Design choice (ledger ruling): the browser renders the deck to HTML and
`html2pptx` measures the real DOM, so exported layout matches the on-screen /
reader layout faithfully without a second hand-built PowerPoint renderer.

## Error handling

- Generation errors attach to the failing card; UI shows a per-card retry and
  keeps completed cards. Job status surfaces a banner with retry.
- Rate/size guards: cap prompt length, cap cards (v1 max 30).
- Every AI call has a timeout + one retry; `StubProvider` never fails (used in
  tests to keep flows deterministic).
- Auth via session cookie (iron-session style signed cookie); all `/api/deck/*`
  and `/deck/*` routes are owner-gated except `/view/[slug]`.

## Testing strategy

- **Unit (Vitest):** block parsing/serialization, theme token → CSS vars,
  outline reducer (add/reorder/remove), StubProvider determinism, AI response
  JSON-schema validation.
- **Integration (Vitest + supertest against route handlers with SQLite in
  tmp):** create deck → enqueue outline → enqueue cards → poll → deck ready;
  chat revise; share toggle; export returns a PDF.
- **E2E (Playwright):** the 8 success-criteria flows, incl. cards streaming in,
  theme switch re-skin, present mode, public reader without auth. E2E runs on
  `StubProvider` so it's key-free and deterministic.

## Security notes

- Passwords hashed (bcrypt/argon2). Session cookie httpOnly + SameSite=Lax.
- Public reader served from an allow-listed route that ignores auth and never
  leaks owner-only fields.
- Export renders only published/approved content; the print route re-checks
  `isPublic` or ownership.
- AI provider keys stay server-side (worker + route handlers), never shipped to
  the client bundle.

## Known limitations (v1)

Deliberate scope cuts for this build; each is a contained follow-up:

- **PPTX export is text-first.** The DOM-free pipeline exports the full text
  layer (headings, paragraphs, lists, quotes, callouts, dividers, columns) as
  editable, theme-colored shapes. `image` blocks export as captioned
  placeholders and `chart` blocks as readable data summaries; the
  browser-printed PDF keeps both exactly as they appear on screen.
- **No file uploads.** `image` blocks reference URLs only; there is no asset
  pipeline.
- **Chat refine is single-instruction.** Every revision persists a
  `chatMessage` row, but v1's panel shows no transcript.
- **One SQLite writer.** The queue lives in the shared SQLite file, so run a
  single worker per `DATA_DIR`; horizontal scale-out would need a real queue.
