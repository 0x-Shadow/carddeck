import { expect, type Page } from "@playwright/test";

/**
 * Shared E2E flows.
 *
 * Registration goes through the API: `page.request` shares the browser
 * context's cookie jar, so the session cookie lands in the browser exactly as
 * it would from the login form.
 */

let uniqueCounter = 0;

export function uniqueEmail(): string {
  uniqueCounter += 1;
  return `e2e-${Date.now()}-${uniqueCounter}@carddeck.test`;
}

export const E2E_PASSWORD = "e2e-password-123";

export async function register(page: Page): Promise<string> {
  const email = uniqueEmail();
  const res = await page.request.post("/api/auth/register", {
    data: { email, password: E2E_PASSWORD, name: "E2E Tester" },
  });
  expect(res.status(), await res.text()).toBe(201);
  return email;
}

export interface OutlineOptions {
  prompt?: string;
  numCards?: number;
  tone?: string;
  /** Rename this outline card (0-based) once the outline lands. */
  editIndex?: number;
  editTitle?: string;
  /**
   * Flag this outline card's title with the stub's `[fail]` test hook — its
   * first generation attempt throws, the retry succeeds.
   */
  failIndex?: number;
}

export interface OutlineResult {
  titles: string[];
}

/** Walk `/new` from an empty state up to the editable outline. */
export async function buildOutline(page: Page, opts: OutlineOptions = {}): Promise<OutlineResult> {
  const prompt = opts.prompt ?? "Launching our developer platform in Europe";
  const numCards = opts.numCards ?? 4;

  await page.goto("/new");
  await expect(page.getByRole("heading", { name: "Create a deck" })).toBeVisible();
  await page.getByLabel("What is your deck about?").fill(prompt);
  await page.getByLabel("Number of cards").selectOption(String(numCards));
  if (opts.tone) await page.getByLabel("Tone").selectOption(opts.tone);
  await page.getByRole("button", { name: "Generate outline" }).click();

  await expect(page.getByRole("heading", { name: "Shape your outline" })).toBeVisible({
    timeout: 45_000,
  });
  const inputs = page.getByLabel(/^Outline card \d+ title$/);
  await expect(inputs).toHaveCount(numCards);

  const titles: string[] = [];
  for (let i = 0; i < numCards; i += 1) {
    let title = (await inputs.nth(i).inputValue()).trim() || `Card ${i + 1}`;
    if (opts.editIndex === i && opts.editTitle) {
      title = opts.editTitle;
      await inputs.nth(i).fill(title);
    }
    if (opts.failIndex === i) {
      title = `${title} [fail]`;
      await inputs.nth(i).fill(title);
    }
    // Catch dropped edits immediately (a broken form state would otherwise
    // only surface much later, after generation).
    await expect(inputs.nth(i)).toHaveValue(title);
    titles.push(title);
  }
  return { titles };
}

/** Click "Generate deck", wait for the deck page, and require a ready deck. */
export async function generateAndFinish(page: Page, cardCount: number): Promise<string> {
  await page.getByRole("button", { name: "Generate deck" }).click();
  await page.waitForURL(/\/deck\/[a-zA-Z0-9-]+/);
  const deckId = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.locator("[data-deck-status='ready']")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator("[data-card-status='ready']")).toHaveCount(cardCount);
  return deckId;
}

/** Full happy path: registered, outlined, generated, and ready. */
export async function createReadyDeck(
  page: Page,
  opts: OutlineOptions = {},
): Promise<{ deckId: string; titles: string[] }> {
  await register(page);
  const outline = await buildOutline(page, opts);
  const deckId = await generateAndFinish(page, opts.numCards ?? 4);
  return { deckId, titles: outline.titles };
}

/** Read the first `length` bytes of a downloaded file, as latin1 text. */
export async function firstBytes(filePath: string, length: number): Promise<string> {
  const { open } = await import("node:fs/promises");
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return buffer.toString("latin1");
  } finally {
    await handle.close();
  }
}

/**
 * Export the open deck as PowerPoint through the toolbar and require a real
 * OOXML package (zip magic "PK") on disk.
 */
export async function exportPptx(page: Page): Promise<void> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /^export$/i }).click();
  await page.getByRole("menuitem", { name: /powerpoint/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pptx$/);
  const path = await download.path();
  expect(path).toBeTruthy();
  expect(await firstBytes(path!, 2)).toBe("PK");
}
