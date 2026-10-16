import { describe, it, expect } from "vitest";
import { isInline, inlineToPlainText } from "../src/blocks";
import { inlineToPlainText as plain } from "../src/serialize";

describe("Inline model", () => {
  it("treats a bare string as inline", () => {
    expect(isInline("hello")).toBe(true);
    expect(isInline({ text: "hi", bold: true })).toBe(true);
    expect(isInline({ type: "paragraph", text: [] })).toBe(false);
  });
  it("flattens inline to plain text", () => {
    expect(plain([{ text: "big ", bold: true }, "idea"])).toBe("big idea");
  });
});
