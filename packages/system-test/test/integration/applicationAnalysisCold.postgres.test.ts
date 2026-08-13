import { describe, expect, it } from "vitest";

import {
  proveApplicationAnalysisColdPostgres,
} from "../../support/applicationAnalysisColdHarness";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("AA-R7 Application Analysis PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting AA-R7 cold analysis.",
    ).not.toBeNull();
  });
});

describePostgres("AA-R7 Application Analysis cold entry - PostgreSQL", () => {
  it("matches exact Source Artifact, restart, and corruption proof", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const proof = await proveApplicationAnalysisColdPostgres(persistence);
      expect(proof).toMatchObject({
        lane: "postgres",
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
      expect(proof.postgresVersion).toContain("PostgreSQL");
    });
  }, 480_000);
});
