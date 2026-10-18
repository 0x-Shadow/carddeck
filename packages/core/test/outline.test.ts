import { describe, it, expect } from "vitest";
import {
  moveOutlineCard,
  addOutlineCard,
  removeOutlineCard,
  renameOutlineCard,
} from "../src/outline";
import type { OutlineCard } from "../src/outline";

const cards = (): OutlineCard[] => [
  { id: "a", title: "Intro", intent: "hook" },
  { id: "b", title: "Plan", intent: "body" },
  { id: "c", title: "Ask", intent: "close" },
];

describe("outline reducers", () => {
  it("moves a card", () => {
    expect(
      moveOutlineCard(cards(), 2, 0).map((c) => c.id),
    ).toEqual(["c", "a", "b"]);
  });
  it("adds after an index", () => {
    expect(
      addOutlineCard(cards(), 1, { id: "n", title: "New", intent: "" }).map(
        (c) => c.id,
      ),
    ).toEqual(["a", "n", "b", "c"]);
  });
  it("removes by id", () => {
    expect(
      removeOutlineCard(cards(), "b").map((c) => c.id),
    ).toEqual(["a", "c"]);
  });
  it("renames by id", () => {
    expect(renameOutlineCard(cards(), "b", "Renamed")[1].title).toBe("Renamed");
  });
});
