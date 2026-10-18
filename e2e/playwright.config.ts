import { defineConfig } from "@playwright/test";

/**
 * Boots production web + worker against an isolated DATA_DIR (see serve.mjs)
 * on http://localhost:3000. Serial workers: one SQLite database sits behind
 * web and worker, and the specs are flow tests rather than load tests.
 *
 * Keep this file free of `import.meta` — Playwright loads the config through
 * its CJS loader unless the package declares `"type": "module"`.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    // `cwd` defaults to this config file's directory.
    command: "node serve.mjs",
    url: "http://localhost:3000",
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      // Relative values are anchored to the repo root by resolveDataDir;
      // serve.mjs resolves it to an absolute path for both child processes.
      DATA_DIR: "e2e/.data",
      CARDDECK_E2E_HOOKS: "1",
    },
  },
});
