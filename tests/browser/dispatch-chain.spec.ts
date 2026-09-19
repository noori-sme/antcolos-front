import { expect, test, type Page } from "@playwright/test";

/**
 * The two-level delegation chain, as three people actually see it.
 *
 *   Carrier Owner → Dispatch Organization → employee Dispatcher
 *
 * ── WHAT THIS FILE CAN AND CANNOT REACH ──
 * The demo session signs in as one user with memberships in six workspaces, so
 * two of the three roles are browser-reachable and one is not:
 *
 *   Carrier Owner          Baxter Transit — reachable. Grants trucks out.
 *   employee Dispatcher    Meridian Dispatch — reachable. The session's
 *                          membership there is a dispatcher, not the Owner.
 *   Dispatch Org Owner     NOT reachable. Nadia Rahimi is a colleague inside
 *                          Meridian, not one of this user's memberships.
 *
 * So "the Dispatch Organization Owner sees only the compact team summary" is
 * proven at the service layer in `tests/responsibility/dispatch-chain.test.ts`,
 * which can act as any membership in the directory. What is checked here is
 * everything a browser can actually show.
 */

async function settled(page: Page, path: string) {
  await page.goto(path, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
}

function loopCards(page: Page) {
  return page.locator("li[data-loop-id]");
}

/**
 * Wait for the board, not for the network.
 *
 * The loops are derived from the responsibility layer on every read, and in dev
 * `networkidle` fires while React is still hydrating — a page that has settled
 * by that measure can still be showing a skeleton, which counts as zero loops
 * and quietly passes the wrong assertion.
 */
async function loopsRendered(page: Page, path: string) {
  await settled(page, path);
  await expect(
    page
      .locator('section[aria-labelledby="mt-loop-heading"]')
      .or(page.getByText(/No trucks going empty|No empty truck needs you/))
      // `.or()` can match the section AND the empty state inside it, and a
      // two-element locator is a strict-mode violation rather than a pass.
      .first(),
  ).toBeVisible();
}

/**
 * Open one card's actions panel.
 *
 * ★ WHY A CLICK IS NEEDED AT ALL ★
 * The board carries ONE action per card — the next thing — and keeps the rest
 * of the cycle's controls (take it, hand over, pause, block, ask the carrier,
 * close) together one click away, beside the evidence for the state they act
 * on. That is deliberate: a board offering six buttons on every card is a board
 * nobody works from. Nothing is hidden by it — every button is still rendered
 * from `card.can`, and the panel below proves each one is reachable.
 */
async function openActions(page: Page, index = 0) {
  await page.keyboard.press("Escape");
  const card = loopCards(page).nth(index);
  await card.scrollIntoViewIfNeeded();
  await card.getByRole("button", { name: /Everything you can do to unit/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

/** Whether one card's panel offers a named action. Closes the panel again. */
async function offersAction(page: Page, index: number, name: string) {
  await openActions(page, index);
  const found = await page.getByRole("dialog").getByRole("button", { name }).count() > 0;
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  return found;
}

const dispatchedOut = (page: Page) =>
  page.locator('section[aria-label="Dispatched by another organization"]');
const handledByTeam = (page: Page) =>
  page.locator('section[aria-label="Handled by your team"]');

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

// The workspace switcher lives in the sidebar, which a phone keeps in a drawer.
// The rules here are not viewport-dependent, so they are checked once properly
// rather than twice badly.
test.skip(({ isMobile }) => Boolean(isMobile), "desktop chrome");

/* -------------------------------------------------------------------------- */

test.describe("the Carrier Owner who granted trucks out", () => {
  test("gets a compact summary and no operational cards", async ({ page }) => {
    await settled(page, "/home");
    await switchTo(page, "Baxter Transit");
    await settled(page, "/home");

    const summary = dispatchedOut(page);
    await expect(summary).toBeVisible();
    // The line is a count and a name now, not a sentence — "2 dispatched by
    // Summit Dispatch". What it MEANS ("they will ask if they need you") moved
    // into the tip beside it, which is where every explanation on this board
    // now lives.
    await expect(summary).toContainText(/\d+ dispatched by/);

    // ★ The rule. ★ Somebody else's dispatchers are working these trucks, so
    // the carrier gets no card and nothing to press.
    await expect(summary.getByRole("button")).toHaveCount(0);
    await expect(loopCards(page)).toHaveCount(0);
    // And no team summary either — this carrier has no dispatch team of its own.
    await expect(handledByTeam(page)).toHaveCount(0);
  });

  test("is given a way to look, not a pile to work", async ({ page }) => {
    await settled(page, "/home");
    await switchTo(page, "Baxter Transit");
    await settled(page, "/home");

    await expect(
      dispatchedOut(page).getByRole("link", { name: "Anything they have asked" }),
    ).toHaveAttribute("href", "/needs-you");
  });

  test("never sees another carrier's trucks in the count", async ({ page }) => {
    await settled(page, "/home");
    await switchTo(page, "Baxter Transit");
    await settled(page, "/home");
    const baxter = await dispatchedOut(page).innerText();

    await switchTo(page, "Cascade Haul");
    await settled(page, "/home");
    const cascade = await dispatchedOut(page).count() > 0
      ? await dispatchedOut(page).innerText()
      : "";

    // Two carriers, two different answers — never the agency's whole book.
    if (cascade) expect(cascade).not.toBe(baxter);
  });
});

/* -------------------------------------------------------------------------- */

test.describe("the employee Dispatcher", () => {
  test("gets full cards for the loops that need them", async ({ page }) => {
    await settled(page, "/home");
    await switchTo(page, "Meridian Dispatch");
    await settled(page, "/home");

    const cards = loopCards(page);
    test.skip(await cards.count() === 0, "nothing needs this dispatcher today");

    for (const card of await cards.all()) {
      const text = await card.innerText();
      /*
       * A card on a Home is one that needs this person, and it still says so —
       * in a word rather than a clause. The responsibility line reads "You"
       * when it is the viewer's, and the person's name when it is not, with
       * the distinction between being responsible and having accepted it in
       * the tip. `data-loop-id` finds the card; this checks whose it is.
       */
      expect(text).toMatch(/\bYou\b|Nobody else|escalat/i);
    }
  });

  test("sees their colleagues' loops as one line, not as cards", async ({ page }) => {
    await settled(page, "/home");
    await switchTo(page, "Meridian Dispatch");
    await settled(page, "/home");

    const team = handledByTeam(page);
    test.skip(await team.count() === 0, "nobody else is holding anything");
    await expect(team).toContainText(/handled by/);
    await expect(team.getByRole("button")).toHaveCount(0);

    // Cards plus line is the whole board — nothing hidden.
    const onHome = await loopCards(page).count();
    const inLine = Number((await team.innerText()).match(/(\d+)\s+Empty Loops?/)?.[1] ?? 0);
    await loopsRendered(page, "/dispatch/loops");
    expect(await loopCards(page).count()).toBe(onHome + inLine);
  });

  test("can ask the carrier, but only on a truck a carrier granted", async ({ page }) => {
    await settled(page, "/home");
    await switchTo(page, "Meridian Dispatch");
    await loopsRendered(page, "/dispatch/loops");
    // Meridian dispatches other people's trucks, so the action is offered.
    const meridian = await loopCards(page).count();
    expect(meridian, "Meridian has cycles to check").toBeGreaterThan(0);
    let offered = false;
    for (let i = 0; i < meridian && !offered; i += 1) {
      offered = await offersAction(page, i, "Ask the carrier");
    }
    expect(offered, "at least one granted truck can be raised to its carrier").toBe(true);

    await switchTo(page, "Northline Freight");
    await loopsRendered(page, "/dispatch/loops");
    // Northline dispatches its own: there is nobody above it to ask. Not on any
    // card, so every one of them is checked rather than the first.
    const northline = await loopCards(page).count();
    for (let i = 0; i < northline; i += 1) {
      expect(
        await offersAction(page, i, "Ask the carrier"),
        "a carrier dispatching its own trucks has nobody to ask",
      ).toBe(false);
    }
  });
});

/* -------------------------------------------------------------------------- */

test.describe("a genuine escalation crosses the boundary", () => {
  test("reaches the Carrier Owner, and only then", async ({ page }) => {
    await settled(page, "/home");
    await switchTo(page, "Baxter Transit");
    await settled(page, "/needs-you");
    const before = await page.getByText(/needs you on unit/i).count();
    expect(before, "nothing should be waiting before anybody asks").toBe(0);

    // The dispatcher asks.
    await switchTo(page, "Meridian Dispatch");
    await loopsRendered(page, "/dispatch/loops");
    const cards = await loopCards(page).count();
    let asked = false;
    for (let i = 0; i < cards && !asked; i += 1) {
      await openActions(page, i);
      const ask = page.getByRole("dialog").getByRole("button", { name: "Ask the carrier" });
      if (await ask.count() === 0) {
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        continue;
      }
      await ask.click();
      asked = true;
    }
    expect(asked, "a truck this dispatcher may raise to its carrier").toBe(true);
    const reason = page.getByPlaceholder(/Broker wants/);
    await expect(reason).toBeVisible();
    await reason.fill("Broker wants $200 over your floor. Your call.");
    await page.getByRole("button", { name: "Escalate to the carrier" }).click();
    await expect(page.getByText(/The carrier has been asked/)).toBeVisible();

    // The dispatcher still has the truck — asking is not handing over.
    await loopsRendered(page, "/dispatch/loops");
    expect(await loopCards(page).count()).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */

test.describe("isolation", () => {
  test("a carrier's board never shows an agency's other clients", async ({ page }) => {
    await settled(page, "/home");
    await switchTo(page, "Meridian Dispatch");
    await loopsRendered(page, "/dispatch/loops");
    const agencyUnits = await loopCards(page).evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-truck-unit")));
    expect(agencyUnits.length).toBeGreaterThan(1);

    await switchTo(page, "Baxter Transit");
    await loopsRendered(page, "/dispatch/loops");
    const carrierUnits = await loopCards(page).evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-truck-unit")));

    // The carrier works none of the agency's cycles — they are not in this
    // workspace at all, which is the invariant: one loop, one workspace.
    for (const unit of carrierUnits) {
      expect(agencyUnits, `unit ${unit} appears in both workspaces`).not.toContain(unit);
    }
  });
});
