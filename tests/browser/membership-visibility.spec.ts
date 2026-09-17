import { expect, test, type Page } from "@playwright/test";

/**
 * A seat created by somebody ACCEPTING AN INVITATION, and the page that has to
 * notice.
 *
 * ★ WHAT CHANGED SINCE PR-1 ★
 *
 * PR-1 could only make this claim through a development-only fixture bridge:
 * it had made a granted seat observable without adding anything that granted
 * one, so the browser suite drove the store directly through
 * `window.__antcolosFixtures`. That file is gone. Every seat below is created
 * by filling in a form and pressing Accept, exactly as a person would, and the
 * Access service decides whether it happens.
 *
 * ★ EVERYTHING IN EACH TEST HAPPENS IN ONE PAGE LOAD ★
 * Deliberately. The store is in memory, so a reload throws the acceptance away
 * — and more to the point, "you can see it once you reload" is precisely the
 * behaviour this work exists to replace. So each test loads a page once and
 * then only clicks.
 *
 * `?fixture=newcomer` runs the tab as Alex Rivera, a real account that belongs
 * to nothing. It is the fixture switch that already existed: it chooses which
 * mock person the tab is, and grants nothing.
 */

const NEW_CARRIER = "Northline Freight";

/** The licence a brand-new driver supplies while accepting. */
async function fillLicence(page: Page) {
  await page.getByLabel("Full legal name").fill("Alex Rivera");
  await page.getByLabel("Driver license / CDL number").fill("R9920184471");
  await page.getByLabel("Issuing state").selectOption("IL");
  const expiry = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("License expiration date").fill(expiry);
}

async function acceptAsNewDriver(page: Page) {
  await page.goto("/invitation/INV-NEWDRIVER?fixture=newcomer", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: /You've been invited to/ })).toBeVisible();
  await fillLicence(page);
  await page.getByTestId("accept-invitation").click();
  await expect(page.getByTestId("acceptance-confirmed")).toBeVisible();
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

test.describe("accepting an invitation", () => {
  test("lets the person in, and the session sees it without a reload", async ({ page }) => {
    await acceptAsNewDriver(page);
    const loadedAt = page.url();

    // Client-side navigation only. The seat has to survive it, because nothing
    // re-fetches the document.
    await page.getByRole("button", { name: "Go to Antcolos" }).click();

    // Home recomputed from the new seat and sent them to their portal, because
    // the seat carries a driver profile. That whole chain — service, store,
    // session, permissions, gate, route — ran without the page being loaded
    // again.
    await expect(page).toHaveURL(/\/driver\/home(\?.*)?$/);
    expect(new URL(page.url()).origin).toBe(new URL(loadedAt).origin);

    await openOrgSwitcher(page);
    await expect(page.getByRole("menuitem", { name: new RegExp(NEW_CARRIER) })).toBeVisible();
  });

  test("says plainly that accepting is not starting", async ({ page }) => {
    await acceptAsNewDriver(page);
    // The start date is ABSENT on purpose, and the screen says so rather than
    // showing an empty field somebody would read as a bug.
    await expect(page.getByTestId("no-start-date")).toContainText("Not recorded yet");
  });

  test("names the restricted paperwork it did not hand over", async ({ page }) => {
    await acceptAsNewDriver(page);
    const withheld = page.getByTestId("withheld-documents");
    await expect(withheld).toBeVisible();
    await expect(withheld).toContainText("DOT employment application");
    await expect(withheld).toContainText("Motor vehicle record");
  });

  test("grants nothing beyond the driver seat", async ({ page }) => {
    await acceptAsNewDriver(page);
    await page.getByRole("button", { name: "Go to Antcolos" }).click();
    await expect(page).toHaveURL(/\/driver\/home(\?.*)?$/);

    // A driver seat is narrow by design, and the permission system that already
    // existed is what makes it so. None of the workspace administration
    // surfaces may appear because somebody was let into their own portal.
    const drawer = page.getByRole("button", { name: "Open navigation" });
    if (await drawer.isVisible()) await drawer.click();
    for (const forbidden of [/^Invitations$/, /^People$/, /^Permissions$/, /^Workforce$/]) {
      await expect(page.getByRole("link", { name: forbidden })).toHaveCount(0);
    }
  });

  test("refuses somebody the invitation was not addressed to", async ({ page }) => {
    // Signed in as Sam, opening the link that names Alex.
    await page.goto("/invitation/INV-NEWDRIVER", { waitUntil: "networkidle" });
    await expect(
      page.getByRole("heading", { name: /isn't for this account/ }),
    ).toBeVisible();
    await expect(page.getByTestId("accept-invitation")).toHaveCount(0);
  });

  test("refuses an invitation that has been withdrawn", async ({ page }) => {
    await page.goto("/invitation/INV-REVOKED", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: /withdrawn/i })).toBeVisible();
    await expect(page.getByTestId("accept-invitation")).toHaveCount(0);
  });
});

test.describe("a person who belongs to nothing", () => {
  test("is still sent to onboarding rather than an invented workspace", async ({ page }) => {
    await page.goto("/home?fixture=newcomer", { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/onboarding(\?.*)?$/);
  });
});

/**
 * ★ THE RISK THIS WHOLE DESIGN CREATES, AND HAS TO CLOSE ★
 *
 * While the roster was frozen, a seat could not end underneath somebody. Now it
 * can, and the thing that must not happen is that they carry on in a workspace
 * they no longer belong to — with its permissions, and with its answers on
 * screen — because the session went on resolving them onto a seat that ended.
 *
 * Driven entirely by product buttons: the office-manager invitation carries
 * `members:view` and `members:suspend`, which is what makes the People screen
 * reachable and what makes ending a seat something you can press.
 */
test.describe("when a seat ends underneath the person", () => {
  async function joinAsOfficeManager(page: Page) {
    await page.goto("/invitation/INV-NEWEMPLOYEE?fixture=newcomer", { waitUntil: "networkidle" });
    await page.getByTestId("accept-invitation").click();
    await expect(page.getByTestId("acceptance-confirmed")).toBeVisible();
    await page.getByRole("button", { name: "Go to Antcolos" }).click();
    await expect(page).toHaveURL(/\/home(\?.*)?$/);
  }

  test("the roster shows who is actually in the organization", async ({ page }) => {
    await joinAsOfficeManager(page);

    const drawer = page.getByRole("button", { name: "Open navigation" });
    if (await drawer.isVisible()) await drawer.click();
    await page.getByRole("link", { name: "People", exact: true }).first().click();

    await expect(page.getByTestId("people-list")).toBeVisible();
    // Themselves, plus the owner who invited them. Read from the one membership
    // store — there is no second roster anywhere.
    await expect(page.getByTestId("person-row")).toHaveCount(2);
    await expect(page.getByTestId("leave-organization")).toHaveCount(1);
  });

  test("stops being their workspace instead of leaving stale permissions", async ({ page }) => {
    await joinAsOfficeManager(page);

    const drawer = page.getByRole("button", { name: "Open navigation" });
    if (await drawer.isVisible()) await drawer.click();
    await page.getByRole("link", { name: "People", exact: true }).first().click();
    await expect(page.getByTestId("people-list")).toBeVisible();

    // They put their own seat down.
    await page.getByTestId("leave-organization").click();

    // The very page they are standing on stops being theirs. Before the
    // "usable seats only" rule, the session went on resolving them onto the
    // seat that had ended and they kept an office manager's permissions in a
    // workspace they had left.
    await expect(
      page.getByRole("heading", { name: "You do not have access to this page" }),
    ).toBeVisible();
    await expect(page.getByTestId("people-list")).toHaveCount(0);

    // And they belong to nothing, rather than to an invented workspace. Same
    // page load throughout: the store notified and React re-rendered.
    await page.getByRole("link", { name: "Back to home" }).click();
    await expect(page).toHaveURL(/\/onboarding(\?.*)?$/);
  });
});
