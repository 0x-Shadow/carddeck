import { startWorker } from "./pipeline";

/**
 * Worker entry point.
 *
 * Run alongside the web app (`npm run dev` at the repo root starts both). It
 * polls the shared SQLite job queue and executes outline / cards / chat jobs.
 */
const pollMs = Number(process.env.WORKER_POLL_MS ?? 500);
const worker = startWorker({ pollMs });

console.log(`[worker] started (polling every ${pollMs}ms)`);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] ${signal} received, draining…`);
  await worker.stop();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
