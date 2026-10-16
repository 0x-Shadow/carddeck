import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as t from "@/drizzle/schema";
import { desc } from "drizzle-orm";
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
  return NextResponse.json({ decks }, { status: 200 });
}
