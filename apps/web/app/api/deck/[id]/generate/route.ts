import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as t from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { resolveOwnedDeck } from "@/lib/deck-access";
import { enqueueJob, findActiveJob } from "@/lib/queue";
import type { DeckFormat } from "@carddeck/ai";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/deck/[id]/generate {} -> 200 { jobId }
 *
 * Stage 2 of the pipeline: enqueue the per-card content job. Requires a
 * finished outline (at least one card) and no outline job still in flight,
 * otherwise the cards would be generated from a stale or missing skeleton.
 * Idempotent per (deck, stage) — a double-click returns the same jobId.
 */
export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;
  const owned = await resolveOwnedDeck(id);
  if (owned.res) return owned.res;

  const db = getDb();
  const cards = await db.query.card.findMany({
    where: (c, { eq }) => eq(c.deckId, id),
    columns: { id: true },
  });
  if (cards.length === 0) {
    return NextResponse.json(
      { error: "generate an outline first" },
      { status: 409 },
    );
  }

  if (await findActiveJob(id, "outline")) {
    return NextResponse.json(
      { error: "outline is still generating" },
      { status: 409 },
    );
  }

  const job = await enqueueJob(id, "cards", {
    format: owned.deck.format as DeckFormat,
  });

  if (job.status === "pending" || job.status === "running") {
    await db
      .update(t.deck)
      .set({ status: "generating", updatedAt: Date.now() })
      .where(eq(t.deck.id, id));
  }

  return NextResponse.json({ jobId: job.id }, { status: 200 });
}
