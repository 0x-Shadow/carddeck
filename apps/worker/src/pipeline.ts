import type { AIProvider } from "@carddeck/ai";
import { createProvider } from "@carddeck/ai";
import type { Block, OutlineCard } from "@carddeck/core";
import { getDb, type DB } from "../../web/lib/db";
import * as t from "../../web/drizzle/schema";
import { claimNextJob, updateJob } from "../../web/lib/queue";
import { asc, eq } from "drizzle-orm";

/**
 * The out-of-band generation pipeline.
 *
 * The web app never calls a model directly: it enqueues a job (Task 7) and this
 * worker claims it, runs the stage, and writes results back row by row so the
 * editor can render cards as they land (via SSE, Task 10). Each runner:
 *
 *   1. reads its input,
 *   2. calls the provider (concurrency-limited, one failure never kills the rest),
 *   3. persists results + progress as they arrive,
 *   4. resolves the job to `done` / `error` (or leaves `cancelled` alone).
 */

type Job = typeof t.generationJob.$inferSelect;

export interface PipelineDeps {
  /** AI backend; defaults to `createProvider()` (stub without a key). */
  provider?: AIProvider;
  /** Database; defaults to the shared app DB. */
  db?: DB;
}

/** How many cards may be generated at once. */
const CONCURRENCY = 3;

interface OutlineInput {
  prompt: string;
  numCards: number;
  tone?: string;
  format: "presentation" | "document";
}

interface CardsInput {
  format: "presentation" | "document";
}

function parseInput<T>(job: Job): T {
  try {
    return JSON.parse(job.input) as T;
  } catch {
    throw new Error(`job ${job.id} has malformed input`);
  }
}

async function setProgress(jobId: string, done: number, total: number): Promise<void> {
  await updateJob(jobId, { progress: JSON.stringify({ done, total }) });
}

/** Mark a job failed and flag the deck so the UI stops waiting on it. */
async function failJob(db: DB, job: Job, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await updateJob(job.id, { status: "error", error: message });
  await db
    .update(t.deck)
    .set({ status: "error", updatedAt: Date.now() })
    .where(eq(t.deck.id, job.deckId));
}

async function setDeckStatus(db: DB, deckId: string, status: string): Promise<void> {
  await db.update(t.deck).set({ status, updatedAt: Date.now() }).where(eq(t.deck.id, deckId));
}

/** True while the job may keep running (re-read from the DB before each card). */
async function isCancelled(db: DB, jobId: string): Promise<boolean> {
  const row = await db.query.generationJob.findFirst({
    where: (j, { eq }) => eq(j.id, jobId),
    columns: { status: true },
  });
  return row?.status === "cancelled";
}

/**
 * Stage 1 — turn a prompt into the deck's card skeleton.
 *
 * Replaces the deck's cards wholesale (the outline is the source of truth for
 * structure), then flips the deck to `outline` so "Generate" is unblocked.
 */
export async function runOutlineJob(job: Job, deps: PipelineDeps = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const provider = deps.provider ?? createProvider();
  const input = parseInput<OutlineInput>(job);

  try {
    const outline: OutlineCard[] = await provider.generateOutline({
      prompt: input.prompt,
      numCards: input.numCards,
      tone: input.tone,
      format: input.format ?? "presentation",
    });
    if (outline.length === 0) throw new Error("provider returned an empty outline");

    await db.delete(t.card).where(eq(t.card.deckId, job.deckId));
    await db.insert(t.card).values(
      outline.map((card, i) => ({
        deckId: job.deckId,
        position: i,
        title: card.title,
        intent: card.intent || (i === 0 ? "cover" : i === outline.length - 1 ? "close" : "body"),
        blocks: "[]",
        status: "pending",
      })),
    );

    await setDeckStatus(db, job.deckId, "outline");
    await updateJob(job.id, {
      status: "done",
      error: null,
      result: JSON.stringify(outline),
      progress: JSON.stringify({ done: outline.length, total: outline.length }),
    });
  } catch (err) {
    await failJob(db, job, err);
  }
}

/**
 * Stage 2 — fill every non-ready card with content blocks.
 *
 * Cards already marked `ready` are skipped, so re-running after a partial
 * failure is a retry that keeps completed work. A concurrency pool of
 * `CONCURRENCY` streams results back; the job's status is re-read from the DB
 * before each dispatch so a cancel stops the remaining cards.
 */
export async function runCardsJob(job: Job, deps: PipelineDeps = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const provider = deps.provider ?? createProvider();
  const input = parseInput<CardsInput>(job);

  try {
    const deck = await db.query.deck.findFirst({ where: (d, { eq }) => eq(d.id, job.deckId) });
    if (!deck) throw new Error(`deck ${job.deckId} no longer exists`);

    const theme = await db.query.theme.findFirst({ where: (th, { eq }) => eq(th.id, deck.themeId) });
    const themeName = theme?.name ?? "Default";

    const allCards = await db.query.card.findMany({
      where: (c, { eq }) => eq(c.deckId, job.deckId),
      orderBy: (c, { asc }) => asc(c.position),
    });
    const targets = allCards.filter((c) => c.status !== "ready");
    const total = targets.length;

    if (total === 0) {
      // Everything is already generated — nothing to do but close out the job.
      await setProgress(job.id, 0, 0);
      await updateJob(job.id, { status: "done", error: null });
      await setDeckStatus(db, job.deckId, "ready");
      return;
    }

    // The full outline is context for every card, ready or not.
    const context: OutlineCard[] = allCards.map((c) => ({
      id: c.id,
      title: c.title,
      intent: c.intent,
    }));

    let next = 0;
    let done = 0;
    let failures = 0;
    let lastError = "";

    // Progress writes are chained so concurrent completions can't regress the
    // counter (each write carries the value at its own turn in the chain).
    let progressChain: Promise<void> = Promise.resolve();
    const report = () => {
      progressChain = progressChain.then(() => setProgress(job.id, done, total));
      return progressChain;
    };

    const worker = async (): Promise<void> => {
      for (;;) {
        const index = next++;
        if (index >= targets.length) return;
        if (await isCancelled(db, job.id)) return;

        const card = targets[index];
        try {
          const blocks: Block[] = await provider.generateCard({
            outline: { id: card.id, title: card.title, intent: card.intent },
            context,
            format: input.format ?? "presentation",
            themeName,
          });
          await db
            .update(t.card)
            .set({ blocks: JSON.stringify(blocks), status: "ready", genJobId: job.id })
            .where(eq(t.card.id, card.id));
        } catch (err) {
          failures += 1;
          lastError = err instanceof Error ? err.message : String(err);
          await db
            .update(t.card)
            .set({ status: "error", genJobId: job.id })
            .where(eq(t.card.id, card.id));
        }
        done += 1;
        await report();
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker()),
    );
    await progressChain;

    // A cancel mid-flight wins over anything we'd otherwise write.
    if (await isCancelled(db, job.id)) return;

    if (failures > 0) {
      await updateJob(job.id, {
        status: "error",
        error: `${failures} of ${total} card(s) failed: ${lastError}`,
      });
      await setDeckStatus(db, job.deckId, "error");
      return;
    }

    await updateJob(job.id, { status: "done", error: null });
    await setDeckStatus(db, job.deckId, "ready");
  } catch (err) {
    await failJob(db, job, err);
  }
}

/** Run one job on the matching stage handler. Never throws. */
export async function dispatchJob(job: Job, deps: PipelineDeps = {}): Promise<void> {
  try {
    switch (job.stage) {
      case "outline":
        return await runOutlineJob(job, deps);
      case "cards":
        return await runCardsJob(job, deps);
      default:
        await updateJob(job.id, { status: "error", error: `unknown stage "${job.stage}"` });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateJob(job.id, { status: "error", error: message }).catch(() => {});
  }
}

/**
 * Claim and run at most one job. Returns true when a job was processed.
 * Exported so the claim → dispatch path can be tested without starting the
 * polling loop.
 */
export async function runOnce(deps: PipelineDeps = {}): Promise<boolean> {
  const job = await claimNextJob();
  if (!job) return false;
  await dispatchJob(job, deps);
  return true;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface WorkerOptions {
  /** How long to wait between polls when the queue is empty. Default 500ms. */
  pollMs?: number;
  provider?: AIProvider;
  db?: DB;
}

export interface WorkerHandle {
  /** Claim and run at most one job. Returns true when a job was processed. */
  runOnce(): Promise<boolean>;
  /** Stop the loop and wait for the in-flight job to finish. */
  stop(): Promise<void>;
}

/**
 * Start the polling loop. The worker claims the oldest pending job, runs it,
 * and repeats; it sleeps `pollMs` when the queue is empty.
 */
export function startWorker(opts: WorkerOptions = {}): WorkerHandle {
  const pollMs = opts.pollMs ?? 500;
  const deps: PipelineDeps = { provider: opts.provider, db: opts.db };
  let stopped = false;

  const loop = (async () => {
    while (!stopped) {
      let worked = false;
      try {
        worked = await runOnce(deps);
      } catch (err) {
        // Never let a transient DB error kill the loop.
        console.error("[worker] poll failed:", err);
      }
      if (!worked) await sleep(pollMs);
    }
  })();

  return {
    runOnce: () => runOnce(deps),
    stop: async () => {
      stopped = true;
      await loop;
    },
  };
}
