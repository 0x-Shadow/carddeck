"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ReaderCard } from "./ReaderCard";
import { ReaderChrome } from "./ReaderChrome";
import type { Theme } from "@carddeck/core";
import { deckCssVars } from "@/lib/theme-styles";

export interface PresentStageProps {
  deckTitle: string;
  cards: Array<{ id: string; title: string; blocks: string }>;
  theme: Theme;
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
export function PresentStage({ deckTitle, cards, theme, onExit }: PresentStageProps) {
  const [index, setIndex] = useState(0);
  const indexRef = useRef(index);
  indexRef.current = index;
  const total = cards.length;

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
        <ReaderCard key={card.id} card={card} theme={theme} />
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
