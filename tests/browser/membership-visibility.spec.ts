import { expect, test, type Page } from "@playwright/test";

/**
 * A seat granted while the tab is open, and the page that has to notice.
 *
 * This is the claim PR-1 exists to make true, and it is not one a service test
 * can check. `SessionProvider` used to read its memberships off a frozen
 * fixture array, so a `Membership` record could be perfectly correct and the
 * person would still be looking at a workspace that did not include it. The
 * only honest way to tell the difference is to render the page, grant the seat
 * and look again.
 *
 * ★ EVERYTHING BELOW HAPPENS IN ONE PAGE LOAD ★
 * Deliberately, and for two reasons. The store is in memory, so a reload throws
 * the grant away — the same rule the newcomer suite already keeps. And more to
 * the point, "you can see it once you reload" is precisely the behaviour this
 * work exists to replace. So each test loads a page once and never navigates by
 * URL again: it opens a menu, clicks, and watches the app rearrange itself.
 *
 * The grant is driven through the development-only fixture bridge. There is no
 * button to press yet on purpose — deciding who may have a seat is the Access
 * service's, and that is PR-2. See src/lib/session/fixture-bridge.tsx.
 */

/** A carrier the demo account has no seat in, so its arrival is unambiguous. */
const NEW_CARRIER = "Harbor Line Carriers";

interface FixtureWindow {
  __antcolosFixtures?: { grantMembership: (input: unknown) => void };
}

/** The seat a driver gets: their own loads, their own paperwork, their own pay. */
async function grantDriverSeat(page: Page, membershipId = "mem_browser_driver") {
  await page.evaluate((id) => {
    const fixtures = (window as unknown as FixtureWindow).__antcolosFixtures;
    if (!fixtures) throw new Error("The development fixture bridge is not mounted.");
    fixtures.grantMembership({
      scenario: "demo",
      membership: {
        id,
        userId: "usr_sam",
        organizationId: "org_harborline",
        status: "active",
        title: "Driver",
        templateIds: ["tpl_org_harborline_driver"],
        grants: [],
        revocations: [],
        // The narrow record scope that makes a driver seat a driver seat.
        scope: { loads: "assigned", financials: "own" },
        driverProfileId: "dp_browser",
        isOwner: false,
        joinedAt: "2026-09-17T00:00:00.000Z",
      },
      organization: {
        id: "org_harborline",
        type: "CARRIER",
        legalName: "Harbor Line Carriers LLC",
        displayName: "Harbor Line Carriers",
        dotNumber: "4410023",
        timeZone: "America/Chicago",
        createdAt: "2026-09-17T00:00:00.000Z",
      },
    });
  }, membershipId);
}

/**
 * Open the organization switcher.
 *
 * It lives in the sidebar, which a phone keeps behind the navigation drawer —
 * so the drawer comes first there. One helper for both projects, because the
 * claim is about the person seeing their new workspace and not about which
 * layout happened to show it.
 */
async function openOrgSwitcher(page: Page) {
  const drawer = page.getByRole("button", { name: "Open navigation" });
  if (await drawer.isVisible()) await drawer.click();
  await page.getByRole("button", { name: "Switch organization" }).first().click();
}

const carrierItem = (page: Page) =>
  page.getByRole("menuitem", { name: new RegExp(NEW_CARRIER) });

test.describe("a membership granted in the open tab", () => {
  test("appears in the workspace switcher without a reload", async ({ page }) => {
    await page.goto("/home", { waitUntil: "networkidle" });
    const loadedAt = page.url();

    await openOrgSwitcher(page);
    await expect(carrierItem(page)).toHaveCount(0);
    await page.keyboard.press("Escape");

    await grantDriverSeat(page);

    await openOrgSwitcher(page);
    await expect(carrierItem(page)).toBeVisible();
    // Same page load throughout. Nothing navigated and nothing re-fetched the
    // document — the store notified and React re-rendered.
    expect(page.url()).toBe(loadedAt);
  });

  test("becomes usable: switching into it opens the driver portal, still no reload", async ({
    page,
  }) => {
    await page.goto("/home", { waitUntil: "networkidle" });
    await grantDriverSeat(page);

    await openOrgSwitcher(page);
    await carrierItem(page).click();

    // Home recomputed from the new seat and sent them to their portal, because
    // the seat carries a driver profile. That whole chain — store, session,
    // permissions, gate, route — ran without the page being loaded again.
    await expect(page).toHaveURL(/\/driver\/home(\?.*)?$/);
  });

  test("grants nothing beyond the driver seat", async ({ page }) => {
    await page.goto("/home", { waitUntil: "networkidle" });
    await grantDriverSeat(page);

    await openOrgSwitcher(page);
    await carrierItem(page).click();
    await expect(page).toHaveURL(/\/driver\/home(\?.*)?$/);

    // A driver seat is narrow by design, and the permission system that already
    // existed is what makes it so. None of the workspace administration
    // surfaces may appear because somebody was let into their own portal.
    const drawer = page.getByRole("button", { name: "Open navigation" });
    if (await drawer.isVisible()) await drawer.click();
    for (const forbidden of [/^Invitations$/, /^Users$/, /^Permissions$/, /^Workforce$/]) {
      await expect(page.getByRole("link", { name: forbidden })).toHaveCount(0);
    }
  });

  test("is idempotent: granting the same seat twice leaves one", async ({ page }) => {
    await page.goto("/home", { waitUntil: "networkidle" });
    await grantDriverSeat(page, "mem_browser_driver");
    // A retry, with a fresh id, as a caller re-running a half-finished sequence
    // would send. It is the person and the organization that make it the same
    // seat, never the id the caller happened to generate.
    await grantDriverSeat(page, "mem_browser_driver_retry");

    await openOrgSwitcher(page);
    await expect(carrierItem(page)).toHaveCount(1);
  });

  test("leaves the seats the person already held exactly as they were", async ({ page }) => {
    await page.goto("/home", { waitUntil: "networkidle" });
    await openOrgSwitcher(page);
    const before = await page.getByRole("menuitem").count();
    await page.keyboard.press("Escape");

    await grantDriverSeat(page);

    await openOrgSwitcher(page);
    expect(await page.getByRole("menuitem").count()).toBe(before + 1);
  });
});

test.describe("a person who belongs to nothing", () => {
  test("is still sent to onboarding rather than an invented workspace", async ({ page }) => {
    await page.goto("/home?fixture=newcomer", { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/onboarding(\?.*)?$/);
  });
});
