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
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGliteLocatedRetainedHistoryFloorTarget,
  createPGlitePersistence,
  createPGliteSharedScopeAuthorityProvisioner,
} from "@flarex/persistence-postgres/pglite";
import { Effect, Result } from "effect";
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
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const locator = Object.freeze({
  kind: "shared_database" as const,
  databaseKey: "retained-history-scheduler-run-pglite",
  schemaName: "public",
});

describe("O11-F2 connected PGlite retained-history scheduler", () => {
  it("cold-resumes a fixed directory sweep and fences a duplicate wake", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    let uuidCounter = 1;
    const nextUuid = (): string => {
      const suffix = uuidCounter.toString().padStart(12, "0");
      uuidCounter += 1;
      return `95000000-0000-4000-8000-${suffix}`;
    };

    const deployments = [];
    for (const suffix of ["one", "two"] as const) {
      const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
        `deployment_retained_history_scheduler_${suffix}`,
      );
      const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
        persistence,
        { physicalLocator: locator, randomUuid: nextUuid },
      ).ensure({
        deploymentId,
        projectId: `project_retained_history_scheduler_${suffix}`,
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

    const mutableMaintenance = {
      maximumPages: 8,
      maximumElapsedMilliseconds: 10_000,
    };
    const controlDbOwner = persistence.drizzle;
    const originalExecute = controlDbOwner.execute;
    let currentExecute = originalExecute;
    const mutableControlDb = new Proxy(controlDbOwner, {
      get: (target, property) =>
        property === "execute"
          ? currentExecute
          : Reflect.get(target, property, target),
    });
    const capturedDirectory = Result.getOrThrow(
      createRetainedHistorySchedulerDirectory(mutableControlDb, {
        authority: authorityPorts(persistence),
        maintenance: mutableMaintenance,
      }),
    );
    mutableMaintenance.maximumPages = 1;
    currentExecute = () => {
      throw new Error("late execute replacement");
    };
    await expect(runEffect(capturedDirectory.discoverEffect({ limit: 1 })))
      .resolves.toMatchObject({
        items: [{ kind: "ready", maximumPagesPerRun: 8 }],
      });

    const unavailableDirectory = Result.getOrThrow(
      createRetainedHistorySchedulerDirectory(persistence.drizzle, {
        authority: {
          ...authorityPorts(persistence),
          scopeMetadata: {
            getScopeMetadataByDeploymentId: async () => {
              throw new Error("control metadata unavailable");
            },
          },
        },
        maintenance: {
          maximumPages: 8,
          maximumElapsedMilliseconds: 10_000,
        },
      }),
    );
    await expect(runEffectFailure(
      unavailableDirectory.discoverEffect({ limit: 1 }),
    )).resolves.toMatchObject({
      _tag: "TrustedScopeAuthorityPortError",
      operation: "scopeMetadataRead",
    });

    const first = makeRunner(persistence, nextUuid);
    const firstResult = await runEffect(first.runEffect());
    expect(firstResult).toMatchObject({
      kind: "completed",
      reason: "countBudget",
      invocations: 1,
      batches: [{
        maintenance: {
          deploymentId: deployments[0]!.deploymentId,
          scopeId: deployments[0]!.scopeId,
          status: "maintenanceComplete",
        },
      }],
    });

    const cold = makeRunner(persistence, nextUuid);
    const coldResult = await runEffect(cold.runEffect());
    expect(coldResult).toMatchObject({
      kind: "completed",
      reason: "cycleExhausted",
      invocations: 1,
      batches: [{
        maintenance: {
          deploymentId: deployments[1]!.deploymentId,
          scopeId: deployments[1]!.scopeId,
          status: "maintenanceComplete",
        },
      }],
    });

    const blocker = checkpoint(persistence, nextUuid);
    const acquired = await runEffect(blocker.acquireEffect());
    if (acquired.kind !== "acquired") {
      throw new Error(`Expected blocking claim, observed ${acquired.kind}.`);
    }
    await expect(runEffect(makeRunner(persistence, nextUuid).runEffect()))
      .resolves.toMatchObject({ kind: "busy" });
    await runEffect(blocker.releaseEffect(acquired.run));
  }, 120_000);
});

function makeRunner(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
  nextUuid: () => string,
) {
  const directory = Result.getOrThrow(
    createRetainedHistorySchedulerDirectory(
      persistence.drizzle,
      {
        authority: authorityPorts(persistence),
        maintenance: {
          maximumPages: 8,
          maximumElapsedMilliseconds: 10_000,
        },
      },
    ),
  );
  const multiScope = Result.getOrThrow(
    createRetainedHistoryMultiScopeMaintenance(directory, {
      maximumDirectoryPagesPerInvocation: 2,
      maximumMaintenancePagesPerInvocation: 8,
    }),
  );
  return Result.getOrThrow(createRetainedHistorySchedulerRun(
    checkpointPort(checkpoint(persistence, nextUuid)),
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

function authorityPorts(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
) {
  return {
    scopeMetadata: persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => {
        throw new Error("Shared scopes do not use split receipts.");
      },
    },
    scopeClockTargets: {
      resolve: async (
        physicalLocator: Parameters<
          typeof createPGliteLocatedRetainedHistoryFloorTarget
        >[1],
      ) =>
        createPGliteLocatedRetainedHistoryFloorTarget(
          persistence,
          physicalLocator,
        ),
    },
  };
}

function checkpoint(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
  nextUuid: () => string,
) {
  const target = createPGliteLocatedPointMutationSessionActivationTargetV1(
    persistence,
    locator,
  );
  if (!isLocatedReadCommittedAttemptTargetV1(target)) {
    throw new Error("Expected a located READ COMMITTED PGlite target.");
  }
  return createRetainedHistorySchedulerCheckpointV1(target, {
    claimDurationMilliseconds: 60_000,
    randomUuid: nextUuid,
  });
}

function checkpointPort(
  repository: ReturnType<typeof checkpoint>,
) {
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
