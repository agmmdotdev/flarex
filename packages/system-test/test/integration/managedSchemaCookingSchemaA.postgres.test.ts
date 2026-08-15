import {
  createApplicationNativeMutationPostgresFixture,
} from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { describe, expect, it } from "vitest";

import { proveManagedSchemaCookingSchemaA } from
  "../../support/managedSchemaCookingHarness";
import {
  postgresUrl,
  withTemporarySplitPostgresPersistence,
} from "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("Managed-schema cooking schema A PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting M03-D schema A.",
    ).not.toBeNull();
  });
});

describePostgres("Managed-schema cooking schema A - PostgreSQL", () => {
  it("analyzes, activates, mutates, replays, and queries through the real system", async () => {
    await withTemporarySplitPostgresPersistence(async persistence => {
      await expect(proveManagedSchemaCookingSchemaA(options =>
        createApplicationNativeMutationPostgresFixture(options, persistence)
      )).resolves.toMatchObject({
        analyzedWithTwoColdLoads: true,
        activatedSchemaA: true,
        mutationPublished: true,
        exactReplay: true,
        queryReadCommittedDocument: true,
        runtimeWorkerLoads: 2,
        commitCount: 1,
        outcomeCount: 1,
        feedCount: 1,
        outboxCount: 1,
      });
    });
  }, 480_000);
});
