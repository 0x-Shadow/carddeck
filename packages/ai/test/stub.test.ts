import { describe, it, expect } from "vitest";
import { StubProvider } from "../src/stub";
import { createProvider } from "../src/index";

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

  describe("failure hook (E2E test hook)", () => {
    const failingOutline = {
      id: "card-x",
      title: "Trouble [fail]",
      intent: "body" as const,
    };

    it("throws once for a [fail] title when the hook is enabled, then succeeds", async () => {
      const p = new StubProvider({ failureHook: true });
      await expect(
        p.generateCard({ outline: failingOutline, context: [failingOutline], format: "presentation", themeName: "Light" }),
      ).rejects.toThrow(/\[fail\]/);
      // The retry (same card id) succeeds so E2E can recover via per-card retry.
      const blocks = await p.generateCard({
        outline: failingOutline,
        context: [failingOutline],
        format: "presentation",
        themeName: "Light",
      });
      expect(blocks.length).toBeGreaterThan(0);
    });

    it("never throws for [fail] titles when the hook is off (default)", async () => {
      const p = new StubProvider();
      const blocks = await p.generateCard({
        outline: failingOutline,
        context: [failingOutline],
        format: "presentation",
        themeName: "Light",
      });
      expect(blocks.length).toBeGreaterThan(0);
    });

    it("tracks failures per card id, not per title", async () => {
      const p = new StubProvider({ failureHook: true });
      const a = { id: "card-a", title: "T [fail]", intent: "body" as const };
      const b = { id: "card-b", title: "T [fail]", intent: "body" as const };
      await expect(p.generateCard({ outline: a, context: [a], format: "presentation", themeName: "L" })).rejects.toThrow();
      await expect(p.generateCard({ outline: b, context: [b], format: "presentation", themeName: "L" })).rejects.toThrow();
    });
  });

  describe("createProvider hook wiring", () => {
    it("enables the failure hook when CARDDECK_E2E_HOOKS=1", async () => {
      const p = createProvider({ CARDDECK_E2E_HOOKS: "1" });
      await expect(
        p.generateCard({
          outline: { id: "e2e-1", title: "T [fail]", intent: "body" },
          context: [],
          format: "presentation",
          themeName: "Light",
        }),
      ).rejects.toThrow(/\[fail\]/);
    });

    it("leaves the hook off without the env flag", async () => {
      const p = createProvider({});
      const blocks = await p.generateCard({
        outline: { id: "e2e-2", title: "T [fail]", intent: "body" },
        context: [],
        format: "presentation",
        themeName: "Light",
      });
      expect(blocks.length).toBeGreaterThan(0);
    });
  });
});
