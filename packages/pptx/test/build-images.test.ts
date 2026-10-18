import { describe, it, expect, vi } from "vitest";
import { buildPptxBuffer, type PptxTextItem, type ImageResolver } from "../src/index";

/** 1x1 PNG. */
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function fakeConverter(html: string): PptxTextItem[] {
  const text = html.replace(/<[^>]*>/g, "").trim();
  return text ? [{ text, options: { fontFace: "Arial", fontSize: 18 } }] : [];
}

async function slideXml(buf: Buffer, index: number): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  return zip.file(`ppt/slides/slide${index}.xml`)!.async("string");
}

async function mediaFiles(buf: Buffer): Promise<string[]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  // `.dir` entries are folders — only count actual media files.
  return Object.keys(zip.files).filter(
    (f) => f.startsWith("ppt/media/") && !zip.files[f].dir,
  );
}

describe("buildPptxBuffer image embedding", () => {
  it("embeds resolved images as real picture shapes", async () => {
    const resolveImage: ImageResolver = vi.fn(async () => ({
      dataUrl: TINY_PNG_DATA_URL,
    }));
    const slides = [{ html: "<h1>Cover</h1>" }];
    const buf = await buildPptxBuffer(slides, {
      converter: fakeConverter,
      resolveImage,
      images: [[{ src: "/api/deck/d1/assets/a1", layout: "full" }]],
    });

    expect(resolveImage).toHaveBeenCalledWith("/api/deck/d1/assets/a1");
    expect(await mediaFiles(buf)).toHaveLength(1);
    expect(await slideXml(buf, 1)).toMatch(/<p:pic>/);
  });

  it("falls back to a captioned placeholder when resolution fails", async () => {
    const resolveImage: ImageResolver = vi.fn(async () => null);
    const slides = [{ html: "<h1>Cover</h1>" }];
    const buf = await buildPptxBuffer(slides, {
      converter: fakeConverter,
      resolveImage,
      images: [[{ src: "/api/deck/d1/assets/missing", layout: "side" }]],
    });

    expect(await mediaFiles(buf)).toHaveLength(0);
    // No <p:pic>, and the zip is still a valid deck.
    expect(await slideXml(buf, 1)).not.toMatch(/<p:pic>/);
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("embeds nothing when a slide has no images", async () => {
    const resolveImage: ImageResolver = vi.fn(async () => ({
      dataUrl: TINY_PNG_DATA_URL,
    }));
    const slides = [{ html: "<h1>Text only</h1>" }, { html: "<h1>Also text</h1>" }];
    const buf = await buildPptxBuffer(slides, {
      converter: fakeConverter,
      resolveImage,
      images: [[{ src: "https://example.com/x.png", layout: "full" }], undefined],
    });

    expect(resolveImage).toHaveBeenCalledTimes(1);
    expect(await mediaFiles(buf)).toHaveLength(1);
    // Slide 2 untouched.
    expect(await slideXml(buf, 2)).not.toMatch(/<p:pic>/);
  });

  it("does not call the resolver when no images option is given", async () => {
    const resolveImage: ImageResolver = vi.fn(async () => null);
    const buf = await buildPptxBuffer([{ html: "<h1>A</h1>" }], {
      converter: fakeConverter,
      resolveImage,
    });
    expect(resolveImage).not.toHaveBeenCalled();
    expect(await mediaFiles(buf)).toHaveLength(0);
  });

  it("positions images per layout (EMU geometry)", async () => {
    const slides = [{ html: "<h1>A</h1>" }];
    const buf = await buildPptxBuffer(slides, {
      converter: fakeConverter,
      resolveImage: async () => ({ dataUrl: TINY_PNG_DATA_URL }),
      images: [
        [
          { src: "s1", layout: "full" },
          { src: "s2", layout: "side" },
          { src: "s3", layout: "behind" },
        ],
      ],
    });
    const xml = await slideXml(buf, 1);
    // 914400 EMU per inch. The three picture shapes are positioned at distinct
    // x-offsets (full=left 0.5in, side=right 8.33in, behind=full-bleed 0in).
    expect(xml).toContain('<a:off x="457200" y="4206240"/>'); // full: x=0.5in y=4.6in
    expect(xml).toContain('<a:off x="8076895" y="1097280"/>'); // side: x=8.33in y=1.2in
    expect(xml).toContain('<a:off x="0" y="1005840"/>'); // behind: x=0 y=1.1in
  });
});
