import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { PRESET_THEMES, type Block } from "@carddeck/core";
import { buildPptagentPptxBuffer, isPptagentAvailable, PPTAGENT_CONVERTER } from "../src/pptagent";

const theme = PRESET_THEMES.find((t) => t.name === "Light")!;

const deck = {
  id: "pptagent-test",
  title: "HTML Engine",
  theme,
  cards: [
    {
      id: "cover",
      title: "HTML Engine",
      blocks: [
        { type: "heading", level: 1, text: ["HTML Engine"] },
        { type: "heading", level: 2, text: ["A second PPTX renderer"] },
        { type: "paragraph", text: ["The designed HTML slides become native shapes."] },
        { type: "callout", tone: "info", text: ["PPTAGENT"] },
      ] as Block[],
    },
    {
      id: "body",
      title: "What survives the trip",
      blocks: [
        { type: "heading", level: 1, text: ["What survives the trip"] },
        { type: "heading", level: 2, text: ["Text, cards, pills"] },
        {
          type: "bulletList",
          items: [["Editable runs"], ["Native shapes"], ["Positioned frames"]],
        },
        { type: "callout", tone: "success", text: ["NOT A SCREENSHOT"] },
      ] as Block[],
    },
    {
      id: "close",
      title: "Ship it",
      blocks: [
        { type: "heading", level: 1, text: ["Ship it"] },
        { type: "paragraph", text: ["Convert, then edit in PowerPoint."] },
      ] as Block[],
    },
  ],
};

describe("isPptagentAvailable", () => {
  it("finds the vendored converter and its node dependencies", () => {
    expect(PPTAGENT_CONVERTER.endsWith("html2pptx_cli.cjs")).toBe(true);
    expect(isPptagentAvailable()).toBe(true);
  });
});

describe("buildPptagentPptxBuffer", () => {
  it("rejects an empty deck", async () => {
    await expect(
      buildPptagentPptxBuffer({ title: deck.title, theme: deck.theme }, []),
    ).rejects.toThrow(/at least one card/);
  });

  // Real conversion: Playwright reads the computed layout and PptxGenJS writes
  // the package. Skipped only when the vendored runtime is missing.
  const integration = isPptagentAvailable() ? it : it.skip;
  integration(
    "converts each slide into editable shapes, not a screenshot",
    async () => {
      const warnings: string[] = [];
      const buffer = await buildPptagentPptxBuffer(
        { title: deck.title, theme: deck.theme },
        deck.cards,
        {
        onWarning: (w) => warnings.push(w),
      });

      const zip = await JSZip.loadAsync(buffer);
      const slideNames = Object.keys(zip.files).filter((name) =>
        /^ppt\/slides\/slide\d+\.xml$/.test(name),
      );
      expect(slideNames).toHaveLength(3);

      const first = (await zip.file("ppt/slides/slide1.xml")!.async("string")) as string;
      // Native text runs, not a flat raster. On the cover the second heading
      // becomes the uppercase eyebrow, so assert its rendered form.
      expect(first).toContain("<a:t>HTML Engine</a:t>");
      expect(first).toContain("<a:t>A SECOND PPTX RENDERER</a:t>");
      const second = (await zip.file("ppt/slides/slide2.xml")!.async("string")) as string;
      expect(second).toContain("Editable runs");

      // Pure vector output: the converter must not rasterize the design.
      const media = Object.keys(zip.files).filter(
        (name) => name.startsWith("ppt/media/") && !zip.files[name].dir,
      );
      expect(media).toHaveLength(0);
      expect(warnings).toEqual([]);
    },
    120_000,
  );
});
