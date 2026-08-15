import {
  createApplicationNativeMutationPostgresFixture,
} from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { describe, expect, it } from "vitest";

import { proveManagedSchemaCookingSchemaD } from
  "../../support/managedSchemaCookingHarness";
import {
  postgresUrl,
  withTemporarySplitPostgresPersistence,
} from "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("Managed-schema cooking schema D PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting M03-D schema D.",
    ).not.toBeNull();
  });
});

describePostgres("Managed-schema cooking schema D - PostgreSQL", () => {
  it("blocks nested tightening, remediates through C, and activates D", async () => {
    await withTemporarySplitPostgresPersistence(async persistence => {
      await expect(proveManagedSchemaCookingSchemaD(options =>
        createApplicationNativeMutationPostgresFixture(options, persistence)
      )).resolves.toEqual({
        plannedNestedValidatorValidation: true,
        nestedValidatorBlocked: true,
        failureEvidenceWasPathOnly: true,
        schemaCStayedActive: true,
        remediatedThroughSchemaC: true,
        activatedSchemaD: true,
        schemaDRejectedInvalidNestedArgument: true,
        finalDocumentsConformToSchemaD: true,
        analysisWorkerLoads: 14,
        runtimeWorkerLoads: 16,
        commitCount: 6,
        outcomeCount: 6,
        feedCount: 6,
        outboxCount: 6,
      });
    });
  }, 480_000);
});
