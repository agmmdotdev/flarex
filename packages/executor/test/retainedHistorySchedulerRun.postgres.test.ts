import {
  createRetainedHistorySchedulerCheckpointV1,
  isRetainedHistorySchedulerAcquireConfirmedRollbackV1Error,
  isRetainedHistorySchedulerCheckpointConfirmedRollbackV1Error,
  isRetainedHistorySchedulerReleaseConfirmedRollbackV1Error,
  isRetainedHistorySchedulerRenewConfirmedRollbackV1Error,
} from "@flarex/persistence-postgres/internal/retained-history-scheduler-checkpoint-v1";
import {
  createRetainedHistorySchedulerDirectory,
} from "@flarex/persistence-postgres/internal/retained-history-scheduler-directory";
import {
  isLocatedReadCommittedAttemptTargetV1,
} from "@flarex/persistence-postgres/internal/system-test/transactionSessionAttemptKernel";
import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresLocatedRetainedHistoryFloorTarget,
  createPostgresSharedScopeAuthorityProvisioner,
} from "@flarex/persistence-postgres/postgres";
import { Result } from "effect";
import { decodeReplacementScopeIdV1 } from
  "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";
import { describe, expect, it } from "vitest";

import {
  createRetainedHistoryMultiScopeMaintenance,
} from "../src/retainedHistoryMultiScopeMaintenance";
import {
  createRetainedHistorySchedulerRun,
} from "../src/retainedHistorySchedulerRun";
import { runEffect } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresExecutorPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("O11-F2 genuine PostgreSQL retained-history scheduler", () => {
  it("persists one scope before cold resume and serializes a duplicate wake", async () => {
    await withTemporaryPostgresExecutorPersistence(async (
      persistence,
      _executorPersistence,
      locator,
    ) => {
      let uuidCounter = 1;
      const nextUuid = (): string => {
        const suffix = uuidCounter.toString().padStart(12, "0");
        uuidCounter += 1;
        return `96000000-0000-4000-8000-${suffix}`;
      };
      const deployments = [];
      const provisioner = createPostgresSharedScopeAuthorityProvisioner(
        persistence,
        { physicalLocator: locator, randomUuid: nextUuid },
      );
      for (const suffix of ["one", "two"] as const) {
        const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
          `deployment_retained_history_scheduler_pg_${suffix}`,
        );
        const provisioned = await provisioner.ensure({
          deploymentId,
          projectId: `project_retained_history_scheduler_pg_${suffix}`,
        });
        deployments.push(Object.freeze({
          deploymentId,
          scopeId: decodeReplacementScopeIdV1(provisioned.scope.scopeId),
        }));
        await persistence.query(
          `update fx_system_scope_clock
           set storage_generation = 'flarexdb_v1',
               storage_generation_fence = 1,
               last_commit_seq = 0,
               authorization_revocation_epoch = 0,
               updated_at = clock_timestamp()
           where scope_id = $1`,
          [provisioned.scope.scopeId],
        );
      }

      const first = await runEffect(
        makeRunner(persistence, locator, nextUuid).runEffect(),
      );
      expect(first).toMatchObject({
        kind: "completed",
        reason: "countBudget",
        batches: [{ maintenance: {
          deploymentId: deployments[0]!.deploymentId,
          scopeId: deployments[0]!.scopeId,
        } }],
      });

      const second = await runEffect(
        makeRunner(persistence, locator, nextUuid).runEffect(),
      );
      expect(second).toMatchObject({
        kind: "completed",
        reason: "cycleExhausted",
        batches: [{ maintenance: {
          deploymentId: deployments[1]!.deploymentId,
          scopeId: deployments[1]!.scopeId,
        } }],
      });

      const blocker = checkpoint(persistence, locator, nextUuid);
      const acquired = await runEffect(blocker.acquireEffect());
      if (acquired.kind !== "acquired") {
        throw new Error(`Expected blocking claim, observed ${acquired.kind}.`);
      }
      await expect(runEffect(
        makeRunner(persistence, locator, nextUuid).runEffect(),
      )).resolves.toMatchObject({ kind: "busy" });
      await runEffect(blocker.releaseEffect(acquired.run));
    });
  }, 120_000);
});

function makeRunner(
  persistence: Parameters<
    Parameters<typeof withTemporaryPostgresExecutorPersistence>[0]
  >[0],
  locator: Parameters<
    Parameters<typeof withTemporaryPostgresExecutorPersistence>[0]
  >[2],
  nextUuid: () => string,
) {
  const directory = Result.getOrThrow(
    createRetainedHistorySchedulerDirectory(persistence.drizzle, {
      authority: {
        scopeMetadata: persistence,
        provisioningReceipts: {
          getScopeAuthorityProvisioningReceipt: async () => {
            throw new Error("Shared scopes do not use split receipts.");
          },
        },
        scopeClockTargets: {
          resolve: async (physicalLocator) =>
            createPostgresLocatedRetainedHistoryFloorTarget(
              persistence,
              physicalLocator,
            ),
        },
      },
      maintenance: {
        maximumPages: 8,
        maximumElapsedMilliseconds: 10_000,
      },
    }),
  );
  const multiScope = Result.getOrThrow(
    createRetainedHistoryMultiScopeMaintenance(directory, {
      maximumDirectoryPagesPerInvocation: 2,
      maximumMaintenancePagesPerInvocation: 8,
    }),
  );
  return Result.getOrThrow(createRetainedHistorySchedulerRun(
    checkpointPort(checkpoint(persistence, locator, nextUuid)),
    multiScope,
    {
      maximumInvocations: 1,
      maximumDirectoryPages: 2,
      maximumMaintenancePages: 8,
      maximumRunMilliseconds: 30_000,
      maximumInvocationMilliseconds: 15_000,
      settlementReserveMilliseconds: 1_000,
    },
  ));
}

function checkpoint(
  persistence: Parameters<
    Parameters<typeof withTemporaryPostgresExecutorPersistence>[0]
  >[0],
  locator: Parameters<
    Parameters<typeof withTemporaryPostgresExecutorPersistence>[0]
  >[2],
  nextUuid: () => string,
) {
  const target = createPostgresLocatedPointMutationSessionActivationTargetV1(
    persistence,
    locator,
  );
  if (!isLocatedReadCommittedAttemptTargetV1(target)) {
    throw new Error("Expected a located READ COMMITTED PostgreSQL target.");
  }
  return createRetainedHistorySchedulerCheckpointV1(target, {
    claimDurationMilliseconds: 60_000,
    randomUuid: nextUuid,
  });
}

function checkpointPort(repository: ReturnType<typeof checkpoint>) {
  return Object.freeze({
    ...repository,
    isAcquireConfirmedRollback:
      isRetainedHistorySchedulerAcquireConfirmedRollbackV1Error,
    isRenewConfirmedRollback:
      isRetainedHistorySchedulerRenewConfirmedRollbackV1Error,
    isCheckpointConfirmedRollback:
      isRetainedHistorySchedulerCheckpointConfirmedRollbackV1Error,
    isReleaseConfirmedRollback:
      isRetainedHistorySchedulerReleaseConfirmedRollbackV1Error,
  });
}
