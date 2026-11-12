import { expect, test, type Page } from "@playwright/test";

/**
 * Account → Profile against the REAL API (plan 11): read `/users/me`, edit the
 * headline and "about me", add and remove a profile picture, and see the
 * picture in the top bar.
 *
 *   NEXT_PUBLIC_API_MODE=http npm run build && npx next start -p 3000
 *   LIVE_WEB_URL=http://localhost:3000 npx playwright test tests/browser/self-profile.live.spec.ts
 *
 * Skipped unless LIVE_WEB_URL is set, so CI (mock mode, no backend) never runs it.
 * It edits the seeded carrier admin's own profile and puts it back.
 */
const WEB = process.env.LIVE_WEB_URL;
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "Welcome@123";
const EMAIL = process.env.LIVE_CARRIER_EMAIL ?? "carrier@antcolos.dev";

test.skip(!WEB, "needs the full stack (set LIVE_WEB_URL); see the header comment");

// A 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function signIn(page: Page) {
  await page.goto(`${WEB}/sign-in`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await page.waitForURL((u) => u.pathname === "/home");
}

test("edits the headline and about me, then clears them", async ({ page }) => {
  await signIn(page);
  await page.goto(`${WEB}/account/profile`, { waitUntil: "networkidle" });
  const main = page.getByRole("main");
  await expect(main.getByText(EMAIL)).toBeVisible();
  await expect(page.getByText("This area isn't available yet")).toHaveCount(0);

  const headline = `Fleet admin ${Date.now() % 100000}`;
  await main.getByRole("button", { name: "Edit profile" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Headline").fill(headline);
  await dialog.getByLabel("About me").fill("Runs the trucks.\nAnswers the phone.");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(main.getByText(headline)).toBeVisible();

  // It came from the backend, not just the cache.
  await page.reload({ waitUntil: "networkidle" });
  await expect(main.getByText(headline)).toBeVisible();
  await expect(main.getByText("Answers the phone.")).toBeVisible();

  // Emptying both fields clears them (sent as null).
  await main.getByRole("button", { name: "Edit profile" }).click();
  await dialog.getByLabel("About me").fill("");
  await dialog.getByLabel("Headline").fill("");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(main.getByText("No headline yet")).toBeVisible();
});

test("adds a picture, shows it in the top bar, and removes it", async ({ page }) => {
  await signIn(page);
  await page.goto(`${WEB}/account/profile`, { waitUntil: "networkidle" });
  const main = page.getByRole("main");

  await page.getByLabel("Choose a profile picture").setInputFiles({
    name: "me.png", mimeType: "image/png", buffer: PNG,
  });
  await expect(main.getByRole("img", { name: "Your profile picture" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Account menu" }).locator("img")).toBeVisible();

  // A wrong type is refused before upload.
  await page.getByLabel("Choose a profile picture").setInputFiles({
    name: "me.gif", mimeType: "image/gif", buffer: PNG,
  });
  await expect(main.getByText("Choose a JPEG, PNG or WebP image.")).toBeVisible();

  await main.getByRole("button", { name: "Remove picture" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click();
  await expect(main.getByRole("img", { name: "Your profile picture" })).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Add picture" })).toBeVisible();
});

test("has no sideways scroll on a phone", async ({ page }) => {
  await signIn(page);
  await page.goto(`${WEB}/account/profile`, { waitUntil: "networkidle" });
  await expect(page.getByRole("main").getByText(EMAIL)).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
