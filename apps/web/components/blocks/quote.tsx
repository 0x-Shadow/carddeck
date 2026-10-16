import type { Block, Theme } from "@carddeck/core";
import { blockStyle, renderInline } from "./shared";

type Quote = Extract<Block, { type: "quote" }>;

export function QuoteBlock({ block, theme }: { block: Quote; theme?: Theme }) {
  return (
    <figure data-block="quote" className="quote" style={blockStyle(theme)}>
      <blockquote>{renderInline(block.text)}</blockquote>
      {block.attribution ? <figcaption>{block.attribution}</figcaption> : null}
    </figure>
  );
}
