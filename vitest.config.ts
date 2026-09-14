import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Unit tests for the parts of Antcolos that must be right rather than merely
 * look right: money arithmetic, the settlement status machine, and the service
 * layer's isolation, privacy and immutability rules.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
