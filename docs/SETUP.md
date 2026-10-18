# Carddeck — Setup Guide

Everything you need to run Carddeck locally, in production, and in CI.

## Prerequisites

- **Node.js 20+** (Next.js 15 requires ≥ 18.18; 20 LTS is tested)
- **npm 10+** (the repo pins `packageManager: npm@10.0.0`)
- A C toolchain for `better-sqlite3` (prebuilt binaries are normally used; if
  npm has to compile, `build-essential` / Xcode CLT must be present)

## Install

```bash
git clone <repo> carddeck && cd carddeck
npm install
```

> **npm install scripts:** the repo pins `allowScripts` in `package.json`.
> If npm blocks `better-sqlite3`'s install script and native-module errors
> appear, approve it once: `npm install-scripts approve better-sqlite3`.

## Development (zero keys)

```bash
npm run dev
```

This starts, via turbo:

- **web** — Next.js dev server on http://localhost:3000
- **worker** — `tsx watch` job runner polling every `WORKER_POLL_MS` (500ms)

The AI layer defaults to the deterministic **StubProvider**: no network, no
keys, same prompt → same deck. Everything (accounts, decks, chat refine,
present, share, **PPTX/POTX export**) is fully functional. PDF export additionally
needs a headless browser (see [PDF export](#pdf-export)).

The database lives at `DATA_DIR` (`./data` by default, anchored to the repo
root regardless of the caller's cwd) and migrates itself on first access.

## Environment variables

Copy `.env.example` to `.env` and edit:

```bash
cp .env.example .env
```

| Variable | Notes |
| --- | --- |
| `OPENAI_API_KEY` | When set, generation switches from StubProvider to OpenAIProvider. |
| `OPENAI_MODEL` | Model name; default `gpt-4o-mini`. |
| `OPENAI_BASE_URL` | Optional base URL for any OpenAI-compatible server (Ollama, vLLM, LiteLLM…). Example: `http://localhost:11434/v1`. |
| `SESSION_SECRET` | Session-cookie HMAC key. **Production refuses the dev default** — use ≥32 random characters (`openssl rand -hex 32`). |
| `DATA_DIR` | Where SQLite and artifacts live. Relative paths anchor to the repo root. |
| `WORKER_POLL_MS` | Queue polling interval (default 500). |
| `CARDDECK_MCP_USER` | Owner account for decks created over MCP (default `mcp@carddeck.local`; auto-provisioned). |
| `CARDDECK_MOTION` | `off` strips animation injection from `.pptx` exports. |
| `CARDDECK_E2E_HOOKS` | Internal: `1` arms the stub's `[fail]` test hook. Do not set in normal use. |

`.env` is loaded by Next.js for the web app; when running the worker by hand,
export the same variables (turbo's `dev` inherits your shell).

## Production

```bash
export SESSION_SECRET="$(openssl rand -hex 32)"   # mandatory
npm run build
npm run start          # turbo: next start (0.0.0.0:3000) + worker
```

- Web serves the built app on port 3000 (`next start`).
- Both processes share the same `DATA_DIR`; SQLite handles the concurrent
  access (the worker is the only writer of job/card rows).
- Scale-out note: the queue is a single SQLite file, so run **one** worker
  process per `DATA_DIR`. Web instances are stateless.

## Docker (self-hosting)

```bash
echo "CARDDECK_SESSION_SECRET=$(openssl rand -hex 32)" > .env
docker compose up -d --build
```

One container runs web + worker with Chromium preinstalled (`DATA_DIR=/data`
in the `carddeck-data` volume); optional `OPENAI_*` vars pass through from the
compose `.env`. Full walkthrough: [`docs/MCP.md`](MCP.md#self-hosting).

## MCP server (agents)

`apps/mcp` is a stdio MCP server that lets agents (OpenCode, Claude Code,
Codex, …) build decks, add images, set motion, and export files. It shares
this app's `DATA_DIR`, so the worker must be running for `create_deck`.
Clients exec:

```text
/path/to/gamma-clone/apps/mcp/bin/carddeck-mcp
```

Setup per client, the full tool reference, and Docker notes:
[`docs/MCP.md`](MCP.md).

## PDF export

PDF printing runs headless Chromium through Playwright. One-time:

```bash
npx playwright install chromium
```

If the browser is missing, the PDF endpoint answers `503` with that exact
hint — PPTX/POTX export and the rest of the app are unaffected.

## Testing

```bash
npm test          # Vitest across core · ai · pptx · worker · mcp · web (286 tests)
npm run e2e       # Playwright, 10 specs, production build on :3000
```

The E2E runner (`e2e/serve.mjs`) is self-contained:

- wipes and recreates `e2e/.data` (never touches your dev database),
- builds `apps/web` if `.next` is missing,
- boots production web + worker with `CARDDECK_E2E_HOOKS=1` and a throwaway
  `SESSION_SECRET`,
- tears both down on exit.

Run a single spec: `cd e2e && node ../node_modules/.bin/playwright test tests/export.spec.ts`.
Debug a failure with `npx playwright show-trace test-results/<test>/trace.zip`
(traces are retained on failure).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `SESSION_SECRET must be set in production` | Set `SESSION_SECRET` (≥32 chars) for `next start`. Dev mode warns and falls back. |
| PDF export: `503` | `npx playwright install chromium`. |
| `EADDRINUSE :3000` | Another dev server is running, or a previous E2E run leaked. `pkill -f "next start"` / `pkill -f serve.mjs`. |
| Phantom TypeScript errors after switching branches | Stale `.next`: `rm -rf apps/web/.next`, then rebuild. |
| Native module errors from `better-sqlite3` | `npm install-scripts approve better-sqlite3 && npm rebuild better-sqlite3`. |
| Deck stuck "Preparing your deck…" | Normally transient (worker down?). Check the worker process is running; deck status settles before the job row turns terminal, so a restart resumes cleanly. |

## Repository layout

See the [README](../README.md#architecture) for the full tree. Design context:

- `docs/superpowers/specs/2026-10-16-gamma-reverse-engineering-findings.md` —
  how the reference product behaves (clean-room findings).
- `docs/superpowers/specs/2026-10-16-gamma-clone-design.md` — Carddeck's own
  design (PPTX-first architecture).
- `docs/superpowers/plans/2026-10-16-carddeck-implementation.md` — the 16-task
  implementation plan this build executed.
