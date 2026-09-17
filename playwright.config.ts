import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests for the surfaces whose whole point is what a person SEES.
 *
 * Most of this app is tested at the service layer, where the rules live. A few
 * things cannot be: whether the top of Needs You is compact, whether a filter
 * is hidden until somebody asks for it, whether a phone can scroll sideways.
 * Those are claims about a rendered page, and the only honest way to check them
 * is to render the page.
 *
 * The app runs entirely on in-memory mocks, so there is no fixture to seed and
 * no backend to stand up — `next dev` is the whole environment.
 */
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    /**
     * Use a Chromium that is already on the machine, when there is one.
     *
     * Sandboxes and CI images often ship a browser whose build number does not
     * match the pinned `@playwright/test`, and Playwright refuses it by default
     * with "run npx playwright install" — which is exactly what an image with a
     * pre-installed browser is trying to avoid. Set `CHROMIUM_PATH` and the
     * suite uses it; leave it unset and Playwright's own download is used.
     */
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {},
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --port 3100",
    /**
     * The second gate on the development fixture bridge.
     *
     * The bridge needs both a development build AND this, so an ordinary
     * `npm run dev` does not attach it and a production build cannot. Only this
     * server, started by this suite, does. See src/lib/session/fixture-bridge.tsx.
     */
    env: { NEXT_PUBLIC_ANTCOLOS_E2E: "1" },
    // `localhost`, not `127.0.0.1`: `next dev` blocks cross-origin requests to
    // its own HMR endpoint, and a page whose HMR socket is refused never
    // finishes hydrating — every click then does nothing.
    url: "http://localhost:3100/home",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
