import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = resolve(import.meta.dirname, "..");

export default defineConfig({
  test: {
    include: ["**/*.integration.test.ts"],
  },
  resolve: {
    alias: [
      {
        find: /^@flarex\/executor$/,
        replacement: resolve(root, "packages/executor/src/index.ts"),
      },
      {
        find: /^@flarex\/executor-http$/,
        replacement: resolve(root, "packages/executor-http/src/index.ts"),
      },
      {
        find: /^@flarex\/executor-nitro$/,
        replacement: resolve(root, "packages/executor-nitro/src/index.ts"),
      },
      {
        find: /^@flarex\/freshness$/,
        replacement: resolve(root, "packages/freshness/src/index.ts"),
      },
      {
        find: /^@flarex\/persistence-postgres\/pglite$/,
        replacement: resolve(root, "packages/persistence-postgres/src/pglite.ts"),
      },
      {
        find: /^@flarex\/persistence-postgres$/,
        replacement: resolve(root, "packages/persistence-postgres/src/index.ts"),
      },
      {
        find: /^flarex\/artifacts$/,
        replacement: resolve(root, "packages/flarex/src/artifacts.ts"),
      },
      {
        find: /^flarex(\/.*)?$/,
        replacement: resolve(root, "packages/flarex/src/index.ts"),
      },
    ],
  },
});
