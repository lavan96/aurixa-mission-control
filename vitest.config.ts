import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Vitest runs unit tests in a Node environment with the same `@/` path alias the
// app uses. It does not load the Lovable/TanStack Vite plugins — these are plain
// unit tests of pure functions and lightly-mocked server helpers.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
