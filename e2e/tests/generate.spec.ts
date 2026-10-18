import { test, expect } from "@playwright/test";
import { register, buildOutline, generateAndFinish } from "./helpers";

/**
 * The headline flow: prompt → editable outline (rename a section) → theme
 * pick → generate → cards stream in over SSE → deck reaches ready with the
 * edited outline title carried through.
 */
test("prompt → outline → streamed cards → ready", async ({ page }) => {
  await register(page);

  await page.goto("/new");
  await expect(page.getByRole("heading", { name: "Create a deck" })).toBeVisible();

  await page.getByLabel("What is your deck about?").fill(
    "Launching our developer platform in Europe",
  );
  await page.getByLabel("Number of cards").selectOption("4");
  await page.getByLabel("Tone").selectOption("professional");
  await page.getByRole("button", { name: "Generate outline" }).click();

  // Outline phase: the worker's job finished and the editor took over.
  await expect(page.getByRole("heading", { name: "Shape your outline" })).toBeVisible({
    timeout: 45_000,
  });
  const inputs = page.getByLabel(/^Outline card \d+ title$/);
  await expect(inputs).toHaveCount(4);

  // Editable outline: rename a section before generating.
  await inputs.nth(1).fill("The European opportunity");
  await expect(inputs.nth(1)).toHaveValue("The European opportunity");

  // Pick a theme in the outline phase.
  await page.getByRole("radio", { name: "Theme: Dark" }).click();

  await generateAndFinish(page, 4);

  // The deck streams cards in as the worker fills them; every card is ready.
  await expect(page.locator("[data-deck-status='ready']")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator("[data-card-status='ready']")).toHaveCount(4);

  // The outline rename survived into the generated deck.
  await expect(page.getByLabel("Card 2 title")).toHaveValue("The European opportunity");

  // The picked theme is active on the canvas.
  await expect(page.getByRole("radio", { name: "Theme: Dark" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});
