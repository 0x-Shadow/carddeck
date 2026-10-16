import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as t from "@/drizzle/schema";
import { and, eq, inArray } from "drizzle-orm";
import { resolveOwnedJob } from "@/lib/deck-access";
import { parseProgress, isTerminalStatus } from "@/lib/queue";

type Params = { params: Promise<{ jobId: string }> };

/**
 * GET /api/generation/[jobId] -> 200 { status, progress, error }
 *
 * Lightweight poll for clients that don't want the SSE stream (and for tests).
 */
export async function GET(_req: Request, { params }: Params) {
  const { jobId } = await params;
  const owned = await resolveOwnedJob(jobId);
  if (owned.res) return owned.res;

  return NextResponse.json(
    {
      status: owned.job.status,
      progress: parseProgress(owned.job.progress),
      error: owned.job.error,
    },
    { status: 200 },
  );
}



/**
 * PATCH /api/generation/[jobId] { action: "cancel" } -> 200 { status }
 *
 * The worker re-reads the job status before starting each card, so flipping
 * this row stops the run between cards. The deck is returned to an editable
 * status immediately — the UI must not sit on a spinner the worker will never
 * clear (cancelled runs exit without touching the deck).
 */
export async function PATCH(req: Request, { params }: Params) {
  const { jobId } = await params;
  const owned = await resolveOwnedJob(jobId);
  if (owned.res) return owned.res;

  const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action !== "cancel") {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  if (isTerminalStatus(owned.job.status)) {
    return NextResponse.json(
      { error: `job already ${owned.job.status}` },
      { status: 409 },
    );
  }

  const db = getDb();
  // Guarded update: if a worker races us to a terminal state, match nothing.
  const updated = await db
    .update(t.generationJob)
    .set({ status: "cancelled", updatedAt: Date.now() })
    .where(
      and(
        eq(t.generationJob.id, jobId),
        inArray(t.generationJob.status, ["pending", "running"]),
      ),
    )
    .returning({ id: t.generationJob.id });
  if (updated.length === 0) {
    return NextResponse.json({ error: "job already finished" }, { status: 409 });
  }

  // With no worker to finish it, "generating" would strand the deck.
  const cards = await db.query.card.findMany({
    where: (c, { eq }) => eq(c.deckId, owned.job.deckId),
    columns: { id: true },
  });
  await db
    .update(t.deck)
    .set({ status: cards.length > 0 ? "outline" : "draft", updatedAt: Date.now() })
    .where(eq(t.deck.id, owned.job.deckId));

  return NextResponse.json({ status: "cancelled" }, { status: 200 });
}
