# Carddeck MCP — let your agent build the deck

`apps/mcp` is a local [Model Context Protocol](https://modelcontextprotocol.io)
server (stdio transport) that gives agents — OpenCode, Claude Code, Codex, and
anything else that speaks MCP — the ability to build real Carddeck decks:

- **Build** — generate a deck from a prompt, or from card content you supply
- **Style** — switch themes, set an animation preset that also lands inside
  the exported PowerPoint
- **Illustrate** — add images from an http(s) URL or a path on this machine
- **Export** — write `.pptx` (with real PowerPoint animations), `.pdf`, or
  `.potx` files to disk

The server shares the app's SQLite database and `DATA_DIR`, so everything it
creates is the same data the web app and worker use — exports go through the
exact same renderers as the UI. There is no HTTP hop and no session: a local
stdio server is exactly as trusted as the worker process.

## Prerequisites

```bash
cd /path/to/gamma-clone
npm install
npm run dev            # web + worker — create_deck needs the worker running
```

PDF export additionally needs a one-time Chromium install:

```bash
npx playwright install chromium
```

(The Docker image ships Chromium already; see [Self-hosting](#self-hosting).)

## The command every client runs

[`apps/mcp/bin/carddeck-mcp`](../apps/mcp/bin/carddeck-mcp) is a tiny wrapper
that pins its working directory to the repo root and then runs
`npx tsx apps/mcp/src/index.ts`. Clients exec this path, so the server starts
with the right `DATA_DIR` (this repo's `./data` unless you set `DATA_DIR`) no
matter where the agent itself was launched.

```text
/path/to/gamma-clone/apps/mcp/bin/carddeck-mcp
```

Replace `/path/to/gamma-clone` with the absolute path of your checkout.
If your client cannot exec a script directly, use `npx` with the source file
and `cwd` set to the repo root: command `npx`, args
`["tsx", "apps/mcp/src/index.ts"]`.

## Client setup

### OpenCode

This repo already contains [`opencode.json`](../opencode.json) with the
`carddeck` server registered — run `opencode` from the repo root and the tools
appear (check with `/mcps`). For every project on your machine:

```bash
opencode mcp add --global carddeck -- /path/to/gamma-clone/apps/mcp/bin/carddeck-mcp
```

Or write it by hand (V2 nests servers under `mcp.servers`):

```jsonc
{
  "mcp": {
    "servers": {
      "carddeck": {
        "type": "local",
        "command": ["/path/to/gamma-clone/apps/mcp/bin/carddeck-mcp"]
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add --scope user carddeck -- /path/to/gamma-clone/apps/mcp/bin/carddeck-mcp
```

`--scope user` makes it available in every project; drop it to keep the server
project-local. Or commit a `.mcp.json` next to the project:

```json
{
  "mcpServers": {
    "carddeck": {
      "command": "/path/to/gamma-clone/apps/mcp/bin/carddeck-mcp"
    }
  }
}
```

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.carddeck]
command = "/path/to/gamma-clone/apps/mcp/bin/carddeck-mcp"
# create_deck waits for generation (up to 120s) — give the tool room.
tool_timeout_sec = 180
```

Or via the CLI:

```bash
codex mcp add carddeck -- /path/to/gamma-clone/apps/mcp/bin/carddeck-mcp
```

### Claude Desktop, Cursor

`claude_desktop_config.json` (Claude Desktop) and `.cursor/mcp.json` (Cursor)
use the same shape:

```json
{
  "mcpServers": {
    "carddeck": {
      "command": "/path/to/gamma-clone/apps/mcp/bin/carddeck-mcp"
    }
  }
}
```

### VS Code (GitHub Copilot)

`.vscode/mcp.json` (note the `servers` key):

```json
{
  "servers": {
    "carddeck": {
      "type": "stdio",
      "command": "/path/to/gamma-clone/apps/mcp/bin/carddeck-mcp"
    }
  }
}
```

### Anything else (raw stdio)

Spawn `/path/to/gamma-clone/apps/mcp/bin/carddeck-mcp` as a child process and
speak MCP over its stdin/stdout. Environment is inherited; set `DATA_DIR`
to point the server at a different data directory.

## Tools

Every tool answers with a single text item carrying a JSON envelope:
`{ "ok": true, ... }` on success, `{ "ok": false, "error": "..." }` plus
`isError: true` on failure. Failures never crash the server.

| Tool | Input | Output |
| --- | --- | --- |
| `create_deck` | `prompt` (required), `numCards` (1–30, default 8), `format` (`presentation`\|`document`), `tone`, `theme`, `motion` | `{ deckId, url, status, cards: [{ id, title }] }`. Enqueues outline + cards and waits up to 120 s. |
| `create_deck_from_cards` | `title`, `cards: [{ title, content? }]` (each content line → a paragraph block), `theme?`, `motion?` | `{ deckId, url, status: "ready", cards }`. Instant — no AI, no worker. |
| `add_cards` | `deckId`, `cards: [{ title, content? }]` | `{ deckId, url, added: [{ id, title, status }] }`. Cards with content are `ready`; without content they're empty outline cards (`pending`). |
| `get_deck` | `deckId` | Full deck: `{ deckId, title, format, status, url, isPublic, shareSlug, theme, motion, cards: [{ id, title, status, blocks }] }`. |
| `list_decks` | — | `{ decks: [{ deckId, title, status, cardCount, updatedAt }] }`, newest first. |
| `set_theme` | `deckId`, `theme` (preset name or id) | `{ deckId, theme: { id, name } }`. Presets: Light, Dark, Midnight, Sunset, Forest, Mono, Paper, Neon. |
| `set_motion` | `deckId`, `preset` (`none`\|`subtle`\|`punchy`\|`cinematic`) | `{ deckId, preset, slides }`. The plan drives web present mode **and** the animations embedded in `.pptx` exports. |
| `add_image` | `deckId`, `source: { url }` or `{ path }`, `cardId?` (default first card), `caption?`, `layout?` (`full`\|`side`\|`behind`) | `{ deckId, cardId, assetId, url, bytes, block }`. Copies the image into `DATA_DIR/assets` (max 10 MB; png/jpeg/webp/gif) and appends an image block. |
| `export_deck` | `deckId`, `format` (`pptx`\|`pdf`\|`potx`), `outDir?` (default `<DATA_DIR>/exports`) | `{ deckId, format, path, bytes }` — `path` is absolute. |

Notes:

- `create_deck` needs the worker. If generation outlives the 120 s deadline the
  tool still succeeds with `status: "generating"` and a note — the deck keeps
  building; call `get_deck` again shortly.
- Decks created over MCP are **shared read-only by default**: `url` is a
  `/view/<slug>` link anyone on the instance can open (the agent account
  itself cannot log a browser in). Unguessable 16-hex-char slug.
- `motion` matters most for PowerPoint: `.pptx` exports carry real entrance
  animations and transitions (subtle fades, punchy pushes/wipes, cinematic
  covers with slower timing). Set `CARDDECK_MOTION=off` to strip them.
- Charts in `.pptx` exports render as readable data summaries; images embed as
  real pictures.
- Relative `source.path` values resolve from the repo root (the wrapper pins
  the working directory); absolute paths are clearer.

## Ask for a deck — examples

Once connected, plain language is enough. Good asks give the agent the deck
brief, the look, images, and the deliverable:

- **From a prompt, with animation and an export**
  > Create a 10-slide deck about our Q3 launch plan, confident tone, Midnight
  > theme, cinematic animations. Then export it as PowerPoint into
  > `~/Desktop/q3`.

- **From your own content**
  > Build a deck titled "Incident Postmortem" from these cards: Overview (<the
  > 3 facts>), Timeline (<bullets>), Root Cause (<bullets>), Action Items
  > (…). Add the screenshot at `~/Pictures/grafana.png` to the Timeline card
  > and export a PDF.

- **Illustrated, from an image folder**
  > Make a 6-slide deck about our office plants. For each slide, add one photo
  > from `~/Pictures/plants/` (any order), caption it with the file name, and
  > export the pptx.

- **Iterate on an existing deck**
  > List my decks. For the Q3 one: switch the theme to Neon, add a closing
  > card "Questions?", and export the pptx again.

The agent does the multi-step work itself (`create_deck` → `add_image` →
`set_motion` → `export_deck`); you can also direct it tool-by-tool.

## Environment

| Variable | Default | Effect |
| --- | --- | --- |
| `DATA_DIR` | `<repo>/data` | SQLite DB, uploaded images, default export directory. Point it at the same directory the web app uses. |
| `CARDDECK_MCP_USER` | `mcp@carddeck.local` | Owner account for decks created over MCP (auto-provisioned on boot). |
| `CARDDECK_MOTION` | *(unset)* | `off` strips animation injection from `.pptx`/`.potx` exports. |
| `OPENAI_API_KEY` | *(unset)* | With a key, `create_deck` uses the real model; without it the deterministic stub generates. Also `OPENAI_MODEL`, `OPENAI_BASE_URL`. |
| `WORKER_POLL_MS` | `500` | Worker queue poll interval (affects how fast generation is claimed). |

## Self-hosting

Docker runs the web app + worker in one container:

```bash
echo "CARDDECK_SESSION_SECRET=$(openssl rand -hex 32)" > .env
docker compose up -d --build
```

The container's data lives in the `carddeck-data` volume. To let an agent
drive that containerized instance, run the MCP server **inside** it and bridge
stdio — no second checkout, no data copying. The client's command is simply
`docker exec -i carddeck npx tsx apps/mcp/src/index.ts`:

```jsonc
{
  "mcpServers": {
    "carddeck": {
      "command": "docker",
      "args": ["exec", "-i", "carddeck", "npx", "tsx", "apps/mcp/src/index.ts"]
    }
  }
}
```

(`carddeck` is the compose service name; adjust if you renamed it. The
container must be running.) Alternatively bind-mount the data directory
(`volumes: ["./data:/data"]` in `docker-compose.yml`) and run the host-side
MCP server with `DATA_DIR=./data`.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `create_deck` returns `status: "generating"` + note | The worker isn't running. `npm run dev` (or `docker compose up -d`), then `get_deck` again. |
| `deck not found` | Deck ids come from `create_deck*`/`list_decks`; they're scoped to the agent account. |
| `unknown theme: …` | Use a preset name (Light, Dark, Midnight, Sunset, Forest, Mono, Paper, Neon) or a theme id from `get_deck`. |
| PDF export fails with "Run 'npx playwright install chromium'" | One-time Chromium install (not needed in Docker). |
| `unsupported image type` / `image too large` | png, jpeg, webp, or gif, max 10 MB; URLs must be reachable within 5 s. |
| Agent connected but no tools | Check the command path is absolute and the wrapper is executable (`chmod +x`). Run the wrapper in a terminal — it should print `[carddeck-mcp] ready on stdio` to stderr and then wait. |
| Deck link opens a 404 | The deck is older than this feature or was created outside MCP (private). `export_deck` always works; `get_deck` shows `isPublic`/`shareSlug`. |
