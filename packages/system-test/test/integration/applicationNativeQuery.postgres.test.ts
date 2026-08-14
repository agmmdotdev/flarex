import {
  createApplicationNativeMutationPostgresFixture,
} from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { describe, expect, it } from "vitest";

import { proveApplicationNativeQuery } from
  "../../support/applicationNativeQueryHarness";
import {
  postgresUrl,
  withTemporarySplitPostgresPersistence,
} from "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const RUNTIME_HOST_IDENTITY = "flarex-application-runtime-host-v1";
const COMPATIBILITY_DATE = "2026-06-14";

describe("Application-native query PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting AA-R7.",
    ).not.toBeNull();
  });
});

describePostgres("Application-native Standard query - PostgreSQL", () => {
  it("opens the active snapshot and executes one fresh Application Worker", async () => {
    await withTemporarySplitPostgresPersistence(async persistence => {
      await expect(proveApplicationNativeQuery(() =>
        createApplicationNativeMutationPostgresFixture({
          runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
          compatibilityDate: COMPATIBILITY_DATE,
        }, persistence)
      )).resolves.toMatchObject({
        result: { name: "Ada" },
        freshWorkerLoads: 2,
        snapshotRevalidations: 2,
        pointDocumentReads: 2,
        sourceReads: 2,
        headMovementSelectedNewRevision: true,
      });
    });
  }, 480_000);
});
