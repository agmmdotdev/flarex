import {
  createApplicationNativeMutationPostgresFixture,
} from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import {
  createLocatedTaskSystemRunAttemptTargetV1,
} from
  "@flarex/persistence-postgres/internal/task-system-run-attempt-store-v1";
import {
  createPostgresTaskComputeDeliveryControlDirectoryResource,
} from
  "@flarex/persistence-postgres/internal/system-test/postgres-task-compute-delivery-control-directory";
import {
  createPostgresTaskExternalEffectAuthorityResource,
} from
  "@flarex/persistence-postgres/internal/system-test/postgres-task-external-effect-authority";
import {
  createPostgresLocatedReadCommittedTransactionRunnerV1,
} from
  "@flarex/persistence-postgres/internal/system-test/postgresLocatedReadCommitted";
import {
  createPostgresLocatedTaskSystemRunAttemptTargetV1,
  type PostgresFlarexPersistence,
} from "@flarex/persistence-postgres/postgres";
import { Result } from "effect";
import {
  APPLICATION_RUNTIME_COMPATIBILITY_DATE,
  APPLICATION_RUNTIME_HOST_IDENTITY,
} from "flarex-backend/artifact-runtime";

import type {
  ApplicationTaskSystemConnectedLane,
} from "../../support/applicationTaskSystemConnectedHarness";

const DEADLINE_POLICY = Object.freeze({
  connectionTimeoutMilliseconds: 500,
  lockTimeoutMilliseconds: 100,
  statementTimeoutMilliseconds: 2_000,
  transactionTimeoutMilliseconds: 5_000,
  settlementReserveMilliseconds: 6_000,
});
const TASK_MUTATION_DEADLINE_POLICY = Object.freeze({
  connectionTimeoutMilliseconds: 500,
  lockTimeoutMilliseconds: 100,
  statementTimeoutMilliseconds: 1_000,
  transactionTimeoutMilliseconds: 2_000,
  settlementReserveMilliseconds: 3_000,
});

export function makeApplicationTaskSystemPostgresLane(
  persistence: Readonly<{
    readonly control: PostgresFlarexPersistence;
    readonly target: PostgresFlarexPersistence;
  }>,
): ApplicationTaskSystemConnectedLane {
  return Object.freeze<ApplicationTaskSystemConnectedLane>({
    createFixture: taskMaximumDurationInSeconds =>
      createApplicationNativeMutationPostgresFixture({
        runtimeHostIdentity: APPLICATION_RUNTIME_HOST_IDENTITY,
        compatibilityDate: APPLICATION_RUNTIME_COMPATIBILITY_DATE,
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
    createExternalEffectTarget: async (_fixture, physicalLocator) => {
      const resource = Result.getOrThrow(
        createPostgresTaskExternalEffectAuthorityResource(
          persistence.target.pool.options,
          physicalLocator,
          TASK_MUTATION_DEADLINE_POLICY,
        ),
      );
      return Object.freeze({
        target: resource.target,
        close: resource.close,
      });
    },
  });
}
