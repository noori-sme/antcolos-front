import { expect, test, type Page } from "@playwright/test";

/**
 * Settings → Usage & costs against the REAL API (M6.3, plan 26; backend plan 49).
 *
 * Needs the seeded API on :3000 (branch feat/platform-cost-dashboard or later)
 * and this app in http mode:
 *
 *   LIVE_WEB_URL=http://localhost:3001 npx playwright test tests/browser/usage.live.spec.ts
 *
 * Skipped unless LIVE_WEB_URL is set, so CI (mock mode, no backend) never runs it.
 */
const WEB = process.env.LIVE_WEB_URL;
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "Welcome@123";

test.skip(!WEB, "needs the full stack (set LIVE_WEB_URL); see the header comment");

async function signIn(page: Page, email: string) {
  await page.goto(`${WEB}/sign-in`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
}

test("an admin sees usage and estimated costs, and the period is in the URL", async ({ page }) => {
  await signIn(page, "carrier@antcolos.dev");
  await page.goto(`${WEB}/settings/usage`);
  await expect(page.getByRole("heading", { name: "Usage & costs", level: 1 })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Estimated total, last 30 days/)).toBeVisible();
  await expect(page.getByText(/calls ·/).first()).toBeVisible();
  await expect(page.getByText(/Not counted yet: FMCSA lookups/)).toBeVisible();

  await page.getByRole("group", { name: "Period" }).getByRole("button", { name: "7 days" }).click();
  await expect(page).toHaveURL(/\?range=7d$/);
  await expect(page.getByText(/Estimated total, last 7 days/)).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a dispatcher has no usage page", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await signIn(page, "dispatcher@antcolos.dev");
  await page.goto(`${WEB}/settings/usage`);
  await expect(page.getByRole("heading", { name: "Usage & costs", level: 1 })).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Usage & costs" })).toHaveCount(0);
});
