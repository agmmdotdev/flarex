import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  canonicalizeApplicationRuntimeColdReceiptV1,
} from "../src/application-runtime-cold-receipt-v1";

describe("ApplicationRuntimeColdReceiptV1", () => {
  it("canonicalizes exact resolved runtime authority and owns the input", () => {
    const input = receipt();
    const canonical = Result.getOrThrow(
      canonicalizeApplicationRuntimeColdReceiptV1(input),
    );
    input.functionPath = "changed:path";

    expect(canonical.receipt.functionPath).toBe("users:get");
    expect(Object.isFrozen(canonical.receipt)).toBe(true);
    expect(canonical.canonicalText).toBe(
      new TextDecoder().decode(canonical.canonicalBytes),
    );
    expect(canonical.canonicalText).not.toContain("artifact");
    expect(canonical.canonicalText).not.toContain("semantic");
  });

  it("rejects accessors, excess fields, invalid dates, and bad digests", () => {
    let reads = 0;
    const accessor = receipt();
    Object.defineProperty(accessor, "functionPath", {
      enumerable: true,
      get() {
        reads += 1;
        return "users:get";
      },
    });

    expect(Result.isFailure(
      canonicalizeApplicationRuntimeColdReceiptV1(accessor),
    )).toBe(true);
    expect(reads).toBe(0);
    expect(Result.isFailure(canonicalizeApplicationRuntimeColdReceiptV1({
      ...receipt(),
      extra: true,
    }))).toBe(true);
    expect(Result.isFailure(canonicalizeApplicationRuntimeColdReceiptV1({
      ...receipt(),
      compatibilityDate: "2026-02-30",
    }))).toBe(true);
    expect(Result.isFailure(canonicalizeApplicationRuntimeColdReceiptV1({
      ...receipt(),
      publicationSha256: "A".repeat(64),
    }))).toBe(true);
  });

  it("bounds the shared Application runtime-host identity", () => {
    expect(Result.isSuccess(canonicalizeApplicationRuntimeColdReceiptV1({
      ...receipt(),
      runtimeHostIdentity: "h".repeat(1_024),
    }))).toBe(true);
    expect(Result.isFailure(canonicalizeApplicationRuntimeColdReceiptV1({
      ...receipt(),
      runtimeHostIdentity: "h".repeat(1_025),
    }))).toBe(true);
  });
});

function receipt() {
  return {
    format: "flarex.application-runtime-cold-receipt" as const,
    version: 1 as const,
    status: "resolved" as const,
    runtimeHostIdentity: "runtime-host",
    compatibilityDate: "2026-06-14",
    sourceArtifactRootSha256: "1".repeat(64),
    manifestSha256: "2".repeat(64),
    publicationSha256: "3".repeat(64),
    runtimeTargetSha256: "4".repeat(64),
    functionPath: "users:get",
    functionKind: "query" as const,
    visibility: "public" as const,
  };
}
