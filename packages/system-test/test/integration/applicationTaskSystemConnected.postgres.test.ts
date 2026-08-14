import {
  createApplicationNativeMutationPostgresFixture,
} from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import {
  createPostgresLocatedTaskSystemRunAttemptTargetV1,
} from "@flarex/persistence-postgres/postgres";
import {
  createPostgresTaskComputeDeliveryControlDirectoryResource,
} from
  "@flarex/persistence-postgres/internal/system-test/postgres-task-compute-delivery-control-directory";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { proveApplicationTaskSystemConnected } from
  "../../support/applicationTaskSystemConnectedHarness";
import {
  postgresUrl,
  withTemporarySplitPostgresPersistence,
} from "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const RUNTIME_HOST_IDENTITY = "flarex-application-runtime-host-v1";
const COMPATIBILITY_DATE = "2026-06-14";
const DEADLINE_POLICY = Object.freeze({
  connectionTimeoutMilliseconds: 100,
  lockTimeoutMilliseconds: 100,
  statementTimeoutMilliseconds: 2_000,
  transactionTimeoutMilliseconds: 5_000,
  settlementReserveMilliseconds: 6_000,
});

describe("Application Task System PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting AA-R7.",
    ).not.toBeNull();
  });
});

describePostgres("Application Task System - PostgreSQL", () => {
  it("creates, replays, discovers, and launches from Application authority", async () => {
    await withTemporarySplitPostgresPersistence(async persistence => {
      await expect(proveApplicationTaskSystemConnected({
        createFixture: () =>
          createApplicationNativeMutationPostgresFixture({
            runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
            compatibilityDate: COMPATIBILITY_DATE,
            includeTask: true,
          }, persistence),
        locateRunTarget: fixture =>
          createPostgresLocatedTaskSystemRunAttemptTargetV1(
            persistence.target,
            fixture.active.basis.authority.physicalLocator,
          ),
        createControlTarget: async () => {
          const resource = Result.getOrThrow(
            createPostgresTaskComputeDeliveryControlDirectoryResource(
              persistence.control.pool.options,
              DEADLINE_POLICY,
            ),
          );
          return Object.freeze({
            target: resource.target,
            close: resource.close,
          });
        },
      })).resolves.toBeUndefined();
    });
  }, 120_000);
});
