import { test, expect } from "@playwright/test";
import { uniqueEmail, E2E_PASSWORD } from "./helpers";

/** Landing → register → dashboard smoke: the signed-out entry path. */
test("landing, register, and dashboard hang together", async ({ page }) => {
  await page.goto("/");

  // Landing: hero, sample strip, and the how-it-works story.
  await expect(page.getByRole("heading", { name: /make your ideas/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Decks people ship with Carddeck" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "From prompt to PowerPoint" })).toBeVisible();

  // CTA into the auth flow.
  await page.getByRole("link", { name: "Get started free" }).click();
  await page.waitForURL(/\/register/);

  await page.getByLabel("Name").fill("E2E Tester");
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  // Landed on the dashboard with the empty state.
  await page.waitForURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.getByText(/no projects yet/i)).toBeVisible();

  // Sign out returns to the landing page.
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/$/);

  // …and the dashboard now guards itself.
  await page.goto("/dashboard");
  await page.waitForURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});
