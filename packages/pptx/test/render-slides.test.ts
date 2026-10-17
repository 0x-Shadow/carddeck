import { describe, it, expect } from "vitest";
import { renderSlideHtml, renderSlidesHtml } from "../src/render-slides";
import { PRESET_THEMES, type Block } from "@carddeck/core";

const theme = PRESET_THEMES.find((t) => t.name === "Midnight")!;
const deck = { title: "Quarterly Plan", theme };

/** Visible text of the slide body (tags stripped, head excluded). */
function bodyText(html: string): string {
  return html.slice(html.indexOf("<body")).replace(/<[^>]+>/g, " ");
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const card = {
  id: "c1",
  title: "Quarterly Plan",
  blocks: [
    { type: "heading", level: 2, text: [{ text: "Q3 Goals", bold: true }] },
    { type: "paragraph", text: ["Ship the", { text: " exporter", bold: true }, " feature."] },
    { type: "bulletList", items: [["Grow users"], ["Cut churn"]] },
    { type: "callout", tone: "info", text: ["Remember to export the deck"] },
  ] as Block[],
};

describe("renderSlideHtml", () => {
  it("wraps one card in a 16:9 slide document with inlined theme styles", async () => {
    const html = await renderSlideHtml(deck, card);

    // Full document html2pptx can parse.
    expect(html).toContain("<html");
    expect(html).toContain("<body");
    // The slide is 16:9 (1280x720 reference box).
    expect(html).toContain("1280");
    expect(html).toContain("720");
    // Title + block text are present.
    expect(html).toContain("Quarterly Plan");
    expect(html).toContain("Q3 Goals");
    expect(html).toContain("Ship the");
    expect(html).toContain("Grow users");
  });

  it("inlines theme colors as hex so html2pptx can read them", async () => {
    const html = await renderSlideHtml(deck, card);
    // No unresolved CSS custom properties — everything is concrete hex/rgb.
    expect(html).not.toContain("var(--");
    expect(html).toContain(theme.colors.accent.replace("#", ""));
  });

  it("escapes block text so markup in content cannot break the document", async () => {
    const evil = {
      id: "c2",
      title: "<script>alert(1)</script>",
      blocks: [{ type: "paragraph", text: ["5 < 6 & 7 > 4"] } as Block],
    };
    const html = await renderSlideHtml(deck, evil);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("5 &lt; 6 &amp; 7 &gt; 4");
  });

  it("prints the card title once when the content already opens with it", async () => {
    // AI-generated cards start with a heading block repeating the title; the
    // synthetic <h1> must be skipped or every slide shows the title twice.
    const generated = {
      id: "c3",
      title: "Roadmap for Q4",
      blocks: [
        { type: "heading", level: 1, text: ["Roadmap for Q4"] } as Block,
        { type: "paragraph", text: ["Three phases."] } as Block,
      ],
    };
    const html = await renderSlideHtml(deck, generated);
    expect(countOccurrences(bodyText(html), "Roadmap for Q4")).toBe(1);
  });

  it("still prepends the title when the content does not open with it", async () => {
    const html = await renderSlideHtml(deck, card);
    expect(countOccurrences(bodyText(html), "Quarterly Plan")).toBe(1);
  });
});

describe("renderSlidesHtml", () => {
  it("renders one slide document per card, in order", async () => {
    const cards = [
      { id: "a", title: "First", blocks: [{ type: "paragraph", text: ["one"] } as Block] },
      { id: "b", title: "Second", blocks: [{ type: "paragraph", text: ["two"] } as Block] },
    ];
    const slides = await renderSlidesHtml(deck, cards);
    expect(slides).toHaveLength(2);
    expect(slides[0].title).toBe("First");
    expect(slides[0].html).toContain("First");
    expect(slides[1].title).toBe("Second");
    expect(slides[1].html).toContain("Second");
  });
});
