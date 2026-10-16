import { describe, it, expect, beforeEach } from "vitest";
import { makeTestDb, setTestDb, type DB } from "../lib/db";
import { enqueueJob, claimNextJob, updateJob, findActiveJob } from "../lib/queue";
import * as t from "../drizzle/schema";
import { randomUUID } from "node:crypto";

/** Seed a user, theme, and deck so the job queue's deckId FK is satisfied. */
async function seedDeck(db: DB): Promise<string> {
  const userId = randomUUID();
  const themeId = randomUUID();
  const deckId = randomUUID();
  await db.insert(t.user).values({ id: userId, email: `${userId}@t.io`, name: "T", passwordHash: "h" });
  await db.insert(t.theme).values({ id: themeId, name: "Midnight", isPreset: 1, tokens: "{}" });
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

describe("job queue", () => {
  let deckId: string;

  beforeEach(async () => {
    const db = makeTestDb();
    setTestDb(db);
    deckId = await seedDeck(db);
  });

  it("enqueues then claims a pending job", async () => {
    const job = await enqueueJob(deckId, "outline", { prompt: "p", numCards: 3 });
    const claimed = await claimNextJob();
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.status).toBe("running");
  });

  it("does not double-claim the same job", async () => {
    await enqueueJob(deckId, "outline", { prompt: "p" });
    const a = await claimNextJob();
    const b = await claimNextJob();
    expect(b === null || b.id !== a?.id).toBe(true);
  });

  it("refuses a second pending job for the same (deckId, stage) and returns the existing one", async () => {
    const first = await enqueueJob(deckId, "cards", {});
    const second = await enqueueJob(deckId, "cards", { different: true });
    expect(second.id).toBe(first.id);
  });

  it("allows a different stage for the same deck", async () => {
    const a = await enqueueJob(deckId, "outline", {});
    const b = await enqueueJob(deckId, "cards", {});
    expect(b.id).not.toBe(a.id);
  });

  it("persists progress patches", async () => {
    const job = await enqueueJob(deckId, "cards", {});
    await updateJob(job.id, { progress: JSON.stringify({ done: 1, total: 3 }) });
    const again = await findActiveJob(deckId, "cards");
    expect(JSON.parse(again!.progress!).done).toBe(1);
  });

  it("marks a job done via updateJob", async () => {
    const job = await enqueueJob(deckId, "outline", {});
    await updateJob(job.id, { status: "done" });
    const claimed = await claimNextJob();
    expect(claimed?.id).not.toBe(job.id); // done job is not claimable
  });
});
