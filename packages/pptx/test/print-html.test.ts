import { describe, it, expect } from "vitest";
import { renderPrintHtml } from "../src/render-slides";
import { PRESET_THEMES, type Block } from "@carddeck/core";

const theme = PRESET_THEMES.find((t) => t.name === "Midnight")!;
const deck = { title: "The Plan", theme };

const cards = [
  { id: "a", title: "First", blocks: [{ type: "paragraph", text: ["first body"] } as Block] },
  { id: "b", title: "Second", blocks: [{ type: "paragraph", text: ["second body"] } as Block] },
];

describe("renderPrintHtml", () => {
  it("presentation mode: one fixed 16:9 page section per card", async () => {
    const html = await renderPrintHtml(deck, cards, { format: "presentation" });

    // CSS paged media drives the page geometry.
    expect(html).toContain("@page");
    expect(html).toContain("1280px");
    expect(html).toContain("720px");
    // One print page per card, in order.
    expect(html.match(/class="slide-page"/g)).toHaveLength(2);
    expect(html).toContain("first body");
    expect(html).toContain("second body");
    expect(html.indexOf("First")).toBeLessThan(html.indexOf("Second"));
    // Themed background per page so the skin survives printing.
    expect(html).toContain(theme.colors.page.replace("#", ""));
  });

  it("defaults to presentation mode when no format is given", async () => {
    const html = await renderPrintHtml(deck, cards);
    expect(html).toContain('class="slide-page"');
  });

  it("document mode: flowing A4 pages with no fixed slide boxes", async () => {
    const html = await renderPrintHtml(deck, cards, { format: "document" });
    expect(html).toContain("A4");
    expect(html).not.toContain('class="slide-page"');
    expect(html).toContain("first body");
    expect(html).toContain("second body");
  });

  it("escapes card content", async () => {
    const evil = [
      { id: "x", title: "<script>", blocks: [{ type: "paragraph", text: ["a < b"] } as Block] },
    ];
    const html = await renderPrintHtml(deck, evil, { format: "presentation" });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("a &lt; b");
  });
});

describe("renderPrintHtml image inlining", () => {
  const imageCard = (src: string): Block => ({
    type: "image",
    src,
    layout: "full",
  });

  it("inlines resolved images as data-URL <img> tags", async () => {
    const dataUrl = "data:image/png;base64,AAAA";
    const html = await renderPrintHtml(
      deck,
      [{ id: "a", title: "Cover", blocks: [imageCard("local:hero")] }],
      {
        format: "presentation",
        resolveImage: async (src) => (src === "local:hero" ? { dataUrl } : null),
      },
    );
    expect(html).toContain(`src="${dataUrl}"`);
    expect(html).not.toContain("[image:");
  });

  it("keeps the captioned placeholder when an image fails to resolve", async () => {
    const html = await renderPrintHtml(
      deck,
      [{ id: "a", title: "Cover", blocks: [imageCard("local:gone")] }],
      {
        format: "presentation",
        resolveImage: async () => null,
      },
    );
    expect(html).toContain("[image: image]");
  });

  it("leaves images as placeholders when no resolver is supplied", async () => {
    const html = await renderPrintHtml(deck, [
      { id: "a", title: "Cover", blocks: [imageCard("/api/deck/d1/assets/a1")] },
    ]);
    expect(html).toContain("[image: image]");
    expect(html).not.toContain("<img");
  });

  it("resolves each unique src exactly once across the deck", async () => {
    const seen: string[] = [];
    await renderPrintHtml(
      deck,
      [
        { id: "a", title: "One", blocks: [imageCard("s1"), imageCard("s2")] },
        { id: "b", title: "Two", blocks: [imageCard("s1")] },
      ],
      {
        resolveImage: async (src) => {
          seen.push(src);
          return null;
        },
      },
    );
    expect(seen.sort()).toEqual(["s1", "s2"]);
  });
});
