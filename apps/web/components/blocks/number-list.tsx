import type { Block, Theme } from "@carddeck/core";
import { blockStyle, renderInline } from "./shared";

type NumberedList = Extract<Block, { type: "numberedList" }>;

export function NumberedListBlock({ block, theme }: { block: NumberedList; theme?: Theme }) {
  return (
    <ol data-block="numberedList" style={blockStyle(theme)}>
      {block.items.map((item, i) => (
        <li key={i}>{renderInline(item)}</li>
      ))}
    </ol>
  );
}
