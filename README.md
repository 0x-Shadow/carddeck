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
- **Animations that survive export.** Subtle, punchy, and cinematic motion
  presets drive the web present mode *and* become real entrance animations and
  slide transitions inside the exported .pptx.
- **Images from anywhere.** Upload, link, or point an agent at a URL or a file
  on disk — images live in `DATA_DIR/assets`, print identically in PDFs, and
  embed as real pictures in .pptx exports.
- **Editable canvas.** Every card edits in place — headings, paragraphs,
  lists, quotes, callouts, images, dividers, columns, and charts — with
  optimistic saves.
- **Themes.** Eight presets (Light, Dark, Midnight, Sunset, Forest, Mono,
  Paper, Neon); switch any deck instantly without losing your editing session.
- **Agent-ready (MCP).** A local [MCP server](docs/MCP.md) lets OpenCode,
  Claude Code, Codex, and any MCP client build decks, add images, set motion,
  and export files for you — see [Agent integrations](#agent-integrations-mcp).
- **Chat refine.** Ask for a change to a single card ("shorten this", "make it
  punchier") — the revision is applied to the card in place.
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

## Agent integrations (MCP)

Carddeck ships a local **MCP server** ([`apps/mcp`](apps/mcp)): point OpenCode,
Claude Code, Codex, or any MCP client at it and your agent can build decks from
a prompt, add images from URLs or local folders, set themes and animations,
and export `.pptx` / `.pdf` / `.potx` files where you want them.

Prerequisite: `npm install` once, and the stack running (`npm run dev`, or the
Docker setup below) so generation jobs get worked off. Every client runs the
same command — an absolute path to a wrapper that pins the working directory:

```text
/path/to/gamma-clone/apps/mcp/bin/carddeck-mcp
```

- **OpenCode** — this repo's [`opencode.json`](opencode.json) already registers
  the server: run `opencode` in the repo and the tools appear. Everywhere else:
  `opencode mcp add --global carddeck -- /path/to/gamma-clone/apps/mcp/bin/carddeck-mcp`
- **Claude Code** —
  `claude mcp add --scope user carddeck -- /path/to/gamma-clone/apps/mcp/bin/carddeck-mcp`
- **Codex** —
  `codex mcp add carddeck -- /path/to/gamma-clone/apps/mcp/bin/carddeck-mcp`
  (or a `[mcp_servers.carddeck]` block in `~/.codex/config.toml` with
  `tool_timeout_sec = 180` — `create_deck` can wait on generation)
- **Claude Desktop / Cursor / VS Code / anything else** — stdio JSON snippets
  live in [docs/MCP.md](docs/MCP.md#client-setup).

Then ask for a deck — the agent drives the tools itself:

> Create a 10-slide deck about our Q3 launch, Midnight theme, cinematic
> animations, add `~/Pictures/cover.png` to the cover slide, and export the
> PowerPoint to `~/Desktop/q3`.

Tool reference, response shapes, and troubleshooting:
[docs/MCP.md](docs/MCP.md).

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
| `CARDDECK_MCP_USER` | `mcp@carddeck.local` | Owner account for decks created over MCP (auto-provisioned). |
| `CARDDECK_MOTION` | _(unset)_ | `off` strips animation injection from .pptx/.potx exports. |
| `CARDDECK_E2E_HOOKS` | _(unset)_ | `1` arms the stub's deterministic `[fail]` failure hook — set only by the E2E runner. |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Web (Next.js dev) + worker (tsx watch) via turbo. |
| `npm run build` | Production build of every workspace. |
| `npm start` | Production web + worker (turbo) — what the Docker image runs. |
| `npm test` | Unit/integration suites (Vitest) across all workspaces. |
| `npm run e2e` | Playwright end-to-end suite (builds web, boots production web + worker against an isolated `e2e/.data`). |

## Exporting

- **PowerPoint (.pptx)** — no extra setup; the pipeline is DOM-free
  (`packages/pptx`: `pptxgenjs` + `html2pptx`). Headings, paragraphs, lists,
  quotes, callouts, dividers, and columns come out fully editable and
  theme-colored; uploaded/linked **images embed as real pictures**; charts
  render as readable data summaries; and decks with a motion preset carry
  **real PowerPoint entrance animations + slide transitions**
  (`CARDDECK_MOTION=off` strips them). PDF export prints through a real
  browser, so it keeps images and charts exactly as they appear on screen.
- **PDF** — uses headless Chromium via Playwright. One-time browser install:

  ```bash
  npx playwright install chromium
  ```

  Without it, the PDF endpoint answers `503` with that exact hint; everything
  else keeps working.

## Self-hosting (Docker)

One container runs the web app and the worker, with Chromium included for PDF
export; all data lives in a named volume.

```bash
echo "CARDDECK_SESSION_SECRET=$(openssl rand -hex 32)" > .env
docker compose up -d --build
```

Open http://localhost:3000. Optional OpenAI settings go in the same `.env`
(`OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`); without them the
key-free stub generates. The `carddeck-data` volume holds the SQLite DB,
uploaded images, and exports — back it up by copying the volume. To let an
agent drive the containerized instance, point the MCP client at
`docker exec -i carddeck npx tsx apps/mcp/src/index.ts` — details in
[docs/MCP.md](docs/MCP.md#self-hosting).

## Architecture

```
turborepo
├── apps/web        Next.js 15 (App Router) — UI, REST API, SSE stream,
│                   export routes (pptx/potx/pdf), auth
├── apps/worker     tsx process — claims jobs from the SQLite queue and runs
│                   the outline and cards pipelines against packages/ai
│                   (chat refine is a synchronous in-request revision)
├── apps/mcp        stdio MCP server — agent tools (build, style, images,
│                   exports) over the same DB and DATA_DIR as the app
├── packages/core   shared types, theme presets, block model, validation
├── packages/ai     AIProvider interface + StubProvider (default) + OpenAIProvider
├── packages/pptx   DOM-free deck renderers: slide HTML + motion timing for
│                   .pptx/.potx and paged-media print HTML for .pdf
└── e2e             Playwright specs + serve.mjs (isolated prod-stack runner)
```

Flow: the browser POSTs an outline/generate job → the worker claims it from the
queue, writes cards as they settle, and flips deck status (`outline →
generating → ready|error`) — deck status is committed *before* the job row goes
terminal, so the SSE client can never see a finished job over a stale
"generating" deck. The web app folds SSE `card` events into the canvas live;
exports render server-side from the database, never from the screen. Agents
reach the same database through the stdio MCP server instead of HTTP — no
session, no port.

## Testing

```bash
npm test         # 277 unit/integration tests (core, ai, pptx, worker, mcp, web)
npm run e2e      # 8 Playwright specs against a production build:
                 #   generate · theme · present · reader · retry · export
                 #   (pptx+pdf) · auth/landing/dashboard
```

## Further reading

- [`docs/MCP.md`](docs/MCP.md) — connecting agents (OpenCode, Claude Code,
  Codex, …), the full tool reference, and self-hosting notes.
- [`docs/SETUP.md`](docs/SETUP.md) — detailed setup, production notes,
  troubleshooting.
- [`docs/superpowers/specs/`](docs/superpowers/specs/) — design spec and the
  reverse-engineering findings this clean-room build is based on.

## Constraints

- ≤ 30 cards per deck, prompts ≤ 4 000 characters.
- Images ≤ 10 MB (png/jpeg/webp/gif); URL fetches time out after 5 s.
- Decks are owner-private until shared; public readers get `/view/[slug]` only.
  (Decks created over MCP are shared read-only from birth — their link is the
  `url` tools return.)
