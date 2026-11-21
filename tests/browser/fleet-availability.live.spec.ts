import { expect, test, type Page } from "@playwright/test";

/**
 * The truck availability board (F2.5, plan 23) against the REAL API.
 *
 * Needs the seeded NestJS API on :3000 and this app in http mode (see
 * access-integration.live.spec.ts for the commands), signed in as the seeded
 * carrier admin of "Acme Haulage":
 *
 *   LIVE_WEB_URL=http://localhost:3001 npx playwright test \
 *     tests/browser/fleet-availability.live.spec.ts
 *
 * Live, not mock: in mock mode the (app) route guard sends a browser without a
 * session cookie to /sign-in, and the permission sync needs the API.
 * The real board is checked first. Trucks on a trip need a booked load the
 * seed does not have, so those scenarios stub only the availability endpoints
 * (shapes from ../antcolos/docs/requirements/fleet-api-contract.md
 * "Truck availability"). The refusal for a seat without `trucks:view` is the
 * pure route-manifest test in src/lib/permissions/permissions.test.ts.
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

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const page1 = (data: unknown[]) => ({
  data, meta: { page: 1, pageSize: 50, totalItems: data.length, totalPages: 1 },
});

const TRIP_ROWS = [
  {
    truckId: "t-soon", unitNumber: "S-104", equipmentType: "REEFER", operationalStatus: "LOADED_IN_TRANSIT",
    bucket: "WITHIN_5H", estimatedEmptyAt: inHours(3), emptyCity: "Dallas", emptyState: "TX",
    activeLoadId: "load-1",
  },
  {
    truckId: "t-unknown", unitNumber: "S-105", equipmentType: "DRY_VAN", operationalStatus: "AT_DELIVERY",
    bucket: "UNKNOWN", estimatedEmptyAt: null, emptyCity: null, emptyState: null, activeLoadId: "load-2",
  },
];

/** Stubs the API calls only: the page itself lives at /fleet/availability too. */
async function stubAvailability(page: Page, status = 200) {
  await page.route(
    (url) => url.pathname.endsWith("/api/v1/fleet/availability"),
    (route) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(status === 200 ? page1(TRIP_ROWS) : { statusCode: status, message: "Not answering." }),
    }),
  );
  await page.route(
    (url) => /\/api\/v1\/fleet\/availability\/[^/]+\/history$/.test(url.pathname),
    (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(page1([
        {
          loadId: "load-0", predictedEmptyAt: inHours(-30), recordedAt: inHours(-40),
          actualEmptyAt: new Date(Date.now() - 30 * 3_600_000 + 42 * 60_000).toISOString(),
          errorMinutes: 42,
        },
      ])),
    }),
  );
}

test("the real board groups the fleet and the filter goes into the URL", async ({ page }) => {
  await signIn(page);
  await page.goto(`${WEB}/fleet/availability`);
  await expect(page.getByRole("heading", { name: "Availability", level: 1 })).toBeVisible();
  const groups = page.getByRole("heading", { level: 2 });
  await expect(groups.first()).toBeVisible();
  const firstBucket = (await groups.first().textContent())!.split(" · ")[0];

  await page.getByRole("group", { name: "Filter by availability" })
    .getByRole("button", { name: new RegExp(`^${firstBucket}`) }).click();
  await expect(page).toHaveURL(/\?bucket=[A-Z_0-9]+$/);
  await expect(groups).toHaveCount(1);
  await expect(groups.first()).toHaveText(new RegExp(firstBucket));

  // The URL is the state: a reload keeps the filter.
  await page.reload();
  await expect(page.getByRole("button", { name: new RegExp(`^${firstBucket}`) }))
    .toHaveAttribute("aria-pressed", "true");
});

test("a truck on a trip shows when and where it empties, and its load", async ({ page }) => {
  await signIn(page);
  await stubAvailability(page);
  await page.goto(`${WEB}/fleet/availability`);

  const soon = page.getByRole("region", { name: /Within 5 hours/ });
  await expect(soon.getByRole("link", { name: "Unit S-104" })).toHaveAttribute("href", "/fleet/trucks/t-soon");
  await expect(soon.getByText(/In (2 h 5\d min|3 h)/)).toBeVisible();
  await expect(soon.getByText("Empties in Dallas, TX")).toBeVisible();
  await expect(soon.getByRole("link", { name: "Load" })).toHaveAttribute("href", "/loads/load-1");
  await expect(page.getByText(/can't see a delivery time/)).toBeVisible();
});

test("history shows a stored prediction against the actual empty time", async ({ page }) => {
  await signIn(page);
  await stubAvailability(page);
  await page.goto(`${WEB}/fleet/availability`);
  await page.getByRole("button", { name: "Prediction history for unit S-104" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Empty-time predictions · Unit S-104")).toBeVisible();
  await expect(dialog.getByRole("cell", { name: "42 min late" })).toBeVisible();
});

test("a failed load says so and offers a retry", async ({ page }) => {
  await signIn(page);
  await stubAvailability(page, 503);
  await page.goto(`${WEB}/fleet/availability`);
  await expect(page.getByText("Couldn't load availability")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("on a phone the board fits the screen", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile layout");
  await signIn(page);
  await stubAvailability(page);
  await page.goto(`${WEB}/fleet/availability`);
  await expect(page.getByRole("link", { name: "Unit S-104" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
