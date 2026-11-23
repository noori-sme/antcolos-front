import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

/**
 * Maintenance on the REAL API (F2.3, plan 24; backend plan 48).
 *
 * Needs the seeded NestJS API on :3000 (branch feat/fleet-maintenance or
 * later) and this app in http mode, plus, in "Acme Haulage", the seeded
 * driver (driver@antcolos.dev) as the current driver of a truck and the seeded
 * dispatcher (dispatcher@antcolos.dev) as a member:
 *
 *   LIVE_WEB_URL=http://localhost:3001 LIVE_API_URL=http://localhost:3000/api/v1 \
 *     npx playwright test tests/browser/fleet-maintenance.live.spec.ts
 *
 * Skipped unless LIVE_WEB_URL is set, so CI (mock mode, no backend) never runs it.
 */
const WEB = process.env.LIVE_WEB_URL;
const API = process.env.LIVE_API_URL ?? "http://localhost:3000/api/v1";
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "Welcome@123";
const ADMIN = "carrier@antcolos.dev";
const DISPATCHER = "dispatcher@antcolos.dev";
const DRIVER = "driver@antcolos.dev";

test.skip(!WEB, "needs the full stack (set LIVE_WEB_URL); see the header comment");
test.describe.configure({ mode: "serial" });

async function signIn(page: Page, email: string) {
  await page.goto(`${WEB}/sign-in`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
}

/** A tenant token for the admin, straight from the API, to set up data. */
async function adminApi() {
  const login = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ADMIN, password: PASSWORD }),
  });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    expect(res.ok, `${method} ${path} → ${res.status} ${await res.clone().text()}`).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose API fixtures in a live test
    return res.json() as Promise<Record<string, any>>;
  };
  return call;
}

test("the owner runs a service interval from due to done", async ({ page, isMobile }) => {
  test.skip(isMobile, "the owner flow is checked on desktop; the phone layout below");
  const api = await adminApi();
  const vin = `1LV${randomUUID().replace(/-/g, "").slice(0, 14).toUpperCase()}`;
  const unit = `SV-${vin.slice(-4)}`;
  const truck = await api("POST", "/trucks", { vin, unitNumber: unit, equipmentType: "DRY_VAN", ownershipType: "COMPANY" });

  await signIn(page, ADMIN);
  await page.goto(`${WEB}/fleet/trucks/${truck.id}`);
  const panel = page.getByRole("region", { name: "Maintenance" });
  await expect(panel.getByText("No service intervals yet")).toBeVisible({ timeout: 60_000 });

  // Add an oil change every 15,000 mi from 100,000; record 114,600.
  await panel.getByRole("button", { name: "Add interval" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Every (miles)").fill("15000");
  await dialog.getByLabel("Odometer at last service").fill("100000");
  await dialog.getByRole("button", { name: "Add interval" }).click();
  await expect(dialog).toBeHidden();
  await expect(panel.getByText("No reading yet").first()).toBeVisible();

  await panel.getByRole("button", { name: "Record reading" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Odometer (miles)").fill("114600");
  await dialog.getByRole("button", { name: "Record reading" }).click();
  await expect(dialog).toBeHidden();
  await expect(panel.getByText("Due soon")).toBeVisible();
  await expect(panel.getByText("400 mi left")).toBeVisible();
  await expect(panel.getByText("Open", { exact: true })).toBeVisible();

  // A reading that goes backwards is refused with the API's reason.
  await panel.getByRole("button", { name: "Record reading" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Odometer (miles)").fill("114000");
  await dialog.getByRole("button", { name: "Record reading" }).click();
  await expect(dialog.getByRole("alert")).toContainText(/lower than the latest/);
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // Acknowledge, then defer with a reason.
  await panel.getByRole("button", { name: "Acknowledge" }).click();
  await expect(panel.getByText("Acknowledged")).toBeVisible();
  await panel.getByRole("button", { name: "Defer" }).click();
  dialog = page.getByRole("dialog");
  const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await dialog.getByLabel("Until").fill(tomorrow);
  await dialog.getByLabel("Reason").fill("Booked at the dealer");
  await dialog.getByRole("button", { name: "Defer" }).click();
  await expect(dialog).toBeHidden();
  await expect(panel.getByText("Deferred: Booked at the dealer")).toBeVisible();

  // Service due lists it; complete it there at 115,100.
  await page.getByRole("link", { name: "Service due" }).first().click();
  await expect(page.getByRole("heading", { name: "Service due", level: 1 })).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: `Unit ${unit}` });
  await expect(row.getByText("Deferred", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Complete" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Odometer (miles)").fill("115100");
  await dialog.getByLabel("What was done").fill("Oil and filter");
  await dialog.getByRole("button", { name: "Complete" }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "Completed" }).click();
  await expect(page).toHaveURL(/\?view=done$/);
  await expect(page.getByRole("listitem").filter({ hasText: `Unit ${unit}` })).toBeVisible();

  // Back on the truck: the next interval starts at 115,100.
  await page.goto(`${WEB}/fleet/trucks/${truck.id}`);
  await expect(panel.getByText("OK", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByText("15,000 mi left")).toBeVisible();
  await page.getByText(/Loading Antcolos/i).waitFor({ state: "hidden" }).catch(() => {});
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/maintenance-owner.png" });
});

test("a dispatcher sees the panel but cannot manage intervals", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop only");
  const api = await adminApi();
  const trucks = await api("GET", "/trucks?pageSize=5");
  const truckId = (trucks.data as { id: string }[])[0].id;
  await signIn(page, DISPATCHER);
  await page.goto(`${WEB}/fleet/trucks/${truckId}`);
  const panel = page.getByRole("region", { name: "Maintenance" });
  await expect(panel).toBeVisible({ timeout: 60_000 });
  await expect(panel.getByRole("button", { name: "Record reading" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Add interval" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Archive" })).toHaveCount(0);
});

test("the driver sees their truck, records the odometer and acknowledges", async ({ page }) => {
  // Make something due on the driver's truck: an interval every 1,000 mi from now.
  const api = await adminApi();
  const assignments = await api("GET", "/trucks?pageSize=100");
  const truck = (assignments.data as { id: string; currentDriver?: { email?: string; name?: string } | null }[])
    .find((t) => t.currentDriver);
  expect(truck, "a truck with a current driver").toBeTruthy();
  const before = await api("GET", `/trucks/${truck!.id}/maintenance`);
  const base = (before.latestReading.odometerMiles as number | null) ?? 50_000;
  await api("POST", `/trucks/${truck!.id}/maintenance/schedules`, {
    title: `Grease ${randomUUID().slice(0, 4)}`,
    category: "PREVENTIVE_SERVICE",
    everyMiles: 1000,
    lastServiceOdometerMiles: base,
  });
  await api("POST", `/trucks/${truck!.id}/meter-readings`, { odometerMiles: base + 700 });

  await signIn(page, DRIVER);
  await page.goto(`${WEB}/driver/loads`);
  const card = page.getByRole("region", { name: /maintenance$/ });
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.getByText("300 mi left").first()).toBeVisible();

  await card.getByLabel("Odometer (miles)").fill(String(base + 650));
  await card.getByRole("button", { name: "Record odometer" }).click();
  await expect(card.getByText(/lower than the last reading/)).toBeVisible();
  await card.getByLabel("Odometer (miles)").fill(String(base + 750));
  await card.getByRole("button", { name: "Record odometer" }).click();
  await expect(card.getByText("250 mi left").first()).toBeVisible();

  const gotIt = card.getByRole("button", { name: "Got it" }).first();
  await gotIt.click();
  await expect(card.getByText("Acknowledged").first()).toBeVisible();
  if (!test.info().project.name.includes("mobile")) return;
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: "test-results/maintenance-driver-mobile.png", fullPage: true });
});
