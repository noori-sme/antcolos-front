import { expect, test, type Page } from "@playwright/test";

/**
 * The landing page, as a visitor with no account actually meets it.
 *
 * Three claims, and they are all claims about a rendered page: the brand is
 * there, the two doors are there and they are real links, and a phone can see
 * both of them without scrolling sideways. The runs on desktop and on a phone
 * viewport are the same file — what differs is only what the viewport proves.
 */

async function settled(page: Page) {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

const signIn = (page: Page) => page.getByRole("link", { name: "Sign in", exact: true });
const signUp = (page: Page) => page.getByRole("link", { name: "Sign up", exact: true });

test("shows the Antcolos name and nothing that needs an account", async ({ page }) => {
  await settled(page);

  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(/Antcolos/i);
  // No product shell leaks onto a page that has no session behind it.
  await expect(page.getByRole("navigation")).toHaveCount(0);
});

test("offers Sign in and Sign up as real links to the existing routes", async ({ page }) => {
  await settled(page);

  await expect(signIn(page)).toHaveAttribute("href", "/sign-in");
  await expect(signUp(page)).toHaveAttribute("href", "/sign-up");
});

test("Sign in reaches the sign in screen", async ({ page }) => {
  await settled(page);

  await signIn(page).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: /Sign in to Antcolos/i })).toBeVisible();
});

test("Sign up reaches the sign up screen", async ({ page }) => {
  await settled(page);

  await signUp(page).click();
  await expect(page).toHaveURL(/\/sign-up$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("both doors are visible at once, at any width", async ({ page }) => {
  await settled(page);

  await expect(signIn(page)).toBeInViewport();
  await expect(signUp(page)).toBeInViewport();

  const overflow = await page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollWidth - d.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
});
