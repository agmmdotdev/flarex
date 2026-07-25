import { isNonArrayRecord } from "@flarex/utils/records";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("private executor Wrangler configuration", () => {
  it("is service-binding-only, smart placed, and node-postgres compatible", async () => {
    const raw = await readFile(
      new URL("../wrangler.jsonc", import.meta.url),
      "utf8",
    );
    const config: unknown = JSON.parse(raw);

    if (!isNonArrayRecord(config)) {
      throw new Error("Executor Wrangler config must be an object.");
    }

    expect(config).toMatchObject({
      name: "flarex-executor",
      main: "src/worker.ts",
      compatibility_flags: ["nodejs_compat"],
      workers_dev: false,
      preview_urls: false,
      placement: { mode: "smart" },
      observability: {
        enabled: true,
        traces: { enabled: true, head_sampling_rate: 1, persist: true },
      },
      hyperdrive: [
        {
          binding: "HYPERDRIVE_CACHE_DISABLED",
          id: "00000000000000000000000000000000",
        },
      ],
      services: [
        {
          binding: "FLAREX_POINT_MUTATION_EXACT_RUNTIME_V1",
          service: "flarex-artifact-runtime",
          entrypoint: "FlarexPointMutationExactRuntimeArtifactHostV1",
        },
      ],
    });
    expect(config).not.toHaveProperty("route");
    expect(config).not.toHaveProperty("routes");
    expect(config).not.toHaveProperty("triggers");
    expect(config).not.toHaveProperty("vars.FLAREX_EXECUTOR_TOKEN");
  });

  it("keeps the public H05 proof caller isolated from database capabilities", async () => {
    const raw = await readFile(
      new URL("../wrangler.h05-probe.jsonc", import.meta.url),
      "utf8",
    );
    const config: unknown = JSON.parse(raw);

    if (!isNonArrayRecord(config)) {
      throw new Error("H05 probe Wrangler config must be an object.");
    }

    expect(config).toMatchObject({
      name: "flarex-executor-h05-probe",
      main: "h05/probeWorker.ts",
      workers_dev: true,
      preview_urls: false,
      services: [
        {
          binding: "FLAREX_EXECUTOR",
          service: "flarex-executor",
        },
      ],
      observability: {
        enabled: true,
        traces: { enabled: true, head_sampling_rate: 1, persist: true },
      },
    });
    expect(config).not.toHaveProperty("hyperdrive");
    expect(config).not.toHaveProperty("vars");
    expect(config).not.toHaveProperty("routes");
    expect(Object.keys(config).sort()).toEqual([
      "$schema",
      "compatibility_date",
      "main",
      "name",
      "observability",
      "preview_urls",
      "services",
      "workers_dev",
    ]);
  });
});
