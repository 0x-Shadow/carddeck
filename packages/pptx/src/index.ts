export { renderSlideHtml, renderSlidesHtml, renderPrintHtml } from "./render-slides";
export type {
  SlideDeck,
  SlideInput,
  SlideHtml,
  PrintFormat,
  PrintOptions,
} from "./render-slides";
export {
  buildPptxBuffer,
  type BuildPptxOptions,
  type PptxTextItem,
  type HtmlConverter,
} from "./build-pptx";
export {
  collectSlideImages,
  resolveBlockImages,
  type ImageResolver,
  type ImageLayout,
  type ImageMap,
  type SlideImage,
  type ResolvedImage,
} from "./images";
export { buildThemePotxBuffer } from "./theme-potx";
export { injectMotion, timingXml, transitionXml, shapeIdsInSlideXml } from "./motion-xml";
