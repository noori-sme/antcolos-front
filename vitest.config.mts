import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Tests run against the service layer and the pure domain logic, in Node.
 *
 * That is deliberate: the boundary worth testing is the one the screens cannot
 * reach past — permissions, scope, organization isolation, applicability and
 * status — not the rendering of a badge.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    restoreMocks: true,
  },
});
