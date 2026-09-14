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
    include: ["src/**/*.test.ts", "tests/fleet/**/*.test.ts"],
    restoreMocks: true,
  },
});
