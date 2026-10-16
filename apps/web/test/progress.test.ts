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
import { enqueueJob, updateJob } from "@/lib/queue";

const params = (jobId: string) => ({ params: Promise.resolve({ jobId }) });

/** Seed a cards-stage job plus `n` pending cards, returning the job id. */
async function seedGeneratingDeck(n: number): Promise<{ userId: string; deckId: string; jobId: string }> {
  const user = await seedUser();
  const themeId = await seedTheme();
  const deckId = await seedDeck(user.id, themeId);
  const db = getDb();
  for (let i = 0; i < n; i += 1) {
    await db.insert(t.card).values({
      deckId,
      position: i,
      title: `Card ${i}`,
      intent: "body",
      blocks: "[]",
      status: "pending",
    });
  }
  await db.update(t.deck).set({ status: "generating" }).where(eq(t.deck.id, deckId));
  const job = await enqueueJob(deckId, "cards", { format: "presentation" });
  await updateJob(job.id, { status: "running", progress: JSON.stringify({ done: 0, total: n }) });
  return { userId: user.id, deckId, jobId: job.id };
}

/**
 * Open the SSE stream and pull one complete `event: ...\n\n` block at a time.
 * Polling in the route emits an immediate snapshot, so the first read is quick;
 * later reads wait on the poll interval.
 */
async function openStream(jobId: string) {
  const { GET } = await import("@/app/api/generation/[jobId]/stream/route");
  const res = await GET(
    new Request(`http://t/api/generation/${jobId}/stream?pollMs=50`),
    params(jobId),
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return {
    async next(timeoutMs = 3000): Promise<string> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary !== -1) {
          const block = buffer.slice(0, boundary + 2);
          buffer = buffer.slice(boundary + 2);
          return block;
        }
        if (Date.now() > deadline) {
          throw new Error(`stream timed out; buffered=${JSON.stringify(buffer)}`);
        }
        const { value, done } = await reader.read();
        if (done) {
          const rest = buffer;
          buffer = "";
          return rest;
        }
        buffer += decoder.decode(value, { stream: true });
      }
    },
    cancel: () => reader.cancel(),
  };
}

describe("GET /api/generation/[jobId] (poll)", () => {
  beforeEach(() => freshDb());

  it("returns status and parsed progress", async () => {
    const { jobId, userId } = await seedGeneratingDeck(3);
    useSession(userId);

    const { GET } = await import("@/app/api/generation/[jobId]/route");
    const res = await readJson(
      await GET(jsonRequest(`http://t/x/${jobId}`, "GET"), params(jobId)),
    );

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("running");
    expect(res.body.progress).toEqual({ done: 0, total: 3 });
    expect(res.body.error).toBeNull();
  });

  it("401s without a session and 404s for another user's job", async () => {
    const { jobId, userId } = await seedGeneratingDeck(1);
    const { GET } = await import("@/app/api/generation/[jobId]/route");

    useSession(null);
    const anon = await readJson(
      await GET(jsonRequest(`http://t/x/${jobId}`, "GET"), params(jobId)),
    );
    expect(anon.status).toBe(401);

    // A different signed-in user must not see this job either.
    const { seedUser: seedAnother } = await import("./helpers/route");
    const stranger = await seedAnother();
    useSession(stranger.id);
    const res = await readJson(
      await GET(jsonRequest(`http://t/x/${jobId}`, "GET"), params(jobId)),
    );
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/generation/[jobId] (cancel)", () => {
  beforeEach(() => freshDb());

  it("cancels a running job and returns the deck to an editable status", async () => {
    const { jobId, deckId, userId } = await seedGeneratingDeck(2);
    useSession(userId);

    const { PATCH } = await import("@/app/api/generation/[jobId]/route");
    const res = await readJson(
      await PATCH(
        jsonRequest(`http://t/x/${jobId}`, "PATCH", { action: "cancel" }),
        params(jobId)),
    );

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");

    const db = getDb();
    const job = await db.query.generationJob.findFirst({ where: (j, { eq }) => eq(j.id, jobId) });
    expect(job?.status).toBe("cancelled");

    // The worker stops between cards, so the deck must not sit in "generating".
    const deck = await db.query.deck.findFirst({ where: (d, { eq }) => eq(d.id, deckId) });
    expect(deck?.status).toBe("outline");
  });

  it("409s once the job has finished", async () => {
    const { jobId, userId } = await seedGeneratingDeck(1);
    useSession(userId);
    await updateJob(jobId, { status: "done" });

    const { PATCH } = await import("@/app/api/generation/[jobId]/route");
    const res = await readJson(
      await PATCH(
        jsonRequest(`http://t/x/${jobId}`, "PATCH", { action: "cancel" }),
        params(jobId)),
    );
    expect(res.status).toBe(409);
  });

  it("400s on an unknown action", async () => {
    const { jobId, userId } = await seedGeneratingDeck(1);
    useSession(userId);

    const { PATCH } = await import("@/app/api/generation/[jobId]/route");
    const res = await readJson(
      await PATCH(
        jsonRequest(`http://t/x/${jobId}`, "PATCH", { action: "explode" }),
        params(jobId)),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/generation/[jobId]/stream (SSE)", () => {
  beforeEach(() => freshDb());

  it("emits progress as the worker advances, then done, then closes", async () => {
    const { jobId, userId } = await seedGeneratingDeck(3);
    useSession(userId);

    const stream = await openStream(jobId);
    try {
      // Immediate snapshot on connect.
      const first = await stream.next();
      expect(first).toContain("event: progress");
      expect(JSON.parse(first.split("data: ")[1])).toEqual({ done: 0, total: 3 });

      // Worker advances -> the next poll reports the new numbers.
      await updateJob(jobId, { progress: JSON.stringify({ done: 2, total: 3 }) });
      const second = await stream.next();
      expect(second).toContain("event: progress");
      expect(JSON.parse(second.split("data: ")[1])).toEqual({ done: 2, total: 3 });

      await updateJob(jobId, { status: "done" });
      const third = await stream.next();
      expect(third).toContain("event: done");

      // Terminal event closes the stream so the browser stops reconnecting.
      const tail = await stream.next();
      expect(tail).toBe("");
    } finally {
      await stream.cancel();
    }
  });

  it("emits a card event as a pending card becomes ready", async () => {
    const { jobId, deckId, userId } = await seedGeneratingDeck(2);
    useSession(userId);

    const stream = await openStream(jobId);
    try {
      await stream.next(); // initial progress snapshot

      const db = getDb();
      const card = await db.query.card.findFirst({
        where: (c, { eq }) => eq(c.deckId, deckId),
      });
      await db
        .update(t.card)
        .set({ status: "ready", blocks: JSON.stringify([{ type: "paragraph", text: ["hi"] }]) })
        .where(eq(t.card.id, card!.id));
      await updateJob(jobId, { progress: JSON.stringify({ done: 1, total: 2 }) });

      const block = await stream.next();
      expect(block).toContain("event: card");
      const payload = JSON.parse(block.split("data: ")[1]);
      expect(payload.id).toBe(card!.id);
      expect(payload.status).toBe("ready");
    } finally {
      await stream.cancel();
    }
  });

  it("emits error when the job fails", async () => {
    const { jobId, userId } = await seedGeneratingDeck(1);
    useSession(userId);
    await updateJob(jobId, { status: "error", error: "upstream exploded" });

    const stream = await openStream(jobId);
    try {
      const block = await stream.next();
      expect(block).toContain("event: error");
      const payload = JSON.parse(block.split("data: ")[1]);
      expect(payload.error).toContain("upstream exploded");
    } finally {
      await stream.cancel();
    }
  });

  it("401s without a session", async () => {
    const { jobId } = await seedGeneratingDeck(1);
    useSession(null);
    const { GET } = await import("@/app/api/generation/[jobId]/stream/route");
    const res = await GET(
      new Request(`http://t/api/generation/${jobId}/stream`),
      params(jobId),
    );
    expect(res.status).toBe(401);
  });
});
