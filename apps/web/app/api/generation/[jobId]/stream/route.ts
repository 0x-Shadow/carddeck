import { getDb } from "@/lib/db";
import * as t from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { resolveOwnedJob } from "@/lib/deck-access";
import { parseProgress, isTerminalStatus } from "@/lib/queue";

type Params = { params: Promise<{ jobId: string }> };

/** Bounds for the client-supplied poll interval (ms). */
const MIN_POLL_MS = 50;
const MAX_POLL_MS = 5000;
const DEFAULT_POLL_MS = 300;

function readPollMs(url: string): number {
  const raw = Number(new URL(url).searchParams.get("pollMs"));
  if (!Number.isFinite(raw)) return DEFAULT_POLL_MS;
  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, raw));
}

/**
 * GET /api/generation/[jobId]/stream -> text/event-stream
 *
 * Emits, over one connection:
 *   - `progress` `{done,total}` — immediately on connect, then whenever the
 *     worker bumps the job's progress row;
 *   - `card` `{...card}` — for each card that settles (`ready`, and `error`
 *     so clients can render the per-card retry; also on connect for cards
 *     already settled, so a reconnecting client catches up);
 *   - `done` `{status}` / `error` `{status,error}` — once, at the end, then the
 *     stream closes so the browser stops trying to reconnect.
 *
 * The worker owns the database; this route only observes it. Polling (rather
 * than a push channel) is deliberate: the queue is SQLite and the worker is a
 * separate process, so a query loop is the honest bridge between them.
 */
export async function GET(req: Request, { params }: Params) {
  const { jobId } = await params;
  const owned = await resolveOwnedJob(jobId);
  if (owned.res) return owned.res;

  const pollMs = readPollMs(req.url);
  const deckId = owned.job.deckId;
  const encoder = new TextEncoder();

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (stopped) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // Client went away mid-write; wind the loop down.
          stopped = true;
        }
      };

      const close = () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      /** Snapshot of the job's current state for one poll iteration. */
      async function readState() {
        const db = getDb();
        const job = await db.query.generationJob.findFirst({
          where: (j, { eq }) => eq(j.id, jobId),
        });
        const cards = await db.query.card.findMany({
          where: (c, { eq }) => eq(c.deckId, deckId),
        });
        return { job, cards };
      }

      // Card ids already reported on this connection.
      const reported = new Set<string>();

      async function tick() {
        if (stopped) return;
        const { job, cards } = await readState();
        if (stopped) return;
        if (!job) {
          send("error", { status: "error", error: "job disappeared" });
          close();
          return;
        }

        // Cards first within a poll, so a client that advanced both the
        // progress row and a card sees the card body before the new numbers.
        // Failed cards are reported too: their `error` status is what renders
        // the per-card Retry affordance — a skeleton would keep pretending a
        // card that already failed is still generating.
        for (const card of cards) {
          if ((card.status === "ready" || card.status === "error") && !reported.has(card.id)) {
            reported.add(card.id);
            send("card", card);
          }
        }

        if (isTerminalStatus(job.status)) {
          if (job.status === "error") {
            send("error", { status: "error", error: job.error });
          } else {
            // "done" and "cancelled" both mean: no more events, stop cleanly.
            send("done", { status: job.status });
          }
          close();
          return;
        }

        send("progress", parseProgress(job.progress));
        timer = setTimeout(() => void tick(), pollMs);
      }

      // Kick the first tick off immediately (the connect snapshot).
      void tick();
    },
    cancel() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
