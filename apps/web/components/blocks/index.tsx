import type { Block, Theme } from "@carddeck/core";
import { HeadingBlock } from "./heading";
import { ParagraphBlock } from "./paragraph";
import { BulletListBlock } from "./bullet-list";
import { NumberedListBlock } from "./number-list";
import { ImageBlock } from "./image";
import { QuoteBlock } from "./quote";
import { DividerBlock } from "./divider";
import { ColumnsBlock } from "./columns";
import { CalloutBlock } from "./callout";
import { ChartBlock } from "./chart";

export interface BlockRendererProps {
  block: Block;
  theme?: Theme;
}

/**
 * Render any block. Every branch emits `data-block="<type>"` so tests and
 * exporter selectors can address blocks without relying on visual structure.
 */
export function BlockRenderer({ block, theme }: BlockRendererProps) {
  switch (block.type) {
    case "heading":
      return <HeadingBlock block={block} theme={theme} />;
    case "paragraph":
      return <ParagraphBlock block={block} theme={theme} />;
    case "bulletList":
      return <BulletListBlock block={block} theme={theme} />;
    case "numberedList":
      return <NumberedListBlock block={block} theme={theme} />;
    case "image":
      return <ImageBlock block={block} theme={theme} />;
    case "quote":
      return <QuoteBlock block={block} theme={theme} />;
    case "divider":
      return <DividerBlock block={block} theme={theme} />;
    case "columns":
      return <ColumnsBlock block={block} theme={theme} />;
    case "callout":
      return <CalloutBlock block={block} theme={theme} />;
    case "chart":
      return <ChartBlock block={block} theme={theme} />;
    default: {
      // Exhaustiveness guard: adding a Block type without a renderer fails here.
      const _never: never = block;
      void _never;
      return null;
    }
  }
}

export { renderInline, blockStyle } from "./shared";
