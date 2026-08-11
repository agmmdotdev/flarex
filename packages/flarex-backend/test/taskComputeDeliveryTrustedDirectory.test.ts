import type {
  FlarexMetadataDatabase,
  ScopeClockRecord,
  ScopeMetadataRecord,
} from "@flarex/persistence-postgres";
import {
  createLocatedTaskComputeDeliveryTargetV1,
} from "@flarex/persistence-postgres/internal/task-compute-delivery-repository-v1";
import {
  createTaskComputeDeliveryControlDirectoryTargetForSystemTest,
} from "@flarex/persistence-postgres/internal/system-test/task-compute-delivery-control-directory";
import type {
  AppRowTransaction,
} from "@flarex/persistence-postgres/internal/system-test/appRows";
import type {
  TaskRepairPostgresDeadlinePolicyInputV1,
} from "@flarex/persistence-postgres/internal/task-repair-postgres-deadline-policy-v1";
import { Effect, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  OutboxSeqSchema,
  ScopeEpochSchema,
  StorageGenerationFenceSchema,
  replacementScopeIdV1FromUuid,
} from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import {
  TaskComputeDeliveryTrustedDirectory,
  TaskComputeDeliveryTrustedDirectoryInputError,
  makeTaskComputeDeliveryTrustedDirectoryLayer,
} from "../src/taskComputeDelivery/TrustedDirectory";

const SCOPE_ID = replacementScopeIdV1FromUuid(
  "93000000-0000-4000-8000-000000000001",
);
const OTHER_SCOPE_ID = replacementScopeIdV1FromUuid(
  "93000000-0000-4000-8000-000000000002",
);
const DEPLOYMENT_ID = "deployment_task_compute_delivery";
const OTHER_DEPLOYMENT_ID = "deployment_task_compute_delivery_other";
const LOCATOR = Object.freeze({
  kind: "shared_database" as const,
  databaseKey: "primary",
  schemaName: "public",
});

describe("DTE06-C3 trusted compute-delivery directory", () => {
  it("discovers and freshly resolves one ready located partition", async () => {
    let executeReceiver = false;
    const controlDb = Object.freeze({
      execute(this: unknown) {
        executeReceiver = this === controlDb;
        return Promise.resolve({ rows: [directoryRow(SCOPE_ID)] });
      },
    }) as unknown as FlarexMetadataDatabase;
    const layer = makeTaskComputeDeliveryTrustedDirectoryLayer(
      controlDirectoryTarget(controlDb, Object.freeze({
        ...directoryDeadline(),
        settlementReserveMilliseconds: 1_200,
      })),
      directoryOptions(SCOPE_ID),
    );

    const page = await Effect.runPromise(Effect.gen(function* () {
      const directory = yield* TaskComputeDeliveryTrustedDirectory;
      expect(
        directory.singleCandidateDiscoverSettlementBudgetMilliseconds,
      ).toBe(1_701);
      expect(directory.resolveSettlementBudgetMilliseconds).toBe(501);
      return yield* directory.discover({ limit: 1 });
    }).pipe(Effect.provide(layer)));

    expect(executeReceiver).toBe(true);
    expect(page.continuation).toBeNull();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      kind: "ready",
      deploymentId: DEPLOYMENT_ID,
      scopeId: SCOPE_ID,
    });
    expect(page.items[0]).not.toHaveProperty("authority");
    expect(page.items[0]).not.toHaveProperty("target");
    expect(Object.isFrozen(page)).toBe(true);
    expect(Object.isFrozen(page.items)).toBe(true);
    expect(Object.isFrozen(page.items[0])).toBe(true);
    if (page.items[0]?.kind !== "ready") throw new Error("expected ready item");
    expect(Object.isFrozen(page.items[0].discovery)).toBe(true);
    expect(Object.isFrozen(page.items[0].repository)).toBe(true);
  });

  it("returns candidate-local mismatch evidence without failing the page", async () => {
    const controlDb = Object.freeze({
      execute: () => Promise.resolve({ rows: [directoryRow(SCOPE_ID)] }),
    }) as unknown as FlarexMetadataDatabase;
    const layer = makeTaskComputeDeliveryTrustedDirectoryLayer(
      controlDirectoryTarget(controlDb),
      directoryOptions(OTHER_SCOPE_ID),
    );

    const page = await Effect.runPromise(Effect.gen(function* () {
      const directory = yield* TaskComputeDeliveryTrustedDirectory;
      return yield* directory.discover({ limit: 1 });
    }).pipe(Effect.provide(layer)));

    expect(page.items).toEqual([
      expect.objectContaining({
        kind: "failed",
        deploymentId: DEPLOYMENT_ID,
        scopeId: SCOPE_ID,
        reason: "candidate_scope_mismatch",
      }),
    ]);
  });

  it("times out one authority candidate and still resolves the later scope", async () => {
    const controlDb = Object.freeze({
      execute: () => Promise.resolve({ rows: [
        directoryRow(SCOPE_ID, 1, DEPLOYMENT_ID, OTHER_SCOPE_ID),
        directoryRow(OTHER_SCOPE_ID, 2, OTHER_DEPLOYMENT_ID),
      ] }),
    }) as unknown as FlarexMetadataDatabase;
    const baseOptions = directoryOptions(OTHER_SCOPE_ID);
    const healthyMetadata = scopeMetadata(
      OTHER_SCOPE_ID,
      OTHER_DEPLOYMENT_ID,
    );
    const layer = makeTaskComputeDeliveryTrustedDirectoryLayer(
      controlDirectoryTarget(controlDb),
      Object.freeze({
        ...baseOptions,
        authority: Object.freeze({
          ...baseOptions.authority,
          scopeMetadata: Object.freeze({
            getScopeMetadataByDeploymentId: (deploymentId: string) =>
              deploymentId === DEPLOYMENT_ID
                ? new Promise<ScopeMetadataRecord | null>(() => {})
                : Promise.resolve(healthyMetadata),
          }),
        }),
        resolutionTimeoutMilliseconds: 10,
      }),
    );

    const page = await Effect.runPromise(Effect.gen(function* () {
      const directory = yield* TaskComputeDeliveryTrustedDirectory;
      const resolving = yield* directory.discover({ limit: 2 }).pipe(
        Effect.forkChild,
      );
      yield* TestClock.adjust("10 millis");
      return yield* Fiber.join(resolving);
    }).pipe(
      Effect.provide(layer),
      Effect.provide(TestClock.layer()),
    ));

    expect(page.continuation).toBeNull();
    expect(page.items).toEqual([
      expect.objectContaining({
        kind: "failed",
        deploymentId: DEPLOYMENT_ID,
        scopeId: SCOPE_ID,
        reason: "authority_unavailable",
      }),
      expect.objectContaining({
        kind: "ready",
        deploymentId: OTHER_DEPLOYMENT_ID,
        scopeId: OTHER_SCOPE_ID,
      }),
    ]);
  });

  it("preserves continuation across a filtered legacy scope page", async () => {
    const legacyScope =
      "scope_92000000-0000-4000-8000-000000000001x";
    const controlDb = Object.freeze({
      execute: () => Promise.resolve({ rows: [
        Object.freeze({
          high_water_scope_id: SCOPE_ID,
          continuation_ordering_valid: true,
          scope_id: legacyScope,
          deployment_id: "legacy-deployment",
          scope_ordinal: 1,
        }),
        directoryRow(SCOPE_ID, 2),
      ] }),
    }) as unknown as FlarexMetadataDatabase;
    const layer = makeTaskComputeDeliveryTrustedDirectoryLayer(
      controlDirectoryTarget(controlDb),
      directoryOptions(SCOPE_ID),
    );

    const page = await Effect.runPromise(Effect.gen(function* () {
      const directory = yield* TaskComputeDeliveryTrustedDirectory;
      return yield* directory.discover({ limit: 1 });
    }).pipe(Effect.provide(layer)));

    expect(page.items).toEqual([]);
    expect(page.continuation).toMatchObject({
      highWaterScopeId: SCOPE_ID,
      lastScopeId: legacyScope,
    });
  });

  it("fails typed on hostile explicit-resolution input", async () => {
    const controlDb = Object.freeze({
      execute: () => Promise.resolve({ rows: [directoryRow(SCOPE_ID)] }),
    }) as unknown as FlarexMetadataDatabase;
    const layer = makeTaskComputeDeliveryTrustedDirectoryLayer(
      controlDirectoryTarget(controlDb),
      directoryOptions(SCOPE_ID),
    );
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    const failure = await Effect.runPromise(Effect.gen(function* () {
      const directory = yield* TaskComputeDeliveryTrustedDirectory;
      return yield* directory.resolve(revoked.proxy).pipe(Effect.flip);
    }).pipe(Effect.provide(layer)));

    expect(failure).toBeInstanceOf(
      TaskComputeDeliveryTrustedDirectoryInputError,
    );
    expect(failure).toMatchObject({
      operation: "resolve",
      reason: "invalid_candidate",
    });
  });
});

function directoryOptions(resolvedScopeId: typeof SCOPE_ID) {
  const targetDatabase = Object.freeze({}) as unknown as FlarexMetadataDatabase;
  const baseTarget = createLocatedTaskComputeDeliveryTargetV1(
    targetDatabase,
    LOCATOR,
    async () => {
      throw new Error("candidate construction must not start a transaction");
    },
  );
  const target = Object.freeze({
    ...baseTarget,
    getCurrentClock: async () => scopeClock(resolvedScopeId),
  });
  const metadata = scopeMetadata(resolvedScopeId, DEPLOYMENT_ID);
  return Object.freeze({
    authority: Object.freeze({
      scopeMetadata: Object.freeze({
        getScopeMetadataByDeploymentId: async () => metadata,
      }),
      provisioningReceipts: Object.freeze({
        getScopeAuthorityProvisioningReceipt: async () => {
          throw new Error("shared scope must not read split receipt");
        },
      }),
      scopeClockTargets: Object.freeze({ resolve: async () => target }),
    }),
    repository: Object.freeze({
      claimDurationMilliseconds: 30_000,
      retryDelayMilliseconds: Object.freeze([1_000]),
      maximumDeliveryAttempts: 2,
      randomUuid: () => "93000000-0000-4000-8000-000000000010",
    }),
    discoveryDeadline: Object.freeze({
      connectionTimeoutMilliseconds: 100,
      lockTimeoutMilliseconds: 100,
      statementTimeoutMilliseconds: 200,
      transactionTimeoutMilliseconds: 300,
      settlementReserveMilliseconds: 1_000,
    }),
    resolutionTimeoutMilliseconds: 500,
  });
}

function controlDirectoryTarget(
  controlDb: FlarexMetadataDatabase,
  deadline: TaskRepairPostgresDeadlinePolicyInputV1 = directoryDeadline(),
) {
  return Result.getOrThrow(
    createTaskComputeDeliveryControlDirectoryTargetForSystemTest(
      async (work) => work(controlDb as AppRowTransaction),
      deadline,
    ),
  );
}

function directoryDeadline(): TaskRepairPostgresDeadlinePolicyInputV1 {
  return Object.freeze({
    connectionTimeoutMilliseconds: 100,
    lockTimeoutMilliseconds: 100,
    statementTimeoutMilliseconds: 200,
    transactionTimeoutMilliseconds: 300,
    settlementReserveMilliseconds: 1_000,
  });
}

function directoryRow(
  scopeId: typeof SCOPE_ID,
  ordinal = 1,
  deploymentId = DEPLOYMENT_ID,
  highWaterScopeId = scopeId,
) {
  return Object.freeze({
    high_water_scope_id: highWaterScopeId,
    continuation_ordering_valid: true,
    scope_id: scopeId,
    deployment_id: deploymentId,
    scope_ordinal: ordinal,
  });
}

function scopeMetadata(
  scopeId: typeof SCOPE_ID,
  deploymentId: string,
): ScopeMetadataRecord {
  return Object.freeze({
    scopeId,
    deploymentId,
    activeSchemaVersionId: null,
    createdAt: new Date("2026-08-11T00:00:00.000Z"),
    isolationKind: "shared_database",
    physicalLocator: LOCATOR,
  });
}

function scopeClock(scopeId: typeof SCOPE_ID): ScopeClockRecord {
  return Object.freeze({
    scopeId,
    storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    storageGenerationFence: StorageGenerationFenceSchema.make(1n),
    lastCommitSeq: CommitSeqSchema.make(0n),
    lastOutboxSeq: OutboxSeqSchema.make(0n),
    epoch: ScopeEpochSchema.make("epoch-task-compute-delivery"),
    updatedAt: new Date("2026-08-11T00:00:00.000Z"),
  });
}
