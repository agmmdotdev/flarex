import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("private executor Wrangler configuration", () => {
  it("is service-binding-only, smart placed, and node-postgres compatible", async () => {
    const raw = await readFile(
      new URL("../wrangler.jsonc", import.meta.url),
      "utf8",
    );
    const config: unknown = JSON.parse(raw);

    expect(config).toMatchObject({
      name: "flarex-executor",
      main: "src/worker.ts",
      compatibility_flags: ["nodejs_compat"],
      workers_dev: false,
      preview_urls: false,
      placement: { mode: "smart" },
      hyperdrive: [
        {
          binding: "HYPERDRIVE_CACHE_DISABLED",
          id: "00000000000000000000000000000000",
        },
      ],
    });
    expect(config).not.toHaveProperty("route");
    expect(config).not.toHaveProperty("routes");
    expect(config).not.toHaveProperty("vars.FLAREX_EXECUTOR_TOKEN");
  });
});
