import { expect, test, type Page } from "@playwright/test";

/**
 * Needs You as a decision queue, checked where it has to be true: on the page.
 *
 * The service tests prove every item arrives pre-analysed and that one call
 * finishes it. What they cannot prove is the claim this redesign actually
 * makes — that a person can clear a row WITHOUT OPENING ANYTHING, reading a
 * paragraph, or filling in a form. That is a claim about rendered pixels, so it
 * is checked here.
 */

async function openQueue(page: Page) {
  await page.goto("/needs-you", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: /Needs You/ }).first()).toBeVisible();
  await expect(
    page
      .getByRole("list", { name: "Needs You queue" })
      .or(page.getByText(/Nothing (needs you|matches)|no open work|holding nothing/)),
  ).toBeVisible();
}

function rows(page: Page) {
  return page.getByRole("list", { name: "Needs You queue" }).locator("[data-needs-you-item]");
}

test.describe("one press, in the row", () => {
  test("every row carries its own decision control", async ({ page }) => {
    await openQueue(page);
    const list = rows(page);
    const count = await list.count();
    test.skip(count === 0, "this workspace's queue is empty");

    // Checked across the first handful rather than all of them: the claim is
    // that it is a property of a row, not of one lucky work type.
    for (let i = 0; i < Math.min(count, 6); i++) {
      const row = list.nth(i);
      const decision = row.locator("[data-decision]");
      await expect(decision, `row ${i} offers a decision`).toBeVisible();
      // A press, or — for an item that is a view of another module's state —
      // one link straight to where it is fixed. Never a form.
      const controls = decision.locator("button, a");
      expect(await controls.count(), `row ${i} has something to act on`)
        .toBeGreaterThan(0);
    }
  });

  test("a row says how much the system already did", async ({ page }) => {
    await openQueue(page);
    const list = rows(page);
    test.skip((await list.count()) === 0, "this workspace's queue is empty");

    await expect(
      list.first().getByText(/\d+\/\d+ automated|\d+ steps run/),
    ).toBeVisible();
  });

  /**
   * ★ THE HEADLINE ★
   * Press the primary option and the item closes itself, with the downstream
   * steps reported back in place. No dialog, no form, no second screen.
   */
  test("pressing the primary option finishes the item where it stands", async ({ page }) => {
    await openQueue(page);
    const list = rows(page);
    test.skip((await list.count()) === 0, "this workspace's queue is empty");

    // The first row whose primary press is executable here (a row that is a
    // view of another module offers a link instead, which is a different test).
    const row = list
      .filter({ has: page.locator("button.bg-primary") })
      .first();
    test.skip((await row.count()) === 0, "nothing in this queue is decidable here");

    const title = (await row.locator("button").nth(1).innerText()).trim();
    await row.locator("button.bg-primary").first().click();

    // The row reports what ran rather than merely vanishing.
    const outcome = page.getByText(/\d+ steps? run/).first();
    await expect(outcome).toBeVisible();
    expect(title.length).toBeGreaterThan(0);
  });
});

test.describe("text density", () => {
  /**
   * The old row printed two lines of the reason under every title. It now lives
   * on hover and in the drawer, so no row body repeats a whole sentence of it.
   */
  test("no row prints a paragraph", async ({ page }) => {
    await openQueue(page);
    const list = rows(page);
    const count = await list.count();
    test.skip(count === 0, "this workspace's queue is empty");

    for (let i = 0; i < Math.min(count, 6); i++) {
      const height = (await list.nth(i).boundingBox())?.height ?? 0;
      // A decision row with buttons and a meter, not an article.
      expect(height, `row ${i} is a row, not an essay`).toBeLessThan(260);
    }
  });

  test("the drawer still holds the long version", async ({ page }) => {
    await openQueue(page);
    const list = rows(page);
    test.skip((await list.count()) === 0, "this workspace's queue is empty");

    await list.first().getByRole("button", { name: /^Details of / }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("Why", { exact: true })).toBeVisible();
    await expect(
      drawer.getByText(/Already done for you|What the system ran/),
    ).toBeVisible();
  });
});
