import { test, expect } from "@playwright/test";
import { createReadyDeck } from "./helpers";

/** The share link renders the deck for signed-out readers. */
test("public reader works signed out", async ({ page, browser }) => {
  const { titles } = await createReadyDeck(page, { numCards: 3 });

  // Mint the share link from the deck topbar.
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const shareInput = page.getByLabel("Share link");
  await expect(shareInput).toBeVisible();
  const href = await shareInput.inputValue();
  const slug = new URL(href).pathname.replace("/view/", "");
  expect(slug).toBeTruthy();

  // Fresh context: no cookies, no session.
  const context = await browser.newContext();
  const anon = await context.newPage();
  await anon.goto(`/view/${slug}`);

  // Deck chrome shows the title; every card renders its outline title
  // (titles also repeat inside heading blocks, so assert on the chrome/card
  // elements specifically rather than any text node).
  await expect(anon.locator("h1.reader-chrome-title")).toHaveText(
    "Launching our developer platform in Europe",
  );
  await expect(anon.locator(".reader-card")).toHaveCount(3);
  await expect(
    anon.locator(".reader-card-title", { hasText: titles[0] }),
  ).toHaveCount(1);
  await expect(
    anon.locator(".reader-card-title", { hasText: titles[1] }),
  ).toHaveCount(1);

  await context.close();
});
