import { NextResponse } from "next/server";
import { getPublicDeck } from "@/lib/public-deck";

type Params = { params: Promise<{ slug: string }> };

/**
 * GET /api/public/[slug] -> 200 { title, format, author, theme, cards } | 404
 *
 * Unauthenticated reader feed. Delegates every rule (public-only, ready cards,
 * author name only) to `getPublicDeck`, which the `/view/[slug]` server page
 * uses too, so the API and the page can never drift apart.
 */
export async function GET(_req: Request, { params }: Params) {
  const { slug } = await params;
  const deck = await getPublicDeck(slug);
  if (!deck) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(deck, { status: 200 });
}
