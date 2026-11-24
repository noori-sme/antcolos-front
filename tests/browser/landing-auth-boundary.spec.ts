import { expect, test, type Page } from "@playwright/test";

/**
 * Where the landing page ENDS.
 *
 * The landing page's whole job is to hand someone to Sign In or Sign Up. What
 * happens after that — verification, the username, the password, how you say
 * you will use Antcolos, an invitation waiting for you, where a signed-in
 * person lands — was already built and already works, and this file is the
 * fence around it: it walks the flows past the handover and asserts they behave
 * exactly as they did before the landing page existed.
 *
 * Nothing here tests the landing page's looks. `landing.spec.ts` does that.
 */

async function landing(page: Page) {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test("the landing page opens exactly two doors, and both are auth routes", async ({ page }) => {
  await landing(page);

  const links = page.getByRole("link");
  await expect(links).toHaveCount(2);
  await expect(links.nth(0)).toHaveAttribute("href", "/sign-in");
  await expect(links.nth(1)).toHaveAttribute("href", "/sign-up");

  // Nothing on this page reaches past the two doors — not onboarding, not an
  // invitation, not the product.
  for (const beyond of ["/onboarding", "/invitation", "/invite", "/home", "/work"]) {
    await expect(page.locator(`a[href^="${beyond}"]`)).toHaveCount(0);
  }
});

test("Sign in enters /sign-in and stays there", async ({ page }) => {
  await landing(page);
  await page.getByRole("link", { name: "Sign in", exact: true }).click();

  // Exactly the route, with nothing appended: no query, no hash, no onward hop.
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Sign in to Antcolos" })).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page).toHaveURL(/\/sign-in$/);

  // The screen's own exits are untouched.
  await expect(page.getByRole("link", { name: "Create an account" })).toHaveAttribute(
    "href",
    "/sign-up",
  );
  await expect(page.getByRole("link", { name: "Forgot password?" })).toHaveAttribute(
    "href",
    "/forgot-password",
  );
});

test("Sign up enters /sign-up at step one of the existing three", async ({ page }) => {
  await landing(page);
  await page.getByRole("link", { name: "Sign up", exact: true }).click();

  await expect(page).toHaveURL(/\/sign-up$/);
  await expect(page.getByRole("heading", { name: "Create your Antcolos account" })).toBeVisible();
  // Arriving from the landing page starts the flow at the beginning — it does
  // not skip a step or pre-fill one.
  await expect(page.getByText("Step 1 of 3")).toBeVisible();
  await expect(page.getByLabel("Email address")).toHaveValue("");
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
});

test("arriving from the landing page carries no invitation", async ({ page }) => {
  await landing(page);
  await page.getByRole("link", { name: "Sign in", exact: true }).click();

  await expect(page.getByText("Sign in to accept your invitation.")).toHaveCount(0);
});

// Moved to auth-flow.live.spec.ts: sign-in only exists against the real API.

// Covered by auth-flow.live.spec.ts ("a carrier admin signs in and lands on home").

// Covered by auth-flow.live.spec.ts ("a wrong password is refused on the sign-in screen").

test("role selection still asks how you will use Antcolos", async ({ page }) => {
  // Onboarding is reached by finishing Sign Up, never from the landing page.
  await page.goto("/onboarding", { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "How will you use Antcolos?" })).toBeVisible();
  for (const role of ["Carrier owner", "Driver", "Dispatch organization"]) {
    await expect(page.getByRole("button", { name: new RegExp(role) })).toBeVisible();
  }
});
