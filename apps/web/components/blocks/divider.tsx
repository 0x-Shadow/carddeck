import type { Block, Theme } from "@carddeck/core";
import { blockStyle } from "./shared";

type Divider = Extract<Block, { type: "divider" }>;

export function DividerBlock({ theme }: { block: Divider; theme?: Theme }) {
  return <hr data-block="divider" className="divider" style={blockStyle(theme)} />;
}
