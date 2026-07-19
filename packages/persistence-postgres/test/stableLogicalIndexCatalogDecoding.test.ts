import { Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  decodeStableLogicalIndexCatalogIndexIdResult,
  decodeStableLogicalIndexCatalogTableIdResult,
} from "../src/stableLogicalIndexCatalogDecoding";

type ThrowingStableLogicalIndexDecoderExport = Extract<
  keyof typeof import("../src/stableLogicalIndexCatalogDecoding"),
  | "decodeStableLogicalIndexCatalogIndexId"
  | "decodeStableLogicalIndexCatalogTableId"
>;

describe("stable logical index catalog stored ID decoding", () => {
  it("returns branded protocol IDs for valid stored values", () => {
    expectTypeOf<
      ThrowingStableLogicalIndexDecoderExport
    >().toEqualTypeOf<never>();
    const indexId = decodeStableLogicalIndexCatalogIndexIdResult(
      "deployment_a",
      1,
    );
    const tableId = decodeStableLogicalIndexCatalogTableIdResult(
      "deployment_a",
      2,
    );
    expect(Result.isSuccess(indexId)).toBe(true);
    expect(Result.isSuccess(tableId)).toBe(true);
    if (Result.isSuccess(indexId)) {
      expect(indexId.success).toBe(1);
    }
    if (Result.isSuccess(tableId)) {
      expect(tableId.success).toBe(2);
    }
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
