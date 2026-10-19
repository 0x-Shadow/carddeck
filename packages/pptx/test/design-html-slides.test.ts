import { describe, it, expect } from "vitest";
import { renderDesignedSlidesHtml } from "../src/design-html";
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
        type: "bulletList",
        items: [["12 hrs saved"], ["3× faster"]],
      },
      { type: "quote", text: ["Decks that ship win."], attribution: "Team Carddeck" },
    ] as Block[],
  },
  {
    id: "close",
    title: "Ship it",
    blocks: [
      { type: "heading", level: 1, text: ["Ship it"] },
      { type: "paragraph", text: ["One idea away."] },
    ] as Block[],
  },
];

async function render() {
  return renderDesignedSlidesHtml(deck, cards, {
    resolveImage: async (src) => (src === "hero" ? { dataUrl: png } : null),
  });
}

describe("renderDesignedSlidesHtml", () => {
  it("emits one standalone document per card with a single slide page", async () => {
    const docs = await render();
    expect(docs).toHaveLength(3);
    for (const [index, doc] of docs.entries()) {
      expect(doc).toContain("<!DOCTYPE html>");
      expect(doc).toContain("<title>Carddeck");
      expect(doc.match(/class="slide-page/g)).toHaveLength(1);
      expect(doc).toContain(`<title>Carddeck — ${index + 1}</title>`);
    }
  });

  it("pins the body to the 16:9 canvas so converters derive the right layout", async () => {
    const [cover] = await render();
    // html2pptx reads body's computed box to pick the slide size.
    expect(cover).toContain("html, body { width: 1280px; height: 720px; overflow: hidden; }");
  });

  it("keeps the designed cover and closing compositions", async () => {
    const docs = await render();
    expect(docs[0]).toContain('class="slide-page cover"');
    expect(docs[0]).toContain(`src="${png}"`);
    expect(docs[2]).toContain('class="slide-page closing"');
  });

  it("wraps every text-bearing label in an inline tag", async () => {
    // The PPTAgent validator rejects bare text nodes inside container tags, so
    // the print markup must keep labels wrapped. These are the known offenders.
    const docs = await render();
    const doc = docs[1];
    for (const cls of [
      "kicker",
      "page-no",
      "footer-title",
      "footer-page",
      "col-number",
      "callout",
    ]) {
      const match = doc.match(new RegExp(`<div class="${cls}"[^>]*>(.*?)</div>`, "s"));
      if (match) expect(match[1].trimStart().startsWith("<span>")).toBe(true);
    }
    expect(doc).toContain('<p class="quote-attribution">');
    expect(doc).not.toContain("<cite>");
  });
});
