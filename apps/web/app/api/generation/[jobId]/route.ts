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
  // With no worker to finish it, "generating" would strand the deck — count
  // the cards first so we know which editable status to return to.
  const cards = await db.query.card.findMany({
    where: (c, { eq }) => eq(c.deckId, owned.job.deckId),
    columns: { id: true },
  });
  const deckStatus = cards.length > 0 ? "outline" : "draft";

  // The guarded job flip and the deck settle must land together: a client
  // that reloads the instant it observes `cancelled` must never see a
  // terminal job while the deck still reads "generating" — it would treat it
  // as a dropped stream and auto-restart the run it just stopped. One
  // immediate transaction makes the pair visible atomically; the guard inside
  // it still loses cleanly if a worker raced us to a terminal state.
  const cancelled = db.transaction(
    (tx) => {
      const guard = tx
        .select({ id: t.generationJob.id })
        .from(t.generationJob)
        .where(
          and(
            eq(t.generationJob.id, jobId),
            inArray(t.generationJob.status, ["pending", "running"]),
          ),
        )
        .get();
      if (!guard) return false;
      tx.update(t.generationJob)
        .set({ status: "cancelled", updatedAt: Date.now() })
        .where(eq(t.generationJob.id, jobId))
        .run();
      tx.update(t.deck)
        .set({ status: deckStatus, updatedAt: Date.now() })
        .where(eq(t.deck.id, owned.job.deckId))
        .run();
      return true;
    },
    { behavior: "immediate" },
  );
  if (!cancelled) {
    return NextResponse.json({ error: "job already finished" }, { status: 409 });
  }

  return NextResponse.json({ status: "cancelled" }, { status: 200 });
}
