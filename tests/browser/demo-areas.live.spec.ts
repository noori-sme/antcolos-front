import { expect, test, type Page } from "@playwright/test";

/**
 * Demo areas in http mode against the REAL API (plan 10): signed in for real,
 * the shell keeps the real organization, the areas with no backend come back
 * on the Northline demo data under a "Demo data" banner, and the live areas
 * stay live (no banner).
 *
 * Needs a build with NEXT_PUBLIC_API_MODE=http (demo areas are on by default)
 * talking to the seeded API:
 *
 *   NEXT_PUBLIC_API_MODE=http npm run build && npx next start -p 3000
 *   LIVE_WEB_URL=http://localhost:3000 npx playwright test tests/browser/demo-areas.live.spec.ts
 *
 * Skipped unless LIVE_WEB_URL is set, so CI (mock mode, no backend) never runs it.
 */
const WEB = process.env.LIVE_WEB_URL;
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "Welcome@123";
const EMAIL = process.env.LIVE_CARRIER_EMAIL ?? "carrier@antcolos.dev";
const ORG = process.env.LIVE_CARRIER_ORG ?? "Acme Haulage";

test.skip(!WEB, "needs the full stack (set LIVE_WEB_URL); see the header comment");
test.skip(process.env.LIVE_DEMO_AREAS === "off", "this build has demo areas off");

async function signIn(page: Page) {
  await page.goto(`${WEB}/sign-in`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await page.waitForURL((u) => u.pathname === "/home");
}

const banner = (page: Page) => page.getByRole("note", { name: "Demo data" });

test("home is the full demo dashboard, inside the real shell", async ({ page }) => {
  const adapterErrors: string[] = [];
  page.on("console", (m) => {
    if (/HTTP adapter not implemented|has no real adapter yet/.test(m.text())) {
      adapterErrors.push(m.text().slice(0, 120));
    }
  });
  await signIn(page);

  await expect(banner(page)).toBeVisible();
  // The shell (outside the demo session) still shows the real organization.
  await expect(page.getByRole("banner").getByText(ORG).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(adapterErrors).toEqual([]);
});

test("a demo area is back in the menu and opens on demo data", async ({ page, isMobile }) => {
  await signIn(page);
  if (isMobile) await page.getByRole("button", { name: /open navigation|menu/i }).first().click();
  const loads = page.getByRole("link", { name: "Loads", exact: true }).first();
  await expect(loads).toBeVisible();
  await loads.click();
  await page.waitForURL((u) => u.pathname === "/loads");

  await expect(banner(page)).toBeVisible();
  await expect(page.getByText("This area isn't available yet")).toHaveCount(0);
  await expect(page.getByText(/HTTP adapter not implemented/)).toHaveCount(0);
  // No sideways scroll on a phone with the banner on top.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a live area has no demo banner", async ({ page }) => {
  await signIn(page);
  await page.goto(`${WEB}/fleet/trucks`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
});
