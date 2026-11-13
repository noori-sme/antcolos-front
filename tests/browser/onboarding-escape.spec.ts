import { expect, test, type Page } from "@playwright/test";

/**
 * A mid-onboarding session must never trap the person on /onboarding.
 *
 * The bug: a carrier owner sends the verification link, opens it on another
 * device (which creates the organization there), and the first device keeps
 * its onboarding token and `antcolos_next_step=verify-carrier`. Middleware then
 * redirected every page, /sign-in and /sign-up included, back to the
 * onboarding step, so there was no way to sign in again.
 *
 * Expected: /sign-in and /sign-up are always reachable. Opening them drops the
 * abandoned onboarding session; signing in again gets the current next step
 * from the backend. The one exception is the username step, which lives on
 * /sign-up itself and must keep its session.
 */

async function startOnboarding(page: Page, baseURL: string, nextStep: string) {
  await page.context().addCookies([
    { name: "antcolos_token", value: "onboarding-jwt", url: baseURL },
    { name: "antcolos_next_step", value: nextStep, url: baseURL },
  ]);
}

async function cookie(page: Page, name: string) {
  return (await page.context().cookies()).find((c) => c.name === name)?.value;
}

for (const nextStep of ["verify-carrier", "carrier-onboarding", "select-role", "company-details"]) {
  for (const path of ["/sign-in", "/sign-up"]) {
    test(`${path} is reachable mid-onboarding (${nextStep}) and drops the stale session`, async ({ page, baseURL }) => {
      await startOnboarding(page, baseURL!, nextStep);

      await page.goto(path);

      await expect.poll(() => cookie(page, "antcolos_next_step")).toBeUndefined();
      expect(new URL(page.url()).pathname).toBe(path);
      expect(await cookie(page, "antcolos_token")).toBeUndefined();
    });
  }
}

test("the username step keeps its session on /sign-up", async ({ page, baseURL }) => {
  await startOnboarding(page, baseURL!, "choose-username");

  await page.goto("/sign-up");

  await expect(page.getByLabel(/username/i).first()).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/sign-up");
  expect(await cookie(page, "antcolos_next_step")).toBe("choose-username");
  expect(await cookie(page, "antcolos_token")).toBe("onboarding-jwt");
});

test("app pages still send a mid-onboarding session back to its step", async ({ page, baseURL }) => {
  await startOnboarding(page, baseURL!, "verify-carrier");

  await page.goto("/home");

  await expect(page).toHaveURL(/\/onboarding\?step=verify-carrier/);
  expect(await cookie(page, "antcolos_next_step")).toBe("verify-carrier");
});

test("the carrier step links back to sign-in for a link opened elsewhere", async ({ page, baseURL }) => {
  await startOnboarding(page, baseURL!, "verify-carrier");
  await page.goto("/onboarding?step=verify-carrier");

  await page.getByRole("link", { name: "Sign in again" }).click();

  await expect(page).toHaveURL(/\/sign-in$/);
  await expect.poll(() => cookie(page, "antcolos_next_step")).toBeUndefined();
  await expect(page.getByLabel(/email/i).first()).toBeVisible();
});

test("signing in from the username step doesn't bounce a later sign-up, and keeps an invitation", async ({ page, baseURL }) => {
  await startOnboarding(page, baseURL!, "choose-username");
  await page.context().addCookies([{ name: "antcolos_invitation_token", value: "invite-123", url: baseURL! }]);
  await page.goto("/sign-up");
  await page.evaluate(() => sessionStorage.setItem("antcolos_signup_step", "username"));

  await page.goto("/sign-in");
  await expect.poll(() => cookie(page, "antcolos_token")).toBeUndefined();
  expect(await cookie(page, "antcolos_invitation_token")).toBe("invite-123");

  await page.goto("/sign-up");
  await expect(page.getByLabel(/email/i).first()).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/sign-up");
});
