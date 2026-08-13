import { describe, expect, it } from "vitest";

import {
  proveStandardApplicationMutationPostgres,
} from "../../support/applicationMutationStoredAttemptHarness";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("AA-R7 Application mutation PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting AA-R7 mutation parity.",
    ).not.toBeNull();
  });
});

describePostgres("AA-R7 Application mutation system - PostgreSQL", () => {
  it("matches the PGlite authority, admission, commit, and replay proof", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const proof = await proveStandardApplicationMutationPostgres(persistence);

      expect(proof).toMatchObject({
        firstDisposition: "published",
        replayDisposition: "replayed",
        runtimeExecutions: 1,
        sourceLoads: 1,
        grantIssuances: 1,
        exactCompositionGuards: true,
        conflictingRequestRejected: true,
        admittedSessionSurvivedHeadRemoval: true,
        staleHeadBeforeAdmissionRejected: true,
        sessionCount: 1,
        outcomeCount: 1,
        commitCount: 1,
        generation: "application_v1",
        finalName: "standard-application",
      });
      expect(proof.postgresVersion).toContain("PostgreSQL 18.3");
    });
  }, 480_000);
});
