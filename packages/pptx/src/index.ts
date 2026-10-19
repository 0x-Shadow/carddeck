export { renderSlideHtml, renderSlidesHtml, renderPrintHtml } from "./render-slides";
export { renderDesignedPrintHtml, renderDesignedSlidesHtml, type DesignedPrintOptions } from "./design-html";
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
  buildDesignedPptxBuffer,
  type DesignedDeck,
  type DesignedPptxOptions,
} from "./design-pptx";
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
export {
  buildPptagentPptxBuffer,
  isPptagentAvailable,
  PPTAGENT_CONVERTER,
  type PptagentOptions,
} from "./pptagent";
export { injectMotion, timingXml, transitionXml, shapeIdsInSlideXml } from "./motion-xml";
