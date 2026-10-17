import { describe, it, expect } from "vitest";
import { validateOutline, validateBlocks, AIValidationError } from "../src/validate";

describe("output validation", () => {
  it("accepts a well-formed outline", () => {
    const out = validateOutline([{ title: "A", intent: "b" }, { title: "B", intent: "c" }], 2);
    expect(out).toHaveLength(2);
    expect(out[0].id).toMatch(/^card-/);
  });
  it("rejects a non-array outline", () => {
    expect(() => validateOutline("nope", 2)).toThrow(AIValidationError);
  });
  it("accepts a valid block array", () => {
    expect(validateBlocks([{ type: "heading", level: 1, text: ["Hi"] }])).toHaveLength(1);
  });
  it("rejects a block with an unknown type", () => {
    expect(() => validateBlocks([{ type: "sparkle" }])).toThrow(AIValidationError);
  });

  it("coerces malformed payloads instead of letting renderers crash", () => {
    const blocks = validateBlocks([
      { type: "chart" }, // no data at all → dropped
      {
        type: "chart",
        kind: "bar",
        data: { labels: ["a"], series: [{ name: "s", values: [1, "x", 3] }] },
      },
      { type: "bulletList", items: "not-an-array" }, // no salvageable rows → dropped
      { type: "bulletList", items: [["ok"], 42, null] }, // junk rows dropped
      { type: "heading", level: 9, text: "Title" }, // level + bare-string text coerced
    ]);
    expect(blocks.map((b) => b.type)).toEqual(["chart", "bulletList", "heading"]);

    const chart = blocks[0];
    if (chart.type !== "chart") throw new Error("expected chart");
    expect(chart.kind).toBe("bar");
    expect(chart.data.series[0].values).toEqual([1, 3]); // non-numeric dropped

    const list = blocks[1];
    if (list.type !== "bulletList") throw new Error("expected bulletList");
    expect(list.items).toEqual([["ok"]]);

    const heading = blocks[2];
    if (heading.type !== "heading") throw new Error("expected heading");
    expect(heading.level).toBe(2);
    expect(heading.text).toEqual(["Title"]);
  });

  it("keeps columns but drops junk columns and unknown nested blocks", () => {
    const blocks = validateBlocks([
      {
        type: "columns",
        columns: [[{ type: "paragraph", text: ["ok"] }], "junk", [{ type: "sparkle" }]],
      },
      { type: "columns", columns: "nope" },
    ]);
    expect(blocks).toHaveLength(1);
    const cols = blocks[0];
    if (cols.type !== "columns") throw new Error("expected columns");
    // The "junk" column is skipped; the sparkle-only column stays but is empty.
    expect(cols.columns.length).toBe(2);
    expect(cols.columns[0]).toEqual([{ type: "paragraph", text: ["ok"] }]);
    expect(cols.columns[1]).toEqual([]);
  });

  it("drops unsalvageable blocks and canonicalizes the rest", () => {
    const blocks = validateBlocks([
      { type: "quote", text: [{ text: "Ship it", bold: true }], attribution: 42 },
      { type: "callout", tone: "nope", text: ["heads up"] },
      { type: "image", src: 123, layout: "diagonal" },
      { type: "paragraph", text: [] }, // no content → dropped
    ]);
    expect(blocks).toEqual([
      { type: "quote", text: [{ text: "Ship it", bold: true }] },
      { type: "callout", tone: "info", text: ["heads up"] },
      { type: "image", src: "", layout: "full" },
    ]);
  });
});
