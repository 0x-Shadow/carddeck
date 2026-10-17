import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as t from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { resolveOwnedDeck } from "@/lib/deck-access";
import { enqueueJob } from "@/lib/queue";
import type { DeckFormat } from "@carddeck/ai";

type Params = { params: Promise<{ id: string }> };

/** Validation limits, module-private: route files may only export HTTP verbs. */
const MAX_PROMPT_CHARS = 4000;
const MAX_CARDS = 30;
const MAX_TONE_CHARS = 200;

interface OutlineBody {
  prompt?: unknown;
  numCards?: unknown;
  tone?: unknown;
}

/**
 * Validate the outline request. Returns the normalized input, or a ready 400
 * response when a field is missing or out of range.
 */
function parseOutlineRequest(body: OutlineBody | null):
  | { input: { prompt: string; numCards: number; tone?: string }; res?: undefined }
  | { input?: undefined; res: NextResponse } {
  const bad = (error: string) => ({
    res: NextResponse.json({ error }, { status: 400 }),
  });

  if (typeof body?.prompt !== "string" || !body.prompt.trim()) {
    return bad("prompt is required");
  }
  const prompt = body.prompt.trim();
  if (prompt.length > MAX_PROMPT_CHARS) {
    return bad(`prompt must be at most ${MAX_PROMPT_CHARS} characters`);
  }

  const numCards = body.numCards === undefined ? 8 : body.numCards;
  if (typeof numCards !== "number" || !Number.isInteger(numCards)) {
    return bad("numCards must be an integer");
  }
  if (numCards < 1 || numCards > MAX_CARDS) {
    return bad(`numCards must be between 1 and ${MAX_CARDS}`);
  }

  if (body.tone !== undefined) {
    if (typeof body.tone !== "string") return bad("tone must be a string");
    if (body.tone.length > MAX_TONE_CHARS) {
      return bad(`tone must be at most ${MAX_TONE_CHARS} characters`);
    }
  }

  const tone = typeof body.tone === "string" && body.tone.trim() ? body.tone.trim() : undefined;
  return { input: tone === undefined ? { prompt, numCards } : { prompt, numCards, tone } };
}

/**
 * POST /api/deck/[id]/outline { prompt, numCards, tone? } -> 200 { jobId }
 *
 * Stage 1 of the pipeline. Enqueues an `outline` job for the background worker;
 * the route never calls the model itself. Idempotent per (deck, stage): a
 * second submit while the first is in flight returns the same jobId.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const owned = await resolveOwnedDeck(id);
  if (owned.res) return owned.res;

  const body = (await req.json().catch(() => null)) as OutlineBody | null;
  const parsed = parseOutlineRequest(body);
  if (parsed.res) return parsed.res;

  const job = await enqueueJob(id, "outline", {
    ...parsed.input,
    format: owned.deck.format as DeckFormat,
  });

  // Only flip to "generating" when we actually started something new; a
  // duplicate submit must not clobber a deck that already finished.
  if (job.status === "pending" || job.status === "running") {
    const db = getDb();
    await db
      .update(t.deck)
      .set({ status: "generating", updatedAt: Date.now() })
      .where(eq(t.deck.id, id));
  }

  return NextResponse.json({ jobId: job.id }, { status: 200 });
}
