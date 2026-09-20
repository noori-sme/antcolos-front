import { expect, test, type Page } from "@playwright/test";

/**
 * The HR foundation's new surfaces, in a browser.
 *
 * ★ WHAT ONLY A BROWSER CAN SAY ★
 * That the classification dropdown prints "Antcolos makes no determination"
 * where a person will read it rather than in a tooltip; that a start date shows
 * whose claim it is beside the date itself; that a function gap offers a route
 * to Access and no button that grants anything; that recording leave never asks
 * for a diagnosis. The rules underneath — the duplicate refusal, the isolation,
 * what leave does to the routing signal — are proven at the service layer in
 * `workforce-hr-foundation.test.ts`, where they live.
 *
 * MOCK PERSISTENCE: engagements live in memory for one page load, so each test
 * navigates by clicking rather than reloading between steps.
 */

async function settled(page: Page, path: string) {
  await page.goto(path, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
}

async function openWorkforce(page: Page) {
  await settled(page, "/workforce");
  await expect(page.getByTestId("workforce-list")).toBeVisible();
}

/**
 * Open one person's page by the engagement id on their row.
 *
 * Not by name: a supervisor's name appears on every row they supervise, which
 * is the roster doing its job, and a name locator would match five of them.
 */
async function openPerson(page: Page, engagementId: string, name: string) {
  await openWorkforce(page);
  await page.getByTestId("workforce-list")
    .locator(`[data-engagement-id="${engagementId}"]`).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

const PRIYA = "weng_nl_priya";
const TESS = "weng_nl_tess";
const DMITRI = "weng_nl_dmitri";
const SAM = "weng_nl_migrated_driver";

/* -------------------------------------------------------------------------- */
/* The directory                                                               */
/* -------------------------------------------------------------------------- */

test.describe("the workforce directory", () => {
  test("shows functions and availability on the row without unfolding records", async ({ page }) => {
    await openWorkforce(page);
    const list = page.getByTestId("workforce-list");

    // Tess does three jobs at this carrier, which is the small-carrier case a
    // single job title cannot hold.
    const tess = list.locator('[data-engagement-id="weng_nl_tess"]');
    await expect(tess.getByTestId("row-functions")).toContainText("Safety");
    await expect(tess.getByTestId("row-functions")).toContainText("Documents");

    // Priya is away, and the row says so as its own chip — never folded into
    // the engagement state, which still reads Active.
    const priya = list.locator('[data-engagement-id="weng_nl_priya"]');
    await expect(priya).toHaveAttribute("data-availability", "on_leave");
    await expect(priya.getByText("Away")).toBeVisible();
    await expect(priya.getByText("Active")).toBeVisible();
  });

  test("filters to only the people who are away", async ({ page }) => {
    await openWorkforce(page);
    const list = page.getByTestId("workforce-list");
    await expect(list.getByText("Dmitri Kovalenko")).toBeVisible();

    await page.getByTestId("filter-on-leave").click();
    await expect(list.locator('[data-engagement-id="weng_nl_priya"]')).toBeVisible();
    await expect(list.getByText("Dmitri Kovalenko")).toHaveCount(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Recording somebody                                                          */
/* -------------------------------------------------------------------------- */

test.describe("recording somebody who works here", () => {
  test("prints the classification notice where a person reads it", async ({ page }) => {
    await openWorkforce(page);
    await page.getByTestId("record-engagement").click();

    // Not a tooltip, not a help icon. The sentence itself, above the dropdown.
    const notice = page.getByTestId("classification-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("not a determination Antcolos makes");
    await expect(notice).toContainText("no worker-classification test");
  });

  test("refuses a start date until somebody says where it came from", async ({ page }) => {
    await openWorkforce(page);
    await page.getByTestId("record-engagement").click();

    await page.getByLabel("Name").fill("Rosa Delgado");
    await page.getByLabel("Position").fill("Night dispatcher");
    const submit = page.getByTestId("create-engagement-submit");
    await expect(submit).toBeEnabled();

    // Adding a date without its basis blocks the form rather than guessing.
    await page.getByLabel("Start date (optional)").fill("2024-03-04");
    await expect(submit).toBeDisabled();

    await page.getByLabel("Where does that date come from?")
      .selectOption("asserted_by_organization");
    await expect(page.getByText(/Antcolos did not see it happen/)).toBeVisible();
    await expect(submit).toBeEnabled();
  });

  test("records somebody with no account, and says the date is the carrier's claim", async ({ page }) => {
    await openWorkforce(page);
    await page.getByTestId("record-engagement").click();

    await page.getByLabel("Name").fill("Rosa Delgado");
    await page.getByLabel("Position").fill("Night dispatcher");
    await page.getByLabel("Start date (optional)").fill("2024-03-04");
    await page.getByLabel("Where does that date come from?")
      .selectOption("asserted_by_organization");
    // Recording a function is not granting one — asserted in the service tests.
    await page.getByTestId("function-picker").locator('[data-function="dispatch"]').click();
    await page.getByTestId("create-engagement-submit").click();

    const list = page.getByTestId("workforce-list");
    await expect(list.getByText("Rosa Delgado")).toBeVisible();

    await list.getByText("Rosa Delgado").click();
    // No account was minted for her.
    await expect(page.getByText("No Antcolos access").first()).toBeVisible();
    // And the date is shown as what it is: this carrier's claim.
    const start = page.getByTestId("start-date-panel");
    await expect(start).toContainText("2024-03-04");
    await expect(start.locator('[data-basis="asserted_by_organization"]')).toBeVisible();
  });

  test("shows the duplicate refusal instead of closing as though it worked", async ({ page }) => {
    await openWorkforce(page);
    await page.getByTestId("record-engagement").click();

    // Priya already has a live engagement here, matched on the email the
    // carrier recorded for her. Entering her again by hand is exactly the
    // route a second coordinator would take.
    await page.getByLabel("Name").fill("Priya Raman");
    await page.getByLabel("Email (optional)").fill("priya.raman@example.com");
    await page.getByLabel("Position").fill("Yard hand");
    await page.getByTestId("create-engagement-submit").click();

    // The dialog stays open and says why.
    await expect(page.getByText(/already has a live engagement/)).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/* Functions, and the gap                                                      */
/* -------------------------------------------------------------------------- */

test.describe("functions on a person", () => {
  test("says a function grants nothing, and routes a gap to Access", async ({ page }) => {
    await openPerson(page, PRIYA, "Priya Raman");

    const panel = page.getByTestId("functions-panel");
    await expect(panel).toContainText("grants no permission");

    // Northline says Priya coordinates maintenance and she has no seat at all.
    const row = panel.locator('[data-function="maintenance"]');
    await expect(row).toHaveAttribute("data-has-gap", "true");
    await expect(row.getByText("Access does not match")).toBeVisible();
    await expect(row.getByText(/maintenance:view/)).toBeVisible();

    // ★ THE ONLY ROUTE OUT IS ACCESS ★ There is no grant button here.
    await expect(row.getByRole("link", { name: /Invite them to this workspace/ }))
      .toHaveAttribute("href", "/settings/users");
    await expect(panel.getByRole("button", { name: /Grant/ })).toHaveCount(0);
  });

  test("assigns one and records who did it, without touching access", async ({ page }) => {
    await openPerson(page, TESS, "Tess Ferraro");

    await page.getByTestId("assign-function").locator('[data-function="finance"]').click();
    const row = page.getByTestId("assigned-functions").locator('[data-function="finance"]');
    await expect(row).toBeVisible();
    // Who assigned it and when, on the row rather than only in the history.
    await expect(row).toContainText("Assigned by");

    // The access summary is unchanged: she still holds a seat, and nothing
    // here said anything about what it carries.
    await expect(page.getByText("Has Antcolos access").first()).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/* Leave                                                                       */
/* -------------------------------------------------------------------------- */

test.describe("leave and coming back", () => {
  test("asks for no medical detail and says so", async ({ page }) => {
    await openPerson(page, TESS, "Tess Ferraro");
    await page.getByTestId("record-leave").click();

    const notice = page.getByTestId("leave-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("not a medical record");
    await expect(notice).toContainText("not an FMCSA duty status");
    // There is nowhere to type a diagnosis: the reason is a fixed list.
    await expect(page.getByLabel("Reason")).toHaveRole("combobox");
  });

  test("records leave without moving the engagement out of Active", async ({ page }) => {
    await openPerson(page, TESS, "Tess Ferraro");
    await page.getByTestId("record-leave").click();
    await page.getByLabel("Reason").selectOption("planned_time_off");
    await page.getByTestId("record-leave-submit").click();

    const availability = page.getByTestId("availability-panel");
    await expect(availability.locator('[data-availability="on_leave"]')).toBeVisible();
    // ★ STILL ACTIVE ★ Away is not stood down and is not ended.
    await expect(page.getByText("Active").first()).toBeVisible();
  });

  test("states what the availability signal is not", async ({ page }) => {
    await openPerson(page, PRIYA, "Priya Raman");
    const availability = page.getByTestId("availability-panel");
    await expect(availability).toContainText("never declares a truck dispatch-ready");
    await expect(availability).toContainText("Dispatch, Maintenance, Safety and the ELD");
  });

  test("needs somebody to say they came back", async ({ page }) => {
    await openPerson(page, PRIYA, "Priya Raman");
    await expect(page.getByTestId("availability-panel")
      .locator('[data-availability="on_leave"]')).toBeVisible();

    await page.getByTestId("end-leave").click();
    await expect(page.getByTestId("availability-panel")
      .locator('[data-availability="working"]')).toBeVisible();
    // And the summary claims only what it knows.
    await expect(page.getByText(/HR knows of no reason not to route work/)).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/* Next action                                                                 */
/* -------------------------------------------------------------------------- */

test.describe("what happens next", () => {
  test("names one action, and sends a permission gap to Access", async ({ page }) => {
    await openPerson(page, PRIYA, "Priya Raman");
    const next = page.getByTestId("next-action");
    await expect(next).toBeVisible();
    await expect(next).toHaveAttribute("data-action", "close_function_gap");
    await expect(next.getByRole("link", { name: "Go there" }))
      .toHaveAttribute("href", "/settings/users");
  });

  test("notices a start date nobody recorded the source of", async ({ page }) => {
    await openPerson(page, DMITRI, "Dmitri Kovalenko");
    // Dmitri pre-dates the provenance field. The page says so rather than
    // quietly presenting his date as something Antcolos observed.
    await expect(page.getByTestId("start-date-panel"))
      .toContainText("Nobody recorded where this came from");
    await expect(page.getByTestId("next-action"))
      .toHaveAttribute("data-action", "record_start_date_basis");
  });

  test("says nothing at all when nothing is waiting", async ({ page }) => {
    await openPerson(page, SAM, "Sam Murtaza");
    // An active driver whose start date carries its basis, whose one function
    // needs no seat and who has nothing outstanding is somebody a queue should
    // stay quiet about.
    await expect(page.getByTestId("next-action-none")).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/* On a phone                                                                  */
/* -------------------------------------------------------------------------- */

test.describe("on a phone", () => {
  const overflowOf = (page: Page) => page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

  test("the directory with its new columns still fits", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile projects only.");
    await openWorkforce(page);
    await expect(page.getByTestId("row-functions").first()).toBeVisible();
    expect(await overflowOf(page)).toBeLessThanOrEqual(1);
  });

  test("the functions and availability panels fit", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile projects only.");
    await openPerson(page, PRIYA, "Priya Raman");
    await expect(page.getByTestId("functions-panel")).toBeVisible();
    await expect(page.getByTestId("availability-panel")).toBeVisible();
    expect(await overflowOf(page)).toBeLessThanOrEqual(1);
  });

  test("the record-somebody form fits", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile projects only.");
    await openWorkforce(page);
    await page.getByTestId("record-engagement").click();
    await expect(page.getByTestId("classification-notice")).toBeVisible();
    expect(await overflowOf(page)).toBeLessThanOrEqual(1);
  });

  test("the leave form fits", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile projects only.");
    await openPerson(page, TESS, "Tess Ferraro");
    await page.getByTestId("record-leave").click();
    await expect(page.getByTestId("leave-notice")).toBeVisible();
    expect(await overflowOf(page)).toBeLessThanOrEqual(1);
  });
});
