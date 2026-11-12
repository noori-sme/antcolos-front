import { expect, test, type Page } from "@playwright/test";

/**
 * The shell in http mode against the REAL API (plan 08): the session shows
 * the real organization, the sidebar lists only routes with a backend, and a
 * mock-only route says "not available yet" instead of an adapter error.
 *
 * Needs a build with NEXT_PUBLIC_API_MODE=http talking to the seeded API:
 *
 *   NEXT_PUBLIC_API_MODE=http NEXT_PUBLIC_DEMO_AREAS=off npm run build && npx next start -p 3000
 *   LIVE_WEB_URL=http://localhost:3000 LIVE_DEMO_AREAS=off npx playwright test \
 *     tests/browser/http-shell.live.spec.ts --project=desktop
 *
 * Skipped unless LIVE_WEB_URL is set, so CI (mock mode, no backend) never runs it.
 * Demo areas (plan 10) are on by default and bring the hidden areas back, so
 * this spec needs a build with them off; `demo-areas.live.spec.ts` covers "on".
 */
const WEB = process.env.LIVE_WEB_URL;
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "Welcome@123";

test.skip(!WEB, "needs the full stack (set LIVE_WEB_URL); see the header comment");
test.skip(process.env.LIVE_DEMO_AREAS !== "off", "needs a build with demo areas off (plan 10)");

async function signIn(page: Page, email: string) {
  await page.goto(`${WEB}/sign-in`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await page.waitForURL((u) => u.pathname === "/home");
}

test("a carrier admin sees their real organization and only live areas", async ({ page }) => {
  // No background call may reach a mock-only adapter (e.g. the Needs You count).
  const adapterErrors: string[] = [];
  page.on("console", (m) => {
    if (/HTTP adapter not implemented/.test(m.text())) adapterErrors.push(m.text().slice(0, 120));
  });
  await signIn(page, "carrier@antcolos.dev");

  // Real organization from /users/me/memberships, not the Northline fixture.
  await expect(page.getByRole("main").getByText(/Acme Haulage · Admin/)).toBeVisible();
  await expect(page.getByText("Northline Freight")).toHaveCount(0);

  // The live home lists the live areas and nothing mock-only.
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: "Trucks" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Drivers" })).toBeVisible();
  await expect(main.getByText(/HTTP adapter not implemented/)).toHaveCount(0);

  // The sidebar drops mock-only areas.
  for (const name of ["Needs You", "Loads", "Settlements", "Invoices", "Documents"]) {
    await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
  }

  await page.getByRole("main").getByRole("link", { name: "Trucks" }).click();
  await page.waitForLoadState("networkidle");
  expect(adapterErrors).toEqual([]);
});

test("a mock-only deep link says it isn't available yet", async ({ page }) => {
  await signIn(page, "carrier@antcolos.dev");
  await page.goto(`${WEB}/loads`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "This area isn't available yet" })).toBeVisible();
  await expect(page.getByText(/HTTP adapter not implemented/)).toHaveCount(0);
});

test("if the organization can't be loaded, home says so and retries", async ({ page }) => {
  let fail = true;
  await page.route("**/users/me/memberships", (route) =>
    fail
      ? route.fulfill({ status: 500, contentType: "application/json", body: '{"statusCode":500}' })
      : route.continue(),
  );
  await signIn(page, "carrier@antcolos.dev");
  const error = page.getByText("We couldn't load your organization");
  await expect(error).toBeVisible({ timeout: 30_000 });

  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("main").getByText(/Acme Haulage · Admin/)).toBeVisible();
  await expect(error).toHaveCount(0);
});

test("a live area still loads real data", async ({ page }) => {
  await signIn(page, "carrier@antcolos.dev");
  const trucks = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith("/trucks") && r.request().method() === "GET");
  await page.getByRole("main").getByRole("link", { name: "Trucks" }).click();
  expect((await trucks).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Trucks" })).toBeVisible();
});

// Individual accounts have no organization, so no /users/me/permissions (tenant-only by
// contract). Signing in used to call it, get a 403 and log the person straight out.
for (const email of ["dispatcher@antcolos.dev", "driver@antcolos.dev"]) {
  test(`an individual account (${email}) signs in and stays signed in`, async ({ page }) => {
    const permissionCalls: string[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname.endsWith("/users/me/permissions")) permissionCalls.push(r.url());
    });
    await signIn(page, email);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);
    expect(new URL(page.url()).pathname).not.toBe("/sign-in");
    expect(permissionCalls).toEqual([]);
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "antcolos_token")).toBeTruthy();
  });
}
