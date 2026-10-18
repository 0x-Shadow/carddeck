import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, resolveDataDir } from "@/lib/db";
import * as t from "@/drizzle/schema";
import { requireUser } from "@/lib/guard";
import { assetFilePath, assetPublicUrl } from "@/lib/assets";

type Params = { params: Promise<{ id: string }> };

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function remapImageSources(value: unknown, sources: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => remapImageSources(item, sources));
  if (typeof value !== "object" || value === null) return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = key === "src" && typeof child === "string"
      ? sources.get(child) ?? child
      : remapImageSources(child, sources);
  }
  return result;
}

/** Create an editable, private copy of a public MCP deck for the current user. */
export async function POST(_req: Request, { params }: Params) {
  const auth = await requireUser();
  if (auth.res) return auth.res;

  const { id } = await params;
  const db = getDb();
  const source = await db.query.deck.findFirst({ where: (deck, { eq }) => eq(deck.id, id) });
  const agentEmail = process.env.CARDDECK_MCP_USER?.trim() || "mcp@carddeck.local";
  const agent = await db.query.user.findFirst({
    where: (user, { eq }) => eq(user.email, agentEmail),
    columns: { id: true },
  });
  if (!source || !agent || source.userId !== agent.id || source.isPublic !== 1) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  if (source.status !== "ready") {
    return NextResponse.json({ error: "project is not ready to copy" }, { status: 409 });
  }

  const sourceCards = await db.query.card.findMany({
    where: (card, { eq }) => eq(card.deckId, id),
    orderBy: (card, { asc }) => asc(card.position),
  });
  const sourceAssets = await db.query.asset.findMany({
    where: (asset, { eq }) => eq(asset.deckId, id),
  });
  const copiedAssets: Array<{ oldUrl: string; id: string; mime: string; sizeBytes: number; originalName: string | null; bytes: Buffer }> = [];
  for (const asset of sourceAssets) {
    const filePath = await assetFilePath(id, asset.id);
    if (!filePath || !EXT_BY_MIME[asset.mime]) {
      return NextResponse.json({ error: "a project image is unavailable" }, { status: 409 });
    }
    const bytes = await fs.readFile(filePath).catch(() => null);
    if (!bytes) return NextResponse.json({ error: "a project image is unavailable" }, { status: 409 });
    copiedAssets.push({
      oldUrl: assetPublicUrl(id, asset.id),
      id: randomUUID(),
      mime: asset.mime,
      sizeBytes: asset.sizeBytes,
      originalName: asset.originalName,
      bytes,
    });
  }

  const [copy] = await db.insert(t.deck).values({
    userId: auth.user.id,
    title: `${source.title} (Copy)`,
    format: source.format,
    themeId: source.themeId,
    status: "ready",
    motion: source.motion,
  }).returning();

  const assetsDir = path.join(resolveDataDir(), "assets", copy.id);
  const sourceMap = new Map(copiedAssets.map((asset) => [
    asset.oldUrl,
    assetPublicUrl(copy.id, asset.id),
  ]));
  try {
    if (copiedAssets.length) await fs.mkdir(assetsDir, { recursive: true });
    for (const asset of copiedAssets) {
      await fs.writeFile(path.join(assetsDir, `${asset.id}.${EXT_BY_MIME[asset.mime]}`), asset.bytes);
    }
    if (copiedAssets.length) {
      await db.insert(t.asset).values(copiedAssets.map((asset) => ({
        id: asset.id,
        deckId: copy.id,
        mime: asset.mime,
        sizeBytes: asset.sizeBytes,
        originalName: asset.originalName,
      })));
    }
    if (sourceCards.length) {
      await db.insert(t.card).values(sourceCards.map((card) => {
        let blocks: unknown;
        try {
          blocks = remapImageSources(JSON.parse(card.blocks) as unknown, sourceMap);
        } catch {
          blocks = [];
        }
        return {
          deckId: copy.id,
          position: card.position,
          title: card.title,
          intent: card.intent,
          blocks: JSON.stringify(blocks),
          status: card.status,
        };
      }));
    }
  } catch (error) {
    await db.delete(t.card).where(eq(t.card.deckId, copy.id));
    await db.delete(t.deck).where(eq(t.deck.id, copy.id));
    await fs.rm(assetsDir, { recursive: true, force: true });
    throw error;
  }

  return NextResponse.json({ deck: copy }, { status: 201 });
}