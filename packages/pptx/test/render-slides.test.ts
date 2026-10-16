import { describe, it, expect } from "vitest";
import { renderSlideHtml, renderSlidesHtml } from "../src/render-slides";
import { PRESET_THEMES, type Block } from "@carddeck/core";

const theme = PRESET_THEMES.find((t) => t.name === "Midnight")!;
const deck = { title: "Quarterly Plan", theme };

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
