import {
  createApplicationNativeMutationPostgresFixture,
} from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { describe, expect, it } from "vitest";

import { proveManagedSchemaCookingSchemaE } from
  "../../support/managedSchemaCookingHarness";
import {
  postgresUrl,
  withTemporarySplitPostgresPersistence,
} from "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("Managed-schema cooking schema E PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting M03-D schema E.",
    ).not.toBeNull();
  });
});

describePostgres("Managed-schema cooking schema E - PostgreSQL", () => {
  it("keeps paused validation sound across valid and invalid active writes", async () => {
    await withTemporarySplitPostgresPersistence(async persistence => {
      await expect(proveManagedSchemaCookingSchemaE(options =>
        createApplicationNativeMutationPostgresFixture(options, persistence)
      )).resolves.toEqual({
        plannedConcurrentWriteValidation: true,
        pausedAfterNonNullCursor: true,
        candidateValidCommitPreservedProgress: true,
        candidateInvalidCommitPublished: true,
        candidateInvalidCommitFailedValidationAtomically: true,
        failureEvidenceWasPathOnly: true,
        schemaDStayedActive: true,
        finalWritesVisibleThroughSchemaD: true,
        analysisWorkerLoads: 16,
        runtimeWorkerLoads: 20,
        commitCount: 8,
        outcomeCount: 8,
        feedCount: 8,
        outboxCount: 8,
      });
    });
  }, 480_000);
});
