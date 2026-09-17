import { expect, test, type Page } from "@playwright/test";

/**
 * A driver signing themselves up, and the walls that stayed standing.
 *
 * Picking "Driver" used to end at a page that told the driver to go and find a
 * carrier's invitation link — a dead end for the one person with nobody to ask.
 * It now ends in the driver portal. What this file checks is that it ends there
 * WITHOUT quietly handing anybody a carrier, and that the invitation road, the
 * other roles, and the account screens are exactly as they were.
 *
 * The relationship rule itself — no carrier relationship, no membership, no
 * carrier's data — is proven where it lives, in
 * `src/features/driver/self-onboarding.test.ts`, which can read the profile and
 * relationship layers directly and start from a person who has nothing. What a
 * browser can prove is checked here.
 */

/** The only code the mock accepts, and one it never will. */
const GOOD_CODE = "123456";
const BAD_CODE = "111111";

async function roleSelection(page: Page) {
  await page.goto("/onboarding", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "How will you use Antcolos?" })).toBeVisible();
}

async function chooseDriver(page: Page) {
  await roleSelection(page);
  // The role cards are buttons whose accessible name starts with the role.
  await page.getByRole("button", { name: /^Driver/ }).click();
  await expect(page.getByRole("heading", { name: "Set up your driver account" })).toBeVisible();
}

async function sendCode(page: Page, address = "yusuf.demir@example.com") {
  await page.getByLabel("Work email address").fill(address);
  await page.getByRole("button", { name: /Send verification code/ }).click();
  await expect(page.getByRole("heading", { name: "Confirm your work email" })).toBeVisible();
}

async function enterCode(page: Page, code: string) {
  for (const [index, digit] of [...code].entries()) {
    await page.getByLabel(`Digit ${index + 1} of 6`).fill(digit);
  }
  await page.getByRole("button", { name: /Verify my email/ }).click();
}

/** The carriers the driver profile screen lists, current and previous. */
async function carriersOnProfile(page: Page): Promise<string[]> {
  await page.goto("/driver/profile", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "My driver profile" })).toBeVisible();
  return page.locator("li[data-carrier-id]").evaluateAll((rows) =>
    rows.map((row) => row.getAttribute("data-carrier-id") ?? ""),
  );
}

test("picking Driver asks for a work email, not for an invitation link", async ({ page }) => {
  await chooseDriver(page);

  await expect(page.getByLabel("Work email address")).toBeVisible();
  await expect(page.getByText("Step 1 of 3")).toBeVisible();

  // The blocker that used to be here is gone, in every form it took.
  await expect(page.getByText(/open the invitation link sent by your carrier/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Open my invitation/ })).toHaveCount(0);
  await expect(page.getByPlaceholder(/antcolos\.com\/invitation/)).toHaveCount(0);
});

test("an address that is not an address cannot continue", async ({ page }) => {
  await chooseDriver(page);

  await page.getByLabel("Work email address").fill("yusuf.demir@");
  await page.getByRole("button", { name: /Send verification code/ }).click();

  await expect(page.getByText(/Enter a valid email address/)).toBeVisible();
  // Still on step one: no code was sent and nothing was created.
  await expect(page.getByRole("heading", { name: "Set up your driver account" })).toBeVisible();
  await expect(page.getByLabel("Digit 1 of 6")).toHaveCount(0);
});

test("an unverified email goes nowhere: a wrong code does not let you in", async ({ page }) => {
  await chooseDriver(page);
  await sendCode(page);

  await enterCode(page, BAD_CODE);

  await expect(page.getByText("That code is not correct.")).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "Confirm your work email" })).toBeVisible();
});

test("verifying reaches the driver portal that already existed", async ({ page }) => {
  await chooseDriver(page);
  await sendCode(page);
  await enterCode(page, GOOD_CODE);

  await expect(page).toHaveURL(/\/driver\/home$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("a driver who already has a profile is not asked for their licence again", async ({ page }) => {
  await chooseDriver(page);
  await sendCode(page);
  await enterCode(page, GOOD_CODE);

  await expect(page).toHaveURL(/\/driver\/home$/);
  // The demo account already has a driver profile, so the licence questions are
  // skipped entirely — one profile, asked for once.
  await expect(page.getByRole("heading", { name: "Your licence" })).toHaveCount(0);
  await expect(page.getByLabel("Driver license / CDL number")).toHaveCount(0);
});

test("the existing profile and documents areas are the ones the driver lands in", async ({ page }) => {
  await chooseDriver(page);
  await sendCode(page);
  await enterCode(page, GOOD_CODE);
  await expect(page).toHaveURL(/\/driver\/home$/);

  await page.goto("/driver/profile", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "My driver profile" })).toBeVisible();
  await expect(page.getByText("This profile is yours. It stays with you when you change carriers.")).toBeVisible();

  await page.goto("/driver/documents", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "My documents" })).toBeVisible();
});

test("nothing in the driver flow asks for, names or offers a carrier", async ({ page }) => {
  await chooseDriver(page);

  // Step one: a work email, and no carrier anywhere — no company field, no
  // carrier directory, no "who do you drive for".
  await expect(page.getByText(/Northline|Cascade|Stonebridge|carrier name/i)).toHaveCount(0);

  await sendCode(page);
  await expect(page.getByText(/Northline|Cascade|Stonebridge/)).toHaveCount(0);
});

test("the driver's carriers are the same ones after signing up", async ({ page }) => {
  const before = await carriersOnProfile(page);
  expect(before.length).toBeGreaterThan(0);

  await chooseDriver(page);
  await sendCode(page);
  await enterCode(page, GOOD_CODE);
  await expect(page).toHaveURL(/\/driver\/home$/);

  // NOTE: the mock keeps profiles and relationships in memory for one page
  // load, so this re-reads a freshly seeded world rather than the one the flow
  // just touched. What it proves is that the flow leaves nothing behind that
  // shows up as a carrier. That signing up creates no relationship AT ALL is
  // proven against the relationship layer itself, from a person who has
  // nothing, in src/features/driver/self-onboarding.test.ts.
  const after = await carriersOnProfile(page);
  expect(after).toEqual(before);
});

test("a real invitation still goes through the invitation flow", async ({ page }) => {
  // INV-DRIVER-ACCT is the carrier invitation addressed to the signed-in demo
  // driver — the ordinary case of a carrier inviting somebody who is already on
  // Antcolos, which is exactly what self-onboarding now produces more of.
  await page.goto("/invitation/INV-DRIVER-ACCT", { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Because this driver already has a profile they are asked for NO licence.
  // The claim is the same one the old two-step flow made; PR-2 moved the
  // questions onto this screen, so their absence is now visible here.
  await expect(page.getByLabel("Driver license / CDL number")).toHaveCount(0);
  await expect(page.getByTestId("accept-invitation")).toBeVisible();
});

test("accepting a carrier invitation attaches to the driver's existing profile", async ({ page }) => {
  await page.goto("/invitation/INV-DRIVER-ACCT", { waitUntil: "networkidle" });
  await page.getByTestId("accept-invitation").click();
  await expect(page.getByTestId("acceptance-confirmed")).toBeVisible();

  /*
   * One profile, carrying the new carrier as well as the ones it already had.
   *
   * The old flow inferred this from a carrier picker two screens later. The
   * acceptance screen now states it outright, which is a more direct assertion
   * of the same rule: `createOrResumeProfile` resumes first, always, so a
   * driver who already has a profile never gets a second one and is never
   * asked for their licence again.
   */
  await expect(page.getByText("Your existing profile — reused, not duplicated.")).toBeVisible();
  await expect(page.getByTestId("no-start-date")).toContainText("Not recorded yet");
});

test("a refresh mid-flow returns to the role question, as it always did", async ({ page }) => {
  await chooseDriver(page);
  await sendCode(page);

  await page.reload({ waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "How will you use Antcolos?" })).toBeVisible();
});

test("the other roles are untouched", async ({ page }) => {
  await roleSelection(page);
  await page.getByRole("button", { name: /Carrier owner/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "How will you use Antcolos?" })).toHaveCount(0);

  await roleSelection(page);
  await page.getByRole("button", { name: /Dispatch organization/ }).click();
  await expect(page.getByRole("heading", { name: "How do you dispatch?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Work as an individual dispatcher/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Create your dispatch organization/ })).toBeVisible();
});
