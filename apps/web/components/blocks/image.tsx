import type { Block, Theme } from "@carddeck/core";
import { blockStyle } from "./shared";

type Image = Extract<Block, { type: "image" }>;

/**
 * An image block. An empty `src` (the AI can reserve a slot before an asset
 * exists) renders a themed placeholder instead of a broken <img>.
 */
export function ImageBlock({ block, theme }: { block: Image; theme?: Theme }) {
  return (
    <figure
      data-block="image"
      className={`block-image block-image-${block.layout}`}
      style={blockStyle(theme)}
    >
      {block.src ? (
        // When a caption is present it becomes the visible <figcaption>, which
        // is already the figure's accessible description — repeating it in
        // `alt` makes a screen reader announce the same line twice. Mark the
        // image decorative in that case. With no caption the image has no
        // text alternative at all, so it stays decorative there too.
        <img src={block.src} alt="" />
      ) : (
        <div className="image-placeholder" role="img" aria-label={block.caption ?? "Image"}>
          Image
        </div>
      )}
      {block.caption ? <figcaption>{block.caption}</figcaption> : null}
    </figure>
  );
}
