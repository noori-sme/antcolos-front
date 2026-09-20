import { expect, test, type Page } from "@playwright/test";

/**
 * The sidebar has three shapes, and which one you get is a claim about a
 * rendered page.
 *
 * ★ WHAT ONLY A BROWSER CAN SAY ★
 * That the icon rail still shows every destination once the labels are gone,
 * that "hidden" leaves the logo and nothing else, that the drawer it opens
 * closes on Escape, and that the choice survives a reload. None of that is
 * reachable from a service test — there is no service involved.
 *
 * Desktop only, deliberately. Below `lg` the shell has always been the phone
 * drawer plus the bottom tab bar, and the display mode does not touch it.
 */
test.describe("sidebar display modes", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "desktop chrome");

  const rail = (page: Page) => page.locator("aside[data-sidebar-mode]");
  const modeMenu = (page: Page) =>
    page.getByRole("button", { name: /^Sidebar: / });
  const logoTrigger = (page: Page) =>
    page.getByRole("button", { name: "Antcolos — open navigation" });

  async function chooseMode(page: Page, option: string) {
    await modeMenu(page).click();
    await page.getByRole("menuitem", { name: option }).click();
  }

  async function settled(page: Page) {
    await page.goto("/home", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  }

  test("starts docked with labels, and the nav is the labelled one", async ({ page }) => {
    await settled(page);
    await expect(rail(page)).toHaveAttribute("data-sidebar-mode", "expanded");
    await expect(
      rail(page).getByRole("link", { name: "Dispatch", exact: true }),
    ).toHaveText(/Dispatch/);
    expect((await rail(page).boundingBox())!.width).toBeGreaterThan(200);
  });

  test("the icon rail keeps every destination, without the labels", async ({ page }) => {
    await settled(page);

    const labelled = await rail(page).getByRole("link").count();
    await chooseMode(page, "Icons only");
    await expect(rail(page)).toHaveAttribute("data-sidebar-mode", "icon");

    // Same links, same order — only the visible text is gone.
    await expect(rail(page).getByRole("link")).toHaveCount(labelled);
    const dispatch = rail(page).getByRole("link", { name: "Dispatch", exact: true });
    await expect(dispatch).toBeVisible();
    // The label is still announced, it is just no longer drawn: the rail is a
    // third of the docked width, and the text that names the link is sr-only.
    await expect(dispatch.locator("span.sr-only")).toHaveText("Dispatch");
    expect((await rail(page).boundingBox())!.width).toBeLessThan(96);

    // The current route is still obvious without a word on screen.
    await dispatch.click();
    await expect(page).toHaveURL(/\/dispatch/);
    await expect(
      rail(page).getByRole("link", { name: "Dispatch", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("hidden leaves the logo, which opens the drawer and Escape closes it", async ({ page }) => {
    await settled(page);
    await chooseMode(page, "Hidden");

    await expect(rail(page)).toHaveCount(0);
    await expect(logoTrigger(page)).toBeVisible();

    await logoTrigger(page).click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Dispatch", exact: true })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();

    // Clicking away closes it too, and the page underneath is untouched.
    await logoTrigger(page).click();
    await expect(drawer).toBeVisible();
    await page.mouse.click(1100, 500);
    await expect(drawer).toBeHidden();
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  });

  test("following a link from the drawer navigates and closes it", async ({ page }) => {
    await settled(page);
    await chooseMode(page, "Hidden");
    await logoTrigger(page).click();

    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await drawer.getByRole("link", { name: "Dispatch", exact: true }).click();

    await expect(page).toHaveURL(/\/dispatch/);
    await expect(drawer).toBeHidden();
  });

  test("the choice survives a reload", async ({ page }) => {
    await settled(page);
    await chooseMode(page, "Icons only");
    await expect(rail(page)).toHaveAttribute("data-sidebar-mode", "icon");

    await page.reload({ waitUntil: "networkidle" });
    await expect(rail(page)).toHaveAttribute("data-sidebar-mode", "icon");

    // And it can be put back, from the same control, in every mode.
    await chooseMode(page, "Expanded");
    await expect(rail(page)).toHaveAttribute("data-sidebar-mode", "expanded");
  });
});
