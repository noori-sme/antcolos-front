import { expect, test, type Page } from "@playwright/test";

/**
 * Plan 13 (F1.1): the Rate Con upload screen against the REAL API, signed in as
 * the seeded carrier admin (holds `document.review`).
 *
 * Needs the seeded NestJS API and this app in http mode (see
 * access-integration.live.spec.ts for the commands):
 *
 *   LIVE_WEB_URL=http://localhost:3001 npx playwright test \
 *     tests/browser/rate-con-intake.live.spec.ts --project=desktop
 *
 * Skipped unless LIVE_WEB_URL is set, so CI (mock mode, no backend) never runs it.
 * The route gate itself is unit-tested (permissions.test.ts, route-availability.test.ts).
 */
const WEB = process.env.LIVE_WEB_URL;
const ADMIN = {
  email: "carrier@antcolos.dev",
  password: process.env.SEED_DEMO_PASSWORD ?? "Welcome@123",
};

test.skip(!WEB, "needs the full stack (set LIVE_WEB_URL); see the header comment");

async function signIn(page: Page) {
  await page.goto(`${WEB}/sign-in`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill(ADMIN.email);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
}

test.describe("Rate Con upload", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("Home links to it, and it refuses an unsupported file before uploading", async ({ page }) => {
    await page.getByRole("link", { name: "New load from a Rate Con" }).click();
    await expect(page.getByRole("heading", { name: "New load from a Rate Con" })).toBeVisible();

    const submit = page.getByRole("button", { name: "Upload and read" });
    await expect(submit).toBeDisabled();

    await page.getByLabel(/Rate confirmation/).setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not a rate con"),
    });
    await expect(page.getByRole("alert").filter({ hasText: "Choose a PDF" })).toHaveText(
      "Choose a PDF, JPEG, PNG or WEBP file.",
    );
    await expect(submit).toBeDisabled();

    await page.getByLabel(/Rate confirmation/).setInputFiles({
      name: "ratecon.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\n"),
    });
    await expect(page.getByText("ratecon.pdf")).toBeVisible();
    await expect(submit).toBeEnabled();
  });

  test("fits a 360 px screen without sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(`${WEB}/rate-cons/new`, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "New load from a Rate Con" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
