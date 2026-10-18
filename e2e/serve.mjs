import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * E2E server bootstrap: one process that Playwright's webServer launches.
 *
 * - Uses an isolated DATA_DIR (wiped here) so runs never touch dev data.
 * - Arms CARDDECK_E2E_HOOKS so the stub provider's deterministic `[fail]`
 *   test hook is live for the per-card retry spec.
 * - Builds apps/web first when `playwright test` is invoked directly (turbo
 *   already does this for `npm run e2e`).
 * - Spawns the web server and the worker together and forwards shutdown
 *   signals to both, so no stray processes are left behind.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
// DATA_DIR may arrive relative (playwright config passes "e2e/.data", and
// resolveDataDir anchors such values to the repo root) — normalize it here so
// the wipe, the web app, and the worker all agree on one absolute path.
const rawDataDir = process.env.DATA_DIR;
const dataDir = rawDataDir
  ? isAbsolute(rawDataDir)
    ? rawDataDir
    : resolve(repoRoot, rawDataDir)
  : join(here, ".data");

// Fresh state every run: the suite registers its own users and decks.
rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });

// `next start` needs a production build; make direct invocations work too.
if (!existsSync(join(repoRoot, "apps/web/.next/BUILD_ID"))) {
  console.log("[serve] apps/web/.next missing — running next build…");
  const build = spawnSync("npm", ["run", "build", "-w", "web"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const env = {
  ...process.env,
  DATA_DIR: dataDir,
  CARDDECK_E2E_HOOKS: process.env.CARDDECK_E2E_HOOKS ?? "1",
  // `next start` runs production, where the HMAC cookie key must not fall back
  // to the dev-insecure default — sign this run's cookies with a throwaway.
  SESSION_SECRET:
    process.env.SESSION_SECRET ??
    "e2e-session-secret-throwaway-0123456789abcdef0123456789abcdef",
};

const children = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500);
}

function run(name, args) {
  const child = spawn("npm", args, { cwd: repoRoot, env, stdio: "inherit" });
  child.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`[serve] ${name} exited unexpectedly (code ${code})`);
      shutdown(code ?? 1);
    }
  });
  children.push(child);
}

run("web", ["run", "start", "-w", "web"]);
run("worker", ["run", "start", "-w", "worker"]);

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
