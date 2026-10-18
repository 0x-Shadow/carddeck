import path from "node:path";
import { test, expect } from "@playwright/test";
import { createReadyDeck, exportPptx } from "./helpers";

/** A real 1×1 PNG — enough to exercise magic-byte sniffing and asset bytes. */
const FIXTURE = path.join(__dirname, "..", "fixtures", "dot.png");

/**
 * Images are a v2 surface end to end: a user picks a file in the editor, the
 * upload route stores and serves it, the block persists, the .pptx package
 * embeds it, and the public reader shows it to signed-out visitors.
 */
test("image upload reaches canvas, persistence, export, and public reader", async ({
  page,
  browser,
}) => {
  const { deckId } = await createReadyDeck(page, { numCards: 3 });

  // Insert an image block via the first card's toolbar (it lands right after
  // the initially selected block 0) and choose the file the way a user does
  // (the file input is visually hidden but real). Generated cards can carry
  // their own empty image placeholders, so scope everything to this row.
  const firstCard = page.locator("[data-card-id]").first();
  await firstCard.getByRole("button", { name: "Add image" }).click();
  const imageRow = firstCard.locator(".block-row[data-index='1']");
  await imageRow.locator('input[type="file"]').setInputFiles(FIXTURE);

  // The editor previews the asset URL the server minted…
  const preview = imageRow.locator(".image-editor-preview");
  await expect(preview).toHaveAttribute(
    "src",
    new RegExp(`^/api/deck/${deckId}/assets/[0-9a-f-]+$`),
  );
  const src = (await preview.getAttribute("src"))!;

  // …the owner can fetch those bytes with the content type preserved…
  const asset = await page.request.get(src);
  expect(asset.status()).toBe(200);
  expect(asset.headers()["content-type"]).toContain("image/png");

  // …and the block survives a reload (two PATCHes race the upload: the empty
  // block, then the chosen src — so wait for the database to show the src).
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/deck/${deckId}`);
        return JSON.stringify((await res.json()).cards).includes(src);
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  await page.reload();
  await expect(imageRow.locator(".image-editor-preview")).toHaveAttribute("src", src);

  // The image rides into the PowerPoint package.
  await exportPptx(page);

  // Shared read-only, the same bytes serve without any session.
  const shareRes = await page.request.patch(`/api/deck/${deckId}/share`, {
    data: { isPublic: true },
  });
  expect(shareRes.ok()).toBe(true);
  const { shareSlug } = (await shareRes.json()) as { shareSlug: string };

  const anon = await browser.newContext();
  try {
    const anonPage = await anon.newPage();
    await anonPage.goto(`/view/${shareSlug}`);
    // Exactly this asset — generated placeholders (empty src) render no <img>.
    await expect(anonPage.locator(`[data-block='image'] img[src="${src}"]`)).toBeVisible();
    const anonAsset = await anonPage.request.get(src);
    expect(anonAsset.status()).toBe(200);
  } finally {
    await anon.close();
  }
});
