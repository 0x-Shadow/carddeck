import { describe, it, expect } from "vitest";
import { planMotion, planMotionForDeck, parseMotionPlan } from "../src/motion";
import type { Block } from "../src/blocks";

const counts2 = { slides: 2, shapes: [3, 4] };

describe("planMotion", () => {
  it("expands 'none' to an empty plan", () => {
    expect(planMotion("none", counts2, "seed-a")).toEqual({ preset: "none", slides: [] });
  });

  it("is deterministic for the same seed", () => {
    const a = planMotion("punchy", { slides: 3, shapes: [2, 3, 2] }, "deck-1");
    const b = planMotion("punchy", { slides: 3, shapes: [2, 3, 2] }, "deck-1");
    expect(a).toEqual(b);
  });

  it("subtle uses only fades, starts at 0, and staggers upward", () => {
    const plan = planMotion("subtle", counts2, "seed-a");
    expect(plan.preset).toBe("subtle");
    expect(plan.slides).toHaveLength(2);
    for (const slide of plan.slides) {
      expect(slide.transition).toBe("fade");
      for (const build of slide.builds) expect(build.effect).toBe("fade");
    }
    const delays = plan.slides[0].builds.map((b) => b.delayMs);
    expect(delays[0]).toBe(0);
    for (let i = 1; i < delays.length; i++) expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    // Never more builds than shapes on the slide.
    expect(plan.slides[0].builds.length).toBeLessThanOrEqual(3);
    expect(plan.slides[1].builds.length).toBeLessThanOrEqual(4);
  });

  it("punchy stays inside its palette", () => {
    const plan = planMotion("punchy", { slides: 4, shapes: [3, 3, 3, 3] }, "seed-b");
    for (const slide of plan.slides) {
      expect(["push", "wipe", "split"]).toContain(slide.transition);
      for (const build of slide.builds) expect(["wipeUp", "zoom"]).toContain(build.effect);
    }
  });

  it("cinematic opens each slide with 200ms and 450ms staggers", () => {
    const plan = planMotion("cinematic", { slides: 2, shapes: [4, 3] }, "seed-c");
    const delays = plan.slides[0].builds.map((b) => b.delayMs);
    expect(delays[0]).toBe(200);
    expect(delays[1] - delays[0]).toBe(450);
    expect(delays[2] - delays[1]).toBe(450);
  });

  it("caps builds at 12 per slide", () => {
    const plan = planMotion("punchy", { slides: 1, shapes: [40] }, "seed-d");
    expect(plan.slides[0].builds).toHaveLength(12);
  });

  it("different seeds pick different transitions somewhere", () => {
    const a = planMotion("cinematic", { slides: 3, shapes: [2, 2, 2] }, "seed-x");
    const b = planMotion("cinematic", { slides: 3, shapes: [2, 2, 2] }, "seed-y");
    expect(a).not.toEqual(b);
  });
});

describe("planMotionForDeck", () => {
  const card = (blocks: Block[] | string) => ({ blocks });

  it("counts the title plus each block as a shape", () => {
    const plan = planMotionForDeck("subtle", [
      card([{ type: "heading", level: 1, text: ["T"] }, { type: "paragraph", text: ["p"] }]),
      card([]),
    ], "deck-2");
    expect(plan.slides).toHaveLength(2);
    expect(plan.slides[0].builds).toHaveLength(3); // title + 2 blocks
    expect(plan.slides[1].builds).toHaveLength(1); // title only
  });

  it("falls back to title-only when blocks are unparseable", () => {
    const plan = planMotionForDeck("subtle", [card("not json")], "deck-3");
    expect(plan.slides[0].builds).toHaveLength(1);
  });
});

describe("parseMotionPlan", () => {
  it("parses a plan round-tripped through the deck.motion column", () => {
    // The column is text, so what reaches the parser is JSON, not an object.
    const plan = planMotion("punchy", { slides: 2, shapes: [3, 1] }, "deck-4");
    expect(parseMotionPlan(JSON.stringify(plan))).toEqual(plan);
  });

  it("accepts an already-parsed object too", () => {
    const plan = planMotion("subtle", { slides: 1, shapes: [2] }, "deck-5");
    expect(parseMotionPlan(plan)).toEqual(plan);
  });

  it("returns null for junk instead of throwing", () => {
    expect(parseMotionPlan("not json")).toBeNull();
    expect(parseMotionPlan(null)).toBeNull();
    expect(parseMotionPlan(42)).toBeNull();
    expect(parseMotionPlan([])).toBeNull();
    expect(parseMotionPlan({ preset: "hyperspace" })).toBeNull();
  });
});
