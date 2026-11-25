import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: [
      // next-auth imports "next/server" without an extension, which Node's ESM resolver needs
      { find: /^next\/server$/, replacement: "next/server.js" },
      { find: "@", replacement: path.resolve(import.meta.dirname, "src") },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    server: { deps: { inline: ["next-auth"] } },
    testTimeout: 30000,
    env: {
      DATABASE_URL: "file:./test.db",
      NODE_ENV: "test",
      ANALYSIS_PROVIDER: "none",
      WRITING_PROVIDER: "none",
      APP_ENCRYPTION_KEY: "test-only-key",
      AUTH_SECRET: "test-only-secret",
    },
  },
});
