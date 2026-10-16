import { describe, it, expect } from "vitest";
import { StubProvider } from "../src/stub";

describe("StubProvider", () => {
  it("is deterministic for the same prompt", async () => {
    const p = new StubProvider();
    const a = await p.generateOutline({ prompt: "Q3 launch", format: "presentation", numCards: 6 });
    const b = await p.generateOutline({ prompt: "Q3 launch", format: "presentation", numCards: 6 });
    expect(a).toEqual(b);
    expect(a).toHaveLength(6);
    expect(a[0].title.length).toBeGreaterThan(0);
  });
  it("returns blocks that parse as a cover card then content", async () => {
    const p = new StubProvider();
    const outline = await p.generateOutline({ prompt: "x", format: "presentation", numCards: 2 });
    const blocks = await p.generateCard({ outline: outline[0], context: outline, format: "presentation", themeName: "Light" });
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.some((b) => b.type === "heading" || b.type === "image")).toBe(true);
  });
  it("never throws on revise", async () => {
    const p = new StubProvider();
    const r = await p.revise({ instruction: "shorter", blocks: [{ type: "paragraph", text: ["long text here"] }], cardTitle: "T" });
    expect(r.blocks.length).toBeGreaterThan(0);
  });
});
