import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import * as t from "../drizzle/schema";
import { and, eq, asc } from "drizzle-orm";

/**
 * Queue stages.
 *
 * Chat revision is deliberately *not* a stage: `POST /api/deck/[id]/chat`
 * applies a single-card revision synchronously (see `lib/revise.ts`), which is
 * fast enough that a job + stream would only add latency. Only the two
 * bulk-generating stages ride the queue.
 */
export type Stage = "outline" | "cards";
export type JobStatus = "pending" | "running" | "done" | "error" | "cancelled";

type GenerationJob = typeof t.generationJob.$inferSelect;

/**
 * Return the active (pending|running) job for a (deckId, stage), or null.
 * Used by enqueueJob to enforce one-in-flight per stage, and by routes to poll.
 */
export async function findActiveJob(
  deckId: string,
  stage: Stage,
): Promise<GenerationJob | null> {
  const db = getDb();
  const job = await db.query.generationJob.findFirst({
    where: (j, { and, eq, inArray }) =>
      and(
        eq(j.deckId, deckId),
        eq(j.stage, stage),
        inArray(j.status, ["pending", "running"]),
      ),
  });
  return job ?? null;
}

/**
 * Enqueue a job. Idempotent per (deckId, stage): if a pending|running job
 * already exists for that stage, return it instead of creating a duplicate.
 */
export async function enqueueJob(
  deckId: string,
  stage: Stage,
  input: Record<string, unknown>,
): Promise<GenerationJob> {
  const existing = await findActiveJob(deckId, stage);
  if (existing) return existing;

  const db = getDb();
  const [job] = await db
    .insert(t.generationJob)
    .values({
      id: randomUUID(),
      deckId,
      stage,
      status: "pending",
      input: JSON.stringify(input),
      progress: JSON.stringify({ done: 0, total: 0 }),
    })
    .returning();
  return job;
}

/**
 * Atomically claim the oldest pending job. The UPDATE is guarded by
 * `WHERE status = 'pending'`, so if two workers race, only one row is affected
 * (the loser's UPDATE matches nothing and returns an empty array). This gives
 * us the same safety as a transaction without needing an async transaction
 * (better-sqlite3's `transaction()` cannot run an async callback).
 */
export async function claimNextJob(): Promise<GenerationJob | null> {
  const db = getDb();
  const next = await db.query.generationJob.findFirst({
    where: (j, { eq }) => eq(j.status, "pending"),
    orderBy: (j, { asc }) => asc(j.createdAt),
  });
  if (!next) return null;

  const updated = await db
    .update(t.generationJob)
    .set({ status: "running", updatedAt: Date.now() })
    .where(and(eq(t.generationJob.id, next.id), eq(t.generationJob.status, "pending")))
    .returning();
  return updated[0] ?? null;
}

/** Patch a job's mutable fields (status, result, error, progress). */
export async function updateJob(
  id: string,
  patch: Partial<Pick<GenerationJob, "status" | "result" | "error" | "progress">>,
): Promise<void> {
  const db = getDb();
  await db
    .update(t.generationJob)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(t.generationJob.id, id));
}

/**
 * Decode a job's `progress` JSON into `{ done, total }`.
 *
 * Tolerates a missing or corrupt column (progress is written concurrently by
 * the worker), so a bad row degrades to zeros instead of throwing in a route
 * handler or the SSE stream.
 */
export function parseProgress(raw: string | null | undefined): {
  done: number;
  total: number;
} {
  if (!raw) return { done: 0, total: 0 };
  try {
    const parsed = JSON.parse(raw) as Partial<{ done: number; total: number }>;
    return {
      done: typeof parsed.done === "number" ? parsed.done : 0,
      total: typeof parsed.total === "number" ? parsed.total : 0,
    };
  } catch {
    return { done: 0, total: 0 };
  }
}

/** Job statuses that mean "no more events are coming". */
export const TERMINAL_STATUSES = ["done", "error", "cancelled"] as const;

/** True when a job status is terminal (done / error / cancelled). */
export function isTerminalStatus(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}
