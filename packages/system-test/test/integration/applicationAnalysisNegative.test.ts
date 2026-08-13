import { describe, expect, it } from "vitest";

import {
  proveApplicationAnalysisNegativePGlite,
} from "../../support/applicationAnalysisColdHarness";
import { createMigratedPGlitePersistence } from "../support/databaseFixturesV1";

describe("AA-R7 Application Analysis negative corpus - PGlite", () => {
  it("settles forbidden import and nondeterminism then replays exactly", async () => {
    const proof = await proveApplicationAnalysisNegativePGlite(
      await createMigratedPGlitePersistence(),
    );
    expect(proof).toEqual({
      lane: "pglite",
      forbiddenImportRejected: true,
      forbiddenColdLoads: 2,
      forbiddenReplayColdLoads: 0,
      forbiddenReplayR2Reads: 0,
      nondeterminismRejected: true,
      nondeterminismColdLoads: 2,
      nondeterminismReplayColdLoads: 0,
      nondeterminismReplayR2Reads: 0,
      durableAnalysisCount: 2,
      durableRevisionCount: 0,
    });
  }, 480_000);
});
