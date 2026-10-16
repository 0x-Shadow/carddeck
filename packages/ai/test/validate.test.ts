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
});
