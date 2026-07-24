import { describe, expect, it } from "vitest";

import {
  checkPointMutationExactRuntimeCore,
} from "../scripts/buildPointMutationExactRuntimeCore";
import {
  POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SHA256_V1,
  POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1,
} from "../src/artifactRuntime/PointMutationExactRuntimeWorkerCore.generated";

describe("point mutation exact-runtime core build", () => {
  it("reproduces the checked-in source, identity, and stable inline map", async () => {
    const receipt = await checkPointMutationExactRuntimeCore();

    expect(receipt).toEqual({
      source: POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1,
      sha256: POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SHA256_V1,
    });
    expect(receipt.source).toContain(
      'import("./pointMutationExactRuntimeWorker/flarex-point-mutation-exact-runtime-execution-v1.js")',
    );
    expect(receipt.source).not.toContain("__vitePreload");

    const marker = "base64,";
    const markerIndex = receipt.source.lastIndexOf(marker);
    expect(markerIndex).toBeGreaterThan(0);
    const sourceMap: unknown = JSON.parse(
      Buffer.from(
        receipt.source.slice(markerIndex + marker.length).trim(),
        "base64",
      ).toString("utf8"),
    );
    expect(sourceMap).toMatchObject({
      sources: ["PointMutationExactRuntimeWorkerCore.ts"],
      sourcesContent: [
        expect.stringContaining("interface DecodedExactRuntimeRequest"),
      ],
    });
  });
});
