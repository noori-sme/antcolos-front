import { expect, test, type Page } from "@playwright/test";

/**
 * Truck writes against the REAL fleet API (plan 02, F0.1).
 *
 * Needs the seeded NestJS API on :3000 and this app in http mode on :3001
 * (see access-integration.live.spec.ts for the commands), plus two members of
 * the seeded carrier "Acme Haulage": a DRIVER (Riley Patel,
 * driver@antcolos.dev) and a DISPATCHER (Jordan Lee, dispatcher@antcolos.dev).
 *
 *   LIVE_WEB_URL=http://localhost:3001 npx playwright test \
 *     tests/browser/fleet-trucks.live.spec.ts --project=desktop
 *
 * Skipped unless LIVE_WEB_URL is set, so CI (mock mode, no backend) never runs it.
 */
const WEB = process.env.LIVE_WEB_URL;
const ADMIN = { email: "carrier@antcolos.dev", password: process.env.SEED_DEMO_PASSWORD ?? "Welcome@123" };
const DRIVER_NAME = "Riley Patel";
const DISPATCHER_NAME = "Jordan Lee";

test.skip(!WEB, "needs the full stack (set LIVE_WEB_URL); see the header comment");

const VIN_CHARS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
function randomVin(): string {
  let vin = "1HG";
  while (vin.length < 17) vin += VIN_CHARS[Math.floor(Math.random() * VIN_CHARS.length)];
  return vin;
}

async function signIn(page: Page) {
  await page.goto(`${WEB}/sign-in`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill(ADMIN.email);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
}

/** Creates a truck through the Add-truck screen and lands on its profile. */
async function createTruck(page: Page, vin: string, unit: string) {
  await page.goto(`${WEB}/fleet/trucks/new`, { waitUntil: "networkidle" });
  await page.getByLabel(/^VIN/).fill(vin);
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.getByRole("heading", { name: "New truck" })).toBeVisible();
  await page.getByLabel(/^Unit number/).fill(unit);
  const created = page.waitForRequest(
    (r) => r.method() === "POST" && new URL(r.url()).pathname.endsWith("/trucks"),
  );
  await page.getByRole("button", { name: "Create truck" }).click();
  const request = await created;
  expect(request.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
  await page.waitForURL(/\/fleet\/trucks\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: `Unit ${unit}` })).toBeVisible();
}

test("add a truck, change its status, edit it, and manage its driver and dispatcher", async ({ page }) => {
  await signIn(page);
  const stamp = String(Date.now()).slice(-6);
  await createTruck(page, randomVin(), `L${stamp}`);

  // Status: new operating rows start UNAVAILABLE.
  await page.getByRole("button", { name: "Status" }).click();
  await page.getByRole("menuitem", { name: "Mark available" }).click();
  await expect(page.getByText("Available", { exact: true }).first()).toBeVisible();

  // Edit this organization's unit number.
  await page.getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Edit truck" });
  await edit.getByLabel(/^Unit number/).fill(`E${stamp}`);
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByRole("heading", { name: `Unit E${stamp}` })).toBeVisible();

  // Assign the driver.
  await page.getByRole("button", { name: "Assign driver" }).click();
  const assign = page.getByRole("dialog", { name: "Assign a driver" });
  await assign.getByRole("option", { name: new RegExp(DRIVER_NAME) }).click();
  await assign.getByRole("button", { name: "Assign" }).click();
  await expect(assign).toBeHidden();
  await expect(page.getByRole("button", { name: `Actions for ${DRIVER_NAME}` })).toBeVisible();

  // Add a dispatcher.
  await page.getByRole("button", { name: "Add dispatcher" }).click();
  const dispatch = page.getByRole("dialog", { name: "Assign a dispatcher" });
  await dispatch.getByRole("option", { name: new RegExp(DISPATCHER_NAME) }).click();
  await dispatch.getByRole("button", { name: "Assign" }).click();
  await expect(dispatch).toBeHidden();
  await expect(page.getByRole("button", { name: `Actions for ${DISPATCHER_NAME}` })).toBeVisible();

  // Remove the driver.
  await page.getByRole("button", { name: `Actions for ${DRIVER_NAME}` }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  const confirm = page.getByRole("dialog", { name: `Remove ${DRIVER_NAME}?` });
  await confirm.getByRole("button", { name: "Remove" }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByText("No active driver assigned to this unit.")).toBeVisible();
  await expect(page.getByRole("button", { name: `Actions for ${DISPATCHER_NAME}` })).toBeVisible();
});

test("a VIN already on the fleet is not added twice", async ({ page }) => {
  await signIn(page);
  const vin = randomVin();
  const stamp = String(Date.now()).slice(-6);
  await createTruck(page, vin, `D${stamp}`);

  await page.goto(`${WEB}/fleet/trucks/new`, { waitUntil: "networkidle" });
  await page.getByLabel(/^VIN/).fill(vin);
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.getByText(`Already on your fleet as unit D${stamp}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Create truck" })).toHaveCount(0);
});

test("the legal owner archives an unavailable truck", async ({ page }) => {
  await signIn(page);
  const stamp = String(Date.now()).slice(-6);
  await createTruck(page, randomVin(), `A${stamp}`);

  await page.getByRole("button", { name: "More truck actions" }).click();
  await page.getByRole("menuitem", { name: "Archive truck…" }).click();
  const confirm = page.getByRole("dialog", { name: "Archive this truck?" });
  await confirm.getByRole("button", { name: "Archive truck" }).click();
  await page.waitForURL((u) => u.pathname === "/fleet/trucks");
});

test("replace the dispatcher, hand ownership to a member, then remove the truck from the fleet", async ({ page }) => {
  await signIn(page);
  const stamp = String(Date.now()).slice(-6);
  await createTruck(page, randomVin(), `R${stamp}`);

  // Add the dispatcher, then replace them with the admin (allowed as dispatcher).
  await page.getByRole("button", { name: "Add dispatcher" }).click();
  const add = page.getByRole("dialog", { name: "Assign a dispatcher" });
  await add.getByRole("option", { name: new RegExp(DISPATCHER_NAME) }).click();
  await add.getByRole("button", { name: "Assign" }).click();
  await expect(add).toBeHidden();
  await page.getByRole("button", { name: `Actions for ${DISPATCHER_NAME}` }).click();
  await page.getByRole("menuitem", { name: "Replace" }).click();
  const replace = page.getByRole("dialog", { name: `Replace ${DISPATCHER_NAME}` });
  await replace.getByRole("option", { name: /Alex Rivera/ }).click();
  await replace.getByRole("button", { name: "Replace" }).click();
  await expect(replace).toBeHidden();
  await expect(page.getByRole("button", { name: "Actions for Alex Rivera" })).toBeVisible();
  await expect(page.getByRole("button", { name: `Actions for ${DISPATCHER_NAME}` })).toHaveCount(0);

  // Hand legal ownership to the driver: this org stops being the owner, so
  // hand-off and archive disappear while the fleet listing stays.
  await page.getByRole("button", { name: "More truck actions" }).click();
  await page.getByRole("menuitem", { name: "Hand off ownership…" }).click();
  const handoff = page.getByRole("dialog", { name: "Hand off ownership" });
  await handoff.getByRole("option", { name: new RegExp(DRIVER_NAME) }).click();
  await handoff.getByRole("button", { name: "Hand off" }).click();
  await expect(handoff).toBeHidden();
  await page.getByRole("button", { name: "More truck actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Hand off ownership…" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: /Archive/ })).toHaveCount(0);

  // Remove it from this fleet.
  await page.getByRole("menuitem", { name: "Remove from our fleet…" }).click();
  const leave = page.getByRole("dialog", { name: "Remove this truck from your fleet?" });
  await leave.getByRole("button", { name: "Remove from fleet" }).click();
  await page.waitForURL((u) => u.pathname === "/fleet/trucks");
});
