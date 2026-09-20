import { expect, test, type Page } from "@playwright/test";

/**
 * ★ WHAT A DISPATCHER ACTUALLY SEES ★
 *
 * ███ NOTHING HERE CONTACTS A FACTORING COMPANY ███
 *
 * The factoring rules live at the service layer and are tested there. Four
 * claims are not reachable from a service test, because they are claims about
 * a rendered page:
 *
 *   1. With an automatic connection the answer is simply THERE, and there is
 *      no "Check with factoring" button beside it.
 *   2. Without one there is exactly ONE button, and it opens a panel with
 *      everything Antcolos already knows already in it.
 *   3. Recording the answer replaces the question on the same screen, without
 *      the dispatcher leaving the search.
 *   4. MT Loop gained no factoring stage or lane — a negative claim about a
 *      board, which only the board can answer.
 *
 * Desktop only. The claims are about a dense row on a wide screen; the phone
 * layout of the same panel is the shell's business and is covered elsewhere.
 */

const TRUCK = "/dispatch/trucks/a1f0c2d4-1111-4a10-9c01-0b0f5d7e1005";

test.describe("factoring inside load search", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "desktop chrome");

  /**
   * Open the truck and run a search.
   *
   * `page.goto` reloads the bundle and with it every in-memory mock, so any
   * test that changes a setting FIRST has to reach the truck by clicking —
   * which is also how a person gets there.
   */
  async function searchOnTruck(page: Page, { viaNav = false } = {}) {
    if (viaNav) {
      await page.getByRole("link", { name: "MT Loop", exact: true }).click();
      await page.waitForSelector(`a[href="${TRUCK}"]`, { timeout: 60_000 });
      await page.locator(`a[href="${TRUCK}"]`).first().click();
    } else {
      await page.goto(TRUCK, { waitUntil: "networkidle" });
    }
    await expect(page.getByRole("heading", { name: /Unit/ }).first()).toBeVisible();

    const start = page.getByRole("button", { name: /Start searching/ });
    if (await start.count()) await start.first().click();
    // The chip is the signal that the search finished AND the answers landed.
    await expect(page.locator('[data-testid="factoring-chip"]').first())
      .toBeVisible({ timeout: 60_000 });
  }

  /** Put this carrier on a connection with no adapter behind it. */
  async function useManualMode(page: Page) {
    await page.goto("/settings/factoring", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Factoring", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Change", exact: true }).click();
    await page.selectOption("#factoring-mode", "manual");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(/Manual check —/)).toBeVisible();
  }

  test("says on the settings screen that no factoring company is connected", async ({ page }) => {
    await page.goto("/settings/factoring", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Factoring", exact: true })).toBeVisible();

    // The honest sentence is on the page, not only in a comment.
    await expect(
      page.getByText(/Antcolos is not connected to a factoring company/),
    ).toBeVisible();

    // The account is shown with its MODE, so "Connected" cannot be read as
    // "connected to a live provider API".
    await expect(page.getByText("OTR Solutions", { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/Mock adapter \(development\)/)).toBeVisible();
  });

  test("shows a status on every result, and no button, when checks are automatic", async ({ page }) => {
    await searchOnTruck(page);

    const chips = page.locator('[data-testid="factoring-chip"]');
    expect(await chips.count()).toBeGreaterThan(0);

    // ★ The claim: the dispatcher pressed nothing and the answer is there.
    await expect(page.locator('[data-testid="check-with-factoring"]')).toHaveCount(0);

    // And it says which factor answered and how, rather than only "Approved".
    const first = chips.first();
    await expect(first).toHaveAttribute("data-factoring-decision", /.+/);
    await expect(first).toContainText(/mock|live|imported|email|portal|phone/);
  });

  test("offers one contextual button when the carrier has no automatic connection", async ({ page }) => {
    await useManualMode(page);
    await searchOnTruck(page, { viaNav: true });

    const button = page.locator('[data-testid="check-with-factoring"]').first();
    await expect(button).toBeVisible();
    await expect(button).toContainText("Check with factoring");

    // Never both: a row that offers the button has no completed live result
    // sitting beside it claiming an API answered.
    await expect(page.getByText("Approved · live")).toHaveCount(0);
  });

  test("prefills the fallback with carrier, broker, MC, amount and opportunity", async ({ page }) => {
    await useManualMode(page);
    await searchOnTruck(page, { viaNav: true });
    await page.locator('[data-testid="check-with-factoring"]').first().click();

    const prefill = page.getByTestId("factoring-prefill");
    await expect(prefill).toBeVisible();

    // Every one of these is something Antcolos already knew. A dispatcher who
    // has to go and find the broker's MC runs the check on the wrong company.
    await expect(prefill).toContainText("Carrier");
    await expect(prefill).toContainText("Northline Freight");
    await expect(prefill).toContainText("Factoring account");
    await expect(prefill).toContainText("Broker MC");
    await expect(prefill).toContainText("Asked by");

    // The message is ready to send, and it names the debtor's MC.
    await expect(page.locator("#factoring-draft")).toHaveValue(/Debtor MC: \d+/);

    // And the panel says what it is not.
    await expect(
      page.getByText(/never from a live factoring API/),
    ).toBeVisible();
  });

  test("replaces the button with the answer it recorded, on the same screen", async ({ page }) => {
    await useManualMode(page);
    await searchOnTruck(page, { viaNav: true });

    const before = await page.locator('[data-testid="check-with-factoring"]').count();
    expect(before).toBeGreaterThan(0);

    await page.locator('[data-testid="check-with-factoring"]').first().click();
    await expect(page.getByTestId("factoring-prefill")).toBeVisible();
    await page.selectOption("#factoring-decision", "approved_manual");
    await page.selectOption("#factoring-source", "phone_confirmation");
    await page.fill("#factoring-reference", "RTS-CALL-1201");
    await page.getByRole("button", { name: "Record the answer" }).click();

    // The dispatcher is back where they were, with the answer on the row.
    await expect(page.getByTestId("factoring-prefill")).toHaveCount(0);
    await expect(
      page.locator('[data-factoring-decision^="approved"]').first(),
    ).toBeVisible({ timeout: 30_000 });
    // Recorded as a phone confirmation, and labelled as one.
    await expect(page.getByText("· phone").first()).toBeVisible();
  });

  test("filters the results by factoring, and never hides them silently", async ({ page }) => {
    await searchOnTruck(page);
    await page.getByRole("button", { name: /^Opportunities/ }).first().click();

    const filter = page.getByTestId("factoring-filter");
    await expect(filter).toBeVisible();
    // Open by default: narrowing is a deliberate act, not the starting state.
    await expect(filter).toHaveValue("all");
    // Each option carries its own count, so nothing disappears unexplained.
    await expect(filter.locator("option", { hasText: "Approved only" })).toContainText(/\(\d+\)/);

    const shown = page.locator('[data-testid="factoring-chip"]');
    const all = await shown.count();
    await filter.selectOption("rejected");
    await expect(shown).not.toHaveCount(all);
    for (const chip of await shown.all()) {
      await expect(chip).toHaveAttribute("data-factoring-decision", "rejected");
    }
  });

  test("adds no factoring stage or lane to the MT Loop", async ({ page }) => {
    await page.goto("/dispatch/loops", { waitUntil: "networkidle" });
    await page.waitForSelector('a[href^="/dispatch/trucks/"]', { timeout: 60_000 });

    // Scoped to the BOARD, not the chrome: Settings → Factoring is a nav entry
    // in the sidebar on every page, and it is the administration screen rather
    // than a step in anybody's day.
    const board = page.getByRole("main");
    await expect(page.getByRole("heading", { name: "MT Loop", exact: true })).toBeVisible();
    await expect(board.getByText(/^Factoring$/)).toHaveCount(0);

    // Nor does the truck's own cycle gain a stage. The stages are the buttons
    // down the left of the cycle, and factoring is not one of them: the answer
    // rides on the Load Search row instead.
    await page.locator(`a[href="${TRUCK}"]`).first().click();
    await expect(page.getByRole("heading", { name: /Unit/ }).first()).toBeVisible();
    await expect(
      board.getByRole("button", { name: /^Factoring/ }),
    ).toHaveCount(0);
  });
});
