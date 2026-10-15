import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fsModuleCache: true,
  },
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(
        new URL("./test/support/cloudflareWorkersStub.ts", import.meta.url),
      ),
    },
  },
});
