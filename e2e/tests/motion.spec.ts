import { test, expect } from "@playwright/test";
import { createReadyDeck, exportPptx } from "./helpers";

/**
 * Motion is a v2 surface end to end: the picker persists a preset, the server
 * derives the per-slide plan, present mode animates from that plan, and the
 * same plan rides into the .pptx export (extraction is unit-tested in
 * packages/pptx — here we require a real, downloadable package).
 */
test("motion preset persists, animates present mode, and exports", async ({ page }) => {
  const { deckId } = await createReadyDeck(page, { numCards: 3 });

  const punchy = page.getByRole("radio", { name: "Motion: Punchy" });
  const patched = page.waitForResponse(
    (r) =>
      r.request().method() === "PATCH" &&
      new URL(r.url()).pathname === `/api/deck/${deckId}` &&
      r.ok(),
  );
  await punchy.click();
  await patched;
  await expect(punchy).toHaveAttribute("aria-checked", "true");

  // Reload: the preset comes back from the deck (and the plan was derived
  // server-side — a ready deck animates immediately).
  await page.reload();
  await expect(page.getByRole("radio", { name: "Motion: Punchy" })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // Present mode replays the plan: the cover title and at least one body
  // block carry the motion effect classes the reader animates with.
  await page.getByRole("link", { name: "Present" }).click();
  await page.waitForURL(new RegExp(`/deck/${deckId}/present$`));
  await expect(page.locator(".reader-card-title")).toHaveClass(/motion-/);
  await expect(page.locator(".reader-card-body > div[class^='motion-']").first()).toBeVisible();

  await page.keyboard.press("Escape");
  await page.waitForURL(new RegExp(`/deck/${deckId}$`));

  await exportPptx(page);
});
