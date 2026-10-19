"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ReaderCard } from "./ReaderCard";
import { ReaderChrome } from "./ReaderChrome";
import type { MotionPlan, Theme } from "@carddeck/core";
import { deckCssVars } from "@/lib/theme-styles";

export interface PresentStageProps {
  deckTitle: string;
  cards: Array<{ id: string; title: string; blocks: string }>;
  theme: Theme;
  /** The deck's motion plan; each slide animates from its plan entry. */
  motion?: MotionPlan | null;
  /** Called on Escape / Exit — the page owns the actual navigation. */
  onExit: () => void;
}

/**
 * Full-screen present mode for one deck.
 *
 * Arrow keys (or the on-screen buttons) walk the cards; Escape exits. The
 * visible `{n} / {total}` readout and a `progressbar` role element keep the
 * position legible to sighted users and screen-reader users alike. Only one
 * card is mounted at a time, so the whole viewport is the slide and there is
 * no scroll-jacking.
 *
 * Presentational: the page fetches the deck and passes plain props, so this
 * component stays free of data fetching and is directly unit-testable.
 */
export function PresentStage({ deckTitle, cards, theme, motion, onExit }: PresentStageProps) {
  const [index, setIndex] = useState(0);
  const indexRef = useRef(index);
  indexRef.current = index;
  const total = cards.length;
  const frameRef = useRef<HTMLDivElement>(null);
  const scalerRef = useRef<HTMLDivElement>(null);

  const goTo = useCallback(
    (next: number) => {
      if (total === 0) return;
      setIndex(Math.max(0, Math.min(total - 1, next)));
    },
    [total],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        goTo(indexRef.current + 1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        goTo(indexRef.current - 1);
      } else if (e.key === "Home") {
        goTo(0);
      } else if (e.key === "End") {
        goTo(total - 1);
      } else if (e.key === "Escape") {
        onExit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, total, onExit]);

  /**
   * Scale the slide to fit the 16:9 stage.
   *
   * Cards are authored as flowing documents, so a tall slide (four cards, a
   * long policy list) used to clip at the bottom in present mode. Measure the
   * card's natural height, widen its layout box by 1/scale, then scale it
   * back down — the whole slide stays visible and the design keeps its
   * proportions. The width/scale loop converges in two or three passes.
   */
  useEffect(() => {
    const frame = frameRef.current;
    const scaler = scalerRef.current;
    if (!frame || !scaler) return;
    let cancelled = false;

    const fit = () => {
      if (cancelled) return;
      const rect = frame.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      // Keep the card's layout width equal to the frame so text reflows at the
      // designed width; only the *visual* size changes. This avoids the
      // non-monotonic height oscillation that widening the box caused.
      scaler.style.width = `${rect.width}px`;
      const natural = scaler.scrollHeight;
      const scale = natural > 0 ? Math.min(1, rect.height / natural) : 1;
      scaler.style.setProperty("--slide-scale", String(scale));
    };

    fit();
    // Web fonts change metrics after first paint; re-fit when they land.
    document.fonts?.ready.then(fit).catch(() => undefined);

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(fit);
      observer.observe(frame);
    }
    window.addEventListener("resize", fit);
    return () => {
      cancelled = true;
      observer?.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [index, total]);

  if (total === 0) {
    return (
      <main className="present" style={deckCssVars(theme)}>
        <p className="page-note">This deck has no slides yet.</p>
      </main>
    );
  }

  const card = cards[index];
  const progress = ((index + 1) / total) * 100;

  return (
    <main className="present" style={deckCssVars(theme)}>
      <ReaderChrome title={deckTitle}>
        <button type="button" className="btn-secondary present-exit" onClick={onExit}>
          Exit
        </button>
      </ReaderChrome>

      <div className="present-stage">
        <div className="present-frame" ref={frameRef}>
          <div className="present-scale" ref={scalerRef}>
            {/* key on the card id: every slide change remounts the card, which
                replays that slide's entrance animations from the plan. */}
            <ReaderCard
              key={card.id}
              card={card}
              theme={theme}
              slideMotion={motion?.slides[index] ?? null}
            />
          </div>
        </div>
      </div>

      <footer className="present-footer">
        <div
          className="present-progressbar"
          role="progressbar"
          aria-label="Slide progress"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={index + 1}
        >
          <div className="present-progressbar-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="present-controls">
          <button
            type="button"
            className="btn-secondary"
            disabled={index === 0}
            onClick={() => goTo(index - 1)}
            aria-label="Previous slide"
          >
            ← Previous
          </button>
          <span className="present-progress" aria-live="polite">
            {index + 1} / {total}
          </span>
          <button
            type="button"
            className="btn-secondary"
            disabled={index === total - 1}
            onClick={() => goTo(index + 1)}
            aria-label="Next slide"
          >
            Next →
          </button>
        </div>
      </footer>
    </main>
  );
}
