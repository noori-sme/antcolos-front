import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

/**
 * FMCSA authority on Home, hand-off to another carrier, leaving an
 * organization — against the REAL API (plan 25; backend plans 41, 42).
 *
 * Needs the seeded API on :3000 and this app in http mode, plus a second
 * carrier ("Bluefin Freight") and the seeded dispatcher as a member of a
 * second organization ("Pacific Dispatch LLC"); the dev SQL that adds them is
 * idempotent and listed in plan 25 §verification.
 *
 *   LIVE_WEB_URL=http://localhost:3001 LIVE_API_URL=http://localhost:3000/api/v1 \
 *     npx playwright test tests/browser/authority-directory-leave.live.spec.ts
 *
 * Skipped unless LIVE_WEB_URL is set, so CI (mock mode, no backend) never runs it.
 */
const WEB = process.env.LIVE_WEB_URL;
const API = process.env.LIVE_API_URL ?? "http://localhost:3000/api/v1";
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "Welcome@123";
const ADMIN = "carrier@antcolos.dev";
const DISPATCHER = "dispatcher@antcolos.dev";

test.skip(!WEB, "needs the full stack (set LIVE_WEB_URL); see the header comment");
test.describe.configure({ mode: "serial" });

async function signIn(page: Page, email: string) {
  await page.goto(`${WEB}/sign-in`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
}

test("Home shows the carrier's FMCSA authority, and a failed check says why", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await signIn(page, ADMIN);
  await page.goto(`${WEB}/home`);
  const card = page.getByRole("region", { name: "FMCSA authority" });
  await expect(card).toBeVisible({ timeout: 60_000 });
  // The seed carrier has a placeholder MC, so FMCSA refuses it: the API's reason is shown.
  await card.getByRole("button", { name: "Check FMCSA now" }).first().click();
  await expect(card.getByRole("alert")).toBeVisible({ timeout: 30_000 });
});

test("a dispatcher sees the authority but cannot re-check it", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await signIn(page, DISPATCHER);
  await page.goto(`${WEB}/home`);
  const card = page.getByRole("region", { name: "FMCSA authority" });
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.getByRole("button", { name: "Check FMCSA now" })).toHaveCount(0);
});

test("a truck can be handed off to another carrier found by name", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  const login = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ADMIN, password: PASSWORD }),
  });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const vin = `1HO${randomUUID().replace(/-/g, "").slice(0, 14).toUpperCase()}`;
  const created = await fetch(`${API}/trucks`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", "idempotency-key": randomUUID() },
    body: JSON.stringify({ vin, unitNumber: `HO-${vin.slice(-4)}`, equipmentType: "DRY_VAN", ownershipType: "COMPANY" }),
  });
  const truck = (await created.json()) as { id: string };

  await signIn(page, ADMIN);
  await page.goto(`${WEB}/fleet/trucks/${truck.id}`);
  await page.getByRole("button", { name: "More truck actions" }).click({ timeout: 60_000 });
  await page.getByRole("menuitem", { name: /Hand off ownership/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Another carrier" }).click();
  await dialog.getByPlaceholder("Search carriers by name, MC or DOT").fill("b");
  await expect(dialog.getByText("Type at least 2 characters.")).toBeVisible();
  await dialog.getByPlaceholder("Search carriers by name, MC or DOT").fill("blue");
  await dialog.getByRole("button", { name: /Bluefin Freight/ }).click();
  await dialog.getByRole("button", { name: "Hand off" }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  const after = await fetch(`${API}/trucks/${truck.id}`, { headers: { authorization: `Bearer ${accessToken}` } });
  const body = (await after.json()) as { legalOwner?: { ownerType?: string } };
  expect(body.legalOwner?.ownerType).toBe("ORGANIZATION");
});

test("a member leaves another organization and keeps working in this one", async ({ page }) => {
  await signIn(page, DISPATCHER);
  await page.goto(`${WEB}/account/organizations`);
  await expect(page.getByRole("heading", { name: "My organizations", level: 1 })).toBeVisible({ timeout: 60_000 });
  const other = page.getByRole("listitem").filter({ hasText: "Pacific Dispatch LLC" });
  await expect(other).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Acme Haulage" }).getByText("Current")).toBeVisible();
  await other.getByRole("button", { name: "Leave" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Your Antcolos account stays.");
  await dialog.getByRole("button", { name: "Leave" }).click();
  await expect(other).toHaveCount(0, { timeout: 30_000 });
  await expect(page).toHaveURL(/\/account\/organizations$/);
  if (test.info().project.name.includes("mobile")) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  }
});
