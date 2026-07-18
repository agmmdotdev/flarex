import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeStableLogicalIndexCatalogIndexId,
  decodeStableLogicalIndexCatalogIndexIdResult,
  decodeStableLogicalIndexCatalogTableId,
  decodeStableLogicalIndexCatalogTableIdResult,
} from "../src/stableLogicalIndexCatalogDecoding";
import { StableLogicalIndexCatalogCorruptionError } from
  "../src/stableLogicalIndexCatalogAllocation";

describe("stable logical index catalog stored ID decoding", () => {
  it("returns branded protocol IDs for valid stored values", () => {
    expect(decodeStableLogicalIndexCatalogIndexId("deployment_a", 1)).toBe(1);
    expect(decodeStableLogicalIndexCatalogTableId("deployment_a", 2)).toBe(2);
    expect(Result.getOrThrow(
      decodeStableLogicalIndexCatalogIndexIdResult("deployment_a", 1),
    )).toBe(1);
    expect(Result.getOrThrow(
      decodeStableLogicalIndexCatalogTableIdResult("deployment_a", 2),
    )).toBe(2);
  });

  it("preserves the catalog-owned corruption detail and cause policy", () => {
    const invalidIndex = decodeStableLogicalIndexCatalogIndexIdResult(
      "deployment_a",
      "bad",
    );
    expect(Result.isFailure(invalidIndex)).toBe(true);
    if (Result.isFailure(invalidIndex)) {
      expect(invalidIndex.failure).toMatchObject({
        _tag: "StableLogicalIndexCatalogCorruptionError",
        name: "StableLogicalIndexCatalogCorruptionError",
        deploymentId: "deployment_a",
        detail: "invalid logical index ID: bad",
      });
      expect(invalidIndex.failure.cause).toBeUndefined();
    }
    const invalidTable = decodeStableLogicalIndexCatalogTableIdResult(
      "deployment_a",
      "bad",
    );
    expect(Result.isFailure(invalidTable)).toBe(true);
    if (Result.isFailure(invalidTable)) {
      expect(invalidTable.failure.detail).toBe("invalid table ID: bad");
    }

    expectCatalogCorruption(
      () => decodeStableLogicalIndexCatalogIndexId("deployment_a", "bad"),
      "invalid logical index ID: bad",
    );
    expectCatalogCorruption(
      () => decodeStableLogicalIndexCatalogTableId("deployment_a", "bad"),
      "invalid table ID: bad",
    );

    const defect = new Error("stored ID formatting defect");
    const defectiveValue = {
      [Symbol.toPrimitive]() {
        throw defect;
      },
    };
    expect(() => decodeStableLogicalIndexCatalogIndexIdResult(
      "deployment_a",
      defectiveValue,
    )).toThrow(defect);
  });
});

function expectCatalogCorruption(run: () => unknown, detail: string): void {
  try {
    run();
  } catch (cause) {
    expect(cause).toBeInstanceOf(StableLogicalIndexCatalogCorruptionError);
    if (!(cause instanceof StableLogicalIndexCatalogCorruptionError)) {
      throw cause;
    }
    expect(cause).toMatchObject({
      name: "StableLogicalIndexCatalogCorruptionError",
      deploymentId: "deployment_a",
      detail,
    });
    expect(cause.cause).toBeUndefined();
    return;
  }
  throw new Error("Expected stored catalog ID decoding to fail.");
}
