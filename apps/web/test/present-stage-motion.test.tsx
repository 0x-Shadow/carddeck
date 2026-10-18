// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { PresentStage } from "../components/reader/PresentStage";
import { PRESET_THEMES, type MotionPlan } from "@carddeck/core";

const theme = PRESET_THEMES[0];
const cards = [
  { id: "c1", title: "One", blocks: JSON.stringify([{ type: "paragraph", text: ["body"] }]) },
  { id: "c2", title: "Two", blocks: "[]" },
];

afterEach(() => cleanup());

const plan: MotionPlan = {
  preset: "punchy",
  slides: [
    { transition: "push", builds: [{ effect: "wipeUp", delayMs: 300 }] },
    { transition: "wipe", builds: [{ effect: "zoom", delayMs: 0 }] },
  ],
};

describe("PresentStage motion", () => {
  it("animates the current slide's blocks from its plan entry", () => {
    render(<PresentStage deckTitle="D" cards={cards} theme={theme} motion={plan} onExit={() => {}} />);
    const animated = document.querySelector(".motion-wipeUp");
    expect(animated).toBeTruthy();
    expect(animated!.getAttribute("style")).toContain("300ms");
  });

  it("replays a different effect on the next slide", () => {
    render(<PresentStage deckTitle="D" cards={cards} theme={theme} motion={plan} onExit={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(document.querySelector(".motion-zoom")).toBeTruthy();
    expect(document.querySelector(".motion-wipeUp")).toBeNull();
  });

  it("renders no motion classes without a plan", () => {
    render(<PresentStage deckTitle="D" cards={cards} theme={theme} onExit={() => {}} />);
    expect(document.querySelector("[class*='motion-']")).toBeNull();
  });

  it("guards every motion class behind prefers-reduced-motion", () => {
    const css = fs.readFileSync(
      path.join(__dirname, "../app/globals.css"),
      "utf8",
    );
    const guard = css.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.motion-[^}]*\}/,
    );
    expect(guard).toBeTruthy();
    // Every entrance class has keyframes.
    for (const cls of ["motion-fade", "motion-wipeUp", "motion-flyLeft", "motion-zoom"]) {
      expect(css).toContain(`.${cls}`);
    }
  });
});
