import { getDb, type DB } from "./db";
import * as t from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { createProvider, type AIProvider } from "@carddeck/ai";
import type { Block } from "@carddeck/core";

export interface ApplyRevisionInput {
  deckId: string;
  cardId: string;
  instruction: string;
  /** AI backend; defaults to `createProvider()` (stub without a key). */
  provider?: AIProvider;
  db?: DB;
}

export interface ApplyRevisionResult {
  blocks: Block[];
  note: string;
}

/**
 * Apply one AI revision to a card and persist the exchange.
 *
 * The provider rewrites the card's blocks from the instruction + current
 * content; this function owns everything around that call: loading the card,
 * writing the new blocks back, and logging both sides of the conversation so
 * the chat panel can render history. The user message is written *before* the
 * model call so a failing provider still leaves a trace of what was asked.
 */
export async function applyRevision(
  input: ApplyRevisionInput,
): Promise<ApplyRevisionResult> {
  const db = input.db ?? getDb();
  const provider = input.provider ?? createProvider();

  const card = await db.query.card.findFirst({
    where: (c, { eq, and }) => and(eq(c.id, input.cardId), eq(c.deckId, input.deckId)),
  });
  if (!card) {
    throw new Error(`card ${input.cardId} no longer exists`);
  }

  await db.insert(t.chatMessage).values({
    deckId: input.deckId,
    cardId: card.id,
    role: "user",
    content: input.instruction,
  });

  let current: Block[] = [];
  try {
    const parsed = JSON.parse(card.blocks) as unknown;
    if (Array.isArray(parsed)) current = parsed as Block[];
  } catch {
    current = [];
  }

  const result = await provider.revise({
    instruction: input.instruction,
    blocks: current,
    cardTitle: card.title,
  });
  const note = result.note ?? "Updated this card.";

  await db
    .update(t.card)
    .set({ blocks: JSON.stringify(result.blocks) })
    .where(eq(t.card.id, card.id));

  await db.insert(t.chatMessage).values({
    deckId: input.deckId,
    cardId: card.id,
    role: "assistant",
    content: note,
  });

  return { blocks: result.blocks, note };
}
