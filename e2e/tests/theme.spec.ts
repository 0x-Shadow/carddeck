import { test, expect } from "@playwright/test";
import { createReadyDeck } from "./helpers";

/**
 * A theme switch must re-skin instantly (CSS custom properties on the deck
 * root change) *without* remounting the card DOM — the user's editing session
 * and focus live in those nodes.
 */
test("theme switch re-skins without re-render", async ({ page }) => {
  await createReadyDeck(page, { numCards: 3 });

  const deckRoot = page.locator("[data-deck-status='ready']").first();
  const before = await deckRoot.evaluate(
    (el) => getComputedStyle(el).getPropertyValue("--page").trim(),
  );
  expect(before).toBeTruthy();

  // Grab a real editable text node inside a generated card (the canvas edits
  // text blocks through textareas).
  const textarea = page.locator("[data-card-status='ready'] textarea").first();
  const handle = await textarea.elementHandle();
  const valueBefore = await textarea.inputValue();

  await page.getByRole("radio", { name: "Theme: Dark" }).click();

  // The skin flips immediately…
  await expect
    .poll(
      () => deckRoot.evaluate((el) => getComputedStyle(el).getPropertyValue("--page").trim()),
      { timeout: 10_000 },
    )
    .not.toBe(before);

  // …and the very same DOM node is still there (no remount).
  const state = await handle!.evaluate((el) => ({
    connected: el.isConnected,
    value: (el as HTMLTextAreaElement).value,
  }));
  expect(state.connected).toBe(true);
  expect(state.value).toBe(valueBefore);
});
