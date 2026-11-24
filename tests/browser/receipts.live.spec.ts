import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

/**
 * Receipts on the REAL API (F2.1, plan 27; backend plan 50).
 *
 * Needs the seeded NestJS API on :3000 (main at or after noori-sme/antcolos#92)
 * and this app in http mode. The seed leaves the dispatcher and driver without
 * a carrier, so first make them members of "Acme Haulage" (the admin's org):
 * driver@antcolos.dev as DRIVER and dispatcher@antcolos.dev as DISPATCHER.
 * Then:
 *
 *   LIVE_WEB_URL=http://localhost:3001 npx playwright test tests/browser/receipts.live.spec.ts
 *
 * Repair receipts are used so no model is called. Skipped unless LIVE_WEB_URL
 * is set, so CI (mock mode, no backend) never runs it.
 */
const WEB = process.env.LIVE_WEB_URL;
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "Welcome@123";
const ADMIN = "carrier@antcolos.dev";
const DISPATCHER = "dispatcher@antcolos.dev";
const DRIVER = "driver@antcolos.dev";

test.skip(!WEB, "needs the full stack (set LIVE_WEB_URL); see the header comment");
test.describe.configure({ mode: "serial" });

/** A valid 1×1 PNG with random trailing bytes: a new file (SHA-256) every call. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const receiptImage = () => ({
  name: "receipt.png",
  mimeType: "image/png",
  buffer: Buffer.concat([PNG_1X1, randomBytes(16)]),
});

async function signIn(page: Page, email: string) {
  await page.goto(`${WEB}/sign-in`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
}

async function sendRepairReceipt(page: Page) {
  await page.goto(`${WEB}/driver/receipts`);
  await expect(page.getByRole("heading", { name: "My receipts" })).toBeVisible({ timeout: 60_000 });
  // Click the visible label, as a person does; retried until hydration has attached the handler.
  const repair = page.getByRole("radio", { name: "Repair" });
  await expect(async () => {
    await page.locator("label", { hasText: /^Repair$/ }).click();
    await expect(repair).toBeChecked({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await page.getByLabel("Choose a photo or PDF of the receipt").setInputFiles(receiptImage());
  await expect(page.getByText("Ready to send: receipt.png")).toBeVisible();
  await page.getByRole("button", { name: "Send receipt" }).click();
  // The new receipt opens: repair receipts wait for the driver's numbers.
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Repair and toll receipts are entered by hand for now.")).toBeVisible();
  return sheet;
}

test("a driver sends a repair receipt and confirms it", async ({ page }) => {
  await signIn(page, DRIVER);
  const sheet = await sendRepairReceipt(page);

  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await sheet.getByLabel(/Date on the receipt/).fill(yesterday);
  await sheet.getByLabel(/Total \(USD\)/).fill("400.00");
  await sheet.getByLabel("Parts").fill("220.00");
  await sheet.getByLabel("Labor").fill("180.00");
  await sheet.getByLabel("Vendor").fill("Joe's Truck Repair");
  await sheet.getByRole("button", { name: "Confirm receipt" }).click();
  await expect(sheet).toBeHidden();

  const row = page.getByRole("button", { name: /Repair · Joe's Truck Repair/ }).first();
  await expect(row).toContainText("Confirmed");
  await expect(row).toContainText("$400.00");

  // The page fits a phone: no horizontal scroll at the viewport width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a dispatcher sees the fleet's receipts but cannot decide them", async ({ page, isMobile }) => {
  test.skip(isMobile, "the office screens are checked on desktop");
  // The driver leaves one waiting.
  await signIn(page, DRIVER);
  const sheet = await sendRepairReceipt(page);
  await sheet.getByRole("button", { name: "Close panel" }).click();
  await page.context().clearCookies();

  await signIn(page, DISPATCHER);
  await page.goto(`${WEB}/finance/receipts`);
  await expect(page.getByRole("heading", { name: "Receipts" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Needs a check" }).click();
  await page.getByRole("button", { name: /Repair · Vendor not read/ }).first().click();
  const detail = page.getByRole("dialog");
  await expect(detail.getByText("Repair and toll receipts are entered by hand for now.")).toBeVisible();
  await expect(detail.getByRole("button", { name: "Confirm receipt" })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: "Reject receipt" })).toHaveCount(0);
});

test("an admin rejects a waiting receipt from the review queue", async ({ page, isMobile }) => {
  test.skip(isMobile, "the office screens are checked on desktop");
  await signIn(page, ADMIN);
  await page.goto(`${WEB}/finance/receipts`);
  await expect(page.getByRole("heading", { name: "Receipts" })).toBeVisible({ timeout: 60_000 });
  // A reviewer starts on what waits for them.
  await expect(page.getByRole("button", { name: "Needs a check" })).toHaveAttribute("aria-pressed", "true");
  const waiting = page.getByRole("button", { name: /Repair · Vendor not read/ });
  await expect(waiting.first()).toBeVisible();
  const before = await waiting.count();
  expect(before).toBeGreaterThan(0);

  await waiting.first().click();
  const detail = page.getByRole("dialog");
  await expect(detail.getByRole("button", { name: "Confirm receipt" })).toBeVisible();
  await detail.getByRole("button", { name: "Reject receipt" }).click();
  const reject = page.getByRole("dialog", { name: "Reject this receipt" });
  await reject.getByLabel(/Reason/).fill("Personal purchase, not a fleet expense");
  await reject.getByRole("button", { name: "Reject receipt" }).click();
  await expect(reject).toBeHidden();
  await expect(waiting).toHaveCount(before - 1);

  await page.getByRole("button", { name: "Rejected" }).click();
  await expect(page.getByRole("button", { name: /Repair · Vendor not read/ }).first()).toContainText("Rejected");
});
