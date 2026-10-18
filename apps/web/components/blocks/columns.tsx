import type { Block, Theme } from "@carddeck/core";
import { blockStyle } from "./shared";
import { BlockRenderer } from "./index";

type Columns = Extract<Block, { type: "columns" }>;

/** Nested layout: each column renders its own block stack. */
export function ColumnsBlock({ block, theme }: { block: Columns; theme?: Theme }) {
  return (
    <div data-block="columns" className="columns" style={blockStyle(theme)}>
      {block.columns.map((column, i) => (
        <div data-column={i} key={i} className="column">
          {column.map((child, j) => (
            <BlockRenderer key={j} block={child} theme={theme} />
          ))}
        </div>
      ))}
    </div>
  );
}
