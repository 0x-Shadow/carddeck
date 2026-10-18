import type { Block, Theme } from "@carddeck/core";
import { blockStyle, renderInline } from "./shared";

type Paragraph = Extract<Block, { type: "paragraph" }>;

export function ParagraphBlock({ block, theme }: { block: Paragraph; theme?: Theme }) {
  return (
    <div data-block="paragraph" style={blockStyle(theme)}>
      <p>{renderInline(block.text)}</p>
    </div>
  );
}
