import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Tests run in Node against the service layer and the pure domain modules —
 * the two places a fuel or IFTA mistake is expensive. There is no DOM here on
 * purpose: what needs proving is that the boundary refuses the right calls and
 * that the arithmetic is right, and neither of those needs a browser.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    restoreMocks: true,
  },
});
