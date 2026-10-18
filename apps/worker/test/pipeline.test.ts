import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { makeTestDb, setTestDb, type DB } from "../../web/lib/db";
import * as t from "../../web/drizzle/schema";
import { enqueueJob, updateJob } from "../../web/lib/queue";
import { runOutlineJob, runCardsJob, runOnce, startWorker } from "../src/pipeline";
import { OpenAIProvider, StubProvider, type AIProvider, type CardRequest, type OutlineRequest } from "@carddeck/ai";
import { PRESET_THEMES, parseMotionPlan, planMotionForDeck, type MotionPlan, type OutlineCard } from "@carddeck/core";
import { asc, eq } from "drizzle-orm";

/** Seed a user + theme + deck so the pipeline has a real deck to work on. */
async function seedDeck(db: DB): Promise<string> {
  const userId = randomUUID();
  const themeId = "midnight";
  const deckId = randomUUID();
  await db.insert(t.user).values({ id: userId, email: `${userId}@t.io`, name: "T", passwordHash: "h" });
  await db
    .insert(t.theme)
    .values({ id: themeId, name: "Midnight", isPreset: 1, tokens: JSON.stringify(PRESET_THEMES[2]) })
    .onConflictDoNothing();
  await db.insert(t.deck).values({
    id: deckId,
    userId,
    title: "Deck",
    format: "presentation",
    themeId,
    status: "draft",
    isPublic: 0,
  });
  return deckId;
}

async function cardsOf(db: DB, deckId: string) {
  return db.query.card.findMany({
    where: (c, { eq }) => eq(c.deckId, deckId),
    orderBy: (c, { asc }) => asc(c.position),
  });
}

async function deckOf(db: DB, deckId: string) {
  return db.query.deck.findFirst({ where: (d, { eq }) => eq(d.id, deckId) });
}

async function jobOf(db: DB, jobId: string) {
  return db.query.generationJob.findFirst({ where: (j, { eq }) => eq(j.id, jobId) });
}

/** Store a motion plan on the deck (or clear it with `null`). */
async function setDeckMotion(db: DB, deckId: string, motion: unknown): Promise<void> {
  await db
    .update(t.deck)
    .set({ motion: motion === null ? null : JSON.stringify(motion) })
    .where(eq(t.deck.id, deckId));
}

/** Enqueue + run the outline stage, returning the finished card rows. */
async function makeOutline(db: DB, deckId: string, numCards: number) {
  const outlineJob = await enqueueJob(deckId, "outline", {
    prompt: "Q3 launch plan",
    numCards,
    format: "presentation",
  });
  await runOutlineJob(outlineJob, { provider: new StubProvider() });
  return cardsOf(db, deckId);
}

/** A provider that throws on the Nth generateCard call, then behaves. */
function flakyProvider(failOnCall: number): AIProvider {
  const base = new StubProvider();
  let calls = 0;
  return {
    name: "flaky",
    generateOutline: (req: OutlineRequest) => base.generateOutline(req),
    generateCard: async (req: CardRequest) => {
      calls += 1;
      if (calls === failOnCall) throw new Error("upstream exploded");
      return base.generateCard(req);
    },
    revise: (req) => base.revise(req),
  };
}

describe("worker pipeline", () => {
  let db: DB;

  beforeEach(() => {
    db = makeTestDb();
    setTestDb(db);
  });

  it("outline job writes outline cards to the deck", async () => {
    const deckId = await seedDeck(db);
    const job = await enqueueJob(deckId, "outline", {
      prompt: "Q3 launch plan",
      numCards: 5,
      format: "presentation",
    });

    await runOutlineJob(job, { provider: new StubProvider() });

    const deck = await deckOf(db, deckId);
    expect(deck?.status).toBe("outline");

    const cards = await cardsOf(db, deckId);
    expect(cards).toHaveLength(5);
    expect(cards.every((c) => c.status === "pending")).toBe(true);
    expect(cards[0].title.length).toBeGreaterThan(0);

    const jobRow = await jobOf(db, job.id);
    expect(jobRow?.status).toBe("done");
    expect(JSON.parse(jobRow!.progress!)).toEqual({ done: 5, total: 5 });
  });

  it("cards job fills blocks, reports progress, and marks the deck ready", async () => {
    const deckId = await seedDeck(db);
    await makeOutline(db, deckId, 4);

    const job = await enqueueJob(deckId, "cards", { format: "presentation" });
    await runCardsJob(job, { provider: new StubProvider() });

    const cards = await cardsOf(db, deckId);
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      expect(card.status).toBe("ready");
      expect(JSON.parse(card.blocks)).not.toEqual([]);
    }

    expect((await deckOf(db, deckId))?.status).toBe("ready");

    const jobRow = await jobOf(db, job.id);
    expect(jobRow?.status).toBe("done");
    expect(JSON.parse(jobRow!.progress!)).toEqual({ done: 4, total: 4 });
  });

  it("a failing card keeps completed cards and marks the job error", async () => {
    const deckId = await seedDeck(db);
    await makeOutline(db, deckId, 4);

    const job = await enqueueJob(deckId, "cards", { format: "presentation" });
    await runCardsJob(job, { provider: flakyProvider(2) });

    const cards = await cardsOf(db, deckId);
    // The 2nd dispatched card fails; its neighbours are unaffected.
    expect(cards[0].status).toBe("ready");
    expect(JSON.parse(cards[0].blocks).length).toBeGreaterThan(0);
    expect(cards[1].status).toBe("error");
    expect(JSON.parse(cards[1].blocks)).toEqual([]);
    // Promise.allSettled semantics: later cards still complete.
    expect(cards[2].status).toBe("ready");
    expect(cards[3].status).toBe("ready");

    const jobRow = await jobOf(db, job.id);
    expect(jobRow?.status).toBe("error");
    expect(jobRow?.error).toContain("upstream exploded");

    expect((await deckOf(db, deckId))?.status).not.toBe("ready");
  });

  it("cancellation stops remaining cards", async () => {
    const deckId = await seedDeck(db);
    await makeOutline(db, deckId, 6);

    const job = await enqueueJob(deckId, "cards", { format: "presentation" });
    const base = new StubProvider();
    let cancelled = false;
    await runCardsJob(job, {
      provider: {
        name: "cancelling",
        generateOutline: (req) => base.generateOutline(req),
        generateCard: async (req) => {
          if (!cancelled) {
            cancelled = true;
            await updateJob(job.id, { status: "cancelled" });
          }
          return base.generateCard(req);
        },
        revise: (req) => base.revise(req),
      },
    });

    const cards = await cardsOf(db, deckId);
    // Cards past the in-flight pool are never started.
    expect(cards[3].status).toBe("pending");
    expect(cards[4].status).toBe("pending");
    expect(cards[5].status).toBe("pending");

    expect((await jobOf(db, job.id))?.status).toBe("cancelled");
    expect((await deckOf(db, deckId))?.status).not.toBe("ready");
  });

  it("re-running after a partial failure only regenerates failed cards", async () => {
    const deckId = await seedDeck(db);
    await makeOutline(db, deckId, 3);

    const first = await enqueueJob(deckId, "cards", { format: "presentation" });
    await runCardsJob(first, { provider: flakyProvider(2) });

    const afterFailure = await cardsOf(db, deckId);
    expect(afterFailure[1].status).toBe("error");
    const keptBlocks = afterFailure[0].blocks;

    // Retry (a fresh job — the failed one is no longer active).
    const retry = await enqueueJob(deckId, "cards", { format: "presentation" });
    expect(retry.id).not.toBe(first.id);
    await runCardsJob(retry, { provider: new StubProvider() });

    const afterRetry = await cardsOf(db, deckId);
    expect(afterRetry.every((c) => c.status === "ready")).toBe(true);
    // The already-good card was left untouched.
    expect(afterRetry[0].blocks).toBe(keptBlocks);

    expect((await deckOf(db, deckId))?.status).toBe("ready");
    expect((await jobOf(db, retry.id))?.status).toBe("done");
  });

  it("fills the deck's motion plan after cards settle, before the ready flip", async () => {
    const deckId = await seedDeck(db);
    await makeOutline(db, deckId, 2);
    await setDeckMotion(db, deckId, { preset: "punchy", slides: [] });

    const base = new StubProvider();
    let statusWhenAsked: string | undefined;
    let askedPreset: string | undefined;
    let askedCards = -1;
    const job = await enqueueJob(deckId, "cards", { format: "presentation" });
    await runCardsJob(job, {
      provider: {
        name: "probe",
        generateOutline: (req) => base.generateOutline(req),
        generateCard: (req) => base.generateCard(req),
        revise: (req) => base.revise(req),
        generateMotion: async (req) => {
          statusWhenAsked = (await deckOf(db, deckId))?.status;
          askedPreset = req.preset;
          askedCards = req.cards.length;
          return undefined; // no design — the deterministic fill must cover it
        },
      },
    });

    expect((await deckOf(db, deckId))?.status).toBe("ready");
    // Asked while the deck was still generating: anything that reads `ready`
    // must already see a complete plan.
    expect(statusWhenAsked).toBe("outline");
    expect(askedPreset).toBe("punchy");
    expect(askedCards).toBe(2);

    const cards = await cardsOf(db, deckId);
    const stored = parseMotionPlan((await deckOf(db, deckId))?.motion);
    expect(stored?.slides).toHaveLength(2);
    // Deterministic: same preset + shapes + seed as planMotionForDeck.
    expect(stored).toEqual(planMotionForDeck("punchy", cards, deckId));
  });

  it("stores a provider-designed plan, keeping the deck's preset", async () => {
    const deckId = await seedDeck(db);
    await makeOutline(db, deckId, 2);
    await setDeckMotion(db, deckId, { preset: "punchy", slides: [] });

    const designed: MotionPlan = {
      preset: "cinematic", // model drift: the worker keeps the deck's preset
      slides: [
        { transition: "split", builds: [{ effect: "flyLeft", delayMs: 40 }] },
        { transition: "cover", builds: [{ effect: "zoom", delayMs: 490 }] },
      ],
    };
    const base = new StubProvider();
    const job = await enqueueJob(deckId, "cards", { format: "presentation" });
    await runCardsJob(job, {
      provider: {
        name: "designer",
        generateOutline: (req) => base.generateOutline(req),
        generateCard: (req) => base.generateCard(req),
        revise: (req) => base.revise(req),
        generateMotion: async () => designed,
      },
    });

    const stored = parseMotionPlan((await deckOf(db, deckId))?.motion);
    expect(stored).toEqual({ preset: "punchy", slides: designed.slides });
  });

  it("falls back to the deterministic plan when the provider's motion design fails", async () => {
    const deckId = await seedDeck(db);
    await makeOutline(db, deckId, 2);
    await setDeckMotion(db, deckId, { preset: "subtle", slides: [] });

    const base = new StubProvider();
    const job = await enqueueJob(deckId, "cards", { format: "presentation" });
    await runCardsJob(job, {
      provider: {
        name: "broken-designer",
        generateOutline: (req) => base.generateOutline(req),
        generateCard: (req) => base.generateCard(req),
        revise: (req) => base.revise(req),
        generateMotion: async () => {
          throw new Error("designer offline");
        },
      },
    });

    // Motion is decoration: the run still succeeds and the deck still animates.
    expect((await deckOf(db, deckId))?.status).toBe("ready");
    expect((await jobOf(db, job.id))?.status).toBe("done");
    const cards = await cardsOf(db, deckId);
    expect(parseMotionPlan((await deckOf(db, deckId))?.motion)).toEqual(
      planMotionForDeck("subtle", cards, deckId),
    );
  });

  it("treats an empty provider design as no design", async () => {
    const deckId = await seedDeck(db);
    await makeOutline(db, deckId, 2);
    await setDeckMotion(db, deckId, { preset: "punchy", slides: [] });

    const base = new StubProvider();
    const job = await enqueueJob(deckId, "cards", { format: "presentation" });
    await runCardsJob(job, {
      provider: {
        name: "empty-designer",
        generateOutline: (req) => base.generateOutline(req),
        generateCard: (req) => base.generateCard(req),
        revise: (req) => base.revise(req),
        generateMotion: async () => ({ preset: "punchy", slides: [] }),
      },
    });

    const cards = await cardsOf(db, deckId);
    expect(parseMotionPlan((await deckOf(db, deckId))?.motion)).toEqual(
      planMotionForDeck("punchy", cards, deckId),
    );
  });

  it("leaves motion untouched when no preset is set or the preset is none", async () => {
    const deckNull = await seedDeck(db);
    await makeOutline(db, deckNull, 2);
    const deckNone = await seedDeck(db);
    await makeOutline(db, deckNone, 2);
    await setDeckMotion(db, deckNone, { preset: "none", slides: [] });

    await runCardsJob(await enqueueJob(deckNull, "cards", { format: "presentation" }), {
      provider: new StubProvider(),
    });
    await runCardsJob(await enqueueJob(deckNone, "cards", { format: "presentation" }), {
      provider: new StubProvider(),
    });

    expect((await deckOf(db, deckNull))?.motion).toBeNull();
    expect((await deckOf(db, deckNone))?.motion).toBe(
      JSON.stringify({ preset: "none", slides: [] }),
    );
  });

  it("does not overwrite an existing plan", async () => {
    const deckId = await seedDeck(db);
    await makeOutline(db, deckId, 2);
    const existing = {
      preset: "cinematic",
      slides: [{ transition: "push", builds: [{ effect: "zoom", delayMs: 10 }] }],
    };
    await setDeckMotion(db, deckId, existing);

    await runCardsJob(await enqueueJob(deckId, "cards", { format: "presentation" }), {
      provider: new StubProvider(),
    });

    expect((await deckOf(db, deckId))?.motion).toBe(JSON.stringify(existing));
  });

  it("fills a late preset when the cards job runs again on a settled deck", async () => {
    const deckId = await seedDeck(db);
    await makeOutline(db, deckId, 2);
    await runCardsJob(await enqueueJob(deckId, "cards", { format: "presentation" }), {
      provider: new StubProvider(),
    });
    expect((await deckOf(db, deckId))?.motion).toBeNull();

    // A preset arrives after the cards are ready (e.g. the deck was ready
    // before v2's motion existed); a re-run must still fill the plan.
    await setDeckMotion(db, deckId, { preset: "subtle", slides: [] });
    await runCardsJob(await enqueueJob(deckId, "cards", { format: "presentation" }), {
      provider: new StubProvider(),
    });

    const cards = await cardsOf(db, deckId);
    const stored = parseMotionPlan((await deckOf(db, deckId))?.motion);
    expect(stored?.slides).toHaveLength(2);
    expect(stored).toEqual(planMotionForDeck("subtle", cards, deckId));
  });

  it("stores an OpenAI-designed plan returned during the cards run", async () => {
    const deckId = await seedDeck(db);
    await makeOutline(db, deckId, 1);
    await setDeckMotion(db, deckId, { preset: "cinematic", slides: [] });

    const designed = {
      preset: "cinematic",
      slides: [{ transition: "fade", builds: [{ effect: "fade", delayMs: 100 }] }],
    };
    // The mock answers by prompt: motion design requests get the plan, card
    // requests get a paragraph block.
    const fakeFetch = (async (_input: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: { content: string }[];
      };
      const content = body.messages[0].content.includes("motion")
        ? JSON.stringify({ motion: designed })
        : JSON.stringify([{ type: "paragraph", text: "hello" }]);
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content } }] }),
      };
    }) as unknown as typeof fetch;

    const provider = new OpenAIProvider({
      apiKey: "k",
      model: "m",
      baseUrl: "https://x/v1",
      fetchImpl: fakeFetch,
    });
    await runCardsJob(await enqueueJob(deckId, "cards", { format: "presentation" }), { provider });

    expect((await deckOf(db, deckId))?.status).toBe("ready");
    expect(parseMotionPlan((await deckOf(db, deckId))?.motion)).toEqual(designed);
  });

  it("runOnce claims a pending job, runs it, and reports an empty queue", async () => {
    const deckId = await seedDeck(db);
    await enqueueJob(deckId, "outline", {
      prompt: "Q3 launch plan",
      numCards: 2,
      format: "presentation",
    });

    expect(await runOnce({ provider: new StubProvider(), db })).toBe(true);
    expect((await deckOf(db, deckId))?.status).toBe("outline");
    // Nothing else queued.
    expect(await runOnce({ provider: new StubProvider(), db })).toBe(false);
  });

  it("startWorker drains queued jobs and stops cleanly", async () => {
    const deckId = await seedDeck(db);
    await enqueueJob(deckId, "outline", {
      prompt: "Q3 launch plan",
      numCards: 3,
      format: "presentation",
    });

    const worker = startWorker({ pollMs: 5, provider: new StubProvider(), db });
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && (await deckOf(db, deckId))?.status !== "outline") {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect((await deckOf(db, deckId))?.status).toBe("outline");

    // stop() must await the in-flight loop rather than hang or orphan it.
    await worker.stop();
    const job = await db.query.generationJob.findFirst();
    expect(job?.status).toBe("done");
  });
});
