import { test, expect } from "@playwright/test";
import { register, buildOutline } from "./helpers";

/**
 * Partial failure: the stub's `[fail]` test hook (armed by
 * CARDDECK_E2E_HOOKS=1 in serve.mjs) throws a card's first attempt. The run
 * surfaces the failure with a per-card Retry, and the retry succeeds because
 * the hook only fails each card once.
 */
test("a failed card offers a working per-card retry", async ({ page }) => {
  await register(page);
  await buildOutline(page, { numCards: 3, failIndex: 1 });

  await page.getByRole("button", { name: "Generate deck" }).click();
  await page.waitForURL(/\/deck\/[a-zA-Z0-9-]+/);

  // The job lands in error: 1 of 3 cards failed (the other two finished).
  await expect(page.getByRole("alert").filter({ hasText: /Generation failed/ })).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.locator("[data-card-status='error']")).toHaveCount(1);

  // Retry just the failed card — the hook lets it through on the second try.
  await page.getByRole("button", { name: "Retry this card" }).click();

  await expect(page.locator("[data-deck-status='ready']")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator("[data-card-status='ready']")).toHaveCount(3);
  await expect(page.getByRole("alert").filter({ hasText: /Generation failed/ })).toHaveCount(0);
});
