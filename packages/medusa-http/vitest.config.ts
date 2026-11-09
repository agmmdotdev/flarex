import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: { conditions: ["source"] },
  test: { include: ["test/**/*.test.ts"], maxWorkers: 1, fileParallelism: false },
})
