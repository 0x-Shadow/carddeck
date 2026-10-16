import { describe, it, expect } from "vitest";
import { buildPptxBuffer, type PptxTextItem } from "../src/build-pptx";

/**
 * A stand-in for `html2pptx.htmlToPptxText`. The real converter needs a DOM
 * (jsdom) and parses CSS; this fake just splits the html into one text item,
 * keeping the unit test fast and dependency-free while still proving the
 * pipeline zips one slide per input.
 */
function fakeConverter(html: string): PptxTextItem[] {
  const text = html.replace(/<[^>]*>/g, "").trim();
  return text ? [{ text, options: { fontFace: "Arial", fontSize: 18 } }] : [];
}

describe("buildPptxBuffer", () => {
  it("returns a valid pptx zip (PK header) with one slide per input", async () => {
    const slides = [{ html: "<div><h1>Big Idea</h1><p>Body</p></div>" }];
    const buf = await buildPptxBuffer(slides, fakeConverter);

    expect(Buffer.isBuffer(buf)).toBe(true);
    // Zip magic bytes.
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(buf.byteLength).toBeGreaterThan(1000);
  });

  it("produces one slide per card html", async () => {
    const slides = [{ html: "<h1>One</h1>" }, { html: "<h1>Two</h1>" }, { html: "<h1>Three</h1>" }];
    const buf = await buildPptxBuffer(slides, fakeConverter);
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buf);
    const slideFiles = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    expect(slideFiles).toHaveLength(3);
  });

  it("passes each card's html through the converter", async () => {
    const seen: string[] = [];
    const recording = (html: string): PptxTextItem[] => {
      seen.push(html);
      return [{ text: "x" }];
    };
    const slides = [{ html: "<h1>A</h1>" }, { html: "<h1>B</h1>" }];
    await buildPptxBuffer(slides, recording);
    expect(seen).toEqual(["<h1>A</h1>", "<h1>B</h1>"]);
  });

  it("defaults to the real html2pptx converter when none is injected", async () => {
    const slides = [{ html: "<h1>Real</h1>" }];
    const buf = await buildPptxBuffer(slides);
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("handles an empty slide list without throwing", async () => {
    const buf = await buildPptxBuffer([], fakeConverter);
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
  });
});
