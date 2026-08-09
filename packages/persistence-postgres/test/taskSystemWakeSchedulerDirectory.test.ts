import { PGlite } from "@electric-sql/pglite";
import {
  decodeTaskRetryJitterV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  makeFixedTaskRetryJitterSourceV1,
} from "@flarex/durable-task/internal/scheduling-testing-v1";
import { Result } from "effect";
import {
  replacementScopeIdV1FromUuid,
  type ReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import {
  createPGliteLocatedTaskSystemRunAttemptTargetV1,
  createPGlitePersistence,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import type { ScopeMetadataRecord } from "../src/scopeMetadata";
import type { SharedDatabaseScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import {
  createTaskSystemWakeSchedulerDirectoryV1,
  TaskSystemWakeSchedulerDirectoryScopeError,
  type TaskSystemWakeSchedulerDirectoryOptionsV1,
} from "../src/taskSystemWakeSchedulerDirectoryV1";
import {
  createTaskSystemWakeSchedulerRepairDirectoryV1,
} from "../src/taskSystemWakeSchedulerRepairDirectoryV1";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  TASK_LOCATOR,
  TASK_SCOPE_ID,
  seedTaskSystemRunAttemptStoreV1,
} from "./taskSystemRunAttemptStoreTestSupport";

const TASK_DEPLOYMENT_ID = "deployment_task_store_v1";
const retryJitter = Result.getOrThrow(decodeTaskRetryJitterV1(0.25));

describe("DTE05-C2 trusted Task scheduler directory - PGlite", () => {
  it("discovers, freshly resolves, and reconstructs a real C1 scheduler", async () => {
    await withFixture(async ({ persistence }) => {
      await insertScopeDirectoryEntry(
        persistence,
        replacementScopeIdV1FromUuid(TASK_SCOPE_ID.slice(6)),
        TASK_DEPLOYMENT_ID,
        TASK_LOCATOR,
      );
      await seedTaskSystemRunAttemptStoreV1(persistence);
      const firstDirectory = makeDirectory(persistence, attemptUuidSequence(301));
      const firstPage = await runEffect(firstDirectory.discoverEffect({
        limit: 10,
      }));

      expect(firstPage.partitions).toHaveLength(1);
      expect(firstPage.continuation).toBeNull();
      expect(firstPage.partitions[0]).toMatchObject({
        deploymentId: TASK_DEPLOYMENT_ID,
        scopeId: TASK_SCOPE_ID,
      });
      expect(firstPage.partitions[0]).not.toHaveProperty("physicalLocator");
      expect(firstPage.partitions[0]).not.toHaveProperty("authority");
      expect(firstPage.partitions[0]).not.toHaveProperty("target");
      expect(Object.isFrozen(firstPage)).toBe(true);
      expect(Object.isFrozen(firstPage.partitions)).toBe(true);
      expect(Object.isFrozen(firstPage.partitions[0])).toBe(true);

      const firstRun = await runEffect(firstPage.partitions[0]!.scheduler.run({
        dueKind: "start_attempt",
        cursor: null,
      }));
      expect(firstRun).toMatchObject({
        stopReason: "source_exhausted",
        candidatesHandled: 1,
      });
      expect(firstRun.handled[0]).toMatchObject({
        disposition: "accepted",
        outcomeKind: "attempt_granted",
      });

      const reconstructed = makeDirectory(
        persistence,
        attemptUuidSequence(401),
      );
      const reconstructedPage = await runEffect(
        reconstructed.discoverEffect({ limit: 10 }),
      );
      const recovered = await runEffect(
        reconstructedPage.partitions[0]!.scheduler.run({
          dueKind: "start_attempt",
          cursor: null,
        }),
      );
      expect(recovered).toMatchObject({
        stopReason: "source_exhausted",
        candidatesHandled: 0,
        continuation: null,
      });
    });
  });

  it("keeps one stable high-water snapshot and defers later scopes", async () => {
    await withFixture(async ({ persistence }) => {
      const first = scopeIdAt(1);
      const second = scopeIdAt(2);
      const third = scopeIdAt(3);
      await insertIdleScope(persistence, first);
      await insertIdleScope(persistence, second);
      await insertIdleScope(persistence, third);
      const directory = makeDirectory(persistence, attemptUuidSequence(501));

      const firstPage = await runEffect(directory.discoverEffect({ limit: 2 }));
      expect(firstPage.partitions.map(({ scopeId }) => scopeId)).toEqual([
        first,
        second,
      ]);
      expect(firstPage.continuation).not.toBeNull();

      const deferred = replacementScopeIdV1FromUuid(
        "89000000-0000-0000-0000-000000000001",
      );
      await insertIdleScope(persistence, deferred);
      const secondPage = await runEffect(directory.discoverEffect({
        limit: 2,
        continuation: firstPage.continuation,
      }));
      expect(secondPage.partitions.map(({ scopeId }) => scopeId)).toEqual([
        third,
      ]);
      expect(secondPage.continuation).toBeNull();

      const fresh = await runEffect(directory.discoverEffect({ limit: 10 }));
      expect(fresh.partitions.some(({ scopeId }) => scopeId === deferred))
        .toBe(true);
    });
  });

  it("fails closed when current authority no longer matches the inert hint", async () => {
    await withFixture(async ({ persistence }) => {
      const discoveredScope = scopeIdAt(10);
      const currentScope = scopeIdAt(11);
      const deploymentId = deploymentIdFor(discoveredScope);
      await insertIdleScope(persistence, discoveredScope, deploymentId);
      await insertScopeClock(persistence, currentScope);
      const currentMetadata = Object.freeze({
        ...(await requireScopeMetadata(persistence, deploymentId)),
        scopeId: currentScope,
      }) satisfies ScopeMetadataRecord;
      const directory = createTaskSystemWakeSchedulerDirectoryV1(
        persistence.drizzle,
        directoryOptions(persistence, attemptUuidSequence(601), {
          getScopeMetadataByDeploymentId: async () => currentMetadata,
        }),
      );

      const failure = await runEffectFailure(
        directory.discoverEffect({ limit: 1 }),
      );
      expect(failure).toBeInstanceOf(
        TaskSystemWakeSchedulerDirectoryScopeError,
      );
      expect(failure).toMatchObject({
        reason: "candidate_scope_mismatch",
      });
    });
  });

  it("isolates one repair candidate failure and preserves the next cursor", async () => {
    await withFixture(async ({ persistence }) => {
      const staleScope = scopeIdAt(20);
      const currentScope = scopeIdAt(21);
      const healthyScope = scopeIdAt(22);
      const staleDeployment = deploymentIdFor(staleScope);
      await insertIdleScope(persistence, staleScope, staleDeployment);
      await insertScopeClock(persistence, currentScope);
      await insertIdleScope(persistence, healthyScope);

      const repairDirectory = createTaskSystemWakeSchedulerRepairDirectoryV1(
        persistence.drizzle,
        directoryOptions(persistence, attemptUuidSequence(701), {
          getScopeMetadataByDeploymentId: async (deploymentId) => {
            const metadata = await requireScopeMetadata(
              persistence,
              deploymentId,
            );
            return deploymentId === staleDeployment
              ? Object.freeze({ ...metadata, scopeId: currentScope })
              : metadata;
          },
        }),
      );

      const failedPage = await runEffect(repairDirectory.discoverEffect({
        limit: 1,
      }));
      expect(failedPage.items).toEqual([
        expect.objectContaining({
          kind: "failed",
          deploymentId: staleDeployment,
          scopeId: staleScope,
          reason: "candidate_scope_mismatch",
        }),
      ]);
      expect(failedPage.continuation).not.toBeNull();
      await expect(runEffect(repairDirectory.resolveEffect(Object.freeze({
        deploymentId: staleDeployment,
        scopeId: staleScope,
      })))).resolves.toMatchObject({
        kind: "failed",
        reason: "candidate_scope_mismatch",
      });

      const healthyPage = await runEffect(repairDirectory.discoverEffect({
        limit: 1,
        continuation: failedPage.continuation,
      }));
      expect(healthyPage.items).toEqual([
        expect.objectContaining({
          kind: "ready",
          deploymentId: deploymentIdFor(healthyScope),
          scopeId: healthyScope,
        }),
      ]);
      expect(healthyPage.continuation).toBeNull();
      expect(healthyPage.items[0]).not.toHaveProperty("physicalLocator");
      expect(healthyPage.items[0]).not.toHaveProperty("authority");
      await expect(runEffect(repairDirectory.resolveEffect(Object.freeze({
        deploymentId: deploymentIdFor(healthyScope),
        scopeId: healthyScope,
      })))).resolves.toMatchObject({
        kind: "ready",
        deploymentId: deploymentIdFor(healthyScope),
        scopeId: healthyScope,
      });
    });
  });

  it("preserves repair continuation across a filtered legacy scope", async () => {
    await withFixture(async ({ persistence }) => {
      await insertLegacyScopeId(
        persistence,
        "scope_81000000-0000-0000-0000-000000000001x",
        "before_replacement",
      );
      const healthyScope = scopeIdAt(30);
      await insertIdleScope(persistence, healthyScope);
      const repairDirectory = createTaskSystemWakeSchedulerRepairDirectoryV1(
        persistence.drizzle,
        directoryOptions(persistence, attemptUuidSequence(801)),
      );

      const filtered = await runEffect(repairDirectory.discoverEffect({
        limit: 1,
      }));
      expect(filtered.items).toEqual([]);
      expect(filtered.continuation).not.toBeNull();

      const healthy = await runEffect(repairDirectory.discoverEffect({
        limit: 1,
        continuation: filtered.continuation,
      }));
      expect(healthy.items).toEqual([
        expect.objectContaining({
          kind: "ready",
          deploymentId: deploymentIdFor(healthyScope),
          scopeId: healthyScope,
        }),
      ]);
      expect(healthy.continuation).toBeNull();
    });
  });
});

function makeDirectory(
  persistence: PGliteFlarexPersistence,
  randomUuid: () => string,
) {
  return createTaskSystemWakeSchedulerDirectoryV1(
    persistence.drizzle,
    directoryOptions(persistence, randomUuid),
  );
}

function directoryOptions(
  persistence: PGliteFlarexPersistence,
  randomUuid: () => string,
  scopeMetadata: TaskSystemWakeSchedulerDirectoryOptionsV1["authority"]["scopeMetadata"] =
    persistence,
): TaskSystemWakeSchedulerDirectoryOptionsV1 {
  return {
    authority: {
      scopeMetadata,
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => {
          throw new Error("Shared Task scope must not read split receipts.");
        },
      },
      scopeClockTargets: {
        resolve: async (physicalLocator) =>
          createPGliteLocatedTaskSystemRunAttemptTargetV1(
            persistence,
            physicalLocator,
          ),
      },
    },
    partition: {
      scheduler: {
        pageSize: 10,
        maximumPages: 10,
        maximumCandidates: 100,
      },
      retryJitter: makeFixedTaskRetryJitterSourceV1(retryJitter),
      runAttemptStore: { randomUuid },
    },
  };
}

async function withFixture(
  run: (fixture: Readonly<{
    readonly persistence: PGliteFlarexPersistence;
  }>) => Promise<void>,
): Promise<void> {
  const raw = new PGlite();
  try {
    const persistence = await createPGlitePersistence({ db: raw });
    await persistence.migrate();
    await run(Object.freeze({ persistence }));
  } finally {
    await raw.close();
  }
}

async function insertIdleScope(
  persistence: PGliteFlarexPersistence,
  scopeId: ReplacementScopeIdV1,
  deploymentId = deploymentIdFor(scopeId),
): Promise<void> {
  await insertScopeDirectoryEntry(
    persistence,
    scopeId,
    deploymentId,
    TASK_LOCATOR,
  );
  await insertScopeClock(persistence, scopeId);
}

async function insertScopeDirectoryEntry(
  persistence: PGliteFlarexPersistence,
  scopeId: ReplacementScopeIdV1,
  deploymentId: string,
  physicalLocator: SharedDatabaseScopePhysicalLocator,
): Promise<void> {
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_${deploymentId}`,
  });
  await persistence.insertScopeMetadata({
    scopeId,
    deploymentId,
    physicalLocator,
  });
}

async function insertScopeClock(
  persistence: PGliteFlarexPersistence,
  scopeId: ReplacementScopeIdV1,
): Promise<void> {
  await persistence.query(`
    insert into fx_system_scope_clock (scope_id, storage_generation, epoch)
    values ($1, 'flarexdb_v1', $2)
  `, [scopeId, `epoch_${scopeId.slice(6)}`]);
}

async function insertLegacyScopeId(
  persistence: PGliteFlarexPersistence,
  scopeId: string,
  suffix: string,
): Promise<void> {
  const deploymentId = `deployment_legacy_task_repair_${suffix}`;
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_${deploymentId}`,
  });
  await persistence.query(`
    insert into fx_control_scope (
      id,
      deployment_id,
      isolation_kind,
      physical_locator_json
    ) values ($1, $2, 'shared_database', $3::jsonb)
  `, [scopeId, deploymentId, JSON.stringify(TASK_LOCATOR)]);
}

async function requireScopeMetadata(
  persistence: PGliteFlarexPersistence,
  deploymentId: string,
): Promise<ScopeMetadataRecord> {
  const metadata = await persistence.getScopeMetadataByDeploymentId(
    deploymentId,
  );
  if (metadata === null) throw new Error("scope metadata fixture missing");
  return metadata;
}

function scopeIdAt(sequence: number): ReplacementScopeIdV1 {
  return replacementScopeIdV1FromUuid(
    `83000000-0000-0000-0000-${sequence.toString().padStart(12, "0")}`,
  );
}

function deploymentIdFor(scopeId: ReplacementScopeIdV1): string {
  return `deployment_task_directory_${scopeId.slice(6)}`;
}

function attemptUuidSequence(start: number): () => string {
  let ordinal = start;
  return () =>
    `84000000-0000-4000-8000-${String(ordinal++).padStart(12, "0")}`;
}
