import {
  type ApplicationNativeMutationFixtureOptions,
  createApplicationNativeMutationPGliteFixtureWithPersistence,
  createApplicationNativeMutationPostgresFixture,
} from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import {
  createLocatedTaskSystemRunAttemptTargetV1,
} from
  "@flarex/persistence-postgres/internal/task-system-run-attempt-store-v1";
import {
  createPGliteLocatedTaskExternalEffectAuthorityTarget,
  createPGliteLocatedTaskSystemRunAttemptTargetV1,
  type PGliteFlarexPersistence,
} from "@flarex/persistence-postgres/pglite";
import {
  createPostgresLocatedTaskSystemRunAttemptTargetV1,
  type PostgresFlarexPersistence,
} from "@flarex/persistence-postgres/postgres";
import type { ScopePhysicalLocator } from "@flarex/persistence-postgres";
import {
  createTaskComputeDeliveryControlDirectoryTargetForSystemTest,
} from
  "@flarex/persistence-postgres/internal/system-test/task-compute-delivery-control-directory";
import {
  createPostgresTaskComputeDeliveryControlDirectoryResource,
} from
  "@flarex/persistence-postgres/internal/system-test/postgres-task-compute-delivery-control-directory";
import {
  createPostgresTaskExternalEffectAuthorityResource,
} from
  "@flarex/persistence-postgres/internal/system-test/postgres-task-external-effect-authority";
import {
  createDefaultLocatedReadCommittedTransactionRunnerV1,
} from
  "@flarex/persistence-postgres/internal/system-test/transactionSessionActivation";
import {
  createPostgresLocatedReadCommittedTransactionRunnerV1,
} from
  "@flarex/persistence-postgres/internal/system-test/postgresLocatedReadCommitted";
import {
  LocatedReadCommittedTransactionFailureV1,
  type RunLocatedReadCommittedTransactionV1,
} from
  "@flarex/persistence-postgres/internal/system-test/transactionSessionAttemptKernel";
import { Result } from "effect";

import type {
  DatabaseLane,
} from "../environment/applicationEnvironment";

const PGLITE_DELIVERY_DEADLINE_POLICY = Object.freeze({
  connectionTimeoutMilliseconds: 100,
  lockTimeoutMilliseconds: 100,
  statementTimeoutMilliseconds: 2_000,
  transactionTimeoutMilliseconds: 5_000,
  settlementReserveMilliseconds: 6_000,
});

const POSTGRES_DELIVERY_DEADLINE_POLICY = Object.freeze({
  ...PGLITE_DELIVERY_DEADLINE_POLICY,
  connectionTimeoutMilliseconds: 500,
});

const PGLITE_TASK_MUTATION_DEADLINE_POLICY = Object.freeze({
  connectionTimeoutMilliseconds: 100,
  lockTimeoutMilliseconds: 100,
  statementTimeoutMilliseconds: 1_000,
  transactionTimeoutMilliseconds: 2_000,
  settlementReserveMilliseconds: 3_000,
});

const POSTGRES_TASK_MUTATION_DEADLINE_POLICY = Object.freeze({
  ...PGLITE_TASK_MUTATION_DEADLINE_POLICY,
  connectionTimeoutMilliseconds: 500,
});

export function makePGliteDatabaseLane(
  persistence: Readonly<{
    readonly control: PGliteFlarexPersistence;
    readonly target: PGliteFlarexPersistence;
  }>,
): DatabaseLane {
  return Object.freeze({
    name: "pglite",
    ...persistence,
    createFixture: (options: ApplicationNativeMutationFixtureOptions) =>
      createApplicationNativeMutationPGliteFixtureWithPersistence(
        options,
        persistence,
      ),
    locateTaskRunTarget: (physicalLocator: ScopePhysicalLocator) =>
      createPGliteLocatedTaskSystemRunAttemptTargetV1(
        persistence.target,
        physicalLocator,
      ),
    locateTaskCompletionResponseLostRunTarget: (
      physicalLocator: ScopePhysicalLocator,
    ) =>
      createLocatedTaskSystemRunAttemptTargetV1(
        persistence.target.drizzle,
        physicalLocator,
        hideFirstCommittedTransactionResponse(
          createDefaultLocatedReadCommittedTransactionRunnerV1(
            persistence.target.drizzle,
          ),
        ),
      ),
    createTaskDeliveryControlTarget: () => Promise.resolve(Object.freeze({
      target: Result.getOrThrow(
        createTaskComputeDeliveryControlDirectoryTargetForSystemTest(
          createDefaultLocatedReadCommittedTransactionRunnerV1(
            persistence.control.drizzle,
          ),
          PGLITE_DELIVERY_DEADLINE_POLICY,
        ),
      ),
      discoveryDeadline: PGLITE_DELIVERY_DEADLINE_POLICY,
      close: () => Promise.resolve(),
    })),
    createTaskMutationExternalEffectTarget: (
      physicalLocator: ScopePhysicalLocator,
    ) =>
      Promise.resolve(Object.freeze({
        target: Result.getOrThrow(
          createPGliteLocatedTaskExternalEffectAuthorityTarget(
            persistence.target,
            physicalLocator,
            PGLITE_TASK_MUTATION_DEADLINE_POLICY,
          ),
        ),
        close: () => Promise.resolve(),
      })),
  });
}

export function makePostgresDatabaseLane(
  persistence: Readonly<{
    readonly control: PostgresFlarexPersistence;
    readonly target: PostgresFlarexPersistence;
  }>,
): DatabaseLane {
  return Object.freeze({
    name: "postgres",
    ...persistence,
    createFixture: (options: ApplicationNativeMutationFixtureOptions) =>
      createApplicationNativeMutationPostgresFixture(options, persistence),
    locateTaskRunTarget: (physicalLocator: ScopePhysicalLocator) =>
      createPostgresLocatedTaskSystemRunAttemptTargetV1(
        persistence.target,
        physicalLocator,
      ),
    locateTaskCompletionResponseLostRunTarget: (
      physicalLocator: ScopePhysicalLocator,
    ) =>
      createLocatedTaskSystemRunAttemptTargetV1(
        persistence.target.drizzle,
        physicalLocator,
        hideFirstCommittedTransactionResponse(
          createPostgresLocatedReadCommittedTransactionRunnerV1(
            persistence.target.pool,
          ),
        ),
      ),
    createTaskDeliveryControlTarget: async () => {
      const resource = Result.getOrThrow(
        createPostgresTaskComputeDeliveryControlDirectoryResource(
          persistence.control.pool.options,
          POSTGRES_DELIVERY_DEADLINE_POLICY,
        ),
      );
      return Object.freeze({
        target: resource.target,
        discoveryDeadline: POSTGRES_DELIVERY_DEADLINE_POLICY,
        close: resource.close,
      });
    },
    createTaskMutationExternalEffectTarget: async (
      physicalLocator: ScopePhysicalLocator,
    ) => {
      const resource = Result.getOrThrow(
        createPostgresTaskExternalEffectAuthorityResource(
          persistence.target.pool.options,
          physicalLocator,
          POSTGRES_TASK_MUTATION_DEADLINE_POLICY,
        ),
      );
      return Object.freeze({
        target: resource.target,
        close: resource.close,
      });
    },
  });
}

function hideFirstCommittedTransactionResponse(
  owner: RunLocatedReadCommittedTransactionV1,
): RunLocatedReadCommittedTransactionV1 {
  let hidden = false;
  return async work => {
    const result = await owner(work);
    if (!hidden) {
      hidden = true;
      throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
        kind: "decisionUncertain",
        settlementCause: new Error(
          "injected lost completion response after transaction settlement",
        ),
      }));
    }
    return result;
  };
}
