import { test, expect } from "@playwright/test";
import { createReadyDeck } from "./helpers";

/**
 * Export is the headline deliverable: the Export menu downloads a real
 * PowerPoint package (PK zip magic) and a printable PDF (PDF magic).
 */
test("PowerPoint export downloads a valid .pptx", async ({ page }) => {
  await createReadyDeck(page, { numCards: 3 });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /^export$/i }).click();
  await page.getByRole("menuitem", { name: /powerpoint/i }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.pptx$/);
  const path = await download.path();
  expect(path).toBeTruthy();

  const { buffer } = await readBytes(path!, 2);
  // OOXML files are ZIP packages: "PK".
  expect(buffer.toString("latin1")).toBe("PK");
});

test("PDF export downloads a real PDF", async ({ page }) => {
  await createReadyDeck(page, { numCards: 3 });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /^export$/i }).click();
  await page.getByRole("menuitem", { name: /^pdf/i }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const path = await download.path();
  expect(path).toBeTruthy();

  const { buffer } = await readBytes(path!, 4);
  expect(buffer.toString("latin1")).toBe("%PDF");
});

async function readBytes(path: string, length: number): Promise<{ buffer: Buffer }> {
  const { open } = await import("node:fs/promises");
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return { buffer };
  } finally {
    await handle.close();
  }
}
