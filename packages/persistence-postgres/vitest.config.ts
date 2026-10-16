import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fsModuleCache: true,
    exclude: [...configDefaults.exclude, "test/performance/relations/**"],
  },
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(
        new URL("./test/support/cloudflareWorkersStub.ts", import.meta.url),
      ),
    },
  },
});
