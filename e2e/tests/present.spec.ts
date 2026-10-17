import { test, expect } from "@playwright/test";
import { createReadyDeck } from "./helpers";

/** Present mode: arrow keys advance slides and drive the progress readout. */
test("present mode advances with arrow keys", async ({ page }) => {
  const { deckId } = await createReadyDeck(page, { numCards: 4 });

  await page.getByRole("link", { name: "Present" }).click();
  await page.waitForURL(new RegExp(`/deck/${deckId}/present$`));

  // The readout and the progressbar both track the current slide; each card
  // also prints its own index, so scope assertions to the chrome readout.
  const progress = page.locator(".present-progress");
  await expect(progress).toHaveText("1 / 4");
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");

  await page.keyboard.press("ArrowRight");
  await expect(progress).toHaveText("2 / 4");
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");

  await page.keyboard.press("ArrowRight");
  await expect(progress).toHaveText("3 / 4");

  // Bounds: walking back works too.
  await page.keyboard.press("ArrowLeft");
  await expect(progress).toHaveText("2 / 4");

  // Escape exits present mode back to the editor.
  await page.keyboard.press("Escape");
  await page.waitForURL(new RegExp(`/deck/${deckId}$`));
});
