import { expect, test, type Page } from "@playwright/test";

/**
 * The access screens against the REAL identity API (plan 01).
 *
 * Needs the full stack from ../antcolos/docs/ai/fullstack.md: the seeded
 * NestJS API on :3000 and this app in http mode, e.g.
 *   NEXT_PUBLIC_API_MODE=http NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1 npm run dev -- -p 3001
 *   LIVE_WEB_URL=http://localhost:3001 LIVE_API_URL=http://localhost:3000/api/v1 \
 *     npx playwright test tests/browser/access-integration.live.spec.ts --project=desktop
 *
 * Playwright serves the app on :3100, so start the API with that origin allowed
 * (process env, not the .env file): CORS_ORIGINS=http://localhost:3100 npm run start:dev
 *
 * Skipped unless LIVE_WEB_URL is set, so CI (mock mode, no backend) never runs it.
 */
const WEB = process.env.LIVE_WEB_URL;
const API = process.env.LIVE_API_URL ?? "http://localhost:3000/api/v1";
const ADMIN = { email: "carrier@antcolos.dev", password: process.env.SEED_DEMO_PASSWORD ?? "Welcome@123" };

test.skip(!WEB, "needs the full stack (set LIVE_WEB_URL); see the header comment");

async function signIn(page: Page) {
  await page.goto(`${WEB}/sign-in`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill(ADMIN.email);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
}

async function apiToken(page: Page): Promise<string> {
  const res = await page.request.post(`${API}/auth/login`, { data: ADMIN });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  return body.accessToken ?? body.data?.accessToken;
}

test("an invitation sent through the API is listed, and Revoke cancels it", async ({ page }) => {
  const token = await apiToken(page);
  const stamp = Date.now();
  const email = `live.revoke.${stamp}@example.com`;
  const created = await page.request.post(`${API}/organizations/invitations`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { email, firstName: "Live", lastName: `Spec${stamp}`, roleId: "DRIVER" },
  });
  expect(created.status()).toBe(201);

  await signIn(page);
  await page.goto(`${WEB}/settings/invitations`, { waitUntil: "networkidle" });
  const row = page.getByRole("listitem").filter({ hasText: email });
  await expect(row).toBeVisible();
  await expect(row.getByText("Pending", { exact: true })).toBeVisible();

  await row.getByRole("button", { name: /^Revoke invitation/ }).click();
  const confirm = page.getByRole("dialog").getByRole("button", { name: /Revoke/ });
  if (await confirm.count()) await confirm.click();

  await expect(row.getByText("Revoked", { exact: true })).toBeVisible();
  // A revoked invitation can be neither revoked nor resent again.
  await expect(row.getByRole("button", { name: /^(Revoke|Resend) invitation/ })).toHaveCount(0);
});

test("the roles screen lists the system roles from the API", async ({ page }) => {
  await signIn(page);
  await page.goto(`${WEB}/settings/permissions`, { waitUntil: "networkidle" });
  for (const name of ["Admin", "Dispatcher", "Driver"]) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }
});

test("a custom role created through the API appears, and Delete removes it", async ({ page }) => {
  const token = await apiToken(page);
  const name = `Live role ${Date.now()}`;
  const created = await page.request.post(`${API}/organizations/roles`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, description: "live spec", permissions: ["load.read"] },
  });
  expect(created.status()).toBe(201);

  await signIn(page);
  await page.goto(`${WEB}/settings/permissions`, { waitUntil: "networkidle" });
  const row = page.getByRole("listitem").filter({ hasText: name });
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: /Delete/ }).click();
  const confirm = page.getByRole("dialog").getByRole("button", { name: /Delete/ });
  if (await confirm.count()) await confirm.click();
  await expect(page.getByRole("listitem").filter({ hasText: name })).toHaveCount(0);
});
