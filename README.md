# Carddeck

A clean-room, Gamma-style AI presentation studio: describe your deck, reshape
the generated outline, watch themed cards stream in card-by-card, then export a
**real, editable PowerPoint (.pptx)** — or a PDF — in one click. Works with zero
API keys out of the box.

```
Prompt → editable outline → AI-generated themed deck → refine → Present / Share / Export .pptx
```

## Features

- **Prompt → outline → deck.** Describe the deck (format, card count, tone);
  the worker drafts an outline you can rename, extend, and trim; generation
  then streams cards in live over server-sent events.
- **PowerPoint export first-class.** `/api/deck/[id]/export/pptx` renders a
  fully editable, OOXML-correct .pptx (16:9, theme colors, real text runs) —
  plus `.potx` theme templates and print-quality **PDF** (headless Chromium).
- **Editable canvas.** Every card edits in place — headings, paragraphs, lists,
  quotes, callouts, images, tables, charts — with optimistic saves.
- **Themes.** Six presets (Light, Dark, Midnight, Paper, Sunset, Terminal);
  switch any deck instantly without losing your editing session.
- **Chat refine.** Ask for changes to a single card ("shorten this", "make it
  punchier") and watch the diff apply.
- **Present & share.** Full-screen present mode (arrow keys, progress bar) and
  public read-only share links.
- **Accounts.** Email + password (argon2), HMAC-signed session cookies,
  owner-gated decks.

## Quickstart (zero keys)

```bash
npm install
npm run dev        # web on http://localhost:3000 + worker, StubProvider active
```

Open http://localhost:3000, create an account, and make a deck. The default
**StubProvider** is deterministic and offline — same prompt, same deck — so the
whole product is usable before you wire up any AI credentials. The SQLite
database is created (and migrated) automatically under `DATA_DIR`.

## Going live with a real model

Set an OpenAI API key and the app switches to real generation. Any
OpenAI-compatible endpoint works via `OPENAI_BASE_URL`.

```bash
cp .env.example .env
# then set:
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini        # or any chat model
OPENAI_BASE_URL=                # optional: e.g. http://localhost:11434/v1
```

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | _(unset)_ | Presence of this key switches `StubProvider` → `OpenAIProvider`. |
| `OPENAI_MODEL` | `gpt-4o-mini` | Chat model used for outlines, cards, and revisions. |
| `OPENAI_BASE_URL` | OpenAI public API | Any OpenAI-compatible endpoint. |
| `SESSION_SECRET` | dev-insecure default | HMAC key for session cookies. **Required in production** (≥32 chars); dev warns and falls back. |
| `DATA_DIR` | `./data` (anchored to the repo root) | SQLite database + generated artifacts. |
| `WORKER_POLL_MS` | `500` | Worker's job-queue polling interval. |
| `CARDDECK_E2E_HOOKS` | _(unset)_ | `1` arms the stub's deterministic `[fail]` failure hook — set only by the E2E runner. |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Web (Next.js dev) + worker (tsx watch) via turbo. |
| `npm run build` | Production build of every workspace. |
| `npm test` | Unit/integration suites (Vitest) across all workspaces. |
| `npm run e2e` | Playwright end-to-end suite (builds web, boots production web + worker against an isolated `e2e/.data`). |

## Exporting

- **PowerPoint (.pptx)** — no extra setup; the pipeline is DOM-free
  (`packages/pptx`: `pptxgenjs` + `html2pptx`).
- **PDF** — uses headless Chromium via Playwright. One-time browser install:

  ```bash
  npx playwright install chromium
  ```

  Without it, the PDF endpoint answers `503` with that exact hint; everything
  else keeps working.

## Architecture

```
turborepo
├── apps/web        Next.js 15 (App Router) — UI, REST API, SSE stream,
│                   export routes (pptx/potx/pdf), auth
├── apps/worker     tsx process — claims jobs from the SQLite queue and runs
│                   the outline / cards / chat pipelines against packages/ai
├── packages/core   shared types, theme presets, block model, validation
├── packages/ai     AIProvider interface + StubProvider (default) + OpenAIProvider
├── packages/pptx   DOM-free deck renderers: slide HTML for .pptx/.potx and
│                   paged-media print HTML for .pdf
└── e2e             Playwright specs + serve.mjs (isolated prod-stack runner)
```

Flow: the browser POSTs an outline/generate job → the worker claims it from the
queue, writes cards as they settle, and flips deck status (`outline →
generating → ready|error`) — deck status is committed *before* the job row goes
terminal, so the SSE client can never see a finished job over a stale
"generating" deck. The web app folds SSE `card` events into the canvas live;
exports render server-side from the database, never from the screen.

## Testing

```bash
npm test         # 152 unit/integration tests (core, ai, pptx, worker, web)
npm run e2e      # 8 Playwright specs against a production build:
                 #   generate · theme · present · reader · retry · export
                 #   (pptx+pdf) · auth/landing/dashboard
```

## Further reading

- [`docs/SETUP.md`](docs/SETUP.md) — detailed setup, production notes,
  troubleshooting.
- [`docs/superpowers/specs/`](docs/superpowers/specs/) — design spec and the
  reverse-engineering findings this clean-room build is based on.

## Constraints

- ≤ 30 cards per deck, prompts ≤ 4 000 characters.
- Decks are owner-private until shared; public readers get `/view/[slug]` only.
