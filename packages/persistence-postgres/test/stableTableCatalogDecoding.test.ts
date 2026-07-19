import { Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  decodeStableTableCatalogIdResult,
} from "../src/stableTableCatalogDecoding";

type ThrowingStableTableDecoderExport = Extract<
  keyof typeof import("../src/stableTableCatalogDecoding"),
  "decodeStableTableCatalogId"
>;

describe("stable table catalog ID decoding", () => {
  it("returns a branded protocol ID for a valid catalog value", () => {
    expectTypeOf<ThrowingStableTableDecoderExport>().toEqualTypeOf<never>();
    const decoded = decodeStableTableCatalogIdResult("deployment_a", 1);
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded)) {
      expect(decoded.success).toBe(1);
    }
  });

  it("preserves the catalog-owned corruption detail and cause policy", () => {
    const invalid = decodeStableTableCatalogIdResult("deployment_a", "bad");
    expect(Result.isFailure(invalid)).toBe(true);
    if (Result.isFailure(invalid)) {
      expect(invalid.failure).toMatchObject({
        _tag: "StableTableCatalogCorruptionError",
        name: "StableTableCatalogCorruptionError",
        deploymentId: "deployment_a",
        detail: "invalid table ID: bad",
      });
      expect(invalid.failure.cause).toBeUndefined();
    }

    const defect = new Error("stored table ID formatting defect");
    const defectiveValue = {
      [Symbol.toPrimitive]() {
        throw defect;
      },
    };
    expect(() => decodeStableTableCatalogIdResult(
      "deployment_a",
      defectiveValue,
    )).toThrow(defect);
  });
});
