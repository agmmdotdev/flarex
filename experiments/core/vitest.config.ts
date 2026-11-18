import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.mjs"],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
  resolve: { dedupe: ["effect"], alias: {
    "cloudflare:workers": fileURLToPath(new URL("../../packages/persistence-postgres/test/support/cloudflareWorkersStub.ts", import.meta.url)),
  } },
});
