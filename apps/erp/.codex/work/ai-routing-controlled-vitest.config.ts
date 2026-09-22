import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true
  },
  test: {
    include: [".codex/work/ai-routing-192793050201-controlled-v2.test.ts"],
    environment: "node"
  }
});
