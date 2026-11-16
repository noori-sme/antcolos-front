import { expect, test, type Page } from "@playwright/test";

/**
 * Plan 15 (F1.3): book a truck and assign a driver from the load, against the
 * REAL API, signed in as the seeded carrier admin. Needs the NestJS API with
 * plans 29–32, an AVAILABLE truck this organization operates, and an active
 * member with the Driver role:
 *
 *   LIVE_WEB_URL=http://localhost:3000 LIVE_API_URL=http://localhost:3001/api/v1 \
 *     npx playwright test tests/browser/load-crew.live.spec.ts
 *
 * Skipped unless both URLs are set, so CI never runs it.
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

async function bookLoad(page: Page): Promise<{ id: string; number: string }> {
  const token = (await (await page.request.post(`${API}/auth/login`, { data: ADMIN })).json()).accessToken;
  const number = `F13-${Date.now().toString(36)}`;
  const day = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  const res = await page.request.post(`${API}/loads`, {
    headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": crypto.randomUUID() },
    data: {
      source: "MANUAL", brokerName: "Northstar Freight Brokerage LLC", brokerMcNumber: "812345",
      brokerLoadNumber: number, equipmentType: "DRY_VAN",
      stops: [
        { type: "PICKUP", city: "Joliet", state: "IL", timezone: "America/Chicago", scheduledDate: day },
        { type: "DELIVERY", city: "Newark", state: "NJ", timezone: "America/New_York" },
      ],
    },
  });
  expect(res.status()).toBe(201);
  return { id: (await res.json()).id as string, number };
}

test("books a truck, assigns a driver, records the answer, and the trip can start", async ({ page }) => {
  await signIn(page);
  const load = await bookLoad(page);
  await page.goto(`${WEB}/loads/${load.id}`, { waitUntil: "networkidle" });
  const crew = page.locator('section[aria-labelledby="load-crew"]');
  await expect(crew.getByText("No truck booked.")).toBeVisible();
  await expect(crew.getByText("No driver assigned.")).toBeVisible();

  await crew.getByRole("button", { name: "Book a truck" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: /^Truck/ }).selectOption({ index: 1 });
  await dialog.getByRole("button", { name: "Book truck" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(crew.getByText("Booked for a load")).toBeVisible();

  await crew.getByRole("button", { name: "Assign a driver" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: /^Driver/ }).selectOption({ index: 1 });
  await dialog.getByRole("button", { name: "Assign driver" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(crew.getByText("Waiting for an answer")).toBeVisible();
  await expect(page.locator("header").filter({ hasText: "Load " }).getByText("Driver assigned", { exact: true })).toBeVisible();

  await crew.getByRole("button", { name: "Driver accepted" }).click();
  await expect(crew.getByText("Accepted", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Start trip to pickup" }).click();
  await expect(crew.getByText("En route to pickup")).toBeVisible();
  // The trip started: the truck and the driver no longer change from here.
  await expect(crew.getByRole("button", { name: /Take truck off|Change driver/ })).toHaveCount(0);

  const timeline = page.locator('section[aria-labelledby="load-timeline"]');
  for (const line of ["Truck booked for this load", "Driver assigned", "Driver accepted the load"]) {
    await expect(timeline.getByText(line)).toBeVisible();
  }
});
