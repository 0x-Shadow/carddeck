"use client";

import { useEffect, useRef, useState } from "react";
import { CardCanvas, type CanvasCard } from "./CardCanvas";

export interface GenerationViewProps {
  deckId: string;
  jobId: string;
  /** Cards as they stand right now (pending ones render as skeletons). */
  cards: CanvasCard[];
  /** Report the merged card list upward whenever a `card` event lands. */
  onCardsChange: (cards: CanvasCard[]) => void;
  /** Called when the stream reaches a terminal state. */
  onDone: (status: "done" | "cancelled") => void;
  /** Called with the fresh jobId when the user retries a failed run. */
  onRetry?: (jobId: string) => void;
}

type RunStatus = "running" | "done" | "cancelled" | "error";

/**
 * Live generation surface for one job.
 *
 * Opens the job's SSE stream and folds `card` events into the card list, so the
 * deck fills in card by card exactly as the worker finishes them — no manual
 * refresh. Pending cards render as skeletons (via CardCanvas), a progress read
 * out tracks the job row, and **Stop** cancels the run server-side.
 *
 * Connection-level EventSource errors (drops, retries) carry no payload and are
 * ignored: the browser reconnects on its own, and only the server's explicit
 * `error` event means the job actually failed.
 */
export function GenerationView({
  deckId,
  jobId,
  cards,
  onCardsChange,
  onDone,
  onRetry,
}: GenerationViewProps) {
  const [merged, setMerged] = useState<CanvasCard[]>(cards);
  const [progress, setProgress] = useState({ done: 0, total: cards.length });
  const [status, setStatus] = useState<RunStatus>("running");
  const [jobError, setJobError] = useState<string | null>(null);

  // Latest props/state for callbacks registered once per subscription.
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const mergedRef = useRef(merged);
  mergedRef.current = merged;
  const onCardsChangeRef = useRef(onCardsChange);
  onCardsChangeRef.current = onCardsChange;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    mergedRef.current = cardsRef.current;
    setMerged(cardsRef.current);
    setStatus("running");
    setJobError(null);

    const source = new EventSource(`/api/generation/${jobId}/stream`);

    const handleProgress = (e: { data?: string }) => {
      if (typeof e.data !== "string") return;
      try {
        setProgress(JSON.parse(e.data));
      } catch {
        /* malformed frame: skip */
      }
    };

    const handleCard = (e: { data?: string }) => {
      if (typeof e.data !== "string") return;
      let card: CanvasCard;
      try {
        card = JSON.parse(e.data) as CanvasCard;
      } catch {
        return;
      }
      // Merge outside the state updater: updaters must be pure (React may run
      // them more than once), and the parent notification belongs here.
      const next = mergedRef.current.some((c) => c.id === card.id)
        ? mergedRef.current.map((c) => (c.id === card.id ? card : c))
        : [...mergedRef.current, card];
      mergedRef.current = next;
      setMerged(next);
      onCardsChangeRef.current(next);
    };

    const handleDone = (e: { data?: string }) => {
      let runStatus: "done" | "cancelled" = "done";
      if (typeof e.data === "string") {
        try {
          const payload = JSON.parse(e.data) as { status?: string };
          if (payload.status === "cancelled") runStatus = "cancelled";
        } catch {
          /* fall through with "done" */
        }
      }
      setStatus(runStatus);
      source.close();
      onDoneRef.current(runStatus);
    };

    const handleError = (e: { data?: string }) => {
      // No payload => the connection dropped, not the job. Let EventSource retry.
      if (typeof e.data !== "string") return;
      try {
        const payload = JSON.parse(e.data) as { error?: string };
        setStatus("error");
        setJobError(payload.error ?? "generation failed");
        source.close();
      } catch {
        /* malformed frame: skip */
      }
    };

    source.addEventListener("progress", handleProgress);
    source.addEventListener("card", handleCard);
    source.addEventListener("done", handleDone);
    source.addEventListener("error", handleError);

    return () => {
      source.removeEventListener("progress", handleProgress);
      source.removeEventListener("card", handleCard);
      source.removeEventListener("done", handleDone);
      source.removeEventListener("error", handleError);
      source.close();
    };
    // cards/onCardsChange/onDone are read through refs; only the job resubscribes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  async function stop() {
    await fetch(`/api/generation/${jobId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    // The stream answers with done(cancelled); handleDone flips the UI.
  }

  async function retry() {
    const res = await fetch(`/api/deck/${deckId}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) return;
    const body = (await res.json().catch(() => null)) as { jobId?: string } | null;
    if (body?.jobId && body.jobId !== jobId) onRetry?.(body.jobId);
  }

  return (
    <div className="generation-view">
      <div className="generation-status" role="status" aria-live="polite">
        {status === "error" ? (
          <div className="generation-error" role="alert">
            <p>Generation failed: {jobError}</p>
            <button type="button" className="btn-primary" onClick={() => void retry()}>
              Try again
            </button>
          </div>
        ) : status === "cancelled" ? (
          <p>Generation stopped.</p>
        ) : status === "done" ? (
          <p>Generation complete.</p>
        ) : (
          <>
            <p>
              Generating {progress.total || merged.length} cards…{" "}
              <span className="generation-progress">
                {progress.done}/{progress.total || merged.length}
              </span>
            </p>
            <button type="button" className="btn-primary" onClick={() => void stop()}>
              Stop
            </button>
          </>
        )}
      </div>

      <CardCanvas
        deck={{ id: deckId, title: "", format: "presentation", status: "generating", themeId: "" }}
        cards={merged}
      />
    </div>
  );
}
