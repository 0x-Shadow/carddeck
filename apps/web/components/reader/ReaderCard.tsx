import type { Block, Theme } from "@carddeck/core";
import { BlockRenderer } from "@/components/blocks";
import { deckCssVars } from "@/lib/theme-styles";

/** The card fields the reader needs (public API rows and DB rows both fit). */
export interface ReaderCardData {
  title: string;
  /** JSON string of `Block[]`; parsed defensively below. */
  blocks: string;
}

export interface ReaderCardProps {
  card: ReaderCardData;
  theme?: Theme | null;
  /** 1-based position for the slide number; omit to hide it. */
  index?: number;
  total?: number;
}

/** Decode a card's blocks JSON, tolerating null/partial/corrupt rows. */
function parseBlocks(raw: string): Block[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Block[]) : [];
  } catch {
    return [];
  }
}

/**
 * One read-only card surface: title, position, and rendered blocks, skinned by
 * the deck theme. Shared by the vertical reader (`/view/[slug]`) and the
 * full-screen present mode, so both always render exactly what the editor
 * shows — the same `BlockRenderer` the editable canvas uses.
 */
export function ReaderCard({ card, theme, index, total }: ReaderCardProps) {
  const blocks = parseBlocks(card.blocks);
  return (
    <section
      className="reader-card"
      style={deckCssVars(theme)}
      aria-label={card.title}
    >
      <div className="reader-card-head">
        <h2 className="reader-card-title">{card.title}</h2>
        {index !== undefined ? (
          <span className="reader-card-index">
            {index}
            {total !== undefined ? ` / ${total}` : ""}
          </span>
        ) : null}
      </div>
      <div className="reader-card-body">
        {blocks.map((block, i) => (
          <BlockRenderer key={i} block={block} theme={theme ?? undefined} />
        ))}
      </div>
    </section>
  );
}
