/**
 * html2pptx ships no types; declare the one function we use.
 * It converts an HTML string into PptxGenJS text items (see its README).
 */
declare module "html2pptx" {
  export interface PptxTextItem {
    text: string;
    options?: Record<string, unknown>;
  }
  export function htmlToPptxText(
    html: string,
    options?: {
      css?: string;
      fontFace?: string;
      fontSize?: number;
      paraSpaceAfter?: number;
      paraSpaceBefore?: number;
      preFontFace?: string;
    },
  ): PptxTextItem[];
}
