import type { Block, Theme } from "@carddeck/core";
import { blockStyle, renderInline } from "./shared";

type BulletList = Extract<Block, { type: "bulletList" }>;

export function BulletListBlock({ block, theme }: { block: BulletList; theme?: Theme }) {
  return (
    <ul data-block="bulletList" style={blockStyle(theme)}>
      {block.items.map((item, i) => (
        <li key={i}>{renderInline(item)}</li>
      ))}
    </ul>
  );
}
