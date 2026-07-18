import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeStableTableCatalogId,
  decodeStableTableCatalogIdResult,
} from "../src/stableTableCatalogDecoding";
import { StableTableCatalogCorruptionError } from
  "../src/stableTableCatalogAllocation";

describe("stable table catalog ID decoding", () => {
  it("returns a branded protocol ID for a valid catalog value", () => {
    expect(decodeStableTableCatalogId("deployment_a", 1)).toBe(1);
    expect(Result.getOrThrow(
      decodeStableTableCatalogIdResult("deployment_a", 1),
    )).toBe(1);
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

    expect(() => decodeStableTableCatalogId(
      "deployment_a",
      "bad",
    )).toThrow(StableTableCatalogCorruptionError);

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
