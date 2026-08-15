import {
  createApplicationNativeMutationPostgresFixture,
} from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { describe, expect, it } from "vitest";

import { proveManagedSchemaCookingSchemaB } from
  "../../support/managedSchemaCookingHarness";
import {
  postgresUrl,
  withTemporarySplitPostgresPersistence,
} from "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("Managed-schema cooking schema B PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting M03-D schema B.",
    ).not.toBeNull();
  });
});

describePostgres("Managed-schema cooking schema B - PostgreSQL", () => {
  it("blocks populated removal, preserves A, remediates, and activates B", async () => {
    await withTemporarySplitPostgresPersistence(async persistence => {
      await expect(proveManagedSchemaCookingSchemaB(options =>
        createApplicationNativeMutationPostgresFixture(options, persistence)
      )).resolves.toMatchObject({
        plannedManagedValidation: true,
        populatedRemovalBlocked: true,
        schemaAStayedActive: true,
        remediatedThroughSchemaA: true,
        activatedSchemaB: true,
        schemaBRejectedRemovedArgument: true,
        schemaBRejectedRemovedWrite: true,
        finalDocumentConformsToSchemaB: true,
        analysisWorkerLoads: 6,
        runtimeWorkerLoads: 7,
        commitCount: 3,
        outcomeCount: 3,
        feedCount: 3,
        outboxCount: 3,
      });
    });
  }, 480_000);
});
