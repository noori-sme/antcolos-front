import { expect, test, type Page } from "@playwright/test";

/**
 * People screens against the REAL users API (F0.2): each family's list and
 * detail read through the service layer.
 *
 * Needs the seeded NestJS API and this app in http mode (see
 * fleet-trucks.live.spec.ts), with Riley Patel (driver@antcolos.dev) as a
 * DRIVER and Jordan Lee (dispatcher@antcolos.dev) as a DISPATCHER of the
 * seeded carrier "Acme Haulage", whose admin is Alex Rivera.
 *
 * Skipped unless LIVE_WEB_URL is set, so CI (mock mode, no backend) never runs it.
 */
const WEB = process.env.LIVE_WEB_URL;
const ADMIN = { email: "carrier@antcolos.dev", password: process.env.SEED_DEMO_PASSWORD ?? "Welcome@123" };

test.skip(!WEB, "needs the full stack (set LIVE_WEB_URL); see the header comment");

async function signIn(page: Page) {
  await page.goto(`${WEB}/sign-in`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill(ADMIN.email);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
}

for (const { family, name, email } of [
  { family: "drivers", name: "Riley Patel", email: "driver@antcolos.dev" },
  { family: "dispatchers", name: "Jordan Lee", email: "dispatcher@antcolos.dev" },
  { family: "admins", name: "Alex Rivera", email: "carrier@antcolos.dev" },
]) {
  test(`${family}: the list shows ${name} and the detail page loads`, async ({ page }) => {
    await signIn(page);
    const listed = page.waitForResponse(
      (r) => new URL(r.url()).pathname.endsWith(`/organizations/${family}`) && r.ok(),
    );
    await page.goto(`${WEB}/people/${family}`);
    await listed;
    const row = page.locator(`a[href^="/people/${family}/"]`).filter({ hasText: name }).first();
    await expect(row).toBeVisible();

    const detail = page.waitForResponse(
      (r) => new URL(r.url()).pathname.includes(`/organizations/${family}/`) && r.ok(),
    );
    await row.click();
    await detail;
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByText(email).first()).toBeVisible();
  });
}

test("the invite flow's existing-user list merges drivers, dispatchers and admins", async ({ page }) => {
  await signIn(page);
  await page.goto(`${WEB}/settings/invitations/new`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Employee/ }).click();
  await page.getByRole("button", { name: /Existing User/ }).click();
  for (const name of ["Riley Patel", "Jordan Lee", "Alex Rivera"]) {
    await expect(page.getByText(name).first()).toBeVisible();
  }
});
