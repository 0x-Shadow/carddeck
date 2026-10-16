# Carddeck (Gamma Clone) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hostable Gamma clone: prompt → editable outline → AI-generated, themed deck of cards → refine → present / share / export.

**Architecture:** Turborepo monorepo. `apps/web` (Next.js App Router + BFF route handlers) is the client + API. A DB-table job queue plus `apps/worker` runs the two-stage AI pipeline out-of-band; the web app subscribes to progress via SSE and renders cards as they land. `packages/core` holds the block/theme model and pure logic, `packages/ai` holds the swappable LLM provider (deterministic `StubProvider` by default, `OpenAIProvider` when a key is present). SQLite + Drizzle for storage.

**Tech Stack:** Next.js 15 (App Router, RSC), React 19, TypeScript, Tailwind, Drizzle ORM + better-sqlite3, Vitest, Supertest, Playwright, unconstrained `fetch`-based OpenAI-compatible client.

**Spec:** `docs/superpowers/specs/2026-10-16-gamma-clone-design.md` (argues from `2026-10-16-gamma-reverse-engineering-findings.md`). Read both before implementing.

## Global Constraints

- Node >= 20. No native modules beyond better-sqlite3.
- Default AI provider is `StubProvider`; the app must be fully usable with zero API keys. `OpenAIProvider` activates only when `OPENAI_API_KEY` is set.
- Max cards per deck: 30. Max prompt length: 4000 chars.
- Block renderers consume theme tokens only — never hard-coded colors/fonts.
- All `/api/deck/*` and `/deck/*` routes are owner-gated by session cookie, except `/view/[slug]` (public reader) and `/api/public/[slug]`.
- Passwords hashed with argon2 (`@node-rs/argon2`). Session = httpOnly, SameSite=Lax signed cookie.
- No ProseMirror in v1 — controlled block editor over `Block[]`.
- E2E and integration tests run on `StubProvider` (deterministic, key-free).

## Review Focus

These are the inputs/failure modes the spec implies but no single task's happy-path test exercises. Each has a pinning test in the named task.

1. **A deck whose card generation partially fails** — some cards land, one provider call throws. Expected: completed cards persist, failing card shows per-card retry, job status is `error` not `ready`. Pinned in Task 8 (integration: partial-failure test) and Task 12 (E2E retry).
2. **Concurrent generation jobs / double-submit** — user clicks Generate twice or two tabs. Expected: one job per deck per stage; second request returns the in-flight job, never a second concurrent pipeline. Pinned in Task 7 (idempotency test) and Task 8 (integration).
3. **Theme switch with existing complex blocks** (columns, chart, callout, cover image) — expected: re-skin via CSS vars with zero re-render of block content and no layout collapse. Pinned in Task 6 (token→CSS test) and Task 13 (E2E theme switch).
4. **Public reader auth boundary** — unauthenticated GET to `/view/[slug]` and `/api/public/[slug]` for a private deck. Expected: 404 for private, full render for public, never leaks owner email or unpublished deck fields. Pinned in Task 8 (integration) and Task 14 (E2E).
5. **Export renders only approved content and valid PDF** — expected: PDF export re-checks `isPublic` or ownership, returns `%PDF` bytes, one page per card in presentation format. Pinned in Task 10 (integration) and Task 14 (E2E).

---

## File Structure

```
gamma-clone/
  package.json                     root, npm workspaces + turbo
  turbo.json
  .env.example
  packages/core/
    src/blocks.ts                  Block/Inline types + guards
    src/theme.ts                   Theme type, presets, token→CSS-var mapping
    src/outline.ts                 OutlineCard type, reorder/add/remove reducers
    src/serialize.ts               Inline[] ↔ plain text/markdown helpers
    test/blocks.test.ts
    test/theme.test.ts
    test/outline.test.ts
  packages/ai/
    src/types.ts                   AIProvider, OutlineRequest, CardRequest, ReviseRequest
    src/stub.ts                    StubProvider
    src/openai.ts                  OpenAIProvider
    src/prompts.ts                 outline/card/revise prompt builders
    src/validate.ts                JSON-schema validation of model output
    test/stub.test.ts
    test/validate.test.ts
    test/openai.test.ts            (mocked fetch)
  apps/web/
    drizzle/schema.ts              user, deck, card, theme, generationJob, chatMessage
    drizzle/                       migrations + db client
    lib/auth.ts                    session get/create/destroy, argon2
    lib/db.ts                      drizzle sqlite singleton
    lib/queue.ts                   enqueue/claim/update job (DB table)
    lib/themes-presets.ts          re-export core presets seeded to DB
    app/page.tsx                   landing
    app/dashboard/page.tsx
    app/new/page.tsx               creation flow
    app/deck/[id]/page.tsx         editor
    app/deck/[id]/present/page.tsx present mode
    app/view/[slug]/page.tsx       public reader
    app/api/auth/{register,login,logout}/route.ts
    app/api/deck/route.ts          create list
    app/api/deck/[id]/route.ts     get update delete
    app/api/deck/[id]/cards/route.ts     reorder, add, delete
    app/api/deck/[id]/cards/[cardId]/route.ts  update blocks
    app/api/deck/[id]/outline/route.ts   stage 1 enqueue
    app/api/deck/[id]/generate/route.ts  stage 2 enqueue
    app/api/deck/[id]/chat/route.ts      revise
    app/api/deck/[id]/theme/route.ts     switch theme
    app/api/deck/[id]/export/route.ts    PDF
    app/api/deck/[id]/share/route.ts     publish toggle + slug
    app/api/generation/[jobId]/route.ts  poll status
    app/api/generation/[jobId]/stream/route.ts  SSE progress
    app/api/public/[slug]/route.ts reader data
    components/blocks/             one renderer per Block type
    components/editor/             BlockEditor, BlockToolbar, CardCanvas
    components/theme/ThemePicker.tsx
    components/ai/ChatPanel.tsx
    components/reader/             ReaderCard, ReaderChrome
    test/                          integration (supertest)
  apps/worker/
    src/index.ts                   loop: claim job → run stage → persist
    src/pipeline.ts                outline + card generation orchestration
    test/pipeline.test.ts
  e2e/
    playwright.config.ts
    tests/                         Task 13 + 14
```

---

### Task 1: Monorepo scaffold + shared core model

**Files:**
- Create: `package.json`, `turbo.json`, `.env.example`, `tsconfig.base.json`
- Create: `packages/core/package.json`, `packages/core/src/{blocks,theme,outline,serialize}.ts`
- Test: `packages/core/test/{blocks,theme,outline}.test.ts`

**Interfaces:**
- Produces: `Block`, `Inline`, `Theme`, `OutlineCard` types; `applyThemeTokens(theme): Record<string,string>`; `moveOutlineCard(cards, from, to)`, `addOutlineCard`, `removeOutlineCard`, `renameOutlineCard`; `inlineToPlainText(inline)`. All later tasks import from `@carddeck/core`.

- [ ] **Step 1: Write failing tests for the block model and theme tokens**

```ts
// packages/core/test/blocks.test.ts
import { describe, it, expect } from "vitest";
import { isInline, inlineToPlainText } from "../src/blocks";
import { inlineToPlainText as plain } from "../src/serialize";

describe("Inline model", () => {
  it("treats a bare string as inline", () => {
    expect(isInline("hello")).toBe(true);
    expect(isInline({ text: "hi", bold: true })).toBe(true);
    expect(isInline({ type: "paragraph", text: [] })).toBe(false);
  });
  it("flattens inline to plain text", () => {
    expect(plain([{ text: "big ", bold: true }, "idea"])).toBe("big idea");
  });
});
```

```ts
// packages/core/test/theme.test.ts
import { describe, it, expect } from "vitest";
import { PRESET_THEMES, applyThemeTokens } from "../src/theme";

describe("theme tokens", () => {
  it("maps a theme to CSS custom properties", () => {
    const t = PRESET_THEMES.find(x => x.name === "Midnight")!;
    const vars = applyThemeTokens(t);
    expect(vars["--page"]).toBe(t.colors.page);
    expect(vars["--surface"]).toBe(t.colors.surface);
    expect(vars["--ink"]).toBe(t.colors.ink);
    expect(vars["--accent"]).toBe(t.colors.accent);
    expect(vars["--font-display"]).toBe(t.fonts.display);
    expect(vars["--font-body"]).toBe(t.fonts.body);
  });
  it("ships at least 8 presets", () => {
    expect(PRESET_THEMES.length).toBeGreaterThanOrEqual(8);
  });
});
```

```ts
// packages/core/test/outline.test.ts
import { describe, it, expect } from "vitest";
import { moveOutlineCard, addOutlineCard, removeOutlineCard, renameOutlineCard } from "../src/outline";
import type { OutlineCard } from "../src/outline";

const cards = (): OutlineCard[] => [
  { id: "a", title: "Intro", intent: "hook" },
  { id: "b", title: "Plan", intent: "body" },
  { id: "c", title: "Ask", intent: "close" },
];

describe("outline reducers", () => {
  it("moves a card", () => {
    expect(moveOutlineCard(cards(), 2, 0).map(c => c.id)).toEqual(["c", "a", "b"]);
  });
  it("adds after an index", () => {
    expect(addOutlineCard(cards(), 1, { id: "n", title: "New", intent: "" }).map(c => c.id))
      .toEqual(["a", "n", "b", "c"]);
  });
  it("removes by id", () => {
    expect(removeOutlineCard(cards(), "b").map(c => c.id)).toEqual(["a", "c"]);
  });
  it("renames by id", () => {
    expect(renameOutlineCard(cards(), "b", "Renamed")[1].title).toBe("Renamed");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm install && npm test -w @carddeck/core`
Expected: FAIL — modules not found / no tests yet.

- [ ] **Step 3: Implement `packages/core/src/{blocks,serialize,theme,outline}.ts`**

Define `Block`/`Inline` exactly as in the spec (union of heading, paragraph, bulletList, numberedList, image, quote, divider, columns, callout, chart). `Theme = { id, name, isPreset, fonts:{display,body}, colors:{page,surface,ink,accent,muted}, radius, shadow }`. `PRESET_THEMES` = 8 named themes (Light, Dark, Midnight, Sunset, Forest, Mono, Paper, Neon). `applyThemeTokens(theme): Record<string,string>` returns the `--*` map. Outline reducers are pure array functions returning new arrays.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @carddeck/core`
Expected: PASS (all three test files).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): block model, theme tokens, outline reducers"
```

---

### Task 2: AI provider interface + deterministic StubProvider + OpenAI provider

**Files:**
- Create: `packages/ai/package.json`, `src/{types,stub,openai,prompts,validate}.ts`
- Test: `packages/ai/test/{stub,validate,openai}.test.ts`

**Interfaces:**
- Consumes: `Block`, `OutlineCard` from Task 1.
- Produces: `AIProvider` interface `{ name; generateOutline(req: OutlineRequest): Promise<OutlineCard[]>; generateCard(req: CardRequest): Promise<Block[]>; revise(req: ReviseRequest): Promise<ReviseResult> }`. `OutlineRequest = { prompt, format, numCards, tone? }`; `CardRequest = { outline: OutlineCard, context: OutlineCard[], format, themeName }`; `ReviseRequest = { instruction, blocks, cardTitle }`. `ReviseResult = { blocks: Block[], note?: string }`. `createProvider(): AIProvider` returns `OpenAIProvider` if `OPENAI_API_KEY` set else `StubProvider`. `validateOutline(raw: unknown, numCards)` and `validateBlocks(raw: unknown)` throw `AIValidationError` on bad shape.

- [ ] **Step 1: Write failing tests for StubProvider determinism**

```ts
// packages/ai/test/stub.test.ts
import { describe, it, expect } from "vitest";
import { StubProvider } from "../src/stub";

describe("StubProvider", () => {
  it("is deterministic for the same prompt", async () => {
    const p = new StubProvider();
    const a = await p.generateOutline({ prompt: "Q3 launch", format: "presentation", numCards: 6 });
    const b = await p.generateOutline({ prompt: "Q3 launch", format: "presentation", numCards: 6 });
    expect(a).toEqual(b);
    expect(a).toHaveLength(6);
    expect(a[0].title.length).toBeGreaterThan(0);
  });
  it("returns blocks that parse as a cover card then content", async () => {
    const p = new StubProvider();
    const outline = await p.generateOutline({ prompt: "x", format: "presentation", numCards: 2 });
    const blocks = await p.generateCard({ outline: outline[0], context: outline, format: "presentation", themeName: "Light" });
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.some(b => b.type === "heading" || b.type === "image")).toBe(true);
  });
  it("never throws on revise", async () => {
    const p = new StubProvider();
    const r = await p.revise({ instruction: "shorter", blocks: [{ type: "paragraph", text: ["long text here"] }], cardTitle: "T" });
    expect(r.blocks.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Write failing validation tests**

```ts
// packages/ai/test/validate.test.ts
import { describe, it, expect } from "vitest";
import { validateOutline, validateBlocks, AIValidationError } from "../src/validate";

describe("output validation", () => {
  it("accepts a well-formed outline", () => {
    const out = validateOutline([{ title: "A", intent: "b" }, { title: "B", intent: "c" }], 2);
    expect(out).toHaveLength(2);
    expect(out[0].id).toMatch(/^card-/);
  });
  it("rejects a non-array outline", () => {
    expect(() => validateOutline("nope", 2)).toThrow(AIValidationError);
  });
  it("accepts a valid block array", () => {
    expect(validateBlocks([{ type: "heading", level: 1, text: ["Hi"] }])).toHaveLength(1);
  });
  it("rejects a block with an unknown type", () => {
    expect(() => validateBlocks([{ type: "sparkle" }])).toThrow(AIValidationError);
  });
});
```

- [ ] **Step 3: Write a failing test for OpenAIProvider with a mocked fetch**

```ts
// packages/ai/test/openai.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenAIProvider } from "../src/openai";

afterEach(() => vi.unstubAllGlobals());

describe("OpenAIProvider", () => {
  it("parses a chat completion into an outline", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify([{ title: "One", intent: "a" }]) } }],
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const p = new OpenAIProvider({ apiKey: "k", model: "gpt-4o-mini", baseUrl: "https://x/v1" });
    const out = await p.generateOutline({ prompt: "p", format: "presentation", numCards: 1 });
    expect(out[0].title).toBe("One");
  });
  it("throws a typed error on non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const p = new OpenAIProvider({ apiKey: "k", model: "m", baseUrl: "https://x/v1" });
    await expect(p.generateOutline({ prompt: "p", format: "presentation", numCards: 1 })).rejects.toThrow();
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test -w @carddeck/ai`
Expected: FAIL — modules not found.

- [ ] **Step 5: Implement `packages/ai/src/*`**

`types.ts` defines the interface + request/result types from the Interfaces block. `stub.ts` builds deterministic outlines by splitting the prompt into `numCards` titled sections and emitting realistic blocks (cover card with a `columns`/`image` layout, content cards with heading+paragraph+bulletList, a `quote` card, a closing card). `prompts.ts` exports `outlineSystem()`, `outlineUser(req)`, `cardSystem()`, `cardUser(req)`, `reviseSystem()`, `reviseUser(req)` returning strings that demand strict JSON. `validate.ts` implements the two validators + `AIValidationError`. `openai.ts` posts to `{baseUrl}/chat/completions` with `response_format: { type: "json_object" }`, one retry on 5xx, timeout via `AbortSignal.timeout(30000)`, then validates. `index.ts` exports `createProvider()`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -w @carddeck/ai`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(ai): provider interface, stub + openai providers, validators"
```

---

### Task 3: SQLite schema, migrations, and DB client

**Files:**
- Create: `apps/web/package.json`, `apps/web/drizzle/schema.ts`, `apps/web/lib/db.ts`
- Create: `apps/web/drizzle/0000_init.sql` (generated), `apps/web/drizzle.config.ts`
- Test: `apps/web/test/db.test.ts`

**Interfaces:**
- Consumes: `Block`, `Theme` from Task 1.
- Produces: Drizzle tables `user`, `deck`, `card`, `theme`, `generationJob`, `chatMessage` and `getDb()` returning the Drizzle client. `deck.themeId` → `theme.id`; `card.blocks` stored as JSON text, typed as `Block[]` at the edge via a `blocksCodec`.

- [ ] **Step 1: Write a failing schema test**

```ts
// apps/web/test/db.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { makeTestDb } from "../lib/db";
import * as t from "../drizzle/schema";

describe("schema", () => {
  beforeAll(() => { /* makeTestDb sets an in-memory/file sqlite for the suite */ });
  it("round-trips a deck with cards and a theme", async () => {
    const db = makeTestDb();
    const themeId = (await db.insert(t.theme).values({ id: "midnight", name: "Midnight", isPreset: 1, tokens: JSON.stringify({}) }).returning())[0].id;
    const deckId = (await db.insert(t.deck).values({ userId: "u1", title: "T", format: "presentation", themeId, status: "draft", isPublic: 0 }).returning())[0].id;
    await db.insert(t.card).values({ deckId, position: 0, title: "Cover", blocks: JSON.stringify([{ type: "heading", level: 1, text: ["Hi"] }]), status: "ready" });
    const deck = await db.query.deck.findFirst({ where: (d, { eq }) => eq(d.id, deckId) });
    expect(deck?.title).toBe("T");
    const cards = await db.query.card.findMany({ where: (c, { eq }) => eq(c.deckId, deckId) });
    expect(JSON.parse(cards[0].blocks as unknown as string)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web`
Expected: FAIL — no schema/db module.

- [ ] **Step 3: Implement schema + `getDb()`/`makeTestDb()`**

Define columns per the spec's data model. `generationJob.progress` is a JSON string `{ done, total }`. `makeTestDb()` builds an isolated SQLite file per test run and runs migrations. `getDb()` memoizes the app singleton using `DATA_DIR ?? ./data`.

- [ ] **Step 4: Generate + apply migration, run test to pass**

Run: `npm run db:generate -w web && npm test -w web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): drizzle schema + sqlite client"
```

---

### Task 4: Auth (register / login / logout / session)

**Files:**
- Create: `apps/web/lib/auth.ts`, `apps/web/app/api/auth/{register,login,logout}/route.ts`
- Test: `apps/web/test/auth.test.ts`

**Interfaces:**
- Consumes: `getDb()`, `t.user`.
- Produces: `hashPassword(pw): Promise<string>`, `verifyPassword(hash, pw): Promise<boolean>`, `createSession(userId): Promise<cookies-set>`, `getSession(): Promise<{ userId } | null>`, `destroySession()`. Route handlers `POST /api/auth/register` `{email,password,name}` → 201 `{user}`, `POST /api/auth/login` → 200, `POST /api/auth/logout` → 204. `getSession()` is used by every owner-gated task later.

- [ ] **Step 1: Write failing auth tests**

```ts
// apps/web/test/auth.test.ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../lib/auth";

describe("password hashing", () => {
  it("hashes and verifies", async () => {
    const h = await hashPassword("correct horse");
    expect(await verifyPassword(h, "correct horse")).toBe(true);
    expect(await verifyPassword(h, "wrong")).toBe(false);
  });
  it("never returns the raw password", async () => {
    const h = await hashPassword("secret123");
    expect(h).not.toContain("secret123");
  });
});
```
Also add a route test that POSTs register then login to the in-process handler and asserts a session cookie is set (use `next-server` test helper or call the handler with a mocked `cookies()`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web`
Expected: FAIL.

- [ ] **Step 3: Implement `lib/auth.ts` + the three route handlers**

Use `@node-rs/argon2` for hashing. Session cookie value = `base64url(userId).hmac` signed with `SESSION_SECRET` (>=32 chars; fail fast in prod if unset). `getSession()` verifies signature + expiry (7 days) and returns `{ userId }` or `null`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): argon2 auth + signed session cookie"
```

---

### Task 5: Deck + card CRUD routes and the DB job queue

**Files:**
- Create: `apps/web/lib/queue.ts`, `apps/web/app/api/deck/route.ts`, `apps/web/app/api/deck/[id]/route.ts`, `apps/web/app/api/deck/[id]/cards/route.ts`, `apps/web/app/api/deck/[id]/cards/[cardId]/route.ts`, `apps/web/app/api/deck/[id]/theme/route.ts`, `apps/web/app/api/deck/[id]/share/route.ts`
- Test: `apps/web/test/{deck,queue}.test.ts`

**Interfaces:**
- Consumes: Task 3 schema, Task 4 `getSession()`.
- Produces: `enqueueJob(deckId, stage, input): Promise<GenerationJob>`, `claimNextJob(): Promise<GenerationJob|null>`, `updateJob(id, patch)`. REST: `POST/GET /api/deck`, `GET/PATCH/DELETE /api/deck/[id]`, `POST /api/deck/[id]/cards` (add at position), `PATCH/DELETE /api/deck/[id]/cards/[cardId]`, `POST /api/deck/[id]/cards/reorder` `{order: string[]}`, `PATCH /api/deck/[id]/theme` `{themeId}`, `PATCH /api/deck/[id]/share` `{isPublic}` → `{shareSlug}`.

- [ ] **Step 1: Write failing queue tests**

```ts
// apps/web/test/queue.test.ts
import { describe, it, expect } from "vitest";
import { makeTestDb, setTestDb } from "../lib/db";
import { enqueueJob, claimNextJob, updateJob } from "../lib/queue";

describe("job queue", () => {
  it("enqueues then claims a pending job", async () => {
    setTestDb(makeTestDb());
    const job = await enqueueJob("deck1", "outline", { prompt: "p", numCards: 3 });
    const claimed = await claimNextJob();
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.status).toBe("running");
  });
  it("does not double-claim", async () => {
    const a = await claimNextJob();
    const b = await claimNextJob();
    expect(b === null || b.id !== a?.id).toBe(true);
  });
  it("persists progress patches", async () => {
    const job = await enqueueJob("d", "cards", {});
    await updateJob(job.id, { progress: JSON.stringify({ done: 1, total: 3 }) });
    const again = await claimNextJob();
    expect(JSON.parse(again!.progress!).done).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w web`
Expected: FAIL.

- [ ] **Step 3: Implement `lib/queue.ts`**

`enqueueJob` refuses a second `running|pending` job for the same `(deckId, stage)` and returns the existing one (Task 2's idempotency constraint). `claimNextJob` atomically flips the oldest `pending` job to `running` inside a transaction.

- [ ] **Step 4: Write failing deck/card REST tests (supertest against the handlers)**

Cover: create deck (auth required → 401 without session), list own decks only, add card at position, reorder persists, delete card, theme switch sets `deck.themeId`, share toggle returns a stable `shareSlug`.

- [ ] **Step 5: Run, implement handlers, run to pass**

Run: `npm test -w web`
Expected: PASS after implementing the route handlers with an `requireUser()` guard (401) and 404 on non-owned deck.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(web): deck/card CRUD, theme switch, share, DB job queue"
```

---

### Task 6: Theme renderer (CSS vars) + theme picker component

**Files:**
- Create: `apps/web/app/globals.css` theme-var block, `apps/web/components/theme/ThemePicker.tsx`, `apps/web/lib/themes-presets.ts`
- Test: `apps/web/test/theme-render.test.ts`

**Interfaces:**
- Consumes: `PRESET_THEMES`, `applyThemeTokens` from Task 1; `PATCH /api/deck/[id]/theme` from Task 5.
- Produces: `<ThemePicker deckId themeId onChange>`; `deckCssVars(theme): React.CSSProperties` used by the editor, reader, and present pages.

- [ ] **Step 1: Write failing test**

```ts
// apps/web/test/theme-render.test.ts
import { describe, it, expect } from "vitest";
import { deckCssVars } from "../lib/themes-presets";
import { PRESET_THEMES } from "@carddeck/core";

describe("deckCssVars", () => {
  it("produces a style object of custom properties", () => {
    const style = deckCssVars(PRESET_THEMES[0]);
    expect(style["--page"]).toBeDefined();
    expect(style["--font-display"]).toBeDefined();
  });
});
```

- [ ] **Step 2: Run, verify FAIL, implement, verify PASS**

Run: `npm test -w web`
Expected: PASS after `deckCssVars` wraps `applyThemeTokens` and `globals.css` adds `.deck { color: var(--ink); background: var(--page); font-family: var(--font-body); }` plus card surface/radius/shadow utility classes.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(web): theme token renderer + picker"
```

---

### Task 7: Outline stage route (stage 1) + generate route (stage 2 enqueue)

**Files:**
- Create: `apps/web/app/api/deck/[id]/outline/route.ts`, `apps/web/app/api/deck/[id]/generate/route.ts`
- Test: `apps/web/test/generation-enqueue.test.ts`

**Interfaces:**
- Consumes: `createProvider()` (Task 2), `enqueueJob` (Task 5).
- Produces: `POST /api/deck/[id]/outline` `{prompt, numCards, tone?}` → enqueues `outline` job, returns `{jobId}`. `POST /api/deck/[id]/generate` `{}` → enqueues `cards` job (requires an outline present), returns `{jobId}`. Both are idempotent per the queue rule.

- [ ] **Step 1: Write failing tests**

```ts
// apps/web/test/generation-enqueue.test.ts
import { describe, it, expect } from "vitest";
// route-level: auth-guarded, valid prompt enqueues one job, second POST returns same jobId,
// prompt > 4000 chars → 400, numCards > 30 → 400, generate without outline → 409.
```
Assert the four behaviors named in the comment.

- [ ] **Step 2: Run, verify FAIL, implement, verify PASS**

Run: `npm test -w web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(web): outline + generate enqueue routes with validation"
```

---

### Task 8: Worker pipeline — outline generation, card streaming, partial-failure handling

**Files:**
- Create: `apps/worker/package.json`, `apps/worker/src/{index,pipeline}.ts`
- Test: `apps/worker/test/pipeline.test.ts`

**Interfaces:**
- Consumes: `claimNextJob`/`updateJob` (Task 5), `createProvider()` (Task 2), schema (Task 3).
- Produces: `runOutlineJob(job)`, `runCardsJob(job)`, `runChatJob(job)`; `startWorker({ pollMs })`. `runCardsJob` writes each card's blocks to `card` as it completes and bumps `job.progress`.

- [ ] **Step 1: Write failing pipeline tests (StubProvider)**

```ts
// apps/worker/test/pipeline.test.ts
import { describe, it, expect } from "vitest";
import { runOutlineJob, runCardsJob } from "../src/pipeline";

describe("pipeline", () => {
  it("outline job writes outline cards to the deck", async () => {
    // seed deck, enqueue outline job, runOutlineJob(job)
    // expect deck.status === "outline" and N card rows with status "pending"
  });
  it("cards job fills blocks and reports progress", async () => {
    // runCardsJob(job) → every card has blocks, deck.status === "ready", job.progress.done === total
  });
  it("a failing card keeps completed cards and marks the job error", async () => {
    // provider stub whose generateCard throws on the 2nd call
    // expect card[0].blocks present, card[1].status === "error", job.status === "error", deck.status !== "ready"
  });
  it("cancellation stops remaining cards", async () => {
    // cancel the job mid-run → later cards stay pending, job.status === "cancelled"
  });
});
```

- [ ] **Step 2: Run, verify FAIL, implement `pipeline.ts`, verify PASS**

Run: `npm test -w worker`
Expected: PASS. `runCardsJob` uses a small concurrency pool (limit 3) and `Promise.allSettled` so one throw doesn't kill the rest. `index.ts` polls `claimNextJob` every `pollMs ?? 500`.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(worker): outline/card/chat pipeline with partial failure + progress"
```

---

### Task 9: Card block renderers + editor canvas

**Files:**
- Create: `apps/web/components/blocks/*.tsx` (one per Block type), `apps/web/components/editor/{BlockEditor,BlockToolbar,CardCanvas}.tsx`, `apps/web/app/deck/[id]/page.tsx`
- Test: `apps/web/test/render.test.tsx` (Vitest + @testing-library/react)

**Interfaces:**
- Consumes: `Block` (Task 1), `deckCssVars` (Task 6), card REST (Task 5).
- Produces: `<BlockRenderer block theme />`; `<CardCanvas deck cards onEditCard>`; `<BlockEditor blocks onChange>` with a toolbar (bold/italic/link/list/image/columns/callout/chart/divider). Editing calls `PATCH /api/deck/[id]/cards/[cardId]`.

- [ ] **Step 1: Write failing render tests**

```tsx
// apps/web/test/render.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BlockRenderer } from "../components/blocks";
import { PRESET_THEMES } from "@carddeck/core";

describe("block renderers", () => {
  it("renders a heading with theme font var", () => {
    render(<BlockRenderer block={{ type: "heading", level: 1, text: ["Big Idea"] }} theme={PRESET_THEMES[0]} />);
    expect(screen.getByRole("heading", { level: 1, name: "Big Idea" })).toBeTruthy();
  });
  it("renders a quote with accent border class", () => {
    const { container } = render(<BlockRenderer block={{ type: "quote", text: ["trust"] }} theme={PRESET_THEMES[0]} />);
    expect(container.querySelector("[data-block=quote]")).toBeTruthy();
  });
  it("renders columns with one cell per column", () => {
    const { container } = render(<BlockRenderer block={{ type: "columns", columns: [[{ type: "paragraph", text: ["a"] }], [{ type: "paragraph", text: ["b"] }]] }} theme={PRESET_THEMES[0]} />);
    expect(container.querySelectorAll("[data-column]").length).toBe(2);
  });
  it("renders a chart without crashing", () => {
    render(<BlockRenderer block={{ type: "chart", kind: "bar", data: { labels: ["a"], series: [{ name: "s", values: [1] }] } }} theme={PRESET_THEMES[0]} />);
    expect(screen.getByText("s")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, verify FAIL, implement renderers + editor, verify PASS**

Run: `npm test -w web`
Expected: PASS. Renderers emit `data-block="<type>"` wrappers for tests and styling. `BlockEditor` is a controlled list of editable block cards; no ProseMirror.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(web): block renderers + inline block editor"
```

---

### Task 10: SSE progress stream + generation UI (skeleton cards, stop button)

**Files:**
- Create: `apps/web/app/api/generation/[jobId]/{route,stream/route}.ts`, `apps/web/components/editor/GenerationView.tsx`
- Test: `apps/web/test/progress.test.ts`

**Interfaces:**
- Consumes: `updateJob` (Task 5), worker writes (Task 8).
- Produces: `GET /api/generation/[jobId]` → `{status, progress, error}`; `GET /api/generation/[jobId]/stream` → SSE emitting `progress`, `card`, `done`, `error` events. `<GenerationView deckId jobId onDone>` renders a shimmer skeleton per pending card, fills cards as `card` events arrive, and exposes **Stop** → `PATCH /api/generation/[jobId]` `{action:"cancel"}`.

- [ ] **Step 1: Write failing tests**

```ts
// apps/web/test/progress.test.ts
import { describe, it, expect } from "vitest";
// GET poll returns {status, progress:{done,total}}
// PATCH cancel sets job.status === "cancelled"
// stream handler emits a "progress" event after updateJob (read the ReadableStream)
```

- [ ] **Step 2: Run, verify FAIL, implement, verify PASS**

Run: `npm test -w web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(web): SSE progress stream + streaming generation UI"
```

---

### Task 11: AI chat panel (revise a card / whole deck)

**Files:**
- Create: `apps/web/app/api/deck/[id]/chat/route.ts`, `apps/web/components/ai/ChatPanel.tsx`
- Test: `apps/web/test/chat.test.ts`

**Interfaces:**
- Consumes: `createProvider().revise` (Task 2), `chatMessage` schema (Task 3).
- Produces: `POST /api/deck/[id]/chat` `{cardId?, instruction}` → persists the exchange, updates the target card's `blocks` (or the named card), returns `{blocks, note}`. `<ChatPanel deckId cardId onApplied>`.

- [ ] **Step 1: Write failing tests**

```ts
// apps/web/test/chat.test.ts
import { describe, it, expect } from "vitest";
// POST chat with cardId updates that card's blocks and appends 2 chatMessage rows
// POST chat without cardId → 400 (v1 requires a target card)
// auth guard → 401
```

- [ ] **Step 2: Run, verify FAIL, implement, verify PASS**

Run: `npm test -w web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(web): AI chat revise panel"
```

---

### Task 12: Reader, present mode, share, public data route

**Files:**
- Create: `apps/web/app/view/[slug]/page.tsx`, `apps/web/app/deck/[id]/present/page.tsx`, `apps/web/app/api/public/[slug]/route.ts`, `apps/web/components/reader/{ReaderChrome,ReaderCard}.tsx`
- Test: `apps/web/test/reader.test.ts`

**Interfaces:**
- Consumes: `BlockRenderer`, `deckCssVars`, share route (Task 5).
- Produces: `<ReaderCard card theme />`, `<ReaderChrome title author>`; `/view/[slug]` renders all cards vertically; present mode is full-screen, arrow-key navigated, with a progress bar.

- [ ] **Step 1: Write failing tests**

```ts
// apps/web/test/reader.test.ts
import { describe, it, expect } from "vitest";
// GET /api/public/[slug] for a public deck → 200 {title, theme, cards}
// GET /api/public/[slug] for a private deck → 404 and body does not contain owner email
// ReaderCard renders the card title
```

- [ ] **Step 2: Run, verify FAIL, implement, verify PASS**

Run: `npm test -w web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(web): public reader, present mode, share"
```

---

### Task 13: PDF export route

**Files:**
- Create: `apps/web/app/api/deck/[id]/export/route.ts`
- Test: `apps/web/test/export.test.ts`

**Interfaces:**
- Consumes: Playwright chromium, reader route (Task 12).
- Produces: `GET /api/deck/[id]/export` → `application/pdf` attachment; re-checks `isPublic || owner`; presentation format uses one PDF page per card.

- [ ] **Step 1: Write failing test**

```ts
// apps/web/test/export.test.ts
import { describe, it, expect } from "vitest";
// auth'd export returns bytes starting with "%PDF"
// non-owner without public deck → 404
```

- [ ] **Step 2: Run, verify FAIL, implement, verify PASS**

Run: `npm test -w web`
Expected: PASS. Use `playwright.chromium.launch()` and `page.pdf({ format: "A4", landscape: format==="presentation" })`. Skip cleanly with a clear message if the browser isn't installed.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(web): PDF export via headless chromium"
```

---

### Task 14: Landing, dashboard, creation flow, E2E suite

**Files:**
- Create: `apps/web/app/page.tsx`, `apps/web/app/dashboard/page.tsx`, `apps/web/app/new/page.tsx`, `e2e/playwright.config.ts`, `e2e/tests/*.spec.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: the marketing landing, the deck dashboard, and the `/new` creation flow wiring prompt → outline editor → theme → Generate.

- [ ] **Step 1: Build landing + dashboard + `/new` flow**

Landing mirrors the Gamma shell (hero + sample deck strip + CTA). Dashboard lists the user's decks with a **Create new** button. `/new` collects mode/format/numCards/tone, shows the editable outline, then routes to `/deck/[id]`.

- [ ] **Step 2: Write Playwright E2E specs covering the success criteria**

```ts
// e2e/tests/generate.spec.ts
test("prompt → outline → streamed cards → ready", async ({ page }) => { /* register, create, fill prompt, generate outline, edit an outline title, pick theme, generate, expect cards to stream in and reach ready */ });
test("theme switch re-skins without re-render", async ({ page }) => { /* change theme, assert --page var changes and card text node persists */ });
test("present mode advances with arrows", async ({ page }) => { /* open present, press ArrowRight, expect progress */ });
test("public reader works signed out", async ({ browser }) => { /* new context (no cookie) opens /view/[slug], sees title */ });
test("partial failure shows per-card retry", async ({ page }) => { /* force a card error (test hook), expect retry button */ });
```
E2E base URL `http://localhost:3000`; the suite boots web + worker with `StubProvider` and an isolated `DATA_DIR`.

- [ ] **Step 3: Run E2E to verify they pass**

Run: `npm run e2e`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(web): landing, dashboard, creation flow + e2e suite"
```

---

### Task 15: Docs, `.env.example`, README, final whole-branch review

**Files:**
- Create: `README.md`, `.env.example`, `docs/SETUP.md`
- Modify: none functional

**Interfaces:**
- Consumes: all tasks.
- Produces: a documented, runnable app.

- [ ] **Step 1: Write README + `.env.example`**

Document: install, `npm run dev` (web + worker, StubProvider, zero keys), `OPENAI_API_KEY`/`OPENAI_MODEL`/`OPENAI_BASE_URL` to go live, `SESSION_SECRET`, `DATA_DIR`, export/browser install (`npx playwright install chromium`), and the test matrix (`npm test`, `npm run e2e`).

- [ ] **Step 2: Full-branch verification**

Run: `npm test && npm run e2e`
Expected: everything green; no task regressed a neighbor.

- [ ] **Step 3: Request code review (whole branch)**

Use superpowers:requesting-code-review before declaring done.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: setup guide + env example"
```
