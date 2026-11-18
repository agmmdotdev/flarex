import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: {
    "@medusajs/workflows-sdk/durable/engine": fileURLToPath(new URL("./src/durable/engine/index.ts", import.meta.url)),
  } },
  test: {
    globals: false,
    maxWorkers: 1,
    fileParallelism: false,
    // Native CommonJS registries must share Node's module cache across SDK imports.
    server: { deps: { external: [/^@medusajs\/orchestration(?:\/|$)/, /[/\\]medusa-orchestration[/\\]dist[/\\]/,
      /[/\\]medusa-utils[/\\]dist[/\\]/] } },
  },
});
