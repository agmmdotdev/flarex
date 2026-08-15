import {
  createApplicationNativeMutationPostgresFixture,
} from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { describe, expect, it } from "vitest";

import { proveManagedSchemaCookingSchemaG } from
  "../../support/managedSchemaCookingHarness";
import {
  postgresUrl,
  withTemporarySplitPostgresPersistence,
} from "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("Managed-schema cooking schema G PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting M03-D schema G.",
    ).not.toBeNull();
  });
});

describePostgres("Managed-schema cooking schema G - PostgreSQL", () => {
  it("fences an old-schema attempt and publishes an ordinary new-schema retry", async () => {
    await withTemporarySplitPostgresPersistence(async persistence => {
      await expect(proveManagedSchemaCookingSchemaG(options =>
        createApplicationNativeMutationPostgresFixture(options, persistence)
      )).resolves.toEqual({
        attemptStartedUnderSchemaF: true,
        replacementActivatedBeforePublication: true,
        staleAttemptRejected: true,
        staleAttemptLeftPublicationUnchanged: true,
        staleAttemptLeftApplicationStorageUnchanged: true,
        candidateReceiptStayedExact: true,
        ordinaryRetrySelectedSchemaG: true,
        ordinaryRetryPublishedExactlyOnce: true,
        finalDocumentConformsToSchemaG: true,
        candidateHeadCount: 1,
        activationCount: 6,
        activeHeadCount: 1,
        analysisWorkerLoads: 18,
        runtimeWorkerLoads: 19,
        commitCount: 7,
        outcomeCount: 7,
        feedCount: 7,
        outboxCount: 7,
      });
    });
  }, 480_000);
});
