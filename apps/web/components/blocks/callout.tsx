import type { Block, Theme } from "@carddeck/core";
import { blockStyle, renderInline } from "./shared";

type Callout = Extract<Block, { type: "callout" }>;

const TONE_CLASS: Record<Callout["tone"], string> = {
  info: "",
  warn: "callout-warn",
  success: "callout-success",
};

export function CalloutBlock({ block, theme }: { block: Callout; theme?: Theme }) {
  return (
    <div
      data-block="callout"
      className={`callout ${TONE_CLASS[block.tone] ?? ""}`.trim()}
      style={blockStyle(theme)}
    >
      {renderInline(block.text)}
    </div>
  );
}
