import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Tests run against the SERVICE LAYER, not the screens.
 *
 * The rules worth protecting — versioning, organization isolation, permissions,
 * relationship scope, which requirements each workspace type is asked for — are
 * all enforced below the UI. A test that clicked a button would prove the
 * button; these prove the boundary.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "tests/fleet/**/*.test.ts",
      "tests/compliance/**/*.test.ts",
      "tests/contracts/**/*.test.ts",
      "tests/audit/**/*.test.ts",
      "tests/eld/**/*.test.ts",
      "tests/responsibility/**/*.test.ts",
    ],
    restoreMocks: true,
    // The mock services deliberately sleep, so a scenario that walks a piece of
    // work through several actions spends most of its time in simulated
    // latency rather than in logic. The default 5s is not enough for those and
    // is not a useful signal about them.
    testTimeout: 30_000,
  },
});
