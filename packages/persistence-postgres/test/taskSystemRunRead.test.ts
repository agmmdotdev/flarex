import { PGlite } from "@electric-sql/pglite";
import {
  RunAttemptLifecycle,
  RunAttemptLifecycleLive,
  TaskSystemRunAttemptStore,
  decodeTaskHeartbeatSequenceV1,
  decodeTaskRequestedEffectSequenceV1,
  decodeTaskRetryJitterV1,
  decodeTaskRunIdV1,
  decodeTaskRunVersionV1,
  type TaskRunIdV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { and, count, eq } from "drizzle-orm";
import { Effect, Layer, Result } from "effect";
import {
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
} from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import {
  createPGliteLocatedTaskSystemRunAttemptTargetV1,
  createPGlitePersistence,
} from "../src/pglite";
import { makeTaskSystemRunAttemptStoreV1 } from
  "../src/taskSystemRunAttemptStoreV1";
import {
  fxSystemDurableTaskAttemptIdentitiesV1,
  fxSystemDurableTaskRequestedEffectsV1,
  fxSystemDurableTaskRunsV1,
  fxSystemScopeClocks,
} from "../src/schema";
import {
  TaskSystemRunReadCorruptionError,
  TaskSystemRunReadStaleScopeAuthorityError,
  TaskSystemRunReadUnavailableError,
  makeTaskSystemDueDiscoveryV1,
  makeTaskSystemRequestedEffectLedgerV1,
  type TaskSystemRunReadQueryObserverV1,
} from "../src/taskSystemRunReadV1";
import { RUN_LOCATED_READ_COMMITTED_V1 } from
  "../src/transactionSessionAttemptKernel";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  ACCEPTED_ATTEMPT_UUID,
  TASK_LOCATOR,
  TASK_RUN_ID,
  TASK_SCOPE_ID,
  locatedTaskAuthorityV1,
  readyTaskRunAggregateV1,
  seedAdditionalTaskSystemRunV1,
  seedTaskSystemRunAttemptStoreV1,
} from "./taskSystemRunAttemptStoreTestSupport";

const EARLY_RUN_ID = "run_72000000-0000-4000-8000-000000000001";
const LATE_RUN_ID = "run_72000000-0000-4000-8000-000000000005";
const MISSING_RUN_ID = "run_72000000-0000-4000-8000-000000000099";
const OTHER_SCOPE_ID = "scope_72000000-0000-4000-8000-000000000098";
const runId = Result.getOrThrow(decodeTaskRunIdV1(TASK_RUN_ID));
const runVersionOne = Result.getOrThrow(decodeTaskRunVersionV1("1"));
const heartbeatOne = Result.getOrThrow(decodeTaskHeartbeatSequenceV1(1));
const requestedEffectOne = Result.getOrThrow(
  decodeTaskRequestedEffectSequenceV1("1"),
);
const retryJitter = Result.getOrThrow(decodeTaskRetryJitterV1(0.25));
const taskScopeId = ScopeIdSchema.make(TASK_SCOPE_ID);
const otherScopeId = ScopeIdSchema.make(OTHER_SCOPE_ID);
const taskStorageGeneration =
  FlarexDbV1StorageGenerationSchema.make("flarexdb_v1");
const crossScopeEpoch = ScopeEpochSchema.make(
  "epoch_72000000-0000-4000-8000-000000000097",
);
const staleScopeEpoch = ScopeEpochSchema.make(
  "epoch_72000000-0000-4000-8000-000000000099",
);

describe("DTE04-D scope-bound Task System reads - PGlite", () => {
  it("discovers a stable, bounded due snapshot in exact keyset order", async () => {
    await withFixture(async ({ persistence, located, lifecycleStore }) => {
      await seedAdditionalTaskSystemRunV1(persistence, LATE_RUN_ID);
      await seedAdditionalTaskSystemRunV1(persistence, EARLY_RUN_ID);
      const observations: Parameters<TaskSystemRunReadQueryObserverV1>[0][] = [];
      const discovery = makeTaskSystemDueDiscoveryV1(located, {
        observeQuery: observation => observations.push(observation),
      });

      const first = await runEffect(discovery.discoverDueRuns({
        version: 1,
        dueKind: "start_attempt",
        pageSize: 1,
        cursor: null,
      }));
      const second = await runEffect(discovery.discoverDueRuns({
        version: 1,
        dueKind: "start_attempt",
        pageSize: 1,
        cursor: first.nextCursor,
      }));
      const third = await runEffect(discovery.discoverDueRuns({
        version: 1,
        dueKind: "start_attempt",
        pageSize: 1,
        cursor: second.nextCursor,
      }));

      expect([
        first.candidates[0]?.runId,
        second.candidates[0]?.runId,
        third.candidates[0]?.runId,
      ]).toEqual([EARLY_RUN_ID, TASK_RUN_ID, LATE_RUN_ID]);
      expect(second.throughMs).toBe(first.throughMs);
      expect(third.throughMs).toBe(first.throughMs);
      expect(first.nextCursor).not.toBeNull();
      expect(second.nextCursor).not.toBeNull();
      expect(third.nextCursor).toBeNull();
      expect(observations).toHaveLength(3);
      expect(observations.map(observation => ({
        name: observation.name,
        tail: observation.sql.slice(observation.sql.indexOf(" from ")),
        params: observation.params,
      }))).toEqual([
        {
          name: "discoverDueRuns",
          tail: ` from "fx_system_durable_task_run_v1" where ("fx_system_durable_task_run_v1"."scope_id" = $1 and "fx_system_durable_task_run_v1"."definition_generation" = $2 and "fx_system_durable_task_run_v1"."due_kind" = $3 and "fx_system_durable_task_run_v1"."due_at_ms" <= $4) order by "fx_system_durable_task_run_v1"."due_at_ms" asc, "fx_system_durable_task_run_v1"."run_id" asc limit $5`,
          params: [TASK_SCOPE_ID, "legacy_definition_v1", "start_attempt", BigInt(first.throughMs), 2],
        },
        {
          name: "discoverDueRuns",
          tail: ` from "fx_system_durable_task_run_v1" where ("fx_system_durable_task_run_v1"."scope_id" = $1 and "fx_system_durable_task_run_v1"."definition_generation" = $2 and "fx_system_durable_task_run_v1"."due_kind" = $3 and "fx_system_durable_task_run_v1"."due_at_ms" <= $4 and ("fx_system_durable_task_run_v1"."due_at_ms" > $5 or ("fx_system_durable_task_run_v1"."due_at_ms" = $6 and "fx_system_durable_task_run_v1"."run_id" > $7))) order by "fx_system_durable_task_run_v1"."due_at_ms" asc, "fx_system_durable_task_run_v1"."run_id" asc limit $8`,
          params: [
            TASK_SCOPE_ID,
            "legacy_definition_v1",
            "start_attempt",
            BigInt(first.throughMs),
            0n,
            0n,
            EARLY_RUN_ID,
            2,
          ],
        },
        {
          name: "discoverDueRuns",
          tail: ` from "fx_system_durable_task_run_v1" where ("fx_system_durable_task_run_v1"."scope_id" = $1 and "fx_system_durable_task_run_v1"."definition_generation" = $2 and "fx_system_durable_task_run_v1"."due_kind" = $3 and "fx_system_durable_task_run_v1"."due_at_ms" <= $4 and ("fx_system_durable_task_run_v1"."due_at_ms" > $5 or ("fx_system_durable_task_run_v1"."due_at_ms" = $6 and "fx_system_durable_task_run_v1"."run_id" > $7))) order by "fx_system_durable_task_run_v1"."due_at_ms" asc, "fx_system_durable_task_run_v1"."run_id" asc limit $8`,
          params: [
            TASK_SCOPE_ID,
            "legacy_definition_v1",
            "start_attempt",
            BigInt(first.throughMs),
            0n,
            0n,
            TASK_RUN_ID,
            2,
          ],
        },
      ]);
      expect(observations.every(item => Object.isFrozen(item.params))).toBe(true);
      await expect(taskCounts(persistence)).resolves.toEqual({
        runs: 3,
        attempts: 0,
        effects: 0,
      });

      const candidate = second.candidates[0];
      if (candidate?.kind !== "start_attempt") {
        throw new Error("expected a start candidate for the seeded run");
      }
      const layer = lifecycleLayer(lifecycleStore);
      const invokeCandidate = () => runEffect(Effect.gen(function* () {
        const service = yield* RunAttemptLifecycle;
        return yield* service.startAttempt({
          type: "start_attempt",
          runId: candidate.runId,
          expectedRunVersion: candidate.expectedRunVersion,
          retryJitter,
        });
      }).pipe(Effect.provide(layer)));
      const accepted = await invokeCandidate();
      const staleReplay = await invokeCandidate();
      expect(accepted.disposition).toBe("accepted");
      expect(staleReplay.disposition).toBe("idempotent");
      await expect(taskCounts(persistence)).resolves.toEqual({
        runs: 3,
        attempts: 1,
        effects: 4,
      });
    });
  });

  it("reads a contiguous effect snapshot without widening after new effects", async () => {
    await withFixture(async ({ located, lifecycleStore }) => {
      const lifecycle = lifecycleLayer(lifecycleStore);
      const started = await runEffect(Effect.gen(function* () {
        const service = yield* RunAttemptLifecycle;
        return yield* service.startAttempt({
          type: "start_attempt",
          runId,
          expectedRunVersion: runVersionOne,
          retryJitter,
        });
      }).pipe(Effect.provide(lifecycle)));
      if (started.outcome.kind !== "attempt_granted") {
        throw new Error("expected the seeded ready run to grant an attempt");
      }
      const attempt = started.outcome.grant.attempt;
      const observations: Parameters<TaskSystemRunReadQueryObserverV1>[0][] = [];
      const ledger = makeTaskSystemRequestedEffectLedgerV1(located, {
        observeQuery: observation => observations.push(observation),
      });
      const first = await runEffect(ledger.readRequestedEffects({
        version: 1,
        runId,
        pageSize: 2,
        cursor: null,
      }));
      expect(first.effects.map(effect => effect.sequence)).toEqual([1n, 2n]);
      expect(first.throughSequence).toBe(4n);

      await runEffect(Effect.gen(function* () {
        const service = yield* RunAttemptLifecycle;
        return yield* service.heartbeatAttempt({
          type: "heartbeat_attempt",
          runId,
          attemptId: attempt.attemptId,
          executionFence: attempt.executionFence,
          heartbeatSequence: heartbeatOne,
        });
      }).pipe(Effect.provide(lifecycle)));

      const second = await runEffect(ledger.readRequestedEffects({
        version: 1,
        runId,
        pageSize: 2,
        cursor: first.nextCursor,
      }));
      expect(second.effects.map(effect => effect.sequence)).toEqual([3n, 4n]);
      expect(second.throughSequence).toBe(first.throughSequence);
      expect(second.nextCursor).toBeNull();

      const widened = await runEffect(ledger.readRequestedEffects({
        version: 1,
        runId,
        pageSize: 100,
        cursor: null,
      }));
      expect(widened.throughSequence).toBeGreaterThan(first.throughSequence);
      expect(widened.effects.map(effect => effect.sequence)).toEqual(
        Array.from(
          { length: Number(widened.throughSequence) },
          (_, index) => BigInt(index + 1),
        ),
      );
      expect(observations.every(item => item.name === "requestedEffects"))
        .toBe(true);
    });
  });

  it("rejects invalid requests before opening a transaction", async () => {
    await withFixture(async ({ located }) => {
      let transactions = 0;
      const baseTarget = located.target;
      const guardedLocated = Object.freeze({
        authority: located.authority,
        target: Object.freeze({
          physicalLocator: baseTarget.physicalLocator,
          getCurrentClock: baseTarget.getCurrentClock,
          [RUN_LOCATED_READ_COMMITTED_V1]: <Value>(
            work: Parameters<
              typeof baseTarget[typeof RUN_LOCATED_READ_COMMITTED_V1]
            >[0],
          ): Promise<Value> => {
            transactions += 1;
            return baseTarget[RUN_LOCATED_READ_COMMITTED_V1](work) as Promise<Value>;
          },
        }),
      });
      const discovery = makeTaskSystemDueDiscoveryV1(guardedLocated);
      await expect(runEffectFailure(discovery.discoverDueRuns({
        version: 1,
        dueKind: "start_attempt",
        pageSize: 0,
        cursor: null,
      }))).resolves.toMatchObject({
        _tag: "InvalidTaskSystemRunReadRequestError",
        issue: "invalid_number",
      });
      expect(transactions).toBe(0);
    });
  });

  it("preserves non-disclosure, corruption detection, and scope authority", async () => {
    await withFixture(async ({ persistence, located, lifecycleStore }) => {
      const ledger = makeTaskSystemRequestedEffectLedgerV1(located);
      const missingRunId = Result.getOrThrow(decodeTaskRunIdV1(MISSING_RUN_ID));
      await seedCrossScopeRun(persistence, missingRunId);
      const unavailable = await runEffectFailure(ledger.readRequestedEffects({
        version: 1,
        runId: missingRunId,
        pageSize: 10,
        cursor: null,
      }));
      expect(unavailable).toBeInstanceOf(TaskSystemRunReadUnavailableError);

      await persistence.drizzle
        .update(fxSystemDurableTaskRunsV1)
        .set({ dueAtMs: 1n })
        .where(and(
          eq(fxSystemDurableTaskRunsV1.scopeId, taskScopeId),
          eq(fxSystemDurableTaskRunsV1.runId, runId),
        ));
      const corruptDue = await runEffectFailure(
        makeTaskSystemDueDiscoveryV1(located).discoverDueRuns({
          version: 1,
          dueKind: "start_attempt",
          pageSize: 10,
          cursor: null,
        }),
      );
      expect(corruptDue).toBeInstanceOf(TaskSystemRunReadCorruptionError);
      expect(corruptDue).toMatchObject({ reason: "run_row_invalid" });
      await persistence.drizzle
        .update(fxSystemDurableTaskRunsV1)
        .set({ dueAtMs: 0n })
        .where(and(
          eq(fxSystemDurableTaskRunsV1.scopeId, taskScopeId),
          eq(fxSystemDurableTaskRunsV1.runId, runId),
        ));

      await runEffect(Effect.gen(function* () {
        const service = yield* RunAttemptLifecycle;
        return yield* service.startAttempt({
          type: "start_attempt",
          runId,
          expectedRunVersion: runVersionOne,
          retryJitter,
        });
      }).pipe(Effect.provide(lifecycleLayer(lifecycleStore))));
      await persistence.drizzle
        .update(fxSystemDurableTaskRequestedEffectsV1)
        .set({ payloadJson: {} })
        .where(and(
          eq(fxSystemDurableTaskRequestedEffectsV1.scopeId, taskScopeId),
          eq(fxSystemDurableTaskRequestedEffectsV1.runId, runId),
          eq(
            fxSystemDurableTaskRequestedEffectsV1.sequence,
            requestedEffectOne,
          ),
        ));
      const corrupted = await runEffectFailure(ledger.readRequestedEffects({
        version: 1,
        runId,
        pageSize: 10,
        cursor: null,
      }));
      expect(corrupted).toBeInstanceOf(TaskSystemRunReadCorruptionError);
      expect(corrupted).toMatchObject({ reason: "effect_sequence_invalid" });

      await persistence.drizzle
        .update(fxSystemScopeClocks)
        .set({ epoch: staleScopeEpoch })
        .where(eq(fxSystemScopeClocks.scopeId, taskScopeId));
      const stale = await runEffectFailure(
        makeTaskSystemDueDiscoveryV1(located).discoverDueRuns({
          version: 1,
          dueKind: "start_attempt",
          pageSize: 10,
          cursor: null,
        }),
      );
      expect(stale).toBeInstanceOf(TaskSystemRunReadStaleScopeAuthorityError);
      expect(stale).toMatchObject({ authority: "epoch" });
    });
  });
});

function lifecycleLayer(
  store: ReturnType<typeof makeTaskSystemRunAttemptStoreV1>,
) {
  return RunAttemptLifecycleLive.pipe(
    Layer.provide(Layer.succeed(TaskSystemRunAttemptStore, store)),
  );
}

async function withFixture(
  run: (fixture: Awaited<ReturnType<typeof makeFixture>>) => Promise<void>,
): Promise<void> {
  const raw = new PGlite();
  try {
    await run(await makeFixture(raw));
  } finally {
    await raw.close();
  }
}

async function makeFixture(raw: PGlite) {
  const persistence = await createPGlitePersistence({ db: raw });
  await persistence.migrate();
  await seedTaskSystemRunAttemptStoreV1(persistence);
  const target = createPGliteLocatedTaskSystemRunAttemptTargetV1(
    persistence,
    TASK_LOCATOR,
  );
  const located = await locatedTaskAuthorityV1(persistence.drizzle, target);
  const lifecycleStore = makeTaskSystemRunAttemptStoreV1(located, {
    randomUuid: () => ACCEPTED_ATTEMPT_UUID,
  });
  return { persistence, located, lifecycleStore };
}

async function taskCounts(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
) {
  const [[runs], [attempts], [effects]] = await Promise.all([
    persistence.drizzle.select({ count: count() }).from(
      fxSystemDurableTaskRunsV1,
    ),
    persistence.drizzle.select({ count: count() }).from(
      fxSystemDurableTaskAttemptIdentitiesV1,
    ),
    persistence.drizzle.select({ count: count() }).from(
      fxSystemDurableTaskRequestedEffectsV1,
    ),
  ]);
  return {
    runs: runs?.count ?? -1,
    attempts: attempts?.count ?? -1,
    effects: effects?.count ?? -1,
  };
}

async function seedCrossScopeRun(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
  crossScopeRunId: TaskRunIdV1,
): Promise<void> {
  await persistence.drizzle.insert(fxSystemScopeClocks).values({
    scopeId: otherScopeId,
    storageGeneration: taskStorageGeneration,
    epoch: crossScopeEpoch,
  });
  const aggregate = Object.freeze({
    ...readyTaskRunAggregateV1(),
    runId: crossScopeRunId,
  });
  await persistence.query("set session_replication_role = replica");
  try {
    await seedTaskSystemRunAttemptStoreV1(persistence, {
      aggregate,
      parent: Object.freeze({
        scopeId: OTHER_SCOPE_ID,
        deploymentId: "deployment_cross_scope_task_read_v1",
        applicationRevisionId: "apprev_cross_scope_task_read_v1",
        candidateSha256Hex: "61".repeat(32),
      }),
    });
  } finally {
    await persistence.query("set session_replication_role = origin");
  }
}
