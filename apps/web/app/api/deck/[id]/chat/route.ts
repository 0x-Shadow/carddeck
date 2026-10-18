import { NextResponse } from "next/server";
import { resolveOwnedDeck } from "@/lib/deck-access";
import { getDb } from "@/lib/db";
import * as t from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { applyRevision } from "@/lib/revise";

type Params = { params: Promise<{ id: string }> };

const MAX_INSTRUCTION_CHARS = 2000;

/**
 * POST /api/deck/[id]/chat { cardId, instruction } -> 200 { blocks, note }
 *
 * v1 revises a single named card synchronously: the provider call is fast
 * enough (and the UX simple enough) that a job + stream would only add
 * latency and moving parts. Deck-wide revision is a thin loop over this later.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const owned = await resolveOwnedDeck(id);
  if (owned.res) return owned.res;

  const body = (await req.json().catch(() => null)) as {
    cardId?: unknown;
    instruction?: unknown;
  } | null;

  if (typeof body?.cardId !== "string" || !body.cardId) {
    return NextResponse.json({ error: "cardId is required" }, { status: 400 });
  }
  if (typeof body.instruction !== "string" || !body.instruction.trim()) {
    return NextResponse.json({ error: "instruction is required" }, { status: 400 });
  }
  const instruction = body.instruction.trim();
  if (instruction.length > MAX_INSTRUCTION_CHARS) {
    return NextResponse.json(
      { error: `instruction must be at most ${MAX_INSTRUCTION_CHARS} characters` },
      { status: 400 },
    );
  }

  // The card must belong to this deck; otherwise a user could revise any card
  // by guessing its id.
  const db = getDb();
  const card = await db.query.card.findFirst({
    where: (c, { eq, and }) => and(eq(c.id, body.cardId as string), eq(c.deckId, id)),
  });
  if (!card) {
    return NextResponse.json({ error: "card not found" }, { status: 404 });
  }

  try {
    const result = await applyRevision({
      deckId: id,
      cardId: card.id,
      instruction,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
