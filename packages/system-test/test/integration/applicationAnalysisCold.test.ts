import { describe, expect, it } from "vitest";

import {
  proveApplicationAnalysisColdPGlite,
} from "../../support/applicationAnalysisColdHarness";
import { createMigratedPGlitePersistence } from "../support/databaseFixturesV1";

describe("AA-R7 Application Analysis cold entry - PGlite", () => {
  it("cold-loads exact Source Artifact V2 bytes and replays durable settlement", async () => {
    const proof = await proveApplicationAnalysisColdPGlite(
      await createMigratedPGlitePersistence(),
    );
    expect(proof).toEqual({
      lane: "pglite",
      firstKind: "analyzed",
      replayKind: "analyzed",
      restartKind: "analyzed",
      coldLoads: 2,
      replayColdLoads: 0,
      restartColdLoads: 2,
      exactReplayIdentity: true,
      restartDistinctIdentity: true,
      durableAnalysisCount: 5,
      durableRevisionCount: 2,
      missingObjectRejected: true,
      digestCorruptionRejected: true,
      lengthCorruptionRejected: true,
    });
  }, 480_000);
});
