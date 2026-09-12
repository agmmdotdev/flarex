import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { conditions: ["source"] },
  test: { globals: false, maxWorkers: 1, fileParallelism: false,
    setupFiles: ["./test/support/native-link-routing-setup.ts"],
    include: ["../medusa-modules-sdk/src/__tests__/remote-link.spec.ts"] },
});
