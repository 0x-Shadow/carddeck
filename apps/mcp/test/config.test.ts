import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

/**
 * Static checks for the repo's "ops" surfaces.
 *
 * These assert on real files rather than code paths, because a typo in an
 * agent config or a Dockerfile fails silently until someone tries to connect
 * or self-host. The tests read the same files a user would:
 *
 * - agent wiring: `opencode.json`, the stdio wrapper script
 * - self-hosting: `Dockerfile`, `docker-compose.yml`, root `start` wiring
 * - documentation: `docs/MCP.md`, `README.md`, `.env.example`
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const readJson = (rel: string) => JSON.parse(read(rel)) as Record<string, unknown>;

describe("agent + self-hosting config", () => {
  it("wires Carddeck into opencode.json as a local stdio MCP server", () => {
    const cfg = readJson("opencode.json") as any;
    expect(cfg.$schema).toBe("https://opencode.ai/config.json");
    const entry = cfg.mcp?.servers?.carddeck;
    expect(entry).toBeDefined();
    expect(entry.type).toBe("local");
    expect(entry.command).toEqual(["npx", "tsx", "apps/mcp/src/index.ts"]);
    // V2 places servers under `mcp.servers`; a V1-style `mcp.carddeck` entry
    // would silently never connect.
    expect(cfg.mcp.carddeck).toBeUndefined();
  });

  it("wires Carddeck into VS Code as a workspace stdio MCP server", () => {
    const cfg = readJson(".vscode/mcp.json") as any;
    const entry = cfg.servers?.carddeck;
    expect(entry).toBeDefined();
    expect(entry.type).toBe("stdio");
    expect(entry.command).toBe("${workspaceFolder}/apps/mcp/bin/carddeck-mcp");
  });

  it("ships an executable wrapper that pins the server's working directory", () => {
    const rel = "apps/mcp/bin/carddeck-mcp";
    const script = read(rel);
    expect(script.startsWith("#!/usr/bin/env sh")).toBe(true);
    expect(script).toContain("apps/mcp/src/index.ts");
    expect(script).toContain("exec");
    // Clients exec the path directly — without the bit it fails with EACCES.
    const mode = fs.statSync(path.join(ROOT, rel)).mode;
    expect(mode & 0o111).toBeGreaterThan(0);
  });

  it("builds a Playwright-capable, non-root Docker image on the shared data dir", () => {
    const dockerfile = read("Dockerfile");
    expect(dockerfile).toContain("npm ci");
    expect(dockerfile).toContain("npm run build");
    expect(dockerfile).toContain("npx playwright install --with-deps chromium");
    expect(dockerfile).toContain("DATA_DIR=/data");
    expect(dockerfile).toContain("USER node");
    expect(dockerfile).toContain('CMD ["npm", "run", "start"]');
    // The container must not ship the developer's local database.
    expect(read(".dockerignore")).toContain("data");
  });

  it("composes a single service with a required session secret and a data volume", () => {
    const compose = parseYaml(read("docker-compose.yml")) as any;
    const svc = compose.services.carddeck;
    expect(svc.build).toBe(".");
    expect(svc.ports).toContain("3000:3000");
    expect(svc.environment.DATA_DIR).toBe("/data");
    expect(svc.environment.SESSION_SECRET).toContain("CARDDECK_SESSION_SECRET");
    // Interpolation syntax that *fails the boot* when the secret is missing.
    expect(svc.environment.SESSION_SECRET).toContain(":?");
    expect(svc.volumes).toContain("carddeck-data:/data");
    expect(compose.volumes["carddeck-data"]).toBeDefined();
    expect(svc.restart).toBe("unless-stopped");
  });

  it("boots web + worker from a single root start script", () => {
    const root = readJson("package.json") as any;
    expect(root.scripts.start).toBe("turbo run start");

    const turbo = readJson("turbo.json") as any;
    expect(turbo.tasks.start).toEqual({ cache: false, persistent: true });

    const web = readJson("apps/web/package.json") as any;
    expect(web.scripts.start).toContain("next start");
    // Containers have no localhost-only browser; bind every interface.
    expect(web.scripts.start).toContain("0.0.0.0");

    const worker = readJson("apps/worker/package.json") as any;
    expect(worker.scripts.start).toContain("tsx src/index.ts");

    // `@carddeck/mcp` deliberately has no `start`: `turbo run start` would
    // otherwise spawn a stdio MCP server inside the container, where nothing
    // ever speaks the protocol.
    const mcp = readJson("apps/mcp/package.json") as any;
    expect(mcp.scripts.start).toBeUndefined();
  });

  it("documents every tool, the three first-class agents, and self-hosting", () => {
    const doc = read("docs/MCP.md");
    const tools = [
      "create_deck",
      "create_deck_from_cards",
      "add_cards",
      "get_deck",
      "list_decks",
      "set_theme",
      "set_motion",
      "add_image",
      "export_deck",
    ];
    for (const tool of tools) expect(doc).toContain(tool);
    expect(doc).toContain("opencode mcp add");
    expect(doc).toContain("claude mcp add");
    expect(doc).toContain("[mcp_servers.carddeck]");
    expect(doc).toContain("docker exec -i");

    const readme = read("README.md");
    expect(readme).toContain("docs/MCP.md");
    expect(readme).toContain("docker compose up");
    expect(readme).toContain("Agent integrations");
  });

  it("documents the MCP and motion environment knobs in .env.example", () => {
    const env = read(".env.example");
    expect(env).toContain("CARDDECK_MCP_USER");
    expect(env).toContain("CARDDECK_MOTION");
  });
});
