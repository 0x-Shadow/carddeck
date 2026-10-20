# Carddeck

[![CI](https://github.com/0x-Shadow/carddeck/actions/workflows/ci.yml/badge.svg)](https://github.com/0x-Shadow/carddeck/actions/workflows/ci.yml)

A clean-room, Gamma-style AI presentation studio: describe your deck, reshape
the generated outline, watch themed cards stream in card-by-card, then export a
**real, editable PowerPoint (.pptx)** — or a PDF — in one click. Works with zero
API keys out of the box.

```
Prompt → editable outline → AI-generated themed deck → refine → Present / Share / Export .pptx
```

![Carddeck in present mode](docs/assets/carddeck.gif)

## Features

- **Prompt → outline → deck.** Describe the deck (format, card count, tone);
  the worker drafts an outline you can rename, extend, and trim; generation
  then streams cards in live over server-sent events.
- **Two PowerPoint engines.** The default `native` renderer (PptxGenJS)
  keeps charts editable and injects real motion; the `pptagent` engine
  renders the same designed 1280×720 HTML slides as positioned, editable
  PowerPoint shapes — HTML-faithful composition with chart rasterization.
  Pick either in the UI, the HTTP route (`?engine=pptagent`), or MCP
  (`export_engine` / `engine`).
- **PowerPoint export first-class.** `/api/deck/[id]/export/pptx` renders a
  composed, fully editable, OOXML-correct .pptx (16:9, theme typography and
  color, real text runs, native data-backed charts) — plus `.potx` theme
  templates and print-quality **PDF** (headless Chromium) from the same slide
  composition.
- **Animations that survive export.** Subtle, punchy, cinematic, and 3D motion
  presets drive the web present mode *and* become real entrance animations and
  slide transitions inside the exported .pptx. Re-exporting keeps the stored
  plan intact.
- **Images from anywhere.** Upload, link, or point an agent at a URL or a file
  on disk — images live in `DATA_DIR/assets`, print identically in PDFs, and
  embed as real pictures in .pptx exports.
- **Editable canvas.** Every card edits in place — headings, paragraphs,
  lists, quotes, callouts, images, dividers, columns, and charts — with
  optimistic saves.
- **Themes.** Twelve presets (Cyberpunk, Aurora, Luxe, Minimal, Light, Dark,
  Midnight, Sunset, Forest, Mono, Paper, Neon); switch any deck instantly
  without losing your editing session.
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
Local databases, uploaded images, and generated exports are excluded from Git.

## Agent integrations (MCP)

Carddeck ships a local **MCP server** ([`apps/mcp`](apps/mcp)): point OpenCode,
Claude Code, Codex, or any MCP client at it and your agent can build decks from
a prompt, add images from URLs or local folders, set themes and animations,
and export `.pptx` / `.pdf` / `.potx` files where you want them.

### Install for an agent

```bash
git clone https://github.com/0x-Shadow/carddeck.git
cd carddeck
npm ci
npm run dev
```

Register this checkout's stdio server with your agent:

```bash
# OpenCode
opencode mcp add --global carddeck -- "$PWD/apps/mcp/bin/carddeck-mcp"

# Claude Code
claude mcp add --scope user carddeck -- "$PWD/apps/mcp/bin/carddeck-mcp"

# Codex
codex mcp add carddeck -- "$PWD/apps/mcp/bin/carddeck-mcp"
```

For VS Code, opening this checkout registers the workspace server from
`.vscode/mcp.json`. Other client setup, Docker instructions, and the full tool
reference are in [docs/MCP.md](docs/MCP.md).

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

## Contributing

Bug reports and focused pull requests are welcome. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) for development and review expectations.
Do not attach databases, exports, or private images to issues. Report suspected
vulnerabilities privately using [`SECURITY.md`](SECURITY.md).

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
| `CARDDECK_MOTION` | _(unset)_ | `off` strips animation injection from `.pptx` exports. |
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

- **PowerPoint (.pptx), two engines.** `native` (default) is the DOM-free
  designed pipeline (`packages/pptx`: `pptxgenjs`), fully editable and
  theme-colored, with real text runs, native data-backed charts, and real
  PowerPoint entrance animations + slide transitions; `pptagent` renders the
  same designed 1280×720 HTML slides through the vendored PPTAgent
  `html2pptx` converter into positioned shapes (HTML-faithful composition;
  charts rasterize). Choose in the UI's Export menu, the HTTP route
  (`?engine=pptagent`), or MCP (`engine`/`exportEngine`). The second engine
  never overwrites the first: its file is suffixed `(PPTAgent)`.
- Cover and closing layouts, editorial two-column slides, card grids, KPI
  tiles, quotes, callouts, and dividers come out fully editable and
  theme-colored; uploaded/linked **images embed as real pictures**; charts
  are **native OOXML charts with editable data** under the native engine;
  and decks with a motion preset carry **real PowerPoint entrance animations
  + slide transitions** (`CARDDECK_MOTION=off` strips them). PDF export
  prints the same composition through headless Chromium, so covers, side
  imagery, and charts match the deck.
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
│                   .pptx/.potx and paged-media print HTML for .pdf; plus the
│                   vendored PPTAgent html2pptx converter (packages/pptx/
│                   vendor/pptagent) used by the second PPTX engine
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
npm test         # 323 unit/integration tests (core, ai, pptx, worker, mcp, web)
npm run e2e      # 10 Playwright specs against a production build:
                 #   generate · theme · present · reader · retry · export
                 #   (pptx+pdf) · images · motion · auth/landing/dashboard
```

## Further reading

- [`docs/PPTAGENT.md`](docs/PPTAGENT.md) — the second PowerPoint engine
  (HTML → PPTX via the vendored PPTAgent converter): usage, engines
  compared, requirements, and limits.
- [`docs/MCP.md`](docs/MCP.md) — connecting agents (OpenCode, Claude Code,
  Codex, …), the full tool reference, and self-hosting notes.
- [`docs/SETUP.md`](docs/SETUP.md) — detailed setup, production notes,
  troubleshooting.

## Constraints

- ≤ 30 cards per deck, prompts ≤ 4 000 characters.
- Images ≤ 10 MB (png/jpeg/webp/gif); URL fetches time out after 5 s.
- Decks are owner-private until shared; public readers get `/view/[slug]` only.
  (Decks created over MCP are shared read-only from birth — their link is the
  `url` tools return.)
