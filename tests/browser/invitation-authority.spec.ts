import { expect, test, type Page } from "@playwright/test";

/**
 * Who can see the Invite Member feature.
 *
 * The rule is one permission — `invitations:create` — from the nav item to the
 * route to the screen to the service call. The service-layer suite proves the
 * refusals; what only a browser can show is the part that matters most here:
 * somebody who may not invite does not SEE that inviting exists.
 *
 * Driven from two real workspaces the demo account already has. Sam owns
 * Northline Freight. Sam is a rate-blind dispatcher in Meridian Dispatch, whose
 * seeded role carries neither invitation key — so Meridian is the "everybody
 * else" case without inventing a fixture for it.
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

test.skip(({ isMobile }) => Boolean(isMobile), "desktop chrome");

test.describe("the owner", () => {
  test("sees the Invitations nav item and can open the invite form", async ({ page }) => {
    await page.goto("/settings/users", { waitUntil: "networkidle" });

    const navItem = page.getByRole("link", { name: "Invitations", exact: true });
    await expect(navItem.first()).toBeVisible();

    await navItem.first().click();
    await expect(page).toHaveURL(/\/settings\/invitations$/);
    await expect(page.getByRole("heading", { name: "Invitations" }).first()).toBeVisible();

    await page.goto("/settings/invitations/new", { waitUntil: "networkidle" });
    // The form itself, not a refusal.
    await expect(page.getByRole("heading", { name: /invite/i }).first()).toBeVisible();
    await expect(page.getByText(/Only the owner can invite people/i)).toHaveCount(0);
  });
});

test.describe("somebody who is not the owner and was given nothing", () => {
  test("has no Invitations nav item at all", async ({ page }) => {
    await page.goto("/home", { waitUntil: "networkidle" });
    await switchTo(page, "Meridian Dispatch");

    await expect(page.getByRole("link", { name: "Invitations", exact: true })).toHaveCount(0);
  });

  test("cannot reach the invite form by typing the URL", async ({ page }) => {
    await page.goto("/home", { waitUntil: "networkidle" });
    await switchTo(page, "Meridian Dispatch");

    await page.goto("/settings/invitations/new", { waitUntil: "networkidle" });
    // Refused — never the form. Whether the route guard or the screen guard
    // answers first does not matter; what matters is that no form appears.
    await expect(page.getByRole("button", { name: /send invitation/i })).toHaveCount(0);
    await expect(page.getByLabel("Their name")).toHaveCount(0);
  });

  test("cannot reach the invitations list either", async ({ page }) => {
    await page.goto("/home", { waitUntil: "networkidle" });
    await switchTo(page, "Meridian Dispatch");

    await page.goto("/settings/invitations", { waitUntil: "networkidle" });
    await expect(page.getByRole("link", { name: /invite someone|send the first invitation/i }))
      .toHaveCount(0);
  });
});
