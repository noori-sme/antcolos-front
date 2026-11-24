import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

/**
 * Expenses and the owner-operator ledger on the REAL API (F2.2, plan 28;
 * backend plan 51).
 *
 * Needs the seeded NestJS API on :3000 (branch feat/finance-expense-routing or
 * later) running with OUTBOX_WORKER_ENABLED=true, so confirmed receipts are
 * routed, and this app in http mode. The seed leaves the driver without a
 * carrier: first make driver@antcolos.dev a DRIVER of "Acme Haulage". Then:
 *
 *   LIVE_WEB_URL=http://localhost:3001 npx playwright test tests/browser/expenses.live.spec.ts
 *
 * Skipped unless LIVE_WEB_URL is set, so CI (mock mode, no backend) never runs it.
 */
const WEB = process.env.LIVE_WEB_URL;
const API = process.env.LIVE_API_URL ?? "http://localhost:3000/api/v1";
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "Welcome@123";
const ADMIN = "carrier@antcolos.dev";
const DRIVER = "driver@antcolos.dev";

test.skip(!WEB, "needs the full stack (set LIVE_WEB_URL); see the header comment");
test.describe.configure({ mode: "serial" });

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** A money amount unique to this run (e.g. "347.25"), so its row is the one on screen. */
const uniqueAmount = (lead: string, cents: string): string =>
  `${lead}${Math.floor(10 + Math.random() * 89)}.${cents}`;
/** Matches the formatted amount ("$347.25") inside a row's accessible name. */
const amountPattern = (amount: string): RegExp => new RegExp(`\\$${amount.replace(".", "\\.")}`);

async function signIn(page: Page, email: string) {
  await page.goto(`${WEB}/sign-in`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
}

/** One API token per account for the whole run: logins are rate limited. */
const tokens = new Map<string, Promise<string>>();
function login(email: string): Promise<string> {
  if (!tokens.has(email)) {
    tokens.set(
      email,
      fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: PASSWORD }),
      }).then(async (res) => {
        expect(res.ok, `login ${email} → ${res.status}`).toBe(true);
        return ((await res.json()) as { accessToken: string }).accessToken;
      }),
    );
  }
  return tokens.get(email)!;
}

/** The user id inside a JWT (its `sub`). */
const userIdOf = (token: string): string =>
  (JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) as { sub: string }).sub;

async function adminApi() {
  const token = await login(ADMIN);
  const call = async (method: string, path: string, body?: unknown, form?: FormData) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(form ? {} : { "content-type": "application/json" }),
        ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}),
      },
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    expect(res.ok, `${method} ${path} → ${res.status} ${await res.clone().text()}`).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose API fixtures in a live test
    return res.json() as Promise<Record<string, any>>;
  };
  return call;
}

type Api = Awaited<ReturnType<typeof adminApi>>;

async function newTruck(api: Api, extras: Record<string, unknown> = {}): Promise<string> {
  const vin = `1EX${randomUUID().replace(/-/g, "").slice(0, 14).toUpperCase()}`;
  const truck = await api("POST", "/trucks", {
    vin,
    unitNumber: `EX-${vin.slice(-4)}`,
    equipmentType: "DRY_VAN",
    ownershipType: "COMPANY",
    ...extras,
  });
  return truck.id as string;
}

/** A confirmed repair receipt for the truck, spent at `purchasedAt`; the worker routes it. */
async function confirmedReceipt(api: Api, truckId: string, total: string, purchasedAt: Date): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([Buffer.concat([PNG_1X1, randomBytes(16)])], { type: "image/png" }), "r.png");
  form.append("kind", "REPAIR");
  form.append("truckId", truckId);
  const receipt = await api("POST", "/receipts", undefined, form);
  await api("POST", `/receipts/${receipt.id}/confirm`, { totalAmount: total, purchasedAt: purchasedAt.toISOString() });
  return receipt.id as string;
}

/** Until the outbox worker has routed the receipt (a few seconds after confirm). */
async function waitForExpense(api: Api, receiptId: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const page = await api("GET", "/expenses?pageSize=100");
        return (page.data as { receiptId: string }[]).some((e) => e.receiptId === receiptId);
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function waitForLedgerEntry(token: string, receiptId: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await fetch(`${API}/users/me/ledger?pageSize=100`, { headers: { authorization: `Bearer ${token}` } });
        const page = (await res.json()) as { data?: { receiptId: string }[] };
        return (page.data ?? []).some((e) => e.receiptId === receiptId);
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

test("a company truck's receipt lands in the books, and an admin voids it", async ({ page, isMobile }) => {
  test.skip(isMobile, "the office screens are checked on desktop");
  const api = await adminApi();
  const truckId = await newTruck(api);
  const total = uniqueAmount("3", "25");
  await waitForExpense(api, await confirmedReceipt(api, truckId, total, new Date()));

  await signIn(page, ADMIN);
  await page.goto(`${WEB}/finance/expenses`);
  await expect(page.getByRole("heading", { name: "Expenses" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "In the books" }).click();
  const row = page.getByRole("button", { name: amountPattern(total) });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText("Company truck");

  await row.click();
  const sheet = page.getByRole("dialog", { name: "Expense" });
  await sheet.getByRole("button", { name: "Void expense" }).click();
  const dialog = page.getByRole("dialog", { name: "Void this expense" });
  await dialog.getByLabel(/Reason/).fill("Duplicate of a card charge");
  await dialog.getByRole("button", { name: "Void expense" }).click();
  await expect(dialog).toBeHidden();
  await expect(sheet.getByText("Duplicate of a card charge")).toBeVisible();
});

test("a receipt the system can't place waits for a person, who puts it in the books", async ({ page, isMobile }) => {
  test.skip(isMobile, "the office screens are checked on desktop");
  const api = await adminApi();
  const truckId = await newTruck(api);
  // Spent before the truck was registered: no ownership on record for that date.
  const total = uniqueAmount("6", "40");
  await waitForExpense(api, await confirmedReceipt(api, truckId, total, new Date(Date.now() - 86_400_000)));

  await signIn(page, ADMIN);
  await page.goto(`${WEB}/finance/expenses`);
  // A router starts on the queue.
  await expect(page.getByRole("button", { name: "Needs routing" })).toHaveAttribute("aria-pressed", "true", {
    timeout: 60_000,
  });
  const row = page.getByRole("button", { name: amountPattern(total) });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText("No owner on record for that date");

  await row.click();
  const sheet = page.getByRole("dialog", { name: "Expense" });
  await sheet.getByRole("button", { name: "Put in company books" }).click();
  const dialog = page.getByRole("dialog", { name: "Put in the company books" });
  await dialog.getByLabel(/Reason/).fill("Bought for this truck before it was registered");
  await dialog.getByRole("button", { name: "Put in books" }).click();
  await expect(dialog).toBeHidden();
  await expect(sheet.getByText("Routed by a person")).toBeVisible();
});

test("an owner-operator's receipt lands in their private ledger, which they can dismiss from", async ({ page }) => {
  const api = await adminApi();
  const driverToken = await login(DRIVER);
  const driverId = userIdOf(driverToken);
  const truckId = await newTruck(api, {
    ownershipType: "OWNER_OPERATOR",
    legalOwner: { type: "USER", userId: driverId },
  });
  const total = uniqueAmount("1", "99");
  await waitForLedgerEntry(driverToken, await confirmedReceipt(api, truckId, total, new Date()));

  await signIn(page, DRIVER);
  await page.goto(`${WEB}/driver/ledger`);
  await expect(page.getByRole("heading", { name: "My truck ledger" })).toBeVisible({ timeout: 60_000 });
  const entry = page.getByRole("listitem").filter({ hasText: `$${total}` });
  await expect(entry).toBeVisible({ timeout: 30_000 });
  await expect(entry).toContainText("via");

  await entry.getByRole("button", { name: "Not mine" }).click();
  const dialog = page.getByRole("dialog", { name: "This isn't my expense" });
  await dialog.getByLabel(/Reason/).fill("I sold this truck last month");
  await dialog.getByRole("button", { name: "Dismiss" }).click();
  await expect(dialog).toBeHidden();
  await expect(entry).toContainText("Dismissed");

  // The phone layout fits without a sideways scroll.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
