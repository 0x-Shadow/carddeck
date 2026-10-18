import { getDb } from "../../web/lib/db";
import { isTerminalStatus } from "../../web/lib/queue";

/** Default deadline for waiting on generation (the spec's 120 s). */
export const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
/** Default poll interval while waiting on the DB. */
export const DEFAULT_POLL_MS = 250;

export interface WaitOptions {
  /** Total time budget; defaults to `DEFAULT_WAIT_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Interval between probes; defaults to `DEFAULT_POLL_MS`. */
  pollMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Poll `probe` until it returns a non-null value or the deadline passes.
 * Returns the value, or null on timeout. Injectable durations let tests run
 * deadlines that are milliseconds, not minutes.
 */
export async function waitFor<T>(
  probe: () => Promise<T | null>,
  opts: WaitOptions = {},
): Promise<T | null> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== null) return value;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    await sleep(Math.min(pollMs, remaining));
  }
}

/** Wait for a generation job to reach a terminal status (done/error/cancelled). */
export async function waitForJobTerminal(jobId: string, opts?: WaitOptions) {
  return waitFor(async () => {
    const job = await getDb().query.generationJob.findFirst({
      where: (j, { eq }) => eq(j.id, jobId),
    });
    return job && isTerminalStatus(job.status) ? job : null;
  }, opts);
}

/** Wait for a deck to reach one of `statuses` (e.g. ready/error). */
export async function waitForDeckStatus(
  deckId: string,
  statuses: readonly string[],
  opts?: WaitOptions,
) {
  return waitFor(async () => {
    const deck = await getDb().query.deck.findFirst({
      where: (d, { eq }) => eq(d.id, deckId),
    });
    return deck && statuses.includes(deck.status) ? deck : null;
  }, opts);
}
