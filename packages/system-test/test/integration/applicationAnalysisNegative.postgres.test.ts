import { describe, expect, it } from "vitest";

import {
  proveApplicationAnalysisNegativePostgres,
} from "../../support/applicationAnalysisColdHarness";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("AA-R7 Application Analysis negative PostgreSQL environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting the AA-R7 negative corpus.",
    ).not.toBeNull();
  });
});

describePostgres("AA-R7 Application Analysis negative corpus - PostgreSQL", () => {
  it("settles forbidden import and nondeterminism then replays exactly", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const proof = await proveApplicationAnalysisNegativePostgres(persistence);
      expect(proof).toMatchObject({
        lane: "postgres",
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
      expect(proof.postgresVersion).toContain("PostgreSQL");
    });
  }, 480_000);
});
