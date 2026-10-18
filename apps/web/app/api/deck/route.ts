import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as t from "@/drizzle/schema";
import { count, desc, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/guard";
import { seedPresetThemes } from "@/lib/themes-presets";

const FORMATS = new Set(["presentation", "document"]);

/**
 * Default theme applied to a new deck when none is requested. Seeds the
 * presets first so a fresh install picks up a real preset rather than a stub.
 */
async function defaultThemeId(): Promise<string> {
  await seedPresetThemes();
  const db = getDb();
  const preset = await db.query.theme.findFirst({
    where: (th, { eq }) => eq(th.isPreset, 1),
  });
  if (preset) return preset.id;
  const [created] = await db
    .insert(t.theme)
    .values({ name: "Midnight", isPreset: 1, tokens: "{}" })
    .returning({ id: t.theme.id });
  return created.id;
}

/** POST /api/deck { title, themeId?, format? } -> 201 { deck } */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth.res) return auth.res;

  const body = (await req.json().catch(() => null)) as {
    title?: string;
    themeId?: string;
    format?: string;
  } | null;

  const title = body?.title?.trim() || "Untitled";
  const format = body?.format && FORMATS.has(body.format) ? body.format : "presentation";

  let themeId = body?.themeId;
  if (!themeId) {
    themeId = await defaultThemeId();
  } else {
    // Validate the theme exists; otherwise fall back to the default.
    const requested = themeId; // const so the query callback narrows to string
    const db = getDb();
    const theme = await db.query.theme.findFirst({ where: (th, { eq }) => eq(th.id, requested) });
    if (!theme) themeId = await defaultThemeId();
  }

  const db = getDb();
  const [deck] = await db
    .insert(t.deck)
    .values({ userId: auth.user.id, title, format, themeId, status: "draft" })
    .returning();

  return NextResponse.json({ deck }, { status: 201 });
}

/** GET /api/deck -> 200 { decks } (only the current user's) */
export async function GET() {
  const auth = await requireUser();
  if (auth.res) return auth.res;

  const db = getDb();
  const decks = await db.query.deck.findMany({
    where: (d, { eq }) => eq(d.userId, auth.user.id),
    orderBy: (d, { desc }) => desc(d.updatedAt),
  });
  const ownIds = decks.map((deck) => deck.id);
  const ownCounts = new Map<string, number>();
  if (ownIds.length) {
    const rows = await db
      .select({ deckId: t.card.deckId, n: count() })
      .from(t.card)
      .where(inArray(t.card.deckId, ownIds))
      .groupBy(t.card.deckId);
    for (const row of rows) ownCounts.set(row.deckId, Number(row.n));
  }
  const decksWithCounts = decks.map((deck) => ({
    ...deck,
    cardCount: ownCounts.get(deck.id) ?? 0,
  }));

  const agentEmail = process.env.CARDDECK_MCP_USER?.trim() || "mcp@carddeck.local";
  const agent = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.email, agentEmail),
    columns: { id: true },
  });
  let agentDecks: Array<Record<string, unknown>> = [];
  if (agent && agent.id !== auth.user.id) {
    const shared = await db.query.deck.findMany({
      where: (d, { and, eq }) => and(eq(d.userId, agent.id), eq(d.isPublic, 1)),
      orderBy: (d, { desc }) => desc(d.updatedAt),
    });
    const ids = shared.map((deck) => deck.id);
    const counts = new Map<string, number>();
    if (ids.length) {
      const rows = await db
        .select({ deckId: t.card.deckId, n: count() })
        .from(t.card)
        .where(inArray(t.card.deckId, ids))
        .groupBy(t.card.deckId);
      for (const row of rows) counts.set(row.deckId, Number(row.n));
    }
    agentDecks = shared.map((deck) => ({
      id: deck.id,
      title: deck.title,
      format: deck.format,
      status: deck.status,
      cardCount: counts.get(deck.id) ?? 0,
      updatedAt: deck.updatedAt,
      shareSlug: deck.shareSlug,
    }));
  }
  return NextResponse.json({ decks: decksWithCounts, agentDecks }, { status: 200 });
}
