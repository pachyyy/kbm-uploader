import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests cover the pure state machines in lib/machines and the response
// classification in lib/sidia — nothing here needs a DOM or a live SIDIA.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
