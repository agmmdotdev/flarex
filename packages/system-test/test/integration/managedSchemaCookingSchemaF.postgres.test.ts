import {
  createApplicationNativeMutationPostgresFixture,
} from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { describe, expect, it } from "vitest";

import { proveManagedSchemaCookingSchemaF } from
  "../../support/managedSchemaCookingHarness";
import {
  postgresUrl,
  withTemporarySplitPostgresPersistence,
} from "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("Managed-schema cooking schema F PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting M03-D schema F.",
    ).not.toBeNull();
  });
});

describePostgres("Managed-schema cooking schema F - PostgreSQL", () => {
  it("proves candidate recovery and concurrent activation", async () => {
    await withTemporarySplitPostgresPersistence(async persistence => {
      await expect(proveManagedSchemaCookingSchemaF(options =>
        createApplicationNativeMutationPostgresFixture(options, persistence)
      )).resolves.toEqual({
        supersededCandidate: true,
        exactCandidateReplay: true,
        decisionUncertaintyColdReplayed: true,
        confirmedRollbackPreservedHead: true,
        concurrentActivationConverged: true,
        corruptionRejectedCold: true,
        activeSchemaSurvivedCandidateCorruption: true,
        candidateHeadCount: 1,
        activationCount: 5,
        activeHeadCount: 1,
        analysisWorkerLoads: 18,
        runtimeWorkerLoads: 18,
        commitCount: 6,
        outcomeCount: 6,
        feedCount: 6,
        outboxCount: 6,
      });
    });
  }, 480_000);
});
