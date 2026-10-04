import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // the DB suites share one throwaway Postgres: run files one at a time
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
