import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { buildPptxBuffer, groupTextItems, type PptxTextItem } from "../src/build-pptx";
import type { MotionPlan } from "@carddeck/core";

/**
 * Stand-in for `html2pptx.htmlToPptxText` (see build-pptx.test.ts): returns
 * one text item, so each slide carries exactly one real shape. That makes
 * the clamp assertion below exact — twelve builds against one shape must
 * produce one animated shape, not twelve.
 */
function fakeConverter(html: string): PptxTextItem[] {
  const text = html.replace(/<[^>]*>/g, "").trim();
  return text ? [{ text, options: { fontFace: "Arial", fontSize: 18 } }] : [];
}

const slideHtml = (n: number) =>
  `<html><body><h1>Slide ${n}</h1><p>body</p></body></html>`;

describe("buildPptxBuffer motion injection", () => {
  const plan: MotionPlan = {
    preset: "punchy",
    slides: [
      {
        transition: "push",
        builds: [
          { effect: "fade", delayMs: 0 },
          { effect: "wipeUp", delayMs: 200 },
        ],
      },
      { transition: "wipe", builds: [{ effect: "zoom", delayMs: 0 }] },
    ],
  };

  it("injects a transition and timing into planned slides only", async () => {
    const buffer = await buildPptxBuffer(
      [1, 2, 3].map((n) => ({ html: slideHtml(n) })),
      { converter: fakeConverter, motion: plan },
    );
    const zip = await JSZip.loadAsync(buffer);
    const slide = async (n: number) =>
      (await zip.file(`ppt/slides/slide${n}.xml`)!.async("string")) as string;

    const s1 = await slide(1);
    expect(s1).toContain("<p:transition");
    expect(s1).toContain("<p:push");
    expect(s1).toContain("<p:timing>");
    expect(s1).toContain('nodeType="clickEffect"');
    expect(s1).toContain('filter="fade"');
    // The transition + timing sit after the slide's content, before </p:sld>.
    expect(s1.indexOf("<p:clrMapOvr")).toBeLessThan(s1.indexOf("<p:transition"));
    expect(s1.indexOf("<p:transition")).toBeLessThan(s1.indexOf("<p:timing"));
    expect(s1.indexOf("<p:timing>")).toBeLessThan(s1.indexOf("</p:sld>"));

    expect(await slide(2)).toContain("<p:wipe");
    // A slide the plan doesn't cover stays byte-plain.
    const s3 = await slide(3);
    expect(s3).not.toContain("<p:timing>");
    expect(s3).not.toContain("<p:transition");
  });

  it("staggers a second shape withEffect instead of animating empty space", async () => {
    // Two text items become two shapes: one clickEffect, one delayed withEffect.
    const twoBuilds: MotionPlan = {
      preset: "punchy",
      slides: [
        {
          transition: "push",
          builds: [
            { effect: "fade", delayMs: 0 },
            { effect: "wipeUp", delayMs: 200 },
          ],
        },
      ],
    };
    const buffer = await buildPptxBuffer([{ html: slideHtml(1) }], {
      converter: () => [{ text: "Title" }, { text: "Body" }],
      motion: twoBuilds,
    });
    const zip = await JSZip.loadAsync(buffer);
    const s1 = (await zip.file("ppt/slides/slide1.xml")!.async("string")) as string;
    expect(s1).toContain('nodeType="clickEffect"');
    expect(s1).toContain('nodeType="withEffect"');
    expect(s1).toContain('delay="200"');
  });

  it("animates text first, then gives embedded images a zoom entrance", async () => {
    // pptxgenjs numbers all slide objects off one shared counter in add order,
    // and the exporter adds images before text. So a slide with an image block
    // writes <p:pic id=2> then <p:sp id=3>… — a build must never land on the
    // picture. Picture animations are appended after the text builds.
    const withImage: MotionPlan = {
      preset: "punchy",
      slides: [
        {
          transition: "push",
          builds: [
            { effect: "fade", delayMs: 0 },
            { effect: "zoom", delayMs: 200 },
          ],
        },
      ],
    };
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const buffer = await buildPptxBuffer([{ html: slideHtml(1) }], {
      converter: () => [{ text: "Title" }, { text: "Body" }],
      resolveImage: async () => ({ dataUrl: png, mime: "image/png" }),
      images: [[{ src: "x.png", layout: "full", caption: "" }]],
      motion: withImage,
    });
    const zip = await JSZip.loadAsync(buffer);
    const s1 = (await zip.file("ppt/slides/slide1.xml")!.async("string")) as string;

    const picIds = [...s1.matchAll(/<p:pic>[\s\S]*?<p:cNvPr[^>]*\sid="(\d+)"/g)].map(
      (m) => m[1],
    );
    const targets = [...new Set(
      [...s1.matchAll(/<p:spTgt[^>]*\sspid="(\d+)"/g)].map((m) => m[1]),
    )];
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.slice(0, 2).some((id) => picIds.includes(id))).toBe(false);
    expect(targets.slice(0, 2)).toEqual(expect.arrayContaining(["3", "4"]));
    expect(targets.slice(2)).toEqual(picIds);
    expect(s1).toContain('presetID="23"');
  });

  it("never animates more shapes than the slide has", async () => {
    const heavy: MotionPlan = {
      preset: "punchy",
      slides: [
        {
          transition: "fade",
          builds: Array.from({ length: 12 }, (_, i) => ({
            effect: "fade" as const,
            delayMs: i * 100,
          })),
        },
      ],
    };
    const buffer = await buildPptxBuffer([{ html: slideHtml(1) }], {
      converter: fakeConverter,
      motion: heavy,
    });
    const zip = await JSZip.loadAsync(buffer);
    const s1 = (await zip.file("ppt/slides/slide1.xml")!.async("string")) as string;
    // The fake converter adds exactly one shape per slide.
    expect(s1.split('presetClass="entr"').length - 1).toBe(1);
  });

  it("produces a motion-free file without a plan", async () => {
    const buffer = await buildPptxBuffer([{ html: slideHtml(1) }], {
      converter: fakeConverter,
    });
    const zip = await JSZip.loadAsync(buffer);
    const s1 = (await zip.file("ppt/slides/slide1.xml")!.async("string")) as string;
    expect(s1).not.toContain("<p:timing>");
    expect(s1).not.toContain("<p:transition");
  });

  it("refuses a plan that covers a missing slide instead of writing a broken file", async () => {
    const bad: MotionPlan = {
      preset: "punchy",
      slides: [
        { transition: "fade", builds: [] },
        { transition: "fade", builds: [] }, // deck only has one slide
      ],
    };
    await expect(
      buildPptxBuffer([{ html: slideHtml(1) }], { converter: fakeConverter, motion: bad }),
    ).rejects.toThrow(/slide/i);
  });
});

describe("groupTextItems", () => {
  const items = [{ text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }, { text: "e" }];

  it("returns a single group when no motion asks for a split", () => {
    expect(groupTextItems(items, 1)).toEqual([items]);
  });

  it("never drops an item", () => {
    for (let parts = 1; parts <= 8; parts++) {
      const groups = groupTextItems(items, parts);
      expect(groups.flat()).toEqual(items);
    }
  });

  it("splits as evenly as the item count allows", () => {
    const groups = groupTextItems(items, 2);
    expect(groups).toHaveLength(2);
    // 5 items over 2 groups: 3 + 2, balanced rather than front-loaded.
    expect(groups[0]).toHaveLength(3);
    expect(groups[1]).toHaveLength(2);
  });

  it("cannot produce more groups than there are items", () => {
    expect(groupTextItems(items, 12)).toHaveLength(5);
  });
});
