import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Tests run in node, not a browser.
 *
 * What is worth testing here is the reconciliation and the access rules — the
 * parts that decide what a person is told and what they are allowed to see.
 * Those live in plain modules behind the service seam, so they can be exercised
 * without a DOM, a session provider or a network.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    restoreMocks: true,
  },
});
