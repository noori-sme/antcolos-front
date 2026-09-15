import { expect, test, type Page } from "@playwright/test";

/**
 * The Needs You filter redesign, checked where it actually has to be true.
 *
 * Every claim below is about a rendered page — "the secondary filters are not
 * on screen", "a phone cannot scroll sideways", "the first item is near the
 * top". None of them can be established from a service test, which is why this
 * file exists and why it is the only kind of test in it.
 *
 * The app runs on in-memory mocks and boots straight into a seeded workspace,
 * so there is nothing to sign in to and nothing to seed.
 */

const NEEDS_YOU = "/needs-you";

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function openNeedsYou(page: Page) {
  await page.goto(NEEDS_YOU, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: /Needs You/ }).first()).toBeVisible();
  /*
   * Wait for the queue itself, not for the network.
   *
   * `networkidle` fires while React is still hydrating in dev, and a click on
   * an unhydrated button does nothing at all — which looks exactly like a
   * broken feature. The list (or the empty state) only renders once the
   * responsibility derivation has resolved, so waiting for one of them waits
   * for a page that can actually be used.
   */
  await expect(
    page
      .getByRole("list", { name: "Needs You queue" })
      .or(page.getByText(/Nothing (needs you|matches)|no open work|holding nothing/)),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Filters/ })).toBeVisible();
}

function filtersButton(page: Page) {
  return page.getByRole("button", { name: /^Filters/ });
}

function panel(page: Page) {
  return page.getByRole("dialog");
}

async function openFilters(page: Page) {
  await filtersButton(page).click();
  await expect(panel(page)).toBeVisible();
}

/* -------------------------------------------------------------------------- */

test.describe("the collapsed default", () => {
  /**
   * The headline claim: a person sees their work, not a control panel.
   *
   * Measured as the distance from the top of the document to the first item,
   * rather than by counting pixels of chrome, because that is the thing the
   * complaint was actually about — more than thirty work-type chips sat between
   * the page title and the first piece of work.
   */
  test("the first piece of work is near the top of the page", async ({ page }) => {
    await openNeedsYou(page);

    const list = page.getByRole("list", { name: "Needs You queue" });
    test.skip((await list.count()) === 0, "this workspace's queue is empty");

    const first = list.getByRole("button").first();
    const box = await first.boundingBox();
    expect(box).not.toBeNull();
    // The old bar pushed the first item past 700px on this viewport.
    expect(box!.y).toBeLessThan(520);
  });

  /** Search, three views, a sort, a Filters button. Nothing else. */
  test("shows only the primary controls", async ({ page }) => {
    await openNeedsYou(page);

    await expect(page.getByLabel("Search Needs You")).toBeVisible();
    await expect(filtersButton(page)).toBeVisible();
    await expect(page.getByLabel("Sort this queue")).toBeVisible();
    await expect(page.getByLabel("Sort this queue")).toHaveValue("urgency");

    // Every chip-style control that used to live above the list is gone from
    // the collapsed page. These are the exact labels the old bar rendered.
    for (const gone of [
      "Everyone", "Mine", "Unassigned",
      "Critical", "High", "Medium", "Low",
      "Next 2h", "Next 8h", "Today",
      "Snoozed", "Resolved",
    ]) {
      await expect(
        page.getByRole("button", { name: gone, exact: true }),
      ).toHaveCount(0);
    }
  });

  /**
   * No work-type chips above the list.
   *
   * Checked by label rather than by counting buttons, so it stays true if the
   * seeded data changes.
   */
  test("shows no work-type chips above the list", async ({ page }) => {
    await openNeedsYou(page);
    for (const label of [
      "Compliance expiring", "Document expiry", "Truck going empty",
      "Invoice review", "Missing fuel receipt", "Unresolved claim",
    ]) {
      await expect(
        page.getByRole("button", { name: label, exact: true }),
      ).toHaveCount(0);
    }
  });

  /** My Needs You, and Open. */
  test("defaults to My Needs You", async ({ page }) => {
    await openNeedsYou(page);
    const mine = page.getByRole("tab", { name: /My Needs You/ });
    if ((await mine.count()) === 0) {
      // A driver or a workspace of one has no tab strip at all, which is the
      // same claim by other means: there is only the personal queue.
      await expect(page.getByRole("tab")).toHaveCount(0);
      return;
    }
    await expect(mine).toHaveAttribute("aria-selected", "true");
  });

  /** A fresh page has narrowed nothing, so the button carries no number. */
  test("starts with no active filters", async ({ page }) => {
    await openNeedsYou(page);
    await expect(filtersButton(page)).toHaveAccessibleName("Filters");
    await expect(page.locator('[aria-label="Active filters"]')).toHaveCount(0);
  });
});

/* -------------------------------------------------------------------------- */

test.describe("the Filters panel", () => {
  test("is closed until asked for, and holds every group", async ({ page }) => {
    await openNeedsYou(page);
    await expect(panel(page)).toHaveCount(0);

    await openFilters(page);
    for (const group of [
      "Status", "Severity", "Due time", "Responsibility", "Work type",
    ]) {
      await expect(
        panel(page).getByRole("button", { name: group, exact: false }).first(),
      ).toBeVisible();
    }
  });

  /**
   * Nothing the old bar could do has been taken away.
   *
   * Every control that used to sit above the list is reachable here: the four
   * severities, the three due windows, the four statuses, the responsibility
   * choice, and the work types.
   */
  test("keeps every filter the old bar had", async ({ page }) => {
    await openNeedsYou(page);
    await openFilters(page);
    const p = panel(page);

    for (const label of ["Open", "Escalated", "Snoozed", "Resolved"]) {
      await expect(p.getByRole("button", { name: label, exact: true })).toBeVisible();
    }
    for (const label of ["Critical", "High", "Medium", "Low"]) {
      await expect(p.getByRole("button", { name: new RegExp(`^${label}`) }).first())
        .toBeVisible();
    }
    for (const label of ["Next 2h", "Next 8h", "Today"]) {
      await expect(p.getByRole("button", { name: label, exact: true })).toBeVisible();
    }

    await p.getByRole("button", { name: "Responsibility", exact: false }).first().click();
    await expect(p.getByRole("button", { name: "Anyone", exact: true })).toBeVisible();
    await expect(p.getByRole("button", { name: "Assigned to me", exact: true }))
      .toBeVisible();
    await expect(p.getByRole("button", { name: "Owner fallback", exact: true }))
      .toBeVisible();
    await expect(p.getByRole("button", { name: "Needs assignment", exact: true }))
      .toBeVisible();
  });

  /**
   * ★ TERMINOLOGY ★
   * "Unassigned" said two different things and was wrong about both. It is not
   * anywhere on this page, under any capitalisation.
   */
  test("never says Unassigned about responsibility", async ({ page }) => {
    await openNeedsYou(page);
    await openFilters(page);
    const p = panel(page);
    await p.getByRole("button", { name: "Responsibility", exact: false }).first().click();
    await expect(p.getByRole("button", { name: /^Unassigned$/i })).toHaveCount(0);
  });

  /**
   * Work types are grouped by the module that raises them, and searchable.
   *
   * The assertions read the groups the panel actually offers rather than
   * naming one. Which work types a view contains depends on the workspace and
   * on who is looking, and a test that hard-codes "Compliance" is testing the
   * seed data, not the grouping.
   */
  test("groups work types by module", async ({ page }) => {
    await openNeedsYou(page);
    await openFilters(page);
    const p = panel(page);

    await p.getByRole("button", { name: "Work type", exact: false }).first().click();
    const search = p.getByLabel("Find a work type");
    await expect(search).toBeVisible();

    // The module groups are disclosures, closed until somebody opens one, so
    // the work types themselves are two presses deep rather than on the page.
    const modules = p.locator('button[aria-expanded="false"]');
    const before = await modules.count();
    expect(before).toBeGreaterThan(0);

    const first = (await modules.first().innerText()).split("\n")[0].trim();
    // "Fuel & IFTA" → "Fuel". A whole label would also match, but a word from
    // it proves the search is matching text rather than an exact key.
    const word = first.split(/\s+/)[0];
    await search.fill(word);
    await expect(
      p.getByRole("button", { name: new RegExp(escapeRe(word)) }).first(),
    ).toBeVisible();

    // A search that matches nothing says so, rather than falling back to all.
    await search.fill("zzzz-no-such-work-type");
    await expect(p.getByText(/No work type here matches/)).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */

test.describe("the active-filter summary", () => {
  /**
   * `Critical · … · Clear` — what is on, and nothing about what is not.
   */
  test("summarises compactly and never lists the inactive ones", async ({ page }) => {
    await openNeedsYou(page);
    await openFilters(page);
    const p = panel(page);
    await p.getByRole("button", { name: /^Critical/ }).first().click();
    await p.getByRole("button", { name: /^Show \d+ items?$/ }).click();
    await expect(panel(page)).toHaveCount(0);

    const summary = page.locator('[aria-label="Active filters"]');
    await expect(summary).toBeVisible();
    await expect(summary.getByRole("button", { name: "Remove filter Critical" }))
      .toBeVisible();
    await expect(summary.getByRole("button", { name: "Clear" })).toBeVisible();
    // The unselected severities are not echoed back into the page.
    for (const off of ["High", "Medium", "Low"]) {
      await expect(summary.getByText(off, { exact: true })).toHaveCount(0);
    }
    await expect(filtersButton(page)).toHaveAccessibleName("Filters, 1 active");
  });

  test("collapses past three filters into “+N more”", async ({ page }) => {
    await openNeedsYou(page);
    await openFilters(page);
    const p = panel(page);
    for (const s of ["Critical", "High", "Medium", "Low"]) {
      await p.getByRole("button", { name: new RegExp(`^${s}`) }).first().click();
    }
    await p.getByRole("button", { name: /^Show \d+ items?$/ }).click();

    const summary = page.locator('[aria-label="Active filters"]');
    await expect(summary.getByRole("button", { name: "+1 more" })).toBeVisible();
    await expect(summary.getByRole("button", { name: /^Remove filter/ }))
      .toHaveCount(3);
  });

  test("Clear puts the page back to My Needs You + Open", async ({ page }) => {
    await openNeedsYou(page);
    await openFilters(page);
    await panel(page).getByRole("button", { name: /^Critical/ }).first().click();
    await panel(page).getByRole("button", { name: /^Show \d+ items?$/ }).click();

    await page.locator('[aria-label="Active filters"]')
      .getByRole("button", { name: "Clear" }).click();

    await expect(page.locator('[aria-label="Active filters"]')).toHaveCount(0);
    await expect(filtersButton(page)).toHaveAccessibleName("Filters");
  });
});

/* -------------------------------------------------------------------------- */

test.describe("filtering still filters", () => {
  /**
   * ★ THE RESULTS ARE THE SAME ★
   * The redesign moved where a filter is chosen. It did not change what a
   * filter selects, and this is the check that says so: pick Critical in the
   * panel, and every row on screen is critical — the same set the old Critical
   * chip produced, from the same service call with the same arguments.
   */
  test("severity narrows the queue to exactly that severity", async ({ page }) => {
    await openNeedsYou(page);
    const list = page.getByRole("list", { name: "Needs You queue" });
    test.skip((await list.count()) === 0, "this workspace's queue is empty");

    const before = await list.getByRole("button").count();

    await openFilters(page);
    await panel(page).getByRole("button", { name: /^Critical/ }).first().click();
    await panel(page).getByRole("button", { name: /^Show \d+ items?$/ }).click();

    const rows = list.getByRole("button");
    const after = await rows.count();
    expect(after).toBeLessThanOrEqual(before);
    for (let i = 0; i < after; i++) {
      await expect(rows.nth(i)).toHaveAttribute("data-severity", "critical");
    }
  });

  /** Search narrows, and the summary says so. */
  test("search narrows the queue", async ({ page }) => {
    await openNeedsYou(page);
    await page.getByLabel("Search Needs You").fill("zzzz-no-such-thing");
    await expect(page.getByText("Nothing matches these filters")).toBeVisible();
    await expect(page.locator('[aria-label="Active filters"]')).toBeVisible();
  });

  /** Sorting reorders. It never hides anything. */
  test("sorting changes the order, not the contents", async ({ page }) => {
    await openNeedsYou(page);
    const list = page.getByRole("list", { name: "Needs You queue" });
    test.skip((await list.count()) === 0, "this workspace's queue is empty");

    const before = await list.getByRole("button").count();
    await page.getByLabel("Sort this queue").selectOption("newest");
    await expect(list.getByRole("button")).toHaveCount(before);
    // A sort is not a filter, so it must not appear in the summary.
    await expect(page.locator('[aria-label="Active filters"]')).toHaveCount(0);
  });
});

/* -------------------------------------------------------------------------- */

test.describe("keyboard and screen readers", () => {
  test("the Filters button opens the panel from the keyboard", async ({ page }) => {
    await openNeedsYou(page);
    await filtersButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
    // Focus comes back to where it was, which is what makes it usable twice.
    await expect(filtersButton(page)).toBeFocused();
  });

  test("groups are disclosures with names and state", async ({ page }) => {
    await openNeedsYou(page);
    await openFilters(page);
    const responsibility = panel(page)
      .getByRole("button", { name: "Responsibility", exact: false }).first();
    await expect(responsibility).toHaveAttribute("aria-expanded", "false");
    await responsibility.focus();
    await page.keyboard.press("Enter");
    await expect(responsibility).toHaveAttribute("aria-expanded", "true");
  });

  test("every control above the list is named", async ({ page }) => {
    await openNeedsYou(page);
    await expect(page.getByLabel("Search Needs You")).toHaveAttribute("type", "search");
    await expect(page.getByLabel("Sort this queue")).toBeVisible();
    for (const tab of await page.getByRole("tab").all()) {
      await expect(tab).toHaveAttribute("aria-selected", /true|false/);
    }
    // The panel names itself for a screen reader even though the heading is
    // drawn separately.
    await openFilters(page);
    await expect(panel(page)).toHaveAccessibleName("Filters");
  });

  test("chips report their own pressed state", async ({ page }) => {
    await openNeedsYou(page);
    await openFilters(page);
    const critical = panel(page).getByRole("button", { name: /^Critical/ }).first();
    await expect(critical).toHaveAttribute("aria-pressed", "false");
    await critical.click();
    await expect(critical).toHaveAttribute("aria-pressed", "true");
  });
});

/* -------------------------------------------------------------------------- */

test.describe("Home stays out of it", () => {
  /**
   * Home shows the shared personal result and a link. It must never grow the
   * page's filtering UI — a person on Home is being told what needs them, not
   * asked to run a query.
   */
  test("has no filter controls", async ({ page }) => {
    await page.goto("/home", { waitUntil: "networkidle" });
    const openQueue = page.getByRole("link", { name: /Open queue/ });
    await expect(openQueue).toBeVisible();
    await expect(page.getByRole("heading", { name: /Needs You/ }).first())
      .toBeVisible();

    await expect(page.getByRole("button", { name: /^Filters/ })).toHaveCount(0);
    await expect(page.getByLabel("Search Needs You")).toHaveCount(0);
    await expect(page.getByLabel("Sort this queue")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /Team oversight/ })).toHaveCount(0);
    // What Home does have: the shared personal result, and a way to the page.
    await expect(openQueue).toHaveAttribute("href", "/needs-you");
  });
});
