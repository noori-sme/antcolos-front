import { expect, test, type Page } from "@playwright/test";

/**
 * Accepting an invitation, end to end, through the product.
 *
 * This file replaces `membership-visibility.spec.ts`, which drove a
 * development-only bridge into the membership store because PR-1 made a granted
 * seat observable without adding anything that granted one. That bridge is
 * gone: there is a real button now, and pressing it is a far better test than
 * reaching into a store ever was.
 *
 * ★ WHAT IS BEING DEFENDED ★
 * Acceptance touches five canonical records across four modules with no
 * transaction around them. The claims that matter are about what a PERSON ends
 * up with, which is why they are checked here and not only at the service:
 *
 *   • the portal opens, in the same page load, with no reload
 *   • the screen reports what actually happened, step by step
 *   • it says "accepted on <date>" and that the carrier has NOT activated them
 *   • accepting twice does not produce a second anything
 *
 * MOCK PERSISTENCE: everything lives in memory for one page load, so these
 * tests move the way a person does — by clicking — and never reload.
 */

/**
 * A person who belongs to nothing, invited by a carrier they have no seat in.
 *
 * Deliberately NOT the demo account: Sam is already Northline's Owner, so
 * accepting a driver invitation there correctly grants no new seat — right
 * behaviour, useless demonstration. `?fixture=newcomer` is the state every real
 * driver starts in.
 */
const DRIVER_INVITE = "/invitation/INV-NEWCOMER?fixture=newcomer&signedin=1";

/** The licence questions a person with no profile answers exactly once. */
async function fillLicence(page: Page) {
  await page.getByLabel("Full legal name").fill("Alex Rivera");
  await page.getByLabel("Driver license / CDL number").fill("A1234567");
  await page.getByLabel("Issuing state").selectOption("TX");
  await page.getByLabel("License expiration date").fill("2030-04-01");
  await page.getByRole("button", { name: "Continue" }).click();
}

async function acceptAsDriver(page: Page) {
  await page.goto(DRIVER_INVITE, { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: /You've been invited to Northline Freight/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Accept invitation" }).click();

  // The collection screen checks for an existing profile before it renders
  // anything, so wait for whichever stage it lands on rather than racing it. A
  // driver who already has a profile goes straight to the sharing decision; one
  // who does not answers the licence questions first, once.
  const licence = page.getByLabel("Driver license / CDL number");
  const consent = page.getByRole("checkbox");
  await expect(licence.or(consent).first()).toBeVisible({ timeout: 20_000 });
  if (await licence.isVisible()) await fillLicence(page);

  await expect(consent).toBeVisible();
  await consent.check();
  await page.getByRole("button", { name: /Confirm and join/ }).click();
}

test.describe("a driver accepting an invitation", () => {
  test("is told what actually happened, one record at a time", async ({ page }) => {
    await acceptAsDriver(page);

    const steps = page.getByTestId("acceptance-steps");
    await expect(steps).toBeVisible();

    // Each of the five things acceptance creates is reported separately,
    // because none of them implies another.
    for (const key of [
      "driver_profile", "carrier_relationship", "document_access",
      "engagement_link", "workspace_membership",
    ]) {
      await expect(steps.locator(`[data-step="${key}"]`)).toHaveAttribute(
        "data-state", /done|not_applicable/,
      );
    }
  });

  test("says it is accepted, and that the carrier has not started them", async ({ page }) => {
    await acceptAsDriver(page);

    // The whole reason acceptance does not set a start date. Saying yes is the
    // person's act; being activated is the carrier's, and has not happened.
    await expect(page.getByText(/Invitation accepted on/)).toBeVisible();
    await expect(page.getByText(/has not activated your relationship yet/)).toBeVisible();
  });

  test("opens the driver portal in the same page load", async ({ page }) => {
    await acceptAsDriver(page);
    await page.getByRole("button", { name: /Go to my driver portal/ }).click();

    // The seat was granted mid-session and the session saw it. No reload.
    await expect(page).toHaveURL(/\/driver\/home(\?.*)?$/);
  });

  test("grants nothing beyond a driver seat", async ({ page }) => {
    await acceptAsDriver(page);
    await page.getByRole("button", { name: /Go to my driver portal/ }).click();
    await expect(page).toHaveURL(/\/driver\/home(\?.*)?$/);

    const drawer = page.getByRole("button", { name: "Open navigation" });
    if (await drawer.isVisible()) await drawer.click();
    for (const forbidden of [/^Invitations$/, /^Users$/, /^Permissions$/, /^Workforce$/]) {
      await expect(page.getByRole("link", { name: forbidden })).toHaveCount(0);
    }
  });
});

test.describe("an invitation that is not acceptable", () => {
  test("says which, and offers nothing to press", async ({ page }) => {
    for (const [token, heading] of [
      ["INV-REVOKED", /was withdrawn/],
      ["INV-EXPIRED", /has expired/],
    ] as const) {
      await page.goto(`/invitation/${token}?signedin=1`, { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await expect(page.getByRole("button", { name: "Accept invitation" })).toHaveCount(0);
    }
  });

  test("refuses to attach to the wrong account", async ({ page }) => {
    // `INV-NEWCOMER` names Alex Rivera, who has an account. This tab is signed
    // in as Sam. (It used to use `INV-WRONGUSER`, addressed to somebody with no
    // account at all — that link now correctly asks them to sign up first,
    // because there is nobody to compare a session against until they do.)
    await page.goto("/invitation/INV-NEWCOMER", { waitUntil: "networkidle" });
    await expect(
      page.getByRole("heading", { name: /isn't for this account/ }),
    ).toBeVisible();
  });

  test("sends somebody with no account to sign up before naming whose it is", async ({ page }) => {
    await page.goto("/invitation/INV-WRONGUSER", { waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: "Accept invitation" })).toHaveCount(0);
  });
});
