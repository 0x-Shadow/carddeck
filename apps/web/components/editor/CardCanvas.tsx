"use client";

import type { Block, Theme } from "@carddeck/core";
import { deckCssVars } from "@/lib/theme-styles";
import { BlockEditor } from "./BlockEditor";
import { ChatPanel } from "@/components/ai/ChatPanel";

export interface CanvasCard {
  id: string;
  position: number;
  title: string;
  /** JSON-encoded Block[] (as stored in the card row). */
  blocks: string;
  status: string;
}

export interface CanvasDeck {
  id: string;
  title: string;
  format: string;
  status: string;
  themeId: string;
}

export interface CardCanvasProps {
  deck: CanvasDeck;
  cards: CanvasCard[];
  theme?: Theme;
  /** Copy for not-yet-generated cards (outline mode uses different words). */
  pendingLabel?: string;
  /** Persist a card's edited blocks. */
  onEditCard?: (cardId: string, blocks: Block[]) => void;
  /** Persist a card's edited title. */
  onEditTitle?: (cardId: string, title: string) => void;
  /** Re-run generation for a card that failed. */
  onRetryCard?: (cardId: string) => void;
  /** Card currently showing the AI refine panel (at most one at a time). */
  refiningCardId?: string | null;
  /** Toggle the refine panel; omit together with `refiningCardId` to hide it. */
  onToggleRefine?: (cardId: string | null) => void;
}

function parseBlocks(raw: string): Block[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Block[]) : [];
  } catch {
    return [];
  }
}

/**
 * The editor's document surface: one `.card` per card, in order, wearing the
 * deck's theme as CSS custom properties.
 *
 * Card status drives what's inside: `ready` cards are editable, `error` cards
 * offer a per-card retry, and `pending` cards show a generating state so a
 * half-streamed deck never looks finished.
 */
export function CardCanvas({
  deck,
  cards,
  theme,
  pendingLabel,
  onEditCard,
  onEditTitle,
  onRetryCard,
  refiningCardId,
  onToggleRefine,
}: CardCanvasProps) {
  return (
    <div
      className="deck"
      style={deckCssVars(theme ?? null)}
      data-deck-format={deck.format}
      data-deck-status={deck.status}
    >
      {cards.map((card) => (
        <section
          className="card"
          key={card.id}
          data-card-id={card.id}
          data-card-status={card.status}
        >
          <header className="card-header">
            <span className="card-index" aria-hidden="true">
              {card.position + 1}
            </span>
            {onEditTitle ? (
              <input
                className="card-title card-title-input"
                aria-label={`Card ${card.position + 1} title`}
                value={card.title}
                onChange={(e) => onEditTitle(card.id, e.target.value)}
              />
            ) : (
              <h2 className="card-title">{card.title}</h2>
            )}
          </header>

          <div className="card-body">
            {card.status === "ready" ? (
              <>
                <BlockEditor
                  deckId={deck.id}
                  blocks={parseBlocks(card.blocks)}
                  theme={theme}
                  onChange={(next) => onEditCard?.(card.id, next)}
                />
                {onToggleRefine ? (
                  <div className="card-refine-row">
                    <button
                      type="button"
                      className="btn-secondary card-refine-toggle"
                      aria-pressed={refiningCardId === card.id}
                      onClick={() =>
                        onToggleRefine(refiningCardId === card.id ? null : card.id)
                      }
                    >
                      {refiningCardId === card.id ? "Close refine" : "Refine with AI"}
                    </button>
                  </div>
                ) : null}
                {refiningCardId === card.id ? (
                  <ChatPanel
                    deckId={deck.id}
                    cardId={card.id}
                    onApplied={(blocks) => onEditCard?.(card.id, blocks)}
                  />
                ) : null}
              </>
            ) : card.status === "error" ? (
              <div className="card-error" role="alert">
                <p>This card failed to generate.</p>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => onRetryCard?.(card.id)}
                >
                  Retry this card
                </button>
              </div>
            ) : (
              <div className="card-pending" aria-live="polite">
                <p>{pendingLabel ?? "Card is still generating…"}</p>
                <div className="skeleton" />
              </div>
            )}
          </div>
        </section>
      ))}

      {cards.length === 0 ? (
        <div className="card card-empty">
          <p>No cards yet — create an outline to get started.</p>
        </div>
      ) : null}
    </div>
  );
}
