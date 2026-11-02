import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // `server-only` throws outside the React server bundle; unit tests run in plain Node.
      "server-only": path.resolve(import.meta.dirname, "./tests/stubs/empty.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: { APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") },
  },
});
