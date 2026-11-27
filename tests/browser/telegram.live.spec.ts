import { expect, test, type Page } from "@playwright/test";

/**
 * Telegram connection, truck groups and member role change against the REAL API (plan 29;
 * backend plan 52). Non-destructive on purpose: staging's demo admin has a real Telegram link
 * and a linked truck group, so dialogs are opened and cancelled, never confirmed.
 *
 *   LIVE_WEB_URL=https://antcolos-front.vercel.app SEED_DEMO_PASSWORD=… \
 *     npx playwright test tests/browser/telegram.live.spec.ts
 *
 * Skipped unless LIVE_WEB_URL is set, so CI (mock mode, no backend) never runs it.
 */
const WEB = process.env.LIVE_WEB_URL;
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "Welcome@123";

test.skip(!WEB, "needs the full stack (set LIVE_WEB_URL); see the header comment");

async function signIn(page: Page, email: string) {
  await page.goto(`${WEB}/sign-in`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
}

const noSideScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

test("Notifications shows your Telegram connection; a new code has a deep link and a countdown", async ({ page }) => {
  await signIn(page, "carrier@antcolos.dev");
  await page.goto(`${WEB}/account/notifications`);
  const card = page.getByRole("region", { name: "Telegram" });
  await expect(card).toBeVisible({ timeout: 60_000 });

  const connected = card.getByText(/^Connected/);
  await expect(connected.or(card.getByRole("button", { name: "Connect Telegram" }))).toBeVisible();
  if (await connected.isVisible()) {
    // Opened and cancelled: the real link stays.
    await card.getByRole("button", { name: "Disconnect" }).click();
    const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
    await expect(dialog.getByText(/for all your companies/)).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(connected).toBeVisible();
  } else {
    await card.getByRole("button", { name: "Connect Telegram" }).click();
    await expect(card.getByRole("link", { name: /Open Telegram and tap Start/ })).toHaveAttribute(
      "href",
      /^https:\/\/t\.me\/.+\?start=/,
    );
    await expect(card.getByText(/Expires in \d+:\d\d/)).toBeVisible();
  }
  await noSideScroll(page);
});

test("Integrations lists the truck groups; Unlink asks first", async ({ page }) => {
  await signIn(page, "carrier@antcolos.dev");
  await page.goto(`${WEB}/settings/integrations`);
  await expect(page.getByRole("heading", { name: "Telegram truck groups" })).toBeVisible({ timeout: 60_000 });
  const linked = page.getByRole("listitem").filter({ hasText: /linked .* by / }).first();
  await expect(linked).toBeVisible();
  await linked.getByRole("button", { name: "Unlink" }).click();
  const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
  await expect(dialog.getByText(/stops posting/)).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(linked).toBeVisible();
  await noSideScroll(page);
});

test("Members offers Change role on others, never on yourself", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await signIn(page, "carrier@antcolos.dev");
  await page.goto(`${WEB}/settings/users`);
  const self = page.getByRole("listitem").filter({ hasText: "(you)" });
  await expect(self).toBeVisible({ timeout: 60_000 });
  await expect(self.getByRole("button", { name: "Change role" })).toHaveCount(0);

  const other = page.getByRole("listitem").filter({ hasNotText: "(you)" }).first();
  await other.getByRole("button", { name: "Change role" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("(current)")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save role" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
});
