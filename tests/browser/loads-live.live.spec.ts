import { expect, test, type Page } from "@playwright/test";

/**
 * Plan 14 (F1.2): loads list, load detail and timeline against the REAL API,
 * signed in as the seeded carrier admin (holds load.* through Admin).
 *
 * Needs the NestJS API with plans 29 and 30 and this app in http mode:
 *
 *   LIVE_WEB_URL=http://localhost:3000 LIVE_API_URL=http://localhost:3001/api/v1 \
 *     npx playwright test tests/browser/loads-live.live.spec.ts
 *
 * Skipped unless LIVE_WEB_URL and LIVE_API_URL are set, so CI never runs it.
 * The route gate and the mappers are unit-tested (route-availability.test.ts,
 * load-records.test.ts).
 */
const WEB = process.env.LIVE_WEB_URL;
const API = process.env.LIVE_API_URL;
const ADMIN = {
  email: "carrier@antcolos.dev",
  password: process.env.SEED_DEMO_PASSWORD ?? "Welcome@123",
};

test.skip(!WEB || !API, "needs the full stack (set LIVE_WEB_URL and LIVE_API_URL); see the header comment");

async function signIn(page: Page) {
  await page.goto(`${WEB}/sign-in`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill(ADMIN.email);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
}

/** Books a load through the API, so the test does not depend on a Rate Con read. */
async function bookLoad(page: Page, loadNumber: string): Promise<string> {
  const login = await page.request.post(`${API}/auth/login`, { data: ADMIN });
  const token = (await login.json()).accessToken as string;
  const day = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const res = await page.request.post(`${API}/loads`, {
    headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": crypto.randomUUID() },
    data: {
      source: "MANUAL",
      brokerName: "Northstar Freight Brokerage LLC",
      brokerMcNumber: "812345",
      brokerLoadNumber: loadNumber,
      equipmentType: "DRY_VAN",
      weightLbs: 42000,
      rateTotal: "2750.00",
      stops: [
        {
          type: "PICKUP",
          facilityName: "Joliet Distribution Center",
          city: "Joliet",
          state: "IL",
          timezone: "America/Chicago",
          scheduledDate: day,
          windowStart: `${day}T08:00:00-06:00`,
          windowEnd: `${day}T10:00:00-06:00`,
        },
        { type: "DELIVERY", city: "Newark", state: "NJ", timezone: "America/New_York" },
      ],
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).id as string;
}

test("lists a load, opens it, cancels it with TONU, and shows it on the timeline", async ({ page }) => {
  await signIn(page);
  const loadNumber = `F12-${Date.now().toString(36)}`;
  const id = await bookLoad(page, loadNumber);

  await page.goto(`${WEB}/loads`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Loads", exact: true })).toBeVisible();
  await page.getByLabel("Search loads").fill(loadNumber);
  await page.getByRole("link", { name: loadNumber }).first().click();
  await page.waitForURL(`**/loads/${id}`);

  await expect(page.getByRole("heading", { name: `Load ${loadNumber}` })).toBeVisible();
  await expect(page.getByText("Joliet Distribution Center")).toBeVisible();
  await expect(page.getByText(/08:00–10:00 CST/)).toBeVisible();
  await expect(page.getByText("$2,750.00")).toBeVisible();
  await expect(page.getByText("Load created")).toBeVisible();
  // BOOKED: only cancelling is a next step (driver assignment arrives with M1.7).
  await expect(page.getByRole("button", { name: /Start trip/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Cancel load" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Cancel load" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Say why the load is cancelled.");
  await dialog.getByLabel(/Reason/).fill("Shipper closed for the holiday");
  await dialog.getByLabel("Who cancelled").selectOption("shipper");
  await dialog.getByLabel(/TONU amount/).fill("150");
  await dialog.getByRole("button", { name: "Cancel load" }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("header").getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(page.getByText("Cancelled by the shipper · TONU $150.00")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel load" })).toHaveCount(0);
});

test("a phone shows the list as cards without sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await signIn(page);
  await page.goto(`${WEB}/loads`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Loads", exact: true })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});
