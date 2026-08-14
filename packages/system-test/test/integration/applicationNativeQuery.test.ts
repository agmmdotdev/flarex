import { describe, expect, it } from "vitest";

import { proveApplicationNativeQuery } from
  "../../support/applicationNativeQueryHarness";

describe("Application-native Standard query - PGlite", () => {
  it("opens the active snapshot and executes one fresh Application Worker", async () => {
    await expect(proveApplicationNativeQuery()).resolves.toMatchObject({
      result: { name: "Ada" },
      freshWorkerLoads: 2,
      snapshotRevalidations: 2,
      pointDocumentReads: 2,
      sourceReads: 2,
      headMovementSelectedNewRevision: true,
    });
  }, 480_000);
});
