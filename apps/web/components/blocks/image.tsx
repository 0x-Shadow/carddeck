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
        <img src={block.src} alt={block.caption ?? ""} />
      ) : (
        <div className="image-placeholder" role="img" aria-label={block.caption ?? "Image"}>
          Image
        </div>
      )}
      {block.caption ? <figcaption>{block.caption}</figcaption> : null}
    </figure>
  );
}
