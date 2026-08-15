import {
  createApplicationNativeMutationPostgresFixture,
} from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { describe, expect, it } from "vitest";

import { proveManagedSchemaCookingSchemaC } from
  "../../support/managedSchemaCookingHarness";
import {
  postgresUrl,
  withTemporarySplitPostgresPersistence,
} from "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("Managed-schema cooking schema C PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting M03-D schema C.",
    ).not.toBeNull();
  });
});

describePostgres("Managed-schema cooking schema C - PostgreSQL", () => {
  it("blocks required slug, backfills through B, and activates C", async () => {
    await withTemporarySplitPostgresPersistence(async persistence => {
      await expect(proveManagedSchemaCookingSchemaC(options =>
        createApplicationNativeMutationPostgresFixture(options, persistence)
      )).resolves.toEqual({
        plannedRequiredFieldValidation: true,
        missingRequiredFieldBlocked: true,
        schemaBStayedActive: true,
        backfilledThroughSchemaB: true,
        activatedSchemaC: true,
        schemaCRejectedMissingSlugArgument: true,
        finalDocumentsConformToSchemaC: true,
        analysisWorkerLoads: 10,
        runtimeWorkerLoads: 12,
        commitCount: 5,
        outcomeCount: 5,
        feedCount: 5,
        outboxCount: 5,
      });
    });
  }, 480_000);
});
