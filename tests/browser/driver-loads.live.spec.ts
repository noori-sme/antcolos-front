import { expect, test, type Page } from "@playwright/test";

/**
 * Plan 16 (F1.4): a driver completes a load on a phone, against the REAL API.
 * Needs the NestJS API with plans 32–34, the seeded carrier admin, and an
 * active Driver member of that carrier who can sign in:
 *
 *   LIVE_WEB_URL=http://localhost:3000 LIVE_API_URL=http://localhost:3001/api/v1 \
 *   LIVE_DRIVER_EMAIL=… LIVE_DRIVER_PASSWORD=… \
 *     npx playwright test tests/browser/driver-loads.live.spec.ts --project=mobile
 *
 * Skipped unless all four are set, so CI never runs it.
 */
const WEB = process.env.LIVE_WEB_URL;
const API = process.env.LIVE_API_URL;
const DRIVER = { email: process.env.LIVE_DRIVER_EMAIL ?? "", password: process.env.LIVE_DRIVER_PASSWORD ?? "" };
const ADMIN = { email: "carrier@antcolos.dev", password: process.env.SEED_DEMO_PASSWORD ?? "Welcome@123" };

test.skip(!WEB || !API || !DRIVER.email || !DRIVER.password, "needs the full stack and a driver; see the header comment");

async function token(page: Page, who: { email: string; password: string }) {
  const res = await page.request.post(`${API}/auth/login`, { data: who });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  return { token: body.accessToken as string, userId: body.user.id as string };
}

/** A load assigned to the driver, created through the API as the carrier admin. */
async function assignedLoad(page: Page): Promise<string> {
  const admin = await token(page, ADMIN);
  const driver = await token(page, DRIVER);
  const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const headers = { Authorization: `Bearer ${admin.token}` };
  const created = await page.request.post(`${API}/loads`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: {
      source: "MANUAL", brokerName: "Northstar Freight Brokerage LLC", brokerMcNumber: "812345",
      brokerLoadNumber: `F14-${Date.now().toString(36)}`, equipmentType: "DRY_VAN",
      rateTotal: "2750.00", specialInstructions: "Call 1 hour before arrival.",
      stops: [
        { type: "PICKUP", city: "Joliet", state: "IL", timezone: "America/Chicago", scheduledDate: day, contactPhone: "+13125550199" },
        { type: "DELIVERY", city: "Newark", state: "NJ", timezone: "America/New_York" },
      ],
    },
  });
  expect(created.status()).toBe(201);
  const id = (await created.json()).id as string;
  const assigned = await page.request.post(`${API}/loads/${id}/driver`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: { userId: driver.userId },
  });
  expect(assigned.status()).toBe(201);
  return id;
}

async function signIn(page: Page) {
  await page.goto(`${WEB}/sign-in`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill(DRIVER.email);
  await page.getByLabel("Password", { exact: true }).fill(DRIVER.password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
}

async function record(page: Page, label: RegExp) {
  await page.getByRole("button", { name: label }).first().click();
  await page.getByRole("button", { name: "Record it" }).click();
  await expect(page.getByRole("button", { name: "Record it" })).toHaveCount(0);
}

test("a driver accepts, runs the trip, uploads the POD, and never sees the rate", async ({ page }) => {
  const id = await assignedLoad(page);
  await signIn(page);

  await page.goto(`${WEB}/driver/loads`, { waitUntil: "networkidle" });
  await expect(page.getByText("Waiting for your answer").first()).toBeVisible();
  await page.goto(`${WEB}/driver/loads/${id}`, { waitUntil: "networkidle" });
  await expect(page.getByText("Call 1 hour before arrival.")).toBeVisible();
  await expect(page.getByText(/2,750|2750/)).toHaveCount(0);

  await page.getByRole("button", { name: "Accept load" }).click();
  await expect(page.getByRole("button", { name: "Start trip" })).toBeVisible();

  await record(page, /^Start trip$/);
  await record(page, /^Arrived at pickup 1/);
  await expect(page.getByText(/^Arrived /).first()).toBeVisible();
  await record(page, /^Loaded at pickup 1$/);
  await record(page, /^Departed pickup 1$/);
  await record(page, /^Arrived at delivery 1/);
  await record(page, /^Delivered at delivery 1$/);

  await page.getByLabel("Upload POD").setInputFiles("tests/browser/files/tiny.pdf");
  await expect(page.getByText("POD", { exact: true })).toBeVisible();
  await expect(page.getByText("POD received").first()).toBeVisible();
  // A phone does not scroll sideways.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
