import type { Block, Theme } from "@carddeck/core";
import { blockStyle, renderInline } from "./shared";

type Heading = Extract<Block, { type: "heading" }>;

export function HeadingBlock({ block, theme }: { block: Heading; theme?: Theme }) {
  const Tag = (block.level === 1 ? "h1" : block.level === 2 ? "h2" : "h3") as "h1" | "h2" | "h3";
  return (
    <div data-block="heading" className="block-heading" style={blockStyle(theme)}>
      <Tag>{renderInline(block.text)}</Tag>
    </div>
  );
}
