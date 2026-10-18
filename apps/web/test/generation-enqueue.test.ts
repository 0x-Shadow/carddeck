import { describe, it, expect, beforeEach } from "vitest";
import {
  freshDb,
  seedUser,
  seedTheme,
  seedDeck,
  useSession,
  jsonRequest,
  readJson,
} from "./helpers/route";
import { getDb } from "@/lib/db";
import * as t from "@/drizzle/schema";
import { eq } from "drizzle-orm";

const outlineBody = (over: Record<string, unknown> = {}) => ({
  prompt: "Q3 launch plan for the mobile app",
  numCards: 6,
  ...over,
});

describe("outline + generate enqueue routes", () => {
  // Every test gets a clean in-memory DB + empty session jar.
  beforeEach(() => freshDb());
  it("POST /api/deck/[id]/outline requires auth", async () => {
    freshDb();
    useSession(null);
    const { POST } = await import("@/app/api/deck/[id]/outline/route");
    const res = await POST(
      jsonRequest("http://t/x", "POST", outlineBody()),
      { params: Promise.resolve({ id: "any" }) },
    );
    expect(res.status).toBe(401);
  });

  it("enqueues exactly one outline job and is idempotent", async () => {
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId);
    useSession(user.id);
    const { POST } = await import("@/app/api/deck/[id]/outline/route");
    const params = { params: Promise.resolve({ id: deckId }) };

    const first = await readJson(
      await POST(jsonRequest("http://t/x", "POST", outlineBody()), params),
    );
    expect(first.status).toBe(200);
    expect(typeof first.body.jobId).toBe("string");

    // Double-submit (two tabs) must not create a second concurrent job.
    const second = await readJson(
      await POST(jsonRequest("http://t/x", "POST", outlineBody()), params),
    );
    expect(second.body.jobId).toBe(first.body.jobId);

    const jobs = await getDb().query.generationJob.findMany({
      where: (j, { eq }) => eq(j.deckId, deckId),
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].stage).toBe("outline");
    expect(JSON.parse(jobs[0].input).prompt).toBe(outlineBody().prompt);

    // The deck flips to a work-in-flight status so the UI can show progress.
    const deck = await getDb().query.deck.findFirst({
      where: (d, { eq }) => eq(d.id, deckId),
    });
    expect(deck?.status).toBe("generating");
  });

  it("rejects a prompt longer than 4000 chars", async () => {
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId);
    useSession(user.id);
    const { POST } = await import("@/app/api/deck/[id]/outline/route");
    const res = await POST(
      jsonRequest("http://t/x", "POST", outlineBody({ prompt: "x".repeat(4001) })),
      { params: Promise.resolve({ id: deckId }) },
    );
    expect(res.status).toBe(400);
    const jobs = await getDb().query.generationJob.findMany({
      where: (j, { eq }) => eq(j.deckId, deckId),
    });
    expect(jobs).toHaveLength(0);
  });

  it("rejects an empty prompt and numCards outside 1..30", async () => {
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId);
    useSession(user.id);
    const { POST } = await import("@/app/api/deck/[id]/outline/route");
    const params = { params: Promise.resolve({ id: deckId }) };

    const empty = await POST(
      jsonRequest("http://t/x", "POST", outlineBody({ prompt: "   " })),
      params,
    );
    expect(empty.status).toBe(400);

    const tooMany = await POST(
      jsonRequest("http://t/x", "POST", outlineBody({ numCards: 31 })),
      params,
    );
    expect(tooMany.status).toBe(400);

    const zero = await POST(
      jsonRequest("http://t/x", "POST", outlineBody({ numCards: 0 })),
      params,
    );
    expect(zero.status).toBe(400);
  });

  it("POST /api/deck/[id]/generate 409s when no outline exists yet", async () => {
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId); // deck has zero cards
    useSession(user.id);
    const { POST } = await import("@/app/api/deck/[id]/generate/route");
    const res = await POST(
      jsonRequest("http://t/x", "POST", {}),
      { params: Promise.resolve({ id: deckId }) },
    );
    expect(res.status).toBe(409);
    const jobs = await getDb().query.generationJob.findMany({
      where: (j, { eq }) => eq(j.deckId, deckId),
    });
    expect(jobs).toHaveLength(0);
  });

  it("POST /api/deck/[id]/generate enqueues one cards job when an outline exists", async () => {
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId);
    const db = getDb();
    await db.insert(t.card).values({ deckId, position: 0, title: "Cover", blocks: "[]", status: "pending" });
    await db
      .update(t.deck)
      .set({ status: "outline" })
      .where(eq(t.deck.id, deckId));
    useSession(user.id);
    const { POST } = await import("@/app/api/deck/[id]/generate/route");
    const params = { params: Promise.resolve({ id: deckId }) };

    const first = await readJson(
      await POST(jsonRequest("http://t/x", "POST", {}), params),
    );
    expect(first.status).toBe(200);
    expect(typeof first.body.jobId).toBe("string");

    const second = await readJson(
      await POST(jsonRequest("http://t/x", "POST", {}), params),
    );
    expect(second.body.jobId).toBe(first.body.jobId);

    const jobs = await getDb().query.generationJob.findMany({
      where: (j, { eq }) => eq(j.deckId, deckId),
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].stage).toBe("cards");
  });

  it("refuses to generate while an outline job is still in flight", async () => {
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId);
    const db = getDb();
    // Cards exist (from a previous outline) but a fresh outline is regenerating.
    await db.insert(t.card).values({ deckId, position: 0, title: "Old", blocks: "[]", status: "ready" });
    const { enqueueJob } = await import("@/lib/queue");
    await enqueueJob(deckId, "outline", { prompt: "again" });

    useSession(user.id);
    const { POST } = await import("@/app/api/deck/[id]/generate/route");
    const res = await POST(
      jsonRequest("http://t/x", "POST", {}),
      { params: Promise.resolve({ id: deckId }) },
    );
    expect(res.status).toBe(409);
  });

  it("refuses to enqueue for a deck the user does not own", async () => {
    const me = await seedUser();
    const other = await seedUser();
    const themeId = await seedTheme();
    const theirDeck = await seedDeck(other.id, themeId);
    useSession(me.id);
    const { POST } = await import("@/app/api/deck/[id]/outline/route");
    const res = await POST(
      jsonRequest("http://t/x", "POST", outlineBody()),
      { params: Promise.resolve({ id: theirDeck }) },
    );
    expect(res.status).toBe(404);
  });
});
