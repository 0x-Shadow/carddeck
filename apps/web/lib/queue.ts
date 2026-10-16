import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import * as t from "../drizzle/schema";
import { and, eq, asc } from "drizzle-orm";

export type Stage = "outline" | "cards" | "chat";
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
