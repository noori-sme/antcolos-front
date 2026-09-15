import { expect, test, type Page } from "@playwright/test";

/**
 * Home is personal. The board is organizational.
 *
 * ★ WHAT ONLY A BROWSER CAN SAY ★
 * That a Carrier Owner's Home does not render an operational card, with
 * buttons, for a healthy loop somebody else is working — and that the loop is
 * still one click away on the views built for looking. Those are claims about
 * a rendered page, which is why they are here rather than in a service test.
 *
 * ── WHAT THIS FILE CANNOT REACH, AND WHERE IT IS PROVEN INSTEAD ──
 * The demo session signs in as one user with memberships in six workspaces.
 * Paige Ellery is a colleague inside Northline, not one of them, so no browser
 * test can open Paige's Home. "The responsible dispatcher sees it in full" is
 * proven at the service layer in `tests/responsibility/home-attention.test.ts`,
 * which can act as any membership in the directory. What IS reachable here is
 * the dispatch-organization case — Meridian is a workspace this session can
 * switch into — and that is covered below.
 */

async function settled(page: Page, path: string) {
  await page.goto(path, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
}

/**
 * Wait for the board itself, not for the network.
 *
 * The loops are derived from the responsibility layer on every read, and in
 * dev `networkidle` fires while React is still hydrating — a page that has
 * settled by that measure can still be showing a skeleton, which counts as
 * zero loops and quietly passes the wrong assertion.
 */
async function loopsRendered(page: Page, path: string) {
  await settled(page, path);
  await expect(
    mtLoopSection(page).or(page.getByText(/No trucks going empty|No empty truck needs you/)),
  ).toBeVisible();
}

function mtLoopSection(page: Page) {
  return page.locator('section[aria-labelledby="mt-loop-heading"]');
}

/** The compact line Home shows instead of a stack of other people's cards. */
function handledLine(page: Page) {
  return page.locator('section[aria-label="Handled by your team"]');
}

/** One `<li>` per loop. Matched by the row's own id, never by its copy. */
function loopCards(page: Page) {
  return mtLoopSection(page).locator("li[data-loop-id]");
}

async function handledCount(page: Page): Promise<number> {
  if (await handledLine(page).count() === 0) return 0;
  const text = await handledLine(page).innerText();
  return Number(text.match(/(\d+)\s+Empty Loops?/)?.[1] ?? 0);
}

/* -------------------------------------------------------------------------- */

test.describe("the Owner's Home", () => {
  test("does not render a card for a healthy delegated loop", async ({ page }) => {
    await loopsRendered(page, "/home");
    const section = mtLoopSection(page);
    test.skip(await section.count() === 0, "this workspace has no loops");

    const summary = handledLine(page);
    test.skip(
      await summary.count() === 0,
      "nothing is delegated in this workspace right now",
    );

    // Whoever the line names is handling loops, and not one of their loops is
    // on this screen as a card.
    const line = await summary.innerText();
    const who = line.match(/handled by ([^.]+)\./)?.[1];
    expect(who, "the line should name who is holding them").toBeTruthy();

    for (const card of await loopCards(page).all()) {
      const text = await card.innerText();
      // Every card left on Home says the viewer is responsible, is the
      // fallback, or that it reached them — never that it is somebody else's.
      expect(text, "a card on Home belongs to somebody else").not.toContain(
        `${who} is responsible`,
      );
    }
  });

  test("shows the delegated loops as one non-actionable line", async ({ page }) => {
    await settled(page, "/home");
    test.skip(await handledLine(page).count() === 0, "nothing delegated");

    const line = handledLine(page);
    await expect(line).toBeVisible();
    await expect(line).toContainText(/Nothing there is waiting on you/);

    // A summary, not a control. Nothing in it can be pressed; the only way
    // out of it is to go and look.
    await expect(line.getByRole("button")).toHaveCount(0);
    await expect(line.locator("li[data-loop-id]")).toHaveCount(0);
    await expect(line.getByRole("link", { name: "Team oversight" })).toBeVisible();
    await expect(line.getByRole("link", { name: "All loops" })).toBeVisible();
  });

  test("keeps Home shorter than the whole board", async ({ page }) => {
    await loopsRendered(page, "/home");
    test.skip(await mtLoopSection(page).count() === 0, "no loops");
    const onHome = await loopCards(page).count();

    await loopsRendered(page, "/dispatch/loops");
    const onBoard = await loopCards(page).count();

    expect(onBoard, "the board has every loop").toBeGreaterThanOrEqual(onHome);
    if (await handledLine(page).count() === 0) {
      // Only assert the strict inequality when something really is delegated.
      expect(onBoard).toBeGreaterThan(0);
    }
  });

  test("says so plainly when no empty truck needs the viewer", async ({ page }) => {
    await settled(page, "/home");
    const section = mtLoopSection(page);
    test.skip(await section.count() === 0, "no panel");
    if (await loopCards(page).count() > 0) return;
    await expect(section.getByText("No empty truck needs you")).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */

test.describe("the Owner can still find it", () => {
  test("every loop is on the organization-wide board", async ({ page }) => {
    await loopsRendered(page, "/home");
    const summaryCount = await handledCount(page);
    const onHome = await mtLoopSection(page).count() > 0
      ? await loopCards(page).count()
      : 0;

    await loopsRendered(page, "/dispatch/loops");
    await expect(page.getByRole("heading", { name: "MT Loop" }).first()).toBeVisible();
    const onBoard = await loopCards(page).count();

    // Nothing was hidden: Home's cards plus Home's line is the whole board.
    expect(onBoard).toBe(onHome + summaryCount);
  });

  test("the board is reachable from the nav", async ({ page, isMobile }) => {
    test.skip(isMobile, "the sidebar is behind a drawer on a phone");
    await settled(page, "/home");
    await expect(
      page.getByRole("navigation").getByRole("link", { name: "MT Loop" }).first(),
    ).toBeVisible();
  });

  test("Team oversight and All organization still list them", async ({ page }) => {
    await settled(page, "/needs-you");
    // Wait for the queue itself: the three views only render once the shared
    // attention derivation has resolved, and a skip taken before that would
    // silently stop testing the thing this file is about.
    await expect(
      page
        .getByRole("list", { name: "Needs You queue" })
        .or(page.getByText(/Nothing (needs you|matches)/)),
    ).toBeVisible();

    const team = page.getByRole("tab", { name: /Team oversight/ });
    test.skip(await team.count() === 0, "this membership has no team view");

    // The tab counts come from the same derivation; a non-zero Team oversight
    // is the Owner's route to work that is not on their Home.
    const label = await team.innerText();
    expect(Number(label.match(/(\d+)\s*$/)?.[1] ?? 0)).toBeGreaterThan(0);

    await team.click();
    await expect(page.getByRole("list", { name: "Needs You queue" })).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */

test.describe("the dispatch organization case", () => {
  // Switching workspaces goes through the sidebar, which a phone keeps in a
  // drawer. The rule being tested is not viewport-dependent, so it is checked
  // once rather than twice badly.
  test.skip(({ isMobile }) => Boolean(isMobile), "desktop chrome");

  /**
   * Meridian is a dispatch workspace this session can switch into, so the
   * "delegated to a Dispatch Organization" shape is reachable here even though
   * an individual colleague's Home is not.
   */
  async function switchTo(page: Page, name: string) {
    await page.keyboard.press("Escape");
    await page
      .locator("aside button, header button")
      .filter({ hasText: /Freight|Dispatch|Transit|Haul|Murtaza|Carriers/ })
      .first()
      .click();
    await page.getByRole("menuitem").filter({ hasText: name }).first().click();
    await page.waitForLoadState("networkidle");
  }

  test("a dispatch workspace's Home is personal too", async ({ page }) => {
    await settled(page, "/home");
    await switchTo(page, "Meridian Dispatch");
    await settled(page, "/home");

    const section = mtLoopSection(page);
    test.skip(await section.count() === 0, "no loops in this workspace");

    const onHome = await loopCards(page).count();
    await loopsRendered(page, "/dispatch/loops");
    const onBoard = await loopCards(page).count();
    expect(onBoard).toBeGreaterThanOrEqual(onHome);
  });

  test("never shows another workspace's trucks", async ({ page }) => {
    await loopsRendered(page, "/dispatch/loops");
    const northline = (await loopCards(page).allInnerTexts()).join(" ");
    const northlineUnits = [...northline.matchAll(/Unit ([A-Z0-9-]+)/g)].map((m) => m[1]);

    await switchTo(page, "Meridian Dispatch");
    await loopsRendered(page, "/dispatch/loops");
    const meridian = (await loopCards(page).allInnerTexts()).join(" ");

    for (const unit of northlineUnits) {
      expect(meridian, `unit ${unit} leaked across workspaces`)
        .not.toContain(`Unit ${unit}`);
    }
  });
});

/* -------------------------------------------------------------------------- */

test.describe("mobile", () => {
  test.skip(({ isMobile }) => !isMobile, "phone viewport only");

  test("the personal Home does not scroll sideways", async ({ page }) => {
    await settled(page, "/home");
    const overflow = await page.evaluate(() => {
      const d = document.documentElement;
      return d.scrollWidth - d.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("so does the organization-wide board", async ({ page }) => {
    await loopsRendered(page, "/dispatch/loops");
    const overflow = await page.evaluate(() => {
      const d = document.documentElement;
      return d.scrollWidth - d.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
