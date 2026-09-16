import { expect, test, type Page } from "@playwright/test";

/**
 * The workforce surfaces, in a browser.
 *
 * ★ WHAT ONLY A BROWSER CAN SAY ★
 * That the offboarding confirmation actually SHOWS what will be kept before
 * anybody presses the button; that a checklist row says which module reported
 * it rather than presenting HR's opinion; that the page fits a phone. The rules
 * underneath — version pinning, isolation, idempotency, the refusals — are
 * proven at the service layer, where they live.
 *
 * MOCK PERSISTENCE: engagements live in memory for one page load, so each test
 * navigates by clicking rather than reloading between steps.
 */

async function settled(page: Page, path: string) {
  await page.goto(path, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
}

/** The demo session starts in Northline, the carrier with the seeded people. */
async function openWorkforce(page: Page) {
  await settled(page, "/workforce");
  await expect(page.getByRole("heading", { name: "Workforce", level: 1 })).toBeVisible();
  await expect(page.getByTestId("workforce-list")).toBeVisible();
}

test.describe("the workforce list", () => {
  test("shows the seeded people with their basis and status", async ({ page }) => {
    await openWorkforce(page);
    const list = page.getByTestId("workforce-list");
    await expect(list.getByText("Dmitri Kovalenko")).toBeVisible();
    await expect(list.getByText("Marcus Hale")).toBeVisible();
    // The classification is on the row: employment basis is the point of this
    // record, and a roster that only showed names would not be one.
    await expect(list.getByText("Owner-operator").first()).toBeVisible();
  });

  test("says plainly who has no Antcolos access", async ({ page }) => {
    await openWorkforce(page);
    // Priya works here and cannot sign in. That has to be legible, because the
    // assumption everybody brings to an HR list is that it is the user list.
    await expect(page.getByTestId("workforce-list").getByText("No Antcolos access").first())
      .toBeVisible();
  });

  test("hides ended engagements by default and can show them", async ({ page }) => {
    await openWorkforce(page);
    const list = page.getByTestId("workforce-list");
    await expect(list.getByText("Kelsey Nguyen")).toHaveCount(0);
    await page.getByRole("button", { name: "Show ended engagements" }).click();
    // Ended, and still there: history is kept, never deleted.
    await expect(list.getByText("Kelsey Nguyen")).toBeVisible();
  });
});

test.describe("an engagement", () => {
  test("shows each onboarding row with the module that reported it", async ({ page }) => {
    await openWorkforce(page);
    await page.getByTestId("workforce-list").getByText("Dmitri Kovalenko").click();
    await expect(page.getByRole("heading", { name: "Dmitri Kovalenko" })).toBeVisible();

    const checklist = page.getByTestId("onboarding-checklist");
    await expect(checklist).toBeVisible();
    await expect(checklist.getByText("Safety & Compliance").first()).toBeVisible();
    await expect(checklist.getByText("Document Center").first()).toBeVisible();
    // And it says out loud that it cannot transact across them.
    await expect(page.getByText(/no cross-module transaction/)).toBeVisible();
  });

  test("links out to the canonical records instead of restating them", async ({ page }) => {
    await openWorkforce(page);
    await page.getByTestId("workforce-list").getByText("Dmitri Kovalenko").click();
    const links = page.getByTestId("engagement-links");
    await expect(links).toBeVisible();
    await expect(links.getByRole("link", { name: "Driver profile" })).toBeVisible();
    await expect(links.getByRole("link", { name: /Governing agreement|Documents/ }).first())
      .toBeVisible();
  });

  test("keeps the whole history on an ended engagement", async ({ page }) => {
    await openWorkforce(page);
    await page.getByRole("button", { name: "Show ended engagements" }).click();
    await page.getByTestId("workforce-list").getByText("Kelsey Nguyen").click();
    const history = page.getByTestId("engagement-history");
    await expect(history).toBeVisible();
    await expect(history.getByText("Engagement ended")).toBeVisible();
    await expect(history.getByText("Engagement created")).toBeVisible();
  });
});

test.describe("ending an engagement", () => {
  test("shows the impact, including what is KEPT, before anything happens", async ({ page }) => {
    await openWorkforce(page);
    await page.getByTestId("workforce-list").getByText("Dmitri Kovalenko").click();
    await page.getByRole("button", { name: "End engagement" }).click();

    const impacts = page.getByTestId("offboarding-impacts");
    await expect(impacts).toBeVisible();
    // The destructive rows.
    await expect(impacts.locator('[data-effect="will_end"]').first()).toBeVisible();
    // ★ And the preserved ones, which is the point. ★
    await expect(impacts.locator('[data-impact="start_qualification_retention"]')).toBeVisible();
    await expect(impacts.locator('[data-impact="preserve_history"]')).toBeVisible();
    await expect(impacts.getByText(/Loads, settlements, Safety history/)).toBeVisible();

    // Nothing has happened yet: the engagement is still active behind the dialog.
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Active").first()).toBeVisible();
  });

  test("will not let a preservation row be switched off", async ({ page }) => {
    await openWorkforce(page);
    await page.getByTestId("workforce-list").getByText("Dmitri Kovalenko").click();
    await page.getByRole("button", { name: "End engagement" }).click();

    const retention = page.getByTestId("offboarding-impacts")
      .locator('[data-impact="start_qualification_retention"]')
      .locator('input[type="checkbox"]');
    await expect(retention).toBeDisabled();
    await expect(retention).toBeChecked();
  });

  test("requires a reason before it can be confirmed", async ({ page }) => {
    await openWorkforce(page);
    await page.getByTestId("workforce-list").getByText("Dmitri Kovalenko").click();
    await page.getByRole("button", { name: "End engagement" }).click();
    const confirm = page.getByRole("button", { name: "End the engagement" });
    await expect(confirm).toBeDisabled();
    await page.getByLabel("Reason for ending the engagement").fill("Left the carrier.");
    await expect(confirm).toBeEnabled();
  });

  test("ends it, and the history and driver profile survive", async ({ page }) => {
    await openWorkforce(page);
    await page.getByTestId("workforce-list").getByText("Dmitri Kovalenko").click();
    await page.getByRole("button", { name: "End engagement" }).click();
    await page.getByLabel("Reason for ending the engagement").fill("Left the carrier.");
    await page.getByRole("button", { name: "End the engagement" }).click();

    await expect(page.getByText("Ended").first()).toBeVisible();
    await expect(page.getByTestId("engagement-history").getByText("Engagement ended"))
      .toBeVisible();
    // The driver record is still linked and still reachable.
    await expect(page.getByTestId("engagement-links").getByRole("link", { name: "Driver profile" }))
      .toBeVisible();
  });
});

test.describe("on a phone", () => {
  test("the workforce list fits without scrolling sideways", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile projects only.");
    await openWorkforce(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("the engagement page fits too", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile projects only.");
    await openWorkforce(page);
    await page.getByTestId("workforce-list").getByText("Dmitri Kovalenko").click();
    await expect(page.getByTestId("onboarding-checklist")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
