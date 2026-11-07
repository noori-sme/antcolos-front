import { expect, test } from "@playwright/test";

/**
 * Sign-in and sign-up against the REAL auth API (plan 05, F0.4): the screens
 * now call `lib/session/auth-api.ts`, so this checks the requests they send
 * and that the flows still land where they did.
 *
 * Needs the seeded NestJS API and this app in http mode (see
 * access-integration.live.spec.ts for the commands).
 *
 *   LIVE_WEB_URL=http://localhost:3001 npx playwright test \
 *     tests/browser/auth-flow.live.spec.ts --project=desktop
 *
 * Skipped unless LIVE_WEB_URL is set, so CI (mock mode, no backend) never runs it.
 */
const WEB = process.env.LIVE_WEB_URL;
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "Welcome@123";

test.skip(!WEB, "needs the full stack (set LIVE_WEB_URL); see the header comment");

const isPost = (path: string) => (r: { method(): string; url(): string }) =>
  r.method() === "POST" && new URL(r.url()).pathname.endsWith(path);

test("a carrier admin signs in and lands on home", async ({ page }) => {
  await page.goto(`${WEB}/sign-in`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill("Carrier@Antcolos.dev");
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  const login = page.waitForRequest(isPost("/auth/login"));
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  expect((await login).postDataJSON()).toEqual({ email: "carrier@antcolos.dev", password: PASSWORD });
  await page.waitForURL((u) => u.pathname === "/home");
});

test("a wrong password is refused on the sign-in screen", async ({ page }) => {
  await page.goto(`${WEB}/sign-in`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill("carrier@antcolos.dev");
  await page.getByLabel("Password", { exact: true }).fill("not-the-password");
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/sign-in");
});

test("sign up, then resend the verification link", async ({ page }) => {
  const email = `auth-live-${Date.now()}@example.com`;
  await page.goto(`${WEB}/sign-up`, { waitUntil: "networkidle" });
  await page.getByLabel(/^First name/).fill("Casey");
  await page.getByLabel(/^Last name/).fill("Live");
  await page.getByLabel(/^Email address/).fill(email);
  await page.getByLabel(/^Password/).fill("Welcome@123!a");
  await page.getByLabel(/^Confirm password/).fill("Welcome@123!a");
  const signup = page.waitForRequest(isPost("/auth/signup"));
  await page.getByRole("button", { name: "Create Account" }).click();
  expect((await signup).postDataJSON()).toMatchObject({ firstName: "Casey", lastName: "Live", email });
  await expect(page.getByText(email)).toBeVisible();

  const resend = page.waitForRequest(isPost("/auth/resend-verification"));
  await page.getByRole("button", { name: "Resend verification link" }).click();
  expect((await resend).postDataJSON()).toEqual({ email });
  await expect(page.getByText(/Link sent! Resend in/)).toBeVisible();
});
