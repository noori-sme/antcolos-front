import { expect, test, type Page } from "@playwright/test";

/**
 * The case the demo account can never prove: somebody who belongs to nothing.
 *
 * The seeded session is one person with seven memberships, a driver profile and
 * years of paperwork — useful for reviewing the product, useless for proving
 * that a driver can arrive from nowhere. `?fixture=newcomer` boots the app as a
 * signed-in person with no membership, no organization, no carrier
 * relationship and no driver profile, which is the state every real driver
 * starts in. It is a fixture switch, not a login and not a permission.
 *
 * MOCK PERSISTENCE: profiles, relationships and documents live in memory for
 * one page load. Everything below therefore moves through the app the way a
 * person does — by clicking — and reloads only where the point IS the reload.
 */

const NEWCOMER = "?fixture=newcomer";
const GOOD_CODE = "123456";

async function fillCode(page: Page, code: string) {
  for (const [index, digit] of [...code].entries()) {
    await page.getByLabel(`Digit ${index + 1} of 6`).fill(digit);
  }
}

/** The whole self-onboarding, as a person with nothing does it. */
async function onboardAsDriver(page: Page) {
  await page.goto(`/onboarding${NEWCOMER}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "How will you use Antcolos?" })).toBeVisible();

  await page.getByRole("button", { name: /^Driver/ }).click();
  await expect(page.getByRole("heading", { name: "Set up your driver account" })).toBeVisible();

  await page.getByRole("button", { name: /Send verification code/ }).click();
  await expect(page.getByRole("heading", { name: "Confirm your work email" })).toBeVisible();
  await fillCode(page, GOOD_CODE);
  await page.getByRole("button", { name: /Verify my email/ }).click();

  // A person with no profile answers the licence questions — once.
  await expect(page.getByRole("heading", { name: "Your licence" })).toBeVisible();
  await page.getByLabel("Full legal name").fill("Alex Rivera");
  await page.getByLabel("Driver license / CDL number").fill("A1234567");
  await page.getByLabel("Issuing state").selectOption("TX");
  await page.getByLabel("License expiration date").fill("2030-04-01");
  await page.getByRole("button", { name: /Create my driver profile/ }).click();

  await expect(page).toHaveURL(/\/driver\/home(\?.*)?$/);
  await expect(page.getByRole("heading", { name: "Hi Alex" })).toBeVisible();
}

/**
 * Navigate the way a person does — by clicking, never by reloading, because the
 * mock forgets everything a reload throws away. A phone keeps most of the nav
 * behind "More", so open that first when the link is not on the tab bar.
 */
async function navTo(page: Page, name: string) {
  const link = page.getByRole("link", { name, exact: true });
  if ((await link.count()) === 0) {
    await page.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  }
  await link.first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

/** The workspace switcher, wherever this viewport keeps it. */
async function expectNoOrganization(page: Page) {
  const switcher = page.getByRole("button", { name: /Switch organization/ });
  if ((await switcher.count()) === 0) {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  }
  await expect(switcher.first()).toContainText("No organization");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("a person who belongs to nothing is sent to set themselves up", async ({ page }) => {
  await page.goto(`/home${NEWCOMER}`, { waitUntil: "networkidle" });

  // No membership and no driver profile: they have not finished setting up, so
  // they get the question, not an empty dashboard and not an error.
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "How will you use Antcolos?" })).toBeVisible();
});

test("picking Driver, verifying and answering the licence creates one profile", async ({ page }) => {
  await onboardAsDriver(page);

  await navTo(page, "My profile");
  await expect(page).toHaveURL(/\/driver\/profile$/);
  await expect(page.getByRole("heading", { name: "My driver profile" })).toBeVisible();
  await expect(page.getByText("Alex Rivera").first()).toBeVisible();
  await expect(page.getByText("alex.rivera@example.com").first()).toBeVisible();

  // One profile: one identity block, and no second one anywhere.
  await expect(page.getByRole("heading", { name: "Identity and licence" })).toHaveCount(1);
});

test("the driver portal is reachable with no carrier membership at all", async ({ page }) => {
  await onboardAsDriver(page);

  // The shell says plainly that there is no organization — it does not invent one.
  await expectNoOrganization(page);

  await navTo(page, "My documents");
  await expect(page).toHaveURL(/\/driver\/documents$/);
  await expect(page.getByRole("heading", { name: "My documents" })).toBeVisible();

  await navTo(page, "My profile");
  await expect(page).toHaveURL(/\/driver\/profile$/);

  await navTo(page, "Home");
  await expect(page).toHaveURL(/\/driver\/home$/);
  await expect(page.getByRole("heading", { name: "Hi Alex" })).toBeVisible();
});

test("no guard bounces the unattached driver back to onboarding or a carrier", async ({ page }) => {
  await onboardAsDriver(page);

  for (const link of ["My documents", "My profile", "Home"]) {
    await navTo(page, link);
    // Never the role question, and never the organization dashboard — note
    // /driver/home is the portal's own home and is exactly where they belong.
    const path = new URL(page.url()).pathname;
    expect(path).not.toBe("/onboarding");
    expect(path).not.toBe("/home");
    expect(path.startsWith("/driver/")).toBe(true);
    // The permission wall never appears: these routes ask for nothing.
    await expect(page.getByText("You don't have access to this")).toHaveCount(0);
  }
});

test("they can supply their own documents, and nobody has reviewed them", async ({ page }) => {
  await onboardAsDriver(page);
  await navTo(page, "My documents");

  await expect(
    page.getByText(/No carrier has reviewed any of these/),
  ).toBeVisible();

  const cdlFront = page
    .getByRole("listitem")
    .filter({ hasText: "Driver license / CDL — front" })
    .first();
  await cdlFront.locator('input[type="file"]').first().setInputFiles("tests/browser/files/cdl-front.jpg");

  await expect(cdlFront.getByText("cdl-front.jpg")).toBeVisible();
  await expect(cdlFront.getByText("On your profile")).toBeVisible();
  // Nobody to send it to, so nothing offers to send it.
  await expect(page.getByRole("button", { name: /Submit for review/ })).toHaveCount(0);
});

test("uploading creates no carrier, relationship or reviewer", async ({ page }) => {
  await onboardAsDriver(page);
  await navTo(page, "My documents");

  const cdlFront = page
    .getByRole("listitem")
    .filter({ hasText: "Driver license / CDL — front" })
    .first();
  await cdlFront.locator('input[type="file"]').first().setInputFiles("tests/browser/files/cdl-front.jpg");
  await expect(cdlFront.getByText("cdl-front.jpg")).toBeVisible();

  await navTo(page, "My profile");
  await expect(page.getByText("You are not working with a carrier right now")).toBeVisible();
  // Not one carrier row on the profile — current or previous.
  await expect(page.locator("li[data-carrier-id]")).toHaveCount(0);
  await expectNoOrganization(page);
});

test("moving around the portal keeps resolving to it; a reload forgets, as the mock does", async ({ page }) => {
  await onboardAsDriver(page);

  await navTo(page, "My documents");
  await navTo(page, "Home");
  await expect(page).toHaveURL(/\/driver\/home$/);

  // The honest limit: nothing is persisted beyond this page load, so a reload
  // is a person with no profile again — and the app asks them to set up rather
  // than showing an empty portal or an error.
  await page.reload({ waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "How will you use Antcolos?" })).toBeVisible();
});

test("a carrier invitation still onboards a driver who has nothing", async ({ page }) => {
  // The invitation road, walked by the same newcomer: INV-DRIVER is addressed to
  // somebody returning from signing up, which is exactly this person.
  await page.goto(`/invitation/INV-DRIVER?signedin=1&fixture=newcomer`, { waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByRole("heading", { name: "Set up your driver profile" })).toBeVisible();

  await page.getByLabel("Full legal name").fill("Yusuf Demir");
  await page.getByLabel("Driver license / CDL number").fill("K4471182993");
  await page.getByLabel("Issuing state").selectOption("TX");
  await page.getByLabel("License expiration date").fill("2030-04-01");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Check this is right" })).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Confirm and join" }).click();
  await expect(page.getByRole("heading", { name: /^You.re set up with/ })).toBeVisible();

  await page.getByRole("button", { name: "Go to my documents" }).click();
  await expect(page).toHaveURL(/\/driver\/documents$/);
  // A carrier is asking now, so the checklist is theirs and submitting exists.
  await expect(page.getByText(/What Northline Freight needs from you/)).toBeVisible();
});
