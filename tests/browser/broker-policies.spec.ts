import { expect, test, type Page } from "@playwright/test";

/**
 * Broker Work Policies, checked where the claims are actually about a page.
 *
 * The rules — who may approve, what blocks a booking, whose policy is whose —
 * are proved at the service layer in `tests/broker-work-policy.test.ts` and
 * `tests/broker-policy-enforcement.test.ts`. What cannot be proved there is
 * whether a person can FIND the feature, whether it has quietly become a
 * sidebar module, and whether it fits on a phone. That is this file.
 *
 * The app runs on in-memory mocks and boots into a seeded carrier workspace, so
 * there is nothing to sign in to and nothing to seed.
 */

async function openDirectory(page: Page) {
  await page.goto("/directory", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
}

async function openPolicies(page: Page) {
  await page.goto("/directory/brokers/policies", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Broker policies" })).toBeVisible();
}

test.describe("finding it at all", () => {
  test("the way in is the broker directory, not a settings page", async ({ page }) => {
    await openDirectory(page);

    const entry = page.getByRole("link", { name: "Broker policies" });
    await expect(entry).toBeVisible();

    await entry.click();
    await expect(page).toHaveURL(/\/directory\/brokers\/policies$/);
    await expect(page.getByRole("heading", { name: "Broker policies" })).toBeVisible();
  });

  test("it is NOT a new primary sidebar module", async ({ page }) => {
    await openDirectory(page);

    /*
     * ★ THE ONE THING THIS FEATURE MUST NOT BECOME ★
     * A Broker Filter module in the sidebar. The directory is the entry point;
     * the sidebar keeps exactly the navigation it had.
     */
    const sidebar = page.getByRole("navigation").first();
    await expect(sidebar.getByRole("link", { name: /Broker/i })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "Directory" }).first()).toBeVisible();
  });

  test("the list says what it holds before anybody filters it", async ({ page }) => {
    await openPolicies(page);

    const summary = page.getByRole("region", { name: "Summary" });
    for (const label of [
      "Hard blocks", "Deprioritized", "Warnings only", "Safety holds",
      "Waiting on an owner",
    ]) {
      await expect(summary.getByText(label, { exact: true })).toBeVisible();
    }

    // Rejected, expired and revoked are reachable through filters rather than
    // mixed into the default view — the default answers "what is stopping work
    // right now", which is the daily question.
    const filters = page.getByRole("group", { name: "Filter by status" });
    for (const label of ["In force", "Waiting for approval", "Rejected", "Expired", "Revoked"]) {
      await expect(filters.getByRole("button", { name: label })).toBeVisible();
    }
    await expect(filters.getByRole("button", { name: "In force" }))
      .toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("setting one from a broker profile", () => {
  test("a broker profile carries a prominent Working policy action", async ({ page }) => {
    await openDirectory(page);

    // The first broker in the seeded directory, whatever it is called.
    await page.getByRole("link", { name: /Apex Logistics/ }).first().click();
    await expect(page.getByRole("button", { name: "Working policy" })).toBeVisible();

    // And the profile shows where the company stands today, without anybody
    // hunting for it.
    await expect(
      page.getByRole("heading", { name: "Working policy", level: 2 }),
    ).toBeVisible();
  });

  test("the dialog says who decides before anybody writes anything", async ({ page }) => {
    await openDirectory(page);
    await page.getByRole("link", { name: /Apex Logistics/ }).first().click();
    await page.getByRole("button", { name: "Working policy" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Signed in as Northline's Owner, so it is theirs to take and it says so.
    await expect(dialog.getByText(/takes effect for Northline Freight/)).toBeVisible();
    await expect(dialog.getByLabel("What should happen")).toBeVisible();
    await expect(dialog.getByLabel("Why")).toBeVisible();

    // It cannot be saved without the private explanation: an unexplained block
    // is something nobody can review, revoke or defend.
    const save = dialog.getByRole("button", { name: "Set the policy" });
    await expect(save).toBeDisabled();
    await dialog.getByLabel("What happened").fill("Invoice 4471 went 52 days.");
    await expect(save).toBeEnabled();
  });

  test("a policy set here shows up in the central list, as the same record", async ({ page }) => {
    await openDirectory(page);
    await page.getByRole("link", { name: /Apex Logistics/ }).first().click();
    await page.getByRole("button", { name: "Working policy" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("What should happen").selectOption("hard_block");
    await dialog.getByLabel("Why").selectOption("payment_experience");
    await dialog.getByLabel("What happened").fill("Invoice 4471 went 52 days.");
    await dialog.getByRole("button", { name: "Set the policy" }).click();
    await expect(dialog.getByText(/in force for Northline Freight/)).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();

    // The profile's own section shows it at once, without a reload.
    const section = page.getByRole("region", { name: "Working policy" });
    await expect(section.getByText("Hard block")).toBeVisible();

    /*
     * Reached by FOLLOWING THE APP'S OWN LINK rather than by `page.goto`.
     *
     * The whole product runs on in-memory mocks that live as long as the tab,
     * so a hard reload throws away the policy that was just written — and would
     * make this test pass or fail for a reason that has nothing to do with the
     * claim. Navigating the way a person does is also what the claim is about:
     * these entry points open the same record.
     */
    await section.getByRole("link", { name: "All broker policies" }).click();
    await expect(page.getByRole("heading", { name: "Broker policies" })).toBeVisible();

    const row = page.getByRole("listitem").filter({ hasText: "Apex Logistics" }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText("Hard block")).toBeVisible();
    // ★ WHOSE POLICY, ON THE ROW ITSELF ★
    await expect(row.getByText(/Northline Freight · Carrier policy/)).toBeVisible();

    // The private sentence is behind "Details" rather than on a row somebody
    // reads over a shoulder.
    await expect(page.getByText("Invoice 4471 went 52 days.")).toHaveCount(0);
    await row.getByRole("button", { name: "Details" }).click();
    await expect(page.getByText("Invoice 4471 went 52 days.")).toBeVisible();
  });
});

test.describe("settings holds the authority and nothing else", () => {
  test("organization settings configures who decides, and points at the directory", async ({ page }) => {
    await page.goto("/settings/organization", { waitUntil: "networkidle" });

    const section = page.getByRole("region", { name: "Broker policy authority" });
    await expect(section).toBeVisible();
    await expect(section.getByText(/Who may propose/)).toBeVisible();
    await expect(section.getByText(/Who may approve/)).toBeVisible();
    await expect(section.getByLabel(/How long a temporary safety hold runs/)).toBeVisible();

    // It is NOT where policies are managed, and it says where they are.
    const link = section.getByRole("link", { name: /Broker policies/ });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/directory\/brokers\/policies$/);
  });
});

test.describe("on a phone", () => {
  test.skip(({ isMobile }) => !isMobile, "mobile only");

  test("the broker policies list fits without scrolling sideways", async ({ page }) => {
    await openPolicies(page);
    const width = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(width).toBeLessThanOrEqual(1);
  });

  test("the working-policy dialog fits too", async ({ page }) => {
    await openDirectory(page);
    await page.getByRole("link", { name: /Apex Logistics/ }).first().click();
    await page.getByRole("button", { name: "Working policy" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    const width = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(width).toBeLessThanOrEqual(1);
  });
});
