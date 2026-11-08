import { expect, test, type Page } from "@playwright/test";

/**
 * The carrier verification link (plan 07): `/verify-carrier?token=…`, emailed
 * to the carrier's FMCSA-registered address.
 *
 * Runs in mock mode with no backend: `POST /auth/verify-carrier` is stubbed
 * with `page.route`, using the response shapes from
 * `../antcolos/docs/requirements/carrier-onboarding.md` §3.
 */

const TENANT_SESSION = {
  user: {
    id: "3f2a1c4e-7b8d-4a21-9c0e-1f2a3b4c5d6e",
    email: "taylor@example.com",
    name: "Taylor Morgan",
    username: "taylormorgan",
    scope: "tenant",
    organizationId: "9b1d2c3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e",
    organizationType: "CARRIER",
    role: "ADMIN",
  },
  accessToken: "tenant-jwt-for-test",
};

async function stubVerify(page: Page, status: number, body: unknown) {
  const requests: unknown[] = [];
  await page.route("**/auth/verify-carrier", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  return requests;
}

test("a valid link verifies the carrier once and offers the workspace", async ({ page }) => {
  const requests = await stubVerify(page, 201, TENANT_SESSION);

  await page.goto("/verify-carrier?token=raw-token-123");

  await expect(page.getByRole("heading", { name: "Carrier verified" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Go to your workspace" })).toBeVisible();
  expect(requests).toEqual([{ token: "raw-token-123" }]);

  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === "antcolos_token")?.value).toBe("tenant-jwt-for-test");
  expect(cookies.find((c) => c.name === "antcolos_next_step")).toBeUndefined();
});

test("a mid-onboarding session can open the link without being redirected", async ({ page, baseURL }) => {
  await page.context().addCookies([
    { name: "antcolos_token", value: "onboarding-jwt", url: baseURL! },
    { name: "antcolos_next_step", value: "verify-carrier", url: baseURL! },
  ]);
  const requests = await stubVerify(page, 201, TENANT_SESSION);

  await page.goto("/verify-carrier?token=raw-token-456");

  await expect(page.getByRole("heading", { name: "Carrier verified" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/verify-carrier");
  expect(requests).toEqual([{ token: "raw-token-456" }]);
});

test("an expired link shows the backend's reason and the way back", async ({ page }) => {
  await stubVerify(page, 400, {
    statusCode: 400,
    error: "Bad Request",
    message: "Carrier verification token is invalid or expired",
  });

  await page.goto("/verify-carrier?token=old-token");

  // Next adds its own empty role="alert" route announcer; pick the form alert.
  const alert = page.getByRole("alert").filter({ hasText: "We couldn't verify your carrier" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/invalid or expired/i);
  await expect(page.getByRole("link", { name: "Back to onboarding" })).toHaveAttribute(
    "href",
    "/onboarding?step=verify-carrier",
  );
});

test("a link without a token asks for the email link again and calls nothing", async ({ page }) => {
  const requests = await stubVerify(page, 201, TENANT_SESSION);

  await page.goto("/verify-carrier");

  await expect(page.getByRole("alert").filter({ hasText: "This link is incomplete" })).toBeVisible();
  expect(requests).toEqual([]);
});
