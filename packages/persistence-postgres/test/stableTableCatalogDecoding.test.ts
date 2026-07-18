import { describe, expect, it } from "vitest";

import { decodeStableTableCatalogId } from
  "../src/stableTableCatalogDecoding";
import { StableTableCatalogCorruptionError } from
  "../src/stableTableCatalogAllocation";

describe("stable table catalog ID decoding", () => {
  it("returns a branded protocol ID for a valid catalog value", () => {
    expect(decodeStableTableCatalogId("deployment_a", 1)).toBe(1);
  });

  it("preserves the catalog-owned corruption detail and cause policy", () => {
    try {
      decodeStableTableCatalogId("deployment_a", "bad");
    } catch (cause) {
      expect(cause).toBeInstanceOf(StableTableCatalogCorruptionError);
      if (!(cause instanceof StableTableCatalogCorruptionError)) {
        throw cause;
      }
      expect(cause).toMatchObject({
        name: "StableTableCatalogCorruptionError",
        deploymentId: "deployment_a",
        detail: "invalid table ID: bad",
      });
      expect(cause.cause).toBeUndefined();
      return;
    }
    throw new Error("Expected stable table catalog ID decoding to fail.");
  });
});
