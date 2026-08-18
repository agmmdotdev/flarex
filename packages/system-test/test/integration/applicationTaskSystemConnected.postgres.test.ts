import {
  createApplicationNativeMutationPostgresFixture,
} from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import {
  createPostgresLocatedTaskSystemRunAttemptTargetV1,
} from "@flarex/persistence-postgres/postgres";
import {
  createLocatedTaskSystemRunAttemptTargetV1,
} from
  "@flarex/persistence-postgres/internal/task-system-run-attempt-store-v1";
import {
  createPostgresLocatedReadCommittedTransactionRunnerV1,
} from
  "@flarex/persistence-postgres/internal/system-test/postgresLocatedReadCommitted";
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
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting DTE06-E5.",
    ).not.toBeNull();
  });
});

describePostgres("Application Task System - PostgreSQL", () => {
  for (const [scenario, description] of [
    ["success", "result publication and terminal lifecycle settlement"],
    ["task_failure_retry", "handler failure and durable retry scheduling"],
    ["cancellation", "exact cancellation delivery and acknowledgement"],
    ["maximum_duration", "maximum-duration interruption and terminal timeout"],
    ["stale_fence", "stale-fence authority loss and Worker shutdown"],
    ["lease_loss", "database-time lease loss and recovery handoff"],
    ["result_publication_reconciled", "lost R2 create response reconciliation"],
    ["result_publication_uncertain", "unresolved R2 settlement recovery handoff"],
    ["completion_response_lost", "lost PostgreSQL completion response replay"],
    ["duplicate_delivery", "duplicate connected delivery suppression"],
    ["cancel_complete_race", "success superseding a racing cancellation"],
  ] as const) {
    it(`connects Application launch through ${description}`, async () => {
      await withTemporarySplitPostgresPersistence(async persistence => {
        await expect(proveApplicationTaskSystemConnected({
          createFixture: taskMaximumDurationInSeconds =>
            createApplicationNativeMutationPostgresFixture({
              runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
              compatibilityDate: COMPATIBILITY_DATE,
              includeTask: true,
              ...(taskMaximumDurationInSeconds === undefined
                ? {}
                : { taskMaximumDurationInSeconds }),
            }, persistence),
          locateRunTarget: (_fixture, physicalLocator) =>
            createPostgresLocatedTaskSystemRunAttemptTargetV1(
              persistence.target,
              physicalLocator,
            ),
          locateCompletionResponseLostRunTarget: (_fixture, physicalLocator) => {
            let releaseCalls = 0;
            return createLocatedTaskSystemRunAttemptTargetV1(
              persistence.target.drizzle,
              physicalLocator,
              createPostgresLocatedReadCommittedTransactionRunnerV1(
                persistence.target.pool,
                {
                  release: (client, discardError) => {
                    releaseCalls += 1;
                    if (releaseCalls === 1 && discardError === undefined) {
                      throw new Error(
                        "hide the committed Application completion response",
                      );
                    }
                    client.release(discardError);
                  },
                },
              ),
            );
          },
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
        }, scenario)).resolves.toBeUndefined();
      });
    }, 120_000);
  }
});
