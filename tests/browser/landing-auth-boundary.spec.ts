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

/** The mock backend accepts this password and no other. */
const DEMO_PASSWORD = "Antcolos1!";
/** An invitation code the mock recognizes. */
const DEMO_INVITATION = "DISPATCH-2026";

async function landing(page: Page) {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

async function signInWith(page: Page, password: string) {
  await page.getByLabel("Email address").fill("sam@baxtertransit.com");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
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

test("Sign up enters /sign-up at step one of the existing four", async ({ page }) => {
  await landing(page);
  await page.getByRole("link", { name: "Sign up", exact: true }).click();

  await expect(page).toHaveURL(/\/sign-up$/);
  await expect(page.getByRole("heading", { name: "Create your Antcolos account" })).toBeVisible();
  // Arriving from the landing page starts the flow at the beginning — it does
  // not skip a step or pre-fill one.
  await expect(page.getByText("Step 1 of 4")).toBeVisible();
  await expect(page.getByLabel("Email address")).toHaveValue("");
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
});

test("arriving from the landing page carries no invitation", async ({ page }) => {
  await landing(page);
  await page.getByRole("link", { name: "Sign in", exact: true }).click();

  await expect(page.getByText("Sign in to accept your invitation.")).toHaveCount(0);
});

test("an invitation still rides through Sign In, exactly as before", async ({ page }) => {
  // Not reached from the landing page — this is the invitation link's own path,
  // checked here to prove the landing page did not disturb it.
  await page.goto(`/sign-in?invitation=${DEMO_INVITATION}`, { waitUntil: "networkidle" });

  await expect(page.getByText("Sign in to accept your invitation.")).toBeVisible();
  await signInWith(page, DEMO_PASSWORD);
  // The token rides through; `signedin=1` does not, because it decided nothing
  // and acceptance is authorized on the signed-in account instead.
  await expect(page).toHaveURL(`/invitation/${DEMO_INVITATION}`);
});

test("post-authentication routing still ends at the product", async ({ page }) => {
  await landing(page);
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in to Antcolos" })).toBeVisible();

  await signInWith(page, DEMO_PASSWORD);
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
});

test("a wrong password still fails the same way, and goes nowhere", async ({ page }) => {
  await landing(page);
  await page.getByRole("link", { name: "Sign in", exact: true }).click();

  await signInWith(page, "not-the-password");
  await expect(page.getByText(/Email or password is incorrect/)).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("role selection still asks how you will use Antcolos", async ({ page }) => {
  // Onboarding is reached by finishing Sign Up, never from the landing page.
  await page.goto("/onboarding", { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "How will you use Antcolos?" })).toBeVisible();
  for (const role of ["Carrier owner", "Driver", "Dispatch organization"]) {
    await expect(page.getByRole("button", { name: new RegExp(role) })).toBeVisible();
  }
});
