import { defineConfig } from "vitest/config"

/** Resolve the linked native packages as one source graph. Mixing transformed
 * source entrypoints with external CJS subpaths duplicates module registries. */
export default defineConfig({
  resolve: { conditions: ["source", "module", "node", "development"] },
  ssr: { noExternal: [/^@medusajs\//], resolve: { conditions: ["source", "module", "node", "development"] } },
  test: { maxWorkers: 1, fileParallelism: false, server: { deps: { inline: [/^@medusajs\//] } } },
})
