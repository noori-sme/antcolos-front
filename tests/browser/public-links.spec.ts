import { expect, test } from "@playwright/test";

/**
 * Public links are for people who have no Antcolos account: a shipper with a
 * tracking link, a broker opening a shared profile, a chat app fetching the
 * preview image. None of them may be bounced to /sign-in, by the middleware
 * (server) or by the session provider (client).
 */

const PUBLIC_PAGES = ["/track/demo-token", "/shared/demo-token", "/profile/demo"];

for (const path of PUBLIC_PAGES) {
  test(`a signed-out visitor stays on ${path}`, async ({ page, context }) => {
    await context.clearCookies();
    await page.goto(path, { waitUntil: "networkidle" });
    expect(new URL(page.url()).pathname).toBe(path);
  });
}

test("an expired session cookie does not bounce a public page to sign-in", async ({ page, context }) => {
  // A former user's stale token: /auth/me would 401, and the interceptor
  // sends anyone who loads the session to /sign-in.
  await context.clearCookies();
  await context.addCookies([
    { name: "antcolos_token", value: "expired-token", domain: "localhost", path: "/" },
  ]);
  await page.goto("/track/demo-token", { waitUntil: "networkidle" });
  expect(new URL(page.url()).pathname).toBe("/track/demo-token");
});

test("the profile preview image is served, not redirected to sign-in", async ({ request }) => {
  const res = await request.get("/profile/demo/opengraph-image", { maxRedirects: 0 });
  expect(res.status()).not.toBe(307);
  expect(res.headers()["location"] ?? "").not.toContain("/sign-in");
});

test("a signed-out visitor to a product page is still sent to sign-in", async ({ page, context }) => {
  await context.clearCookies();
  await page.goto("/home", { waitUntil: "networkidle" });
  expect(new URL(page.url()).pathname).toBe("/sign-in");
});
