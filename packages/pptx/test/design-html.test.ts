import { describe, it, expect } from "vitest";
import { renderDesignedPrintHtml } from "../src/design-html";
import { PRESET_THEMES, type Block } from "@carddeck/core";

const theme = PRESET_THEMES.find((t) => t.name === "Cyberpunk")!;
const deck = { title: "Carddeck", theme };
const png = "data:image/png;base64,AAAA";

const cards = [
  {
    id: "cover",
    title: "Carddeck",
    blocks: [
      { type: "heading", level: 1, text: ["Carddeck"] },
      { type: "paragraph", text: ["A board-ready deck from one prompt."] },
      { type: "callout", tone: "info", text: ["PROMPT → EXPORT"] },
      { type: "image", src: "hero", caption: "Hero", layout: "behind" },
    ] as Block[],
  },
  {
    id: "middle",
    title: "The evidence",
    blocks: [
      { type: "heading", level: 2, text: ["The evidence"] },
      {
        type: "columns",
        columns: [
          [
            { type: "heading", level: 3, text: ["12 hrs"] },
            { type: "callout", tone: "success", text: ["SAVED"] },
            { type: "paragraph", text: ["Every week."] },
          ],
          [
            { type: "heading", level: 3, text: ["3×"] },
            { type: "callout", tone: "info", text: ["FASTER"] },
            { type: "paragraph", text: ["From brief to deck."] },
          ],
        ],
      },
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
      { type: "quote", text: ["The best deck is the one that ships."], attribution: "Carddeck" },
      { type: "callout", tone: "success", text: ["START NOW"] },
      { type: "paragraph", text: ["One idea away."] },
      { type: "image", src: "hero", caption: "Hero", layout: "behind" },
    ] as Block[],
  },
];

async function render(overrides: { cards?: typeof cards } = {}) {
  return renderDesignedPrintHtml(deck, overrides.cards ?? cards, {
    resolveImage: async (src) => (src === "hero" ? { dataUrl: png } : null),
  });
}

describe("renderDesignedPrintHtml", () => {
  it("emits one fixed 16:9 page per card, with designed cover and close", async () => {
    const html = await render();
    expect(html).toContain("@page");
    expect(html).toContain("1280px 720px");
    expect(html.match(/class="slide-page/g)).toHaveLength(3);
    expect(html).toContain('class="slide-page cover"');
    expect(html).toContain('class="slide-page closing"');
    expect(html).toContain("Carddeck");
    expect(html).toContain("The best deck is the one that ships.");
    expect(html).toContain("CARDDECK  ·  CLOSE");
  });

  it("draws real SVG charts instead of flattening data into text", async () => {
    const html = await render();
    expect(html).toContain("<svg");
    expect(html).toContain("<rect");
    expect(html).toContain("Research");
    expect(html).toContain(">12<");
    expect(html).not.toContain("BAR ANALYSIS");
  });

  it("inlines resolved photography and never leaves a placeholder", async () => {
    const html = await render();
    expect(html).toContain(`src="${png}"`);
    expect(html).not.toContain("[image:");
    expect(html).toContain('class="cover-art"');
    expect(html).toContain("Hero");
  });

  it("renders KPI card grids and editorial typography", async () => {
    const html = await render();
    expect(html).toContain('class="columns"');
    expect(html).toContain('class="col-card accent"');
    expect(html).toContain("12 hrs");
    expect(html).toContain("SAVED");
    expect(html).toContain("--accent:");
  });

  it("escapes card copy", async () => {
    const evil = [
      {
        id: "x",
        title: "<script>",
        blocks: [{ type: "paragraph", text: ["a < b"] }] as Block[],
      },
    ];
    const html = await renderDesignedPrintHtml(deck, evil);
    expect(html).not.toContain("<script>");
    expect(html).toContain("a &lt; b");
  });
});
