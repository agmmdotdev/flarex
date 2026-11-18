import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Node-side preparation and genuine mutation harness only. The actual DO
    // bundle uses configFile:false and external cloudflare:* runtime modules.
    alias: {
      "cloudflare:workers": fileURLToPath(new URL(
        "./test/support/cloudflareWorkersStub.ts", import.meta.url,
      )),
    },
  },
});
