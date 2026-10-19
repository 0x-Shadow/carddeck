import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { buildDesignedPptxBuffer } from "../src/design-pptx";
import { PRESET_THEMES, type Block, type MotionPlan } from "@carddeck/core";

const theme = PRESET_THEMES.find((t) => t.name === "Cyberpunk")!;
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const cards = [
  {
    id: "cover",
    title: "Carddeck",
    blocks: [
      { type: "heading", level: 1, text: ["Carddeck"] },
      { type: "paragraph", text: ["A deck from one prompt."] },
      { type: "image", src: "hero", caption: "Hero", layout: "behind" },
    ] as Block[],
  },
  {
    id: "data",
    title: "The evidence",
    blocks: [
      { type: "heading", level: 2, text: ["The evidence"] },
      {
        type: "chart",
        kind: "bar",
        data: {
          labels: ["Research", "Design"],
          series: [{ name: "Hours", values: [12, 4] }],
        },
      },
    ] as Block[],
  },
  {
    id: "close",
    title: "Ship it",
    blocks: [
      { type: "heading", level: 1, text: ["Ship it"] },
      { type: "quote", text: ["Ship the story."], attribution: "Carddeck" },
      { type: "callout", tone: "success", text: ["START NOW"] },
    ] as Block[],
  },
];

const deck = { id: "deck-1", title: "Carddeck", theme, cards };

const motion: MotionPlan = {
  preset: "3d",
  slides: [
    { transition: "push", builds: [{ effect: "wipeUp", delayMs: 150 }] },
    { transition: "wipe", builds: [{ effect: "zoom", delayMs: 0 }] },
    { transition: "fade", builds: [{ effect: "fade", delayMs: 0 }] },
  ],
};

async function build(options: Parameters<typeof buildDesignedPptxBuffer>[1] = {}) {
  const buffer = await buildDesignedPptxBuffer(deck, {
    resolveImage: async (src) => (src === "hero" ? { dataUrl: png, mime: "image/png" } : null),
    ...options,
  });
  return JSZip.loadAsync(buffer);
}

describe("buildDesignedPptxBuffer", () => {
  it("writes a valid package with one native slide per card", async () => {
    const zip = await build();
    const names = Object.keys(zip.files);
    expect(names.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))).toHaveLength(3);
    expect(names).toContain("[Content_Types].xml");
  });

  it("embeds resolved photography as a real picture", async () => {
    const zip = await build();
    const media = Object.keys(zip.files).filter((name) => name.startsWith("ppt/media/"));
    expect(media.length).toBeGreaterThan(0);
    const slide1 = (await zip.file("ppt/slides/slide1.xml")!.async("string")) as string;
    expect(slide1).toContain("<p:pic>");
    expect(slide1).toContain("r:embed");
  });

  it("writes a native, editable OOXML chart instead of flattened text", async () => {
    const zip = await build();
    // PptxGenJS numbers charts from a module-level counter, so the filename
    // depends on how many decks this process has already rendered.
    const chartName = Object.keys(zip.files).find((name) =>
      /^ppt\/charts\/chart\d+\.xml$/.test(name),
    );
    expect(chartName).toBeTruthy();
    const chart = (await zip.file(chartName!)!.async("string")) as string;
    expect(chart).toContain("<c:barChart>");
    expect(chart).toContain("<c:ser>");
    expect(chart).toContain("Research");
    expect(chart).toContain("12");
  });

  it("keeps the deck's transitions and entrances while regenerating builds", async () => {
    const zip = await build({ motion });
    const slide1 = (await zip.file("ppt/slides/slide1.xml")!.async("string")) as string;
    expect(slide1).toContain("<p:transition");
    expect(slide1).toContain("<p:push");
    expect(slide1).toContain("<p:timing>");
    expect(slide1).toContain('filter="wipe(down)"');

    const slide3 = (await zip.file("ppt/slides/slide3.xml")!.async("string")) as string;
    expect(slide3).toContain("<p:fade");
  });

  it("leaves the file motion-free without a plan", async () => {
    const zip = await build();
    const slide1 = (await zip.file("ppt/slides/slide1.xml")!.async("string")) as string;
    expect(slide1).not.toContain("<p:timing>");
    expect(slide1).not.toContain("<p:transition");
  });
});
