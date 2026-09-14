import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Tests run against the real modules, not doubles: the same state machines,
 * the same mock service adapter and the same integration boundary the app
 * uses. A test that stubbed the enforcement layer would be testing nothing.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
  },
});
