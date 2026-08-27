import { PGlite } from "@electric-sql/pglite";
import {
  RunAttemptLifecycle,
  RunAttemptLifecycleLive,
  StaleTaskRunVersionError,
  TaskSystemRunAttemptCorruptionError,
  TaskSystemRunAttemptStaleScopeAuthorityError,
  TaskSystemRunAttemptStore,
  TaskSystemRunAttemptTerminalStoreError,
  TaskSystemRunAttemptTransientStoreError,
  TaskSystemRunAttemptUnavailableError,
  decodePersistedTaskRequestedEffectJsonV1,
  decodeTaskAttemptNumberV1,
  decodeTaskAttemptIdV1,
  decodeTaskCancellationGenerationV1,
  decodeTaskDurationMsV1,
  decodeTaskExecutionFenceV1,
  decodeTaskHeartbeatSequenceV1,
  decodeTaskRequestedEffectSequenceV1,
  decodeTaskRetryJitterV1,
  decodeTaskRunIdV1,
  decodeTaskRunVersionV1,
  encodePersistedTaskRequestedEffectJsonV1,
  type TaskRequestedEffectSequenceV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { and, count, eq, sql } from "drizzle-orm";
import { Cause, Effect, Exit, Layer, Result } from "effect";
import {
  ScopeEpochSchema,
  ScopeIdSchema,
} from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import {
  createPGliteLocatedTaskSystemRunAttemptTargetV1,
  createPGlitePersistence,
} from "../src/pglite";
import {
  createLocatedTaskSystemRunAttemptTargetV1,
  makeTaskSystemRunAttemptStoreV1,
} from "../src/taskSystemRunAttemptStoreV1";
import {
  fxSystemDurableTaskAttemptIdentitiesV1,
  fxSystemDurableTaskComputePendingV1,
  fxSystemDurableTaskRequestedEffectsV1,
  fxSystemDurableTaskRunsV1,
  fxSystemScopeClocks,
} from "../src/schema";
import {
  LocatedReadCommittedTransactionFailureV1,
  type LocatedReadCommittedTransactionFailureIssueV1,
} from "../src/transactionSessionAttemptKernel";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  ACCEPTED_ATTEMPT_UUID,
  COLLIDING_ATTEMPT_UUID,
  TASK_LOCATOR,
  TASK_RUN_ID,
  TASK_SCOPE_ID,
  locatedTaskAuthorityV1,
  seedAdditionalTaskSystemRunV1,
  seedTaskSystemRunAttemptStoreV1,
} from "./taskSystemRunAttemptStoreTestSupport";

const runId = Result.getOrThrow(decodeTaskRunIdV1(TASK_RUN_ID));
const taskScopeId = ScopeIdSchema.make(TASK_SCOPE_ID);
const runVersionOne = Result.getOrThrow(decodeTaskRunVersionV1("1"));
const runVersionTwo = Result.getOrThrow(decodeTaskRunVersionV1("2"));
const runVersionThree = Result.getOrThrow(decodeTaskRunVersionV1("3"));
const attemptNumberOne = Result.getOrThrow(decodeTaskAttemptNumberV1(1));
const attemptNumberTwo = Result.getOrThrow(decodeTaskAttemptNumberV1(2));
const executionFenceOne = Result.getOrThrow(decodeTaskExecutionFenceV1("1"));
const executionFenceTwo = Result.getOrThrow(decodeTaskExecutionFenceV1("2"));
const requestedEffectFive = Result.getOrThrow(
  decodeTaskRequestedEffectSequenceV1("5"),
);
const zeroDuration = Result.getOrThrow(decodeTaskDurationMsV1(0));
const retryJitter = Result.getOrThrow(decodeTaskRetryJitterV1(0.25));
const heartbeatOne = Result.getOrThrow(decodeTaskHeartbeatSequenceV1(1));
const cancellationOne = Result.getOrThrow(
  decodeTaskCancellationGenerationV1("1"),
);
const acceptedAttemptId = Result.getOrThrow(
  decodeTaskAttemptIdV1(`attempt_${ACCEPTED_ATTEMPT_UUID}`),
);

describe("DTE04-B scope-bound Task System lifecycle store - PGlite", () => {
  it("commits lifecycle state, immutable attempt identity, ordered effects, replay, and inspection", async () => {
    await withStore(async ({ persistence, located, store }) => {
      const layer = RunAttemptLifecycleLive.pipe(
        Layer.provide(Layer.succeed(TaskSystemRunAttemptStore, store)),
      );
      const start = (lifecycleLayer: typeof layer) => runEffect(Effect.gen(function* () {
        const lifecycle = yield* RunAttemptLifecycle;
        return yield* lifecycle.startAttempt({
          type: "start_attempt",
          runId,
          expectedRunVersion: runVersionOne,
          retryJitter,
        });
      }).pipe(Effect.provide(lifecycleLayer)));
      const started = await start(layer);
      let forbiddenAllocations = 0;
      const noAllocationStore = makeTaskSystemRunAttemptStoreV1(located, {
        randomUuid: () => {
          forbiddenAllocations += 1;
          throw new Error("replay/current path allocated an attempt identity");
        },
      });
      const noAllocationLayer = RunAttemptLifecycleLive.pipe(
        Layer.provide(Layer.succeed(TaskSystemRunAttemptStore, noAllocationStore)),
      );
      const replayed = await start(noAllocationLayer);
      if (started.outcome.kind !== "attempt_granted") {
        throw new Error("expected attempt grant");
      }
      const result = await runEffect(Effect.gen(function* () {
        const lifecycle = yield* RunAttemptLifecycle;
        if (started.outcome.kind !== "attempt_granted") {
          return yield* Effect.die("expected attempt grant");
        }
        const heartbeat = yield* lifecycle.heartbeatAttempt({
          type: "heartbeat_attempt",
          runId,
          attemptId: started.outcome.grant.attempt.attemptId,
          executionFence: started.outcome.grant.attempt.executionFence,
          heartbeatSequence: heartbeatOne,
        });
        const cancellation = yield* lifecycle.requestCancellation({
          type: "request_cancellation",
          runId,
          reason: { code: "requested", message: null },
        });
        const completed = yield* lifecycle.completeAttempt({
          type: "complete_attempt",
          runId,
          attemptId: started.outcome.grant.attempt.attemptId,
          executionFence: started.outcome.grant.attempt.executionFence,
          completion: {
            kind: "cancellation_acknowledged",
            cancellationGeneration: cancellationOne,
            executionDurationMs: null,
          },
        });
        const inspection = yield* lifecycle.inspectCurrentAttempt({
          type: "inspect_current_attempt",
          runId,
        });
        return { heartbeat, cancellation, completed, inspection };
      }).pipe(Effect.provide(layer)));
      const terminalStart = await start(noAllocationLayer);

      expect(started).toMatchObject({
        disposition: "accepted",
        runVersion: 2n,
        outcome: { kind: "attempt_granted" },
      });
      expect(started.requestedEffects.map(item => item.sequence))
        .toEqual([1n, 2n, 3n, 4n]);
      expect(replayed).toEqual({
        ...started,
        disposition: "idempotent",
      });
      expect(result.heartbeat).toMatchObject({
        disposition: "accepted",
        runVersion: 3n,
        outcome: { kind: "lease_renewed", enteredExecuting: true },
      });
      expect(result.cancellation).toMatchObject({
        disposition: "accepted",
        runVersion: 4n,
        outcome: { kind: "cancellation_requested" },
      });
      expect(result.completed).toMatchObject({
        disposition: "accepted",
        runVersion: 5n,
        outcome: { kind: "terminal_cancelled" },
      });
      expect(result.inspection.state).toMatchObject({
        phase: "terminal",
        runVersion: 5n,
        terminal: { kind: "cancelled", resolution: "acknowledged" },
      });
      expect(terminalStart).toMatchObject({
        disposition: "current",
        runVersion: 5n,
        outcome: { kind: "current", reason: "stale_run_version" },
      });
      expect(forbiddenAllocations).toBe(0);
      expect(Object.isFrozen(result.inspection)).toBe(true);
      expect(await counts(persistence)).toEqual({
        attempts: 1,
        effects: 15,
        pendingComputeDeliveries: 2,
      });
    });
  });

  it("retries only an exact attempt identity primary-key collision and rolls the failed execution back", async () => {
    await withStore(async ({ persistence, located }) => {
      const collisionOwnerRunId =
        "run_72000000-0000-4000-8000-000000000098";
      await seedAdditionalTaskSystemRunV1(persistence, collisionOwnerRunId);
      await persistence.drizzle.insert(
        fxSystemDurableTaskAttemptIdentitiesV1,
      ).values({
        scopeId: taskScopeId,
        attemptId: Result.getOrThrow(
          decodeTaskAttemptIdV1(`attempt_${COLLIDING_ATTEMPT_UUID}`),
        ),
        runId: Result.getOrThrow(decodeTaskRunIdV1(collisionOwnerRunId)),
        attemptNumber: attemptNumberOne,
        executionFence: executionFenceOne,
        acceptedRunVersion: runVersionOne,
      });
      const candidates = [COLLIDING_ATTEMPT_UUID, ACCEPTED_ATTEMPT_UUID];
      let allocations = 0;
      const store = makeTaskSystemRunAttemptStoreV1(located, {
        randomUuid: () => candidates[allocations++] ?? ACCEPTED_ATTEMPT_UUID,
      });
      const layer = RunAttemptLifecycleLive.pipe(
        Layer.provide(Layer.succeed(TaskSystemRunAttemptStore, store)),
      );
      const receipt = await runEffect(Effect.gen(function* () {
        const lifecycle = yield* RunAttemptLifecycle;
        return yield* lifecycle.startAttempt({
          type: "start_attempt",
          runId,
          expectedRunVersion: runVersionOne,
          retryJitter,
        });
      }).pipe(Effect.provide(layer)));

      expect(allocations).toBe(2);
      expect(receipt).toMatchObject({
        disposition: "accepted",
        outcome: {
          kind: "attempt_granted",
          grant: { attempt: { attemptId: acceptedAttemptId } },
        },
      });
      expect(await runState(persistence)).toMatchObject({
        run_version: "2",
        current_attempt_id: acceptedAttemptId,
      });
      expect(await counts(persistence)).toEqual({
        attempts: 2,
        effects: 4,
        pendingComputeDeliveries: 1,
      });
    });
  });

  it("preserves decision failure, no-write behavior, non-disclosure, corruption, and stale authority", async () => {
    await withStore(async ({ persistence, store }) => {
      const expected = new StaleTaskRunVersionError({
        operation: "start_attempt",
        runId,
        reason: "commit_basis_disagrees_with_decoded_state",
      });
      const failure = await runEffectFailure(store.transactRunAttempt({
        operation: "start_attempt",
        runId,
        decide: () => Result.fail(expected),
      }));
      expect(failure).toBe(expected);
      expect(await counts(persistence)).toEqual({
        attempts: 0,
        effects: 0,
        pendingComputeDeliveries: 0,
      });
      expect(await runState(persistence)).toMatchObject({ run_version: "1" });

      const missingRun = Result.getOrThrow(
        decodeTaskRunIdV1("run_72000000-0000-4000-8000-000000000099"),
      );
      await expect(runEffectFailure(store.inspectRunAttempt({
        operation: "inspect_current_attempt",
        runId: missingRun,
      }))).resolves.toBeInstanceOf(TaskSystemRunAttemptUnavailableError);

      await persistence.drizzle.update(fxSystemDurableTaskRunsV1).set({
        aggregateByteLength:
          sql<bigint>`${fxSystemDurableTaskRunsV1.aggregateByteLength} + 1`,
      }).where(taskRunWhere());
      await expect(runEffectFailure(store.inspectRunAttempt({
        operation: "inspect_current_attempt",
        runId,
      }))).resolves.toBeInstanceOf(TaskSystemRunAttemptCorruptionError);
    });

    await withStore(async ({ persistence, store }) => {
      await persistence.drizzle.update(fxSystemScopeClocks).set({
        epoch: ScopeEpochSchema.make(
          "epoch_72000000-0000-4000-8000-000000000099",
        ),
      }).where(eq(fxSystemScopeClocks.scopeId, taskScopeId));
      await expect(runEffectFailure(store.inspectRunAttempt({
        operation: "inspect_current_attempt",
        runId,
      }))).resolves.toBeInstanceOf(
        TaskSystemRunAttemptStaleScopeAuthorityError,
      );
    });

    await withStore(async ({ persistence, store }) => {
      const layer = RunAttemptLifecycleLive.pipe(
        Layer.provide(Layer.succeed(TaskSystemRunAttemptStore, store)),
      );
      await runEffect(Effect.gen(function* () {
        const lifecycle = yield* RunAttemptLifecycle;
        const started = yield* lifecycle.startAttempt({
          type: "start_attempt",
          runId,
          expectedRunVersion: runVersionOne,
          retryJitter,
        });
        if (started.outcome.kind !== "attempt_granted") {
          return yield* Effect.die("expected attempt grant");
        }
        return yield* lifecycle.completeAttempt({
          type: "complete_attempt",
          runId,
          attemptId: started.outcome.grant.attempt.attemptId,
          executionFence: started.outcome.grant.attempt.executionFence,
          completion: {
            kind: "succeeded",
            result: null,
            executionDurationMs: null,
          },
        });
      }).pipe(Effect.provide(layer)));

      await persistence.drizzle.update(
        fxSystemDurableTaskRequestedEffectsV1,
      ).set({
        payloadByteLength:
          sql<bigint>`${fxSystemDurableTaskRequestedEffectsV1.payloadByteLength}
            + 1`,
      }).where(taskEffectWhere(requestedEffectFive));
      await expect(runEffectFailure(store.inspectRunAttempt({
        operation: "inspect_current_attempt",
        runId,
      }))).resolves.toMatchObject({
        _tag: "TaskSystemRunAttemptCorruptionError",
        reason: "effect_sequence_invalid",
      });

      await persistence.drizzle.update(
        fxSystemDurableTaskRequestedEffectsV1,
      ).set({
        payloadByteLength:
          sql<bigint>`${fxSystemDurableTaskRequestedEffectsV1.payloadByteLength}
            - 1`,
      }).where(taskEffectWhere(requestedEffectFive));
      await persistence.drizzle.update(
        fxSystemDurableTaskAttemptIdentitiesV1,
      ).set({
        acceptedRunVersion: runVersionOne,
      }).where(taskAttemptWhere());
      await expect(runEffectFailure(store.inspectRunAttempt({
        operation: "inspect_current_attempt",
        runId,
      }))).resolves.toMatchObject({
        _tag: "TaskSystemRunAttemptCorruptionError",
        reason: "acceptance_invalid",
      });

      await persistence.drizzle.update(
        fxSystemDurableTaskAttemptIdentitiesV1,
      ).set({
        acceptedRunVersion: runVersionTwo,
      }).where(taskAttemptWhere());
      await persistence.drizzle.insert(
        fxSystemDurableTaskAttemptIdentitiesV1,
      ).values({
        scopeId: taskScopeId,
        attemptId: Result.getOrThrow(decodeTaskAttemptIdV1(
          "attempt_72000000-0000-4000-8000-000000000099",
        )),
        runId,
        attemptNumber: attemptNumberTwo,
        executionFence: executionFenceTwo,
        acceptedRunVersion: runVersionTwo,
      });
      await expect(runEffectFailure(store.inspectRunAttempt({
        operation: "inspect_current_attempt",
        runId,
      }))).resolves.toMatchObject({
        _tag: "TaskSystemRunAttemptCorruptionError",
        reason: "acceptance_invalid",
      });
    });
  });

  it("classifies only recognized infrastructure failures as transient", async () => {
    await withStore(async ({ persistence, located }) => {
      const storeFor = (
        issue: LocatedReadCommittedTransactionFailureIssueV1,
      ) => {
        const target = createLocatedTaskSystemRunAttemptTargetV1(
          persistence.drizzle,
          TASK_LOCATOR,
          async () => {
            throw new LocatedReadCommittedTransactionFailureV1(issue);
          },
        );
        return makeTaskSystemRunAttemptStoreV1(Object.freeze({
          authority: located.authority,
          target,
        }));
      };

      const connectionFailure = await runEffectFailure(
        storeFor(Object.freeze({
          kind: "infrastructureFailure",
          phase: "acquire",
          cause: Object.freeze({ code: "08006" }),
        })).inspectRunAttempt({ operation: "inspect_current_attempt", runId }),
      );
      expect(connectionFailure).toBeInstanceOf(
        TaskSystemRunAttemptTransientStoreError,
      );
      expect(connectionFailure).toMatchObject({
        reason: "connection_unavailable",
      });

      const timeoutFailure = await runEffectFailure(
        storeFor(Object.freeze({
          kind: "infrastructureFailure",
          phase: "beginOrConfigure",
          cause: Object.freeze({ code: "57014" }),
        })).inspectRunAttempt({ operation: "inspect_current_attempt", runId }),
      );
      expect(timeoutFailure).toBeInstanceOf(
        TaskSystemRunAttemptTransientStoreError,
      );
      expect(timeoutFailure).toMatchObject({ reason: "timeout" });

      const unsupportedFailure = await runEffectFailure(
        storeFor(Object.freeze({
          kind: "infrastructureFailure",
          phase: "beginOrConfigure",
          cause: new Error("transaction configuration unsupported"),
        })).inspectRunAttempt({ operation: "inspect_current_attempt", runId }),
      );
      expect(unsupportedFailure).toBeInstanceOf(
        TaskSystemRunAttemptTerminalStoreError,
      );
      expect(unsupportedFailure).toMatchObject({
        reason: "unsupported_integration",
      });

      const defectCause = new Error("unexpected acquire defect");
      const defectExit = await runEffect(Effect.exit(
        storeFor(Object.freeze({
          kind: "infrastructureFailure",
          phase: "acquire",
          cause: defectCause,
        })).inspectRunAttempt({ operation: "inspect_current_attempt", runId }),
      ));
      expect(Exit.isFailure(defectExit)).toBe(true);
      if (Exit.isFailure(defectExit)) {
        const defect = Cause.findDefect(defectExit.cause);
        expect(Result.isSuccess(defect)).toBe(true);
        if (Result.isSuccess(defect)) {
          expect(defect.success).toBeInstanceOf(
            LocatedReadCommittedTransactionFailureV1,
          );
        }
      }
    });
  });

  it("rejects a historical dispatch sequence beyond the aggregate cursor", async () => {
    await withStore(async ({ persistence, located }) => {
      const attemptUuids = [ACCEPTED_ATTEMPT_UUID, COLLIDING_ATTEMPT_UUID];
      let allocation = 0;
      const store = makeTaskSystemRunAttemptStoreV1(located, {
        randomUuid: () =>
          attemptUuids[allocation++] ?? COLLIDING_ATTEMPT_UUID,
      });
      const layer = RunAttemptLifecycleLive.pipe(
        Layer.provide(Layer.succeed(TaskSystemRunAttemptStore, store)),
      );
      await runEffect(Effect.gen(function* () {
        const lifecycle = yield* RunAttemptLifecycle;
        const first = yield* lifecycle.startAttempt({
          type: "start_attempt",
          runId,
          expectedRunVersion: runVersionOne,
          retryJitter,
        });
        if (first.outcome.kind !== "attempt_granted") {
          return yield* Effect.die("expected first attempt grant");
        }
        const completion = yield* lifecycle.completeAttempt({
          type: "complete_attempt",
          runId,
          attemptId: first.outcome.grant.attempt.attemptId,
          executionFence: first.outcome.grant.attempt.executionFence,
          completion: {
            kind: "failed",
            failure: {
              kind: "task_failure",
              code: "handler_failed",
              message: null,
            },
            retry: { kind: "override_delay", delayMs: zeroDuration },
            executionDurationMs: null,
          },
        });
        if (completion.outcome.kind !== "retry_scheduled") {
          return yield* Effect.die("expected retry scheduling");
        }
        const second = yield* lifecycle.startAttempt({
          type: "start_attempt",
          runId,
          expectedRunVersion: runVersionThree,
          retryJitter,
        });
        if (second.outcome.kind !== "attempt_granted") {
          return yield* Effect.die("expected second attempt grant");
        }
      }).pipe(Effect.provide(layer)));

      const [row] = await persistence.drizzle.select({
        payloadJson: fxSystemDurableTaskRequestedEffectsV1.payloadJson,
        sequence: fxSystemDurableTaskRequestedEffectsV1.sequence,
        requestedEffectSequence:
          fxSystemDurableTaskRunsV1.requestedEffectSequence,
      }).from(fxSystemDurableTaskRequestedEffectsV1).innerJoin(
        fxSystemDurableTaskRunsV1,
        and(
          eq(
            fxSystemDurableTaskRunsV1.scopeId,
            fxSystemDurableTaskRequestedEffectsV1.scopeId,
          ),
          eq(
            fxSystemDurableTaskRunsV1.runId,
            fxSystemDurableTaskRequestedEffectsV1.runId,
          ),
        ),
      ).where(and(
        taskEffectWhere(),
        eq(
          fxSystemDurableTaskRequestedEffectsV1.kind,
          "dispatch_attempt",
        ),
      )).orderBy(fxSystemDurableTaskRequestedEffectsV1.sequence).limit(1);
      if (row === undefined) throw new Error("missing historical dispatch");
      const decoded = Result.getOrThrow(
        decodePersistedTaskRequestedEffectJsonV1(row.payloadJson),
      );
      const [laterIdentity] = await persistence.drizzle.select({
        acceptedRunVersion:
          fxSystemDurableTaskAttemptIdentitiesV1.acceptedRunVersion,
      }).from(fxSystemDurableTaskAttemptIdentitiesV1).where(and(
        taskAttemptWhere(),
        eq(
          fxSystemDurableTaskAttemptIdentitiesV1.attemptNumber,
          attemptNumberTwo,
        ),
      )).limit(1);
      if (laterIdentity === undefined) {
        throw new Error("missing later attempt identity");
      }
      const laterAcceptedRunVersion = laterIdentity.acceptedRunVersion;
      const forgedAcceptedVersion = Object.freeze({
        ...decoded,
        effect: Object.freeze({
          ...decoded.effect,
          acceptedRunVersion: laterAcceptedRunVersion,
        }),
      });
      const encodedForgedVersion = Result.getOrThrow(
        encodePersistedTaskRequestedEffectJsonV1(forgedAcceptedVersion),
      );
      const forgedVersionJson = JSON.stringify(encodedForgedVersion);
      const forgedVersionByteLength = new TextEncoder().encode(
        forgedVersionJson,
      ).byteLength;
      await persistence.drizzle.update(
        fxSystemDurableTaskAttemptIdentitiesV1,
      ).set({
        acceptedRunVersion: laterAcceptedRunVersion,
      }).where(and(
        taskAttemptWhere(),
        eq(
          fxSystemDurableTaskAttemptIdentitiesV1.attemptNumber,
          attemptNumberOne,
        ),
      ));
      await persistence.drizzle.update(
        fxSystemDurableTaskRequestedEffectsV1,
      ).set({
        acceptedRunVersion: laterAcceptedRunVersion,
        payloadJson: encodedForgedVersion,
        payloadByteLength: BigInt(forgedVersionByteLength),
      }).where(taskEffectWhere(row.sequence));
      await expect(runEffectFailure(store.inspectRunAttempt({
        operation: "inspect_current_attempt",
        runId,
      }))).resolves.toMatchObject({
        _tag: "TaskSystemRunAttemptCorruptionError",
        reason: "acceptance_invalid",
      });

      const originalEncoded = Result.getOrThrow(
        encodePersistedTaskRequestedEffectJsonV1(decoded),
      );
      const originalJson = JSON.stringify(originalEncoded);
      const originalByteLength = new TextEncoder().encode(
        originalJson,
      ).byteLength;
      await persistence.drizzle.update(
        fxSystemDurableTaskAttemptIdentitiesV1,
      ).set({
        acceptedRunVersion: decoded.effect.acceptedRunVersion,
      }).where(and(
        taskAttemptWhere(),
        eq(
          fxSystemDurableTaskAttemptIdentitiesV1.attemptNumber,
          attemptNumberOne,
        ),
      ));
      await persistence.drizzle.update(
        fxSystemDurableTaskRequestedEffectsV1,
      ).set({
        acceptedRunVersion: decoded.effect.acceptedRunVersion,
        payloadJson: originalEncoded,
        payloadByteLength: BigInt(originalByteLength),
      }).where(taskEffectWhere(row.sequence));
      const forgedSequence = Result.getOrThrow(
        decodeTaskRequestedEffectSequenceV1(
          String(row.requestedEffectSequence + 1n),
        ),
      );
      const forged = Object.freeze({ ...decoded, sequence: forgedSequence });
      const encoded = Result.getOrThrow(
        encodePersistedTaskRequestedEffectJsonV1(forged),
      );
      const encodedJson = JSON.stringify(encoded);
      const byteLength = new TextEncoder().encode(encodedJson).byteLength;
      await persistence.drizzle.delete(
        fxSystemDurableTaskComputePendingV1,
      ).where(taskPendingWhere(row.sequence));
      await persistence.drizzle.update(
        fxSystemDurableTaskRequestedEffectsV1,
      ).set({
        sequence: forgedSequence,
        payloadJson: encoded,
        payloadByteLength: BigInt(byteLength),
      }).where(taskEffectWhere(row.sequence));

      await expect(runEffectFailure(store.inspectRunAttempt({
        operation: "inspect_current_attempt",
        runId,
      }))).resolves.toMatchObject({
        _tag: "TaskSystemRunAttemptCorruptionError",
        reason: "acceptance_invalid",
      });
    });
  });
});

async function withStore(
  run: (fixture: Awaited<ReturnType<typeof makeFixture>>) => Promise<void>,
): Promise<void> {
  const raw = new PGlite();
  try {
    const fixture = await makeFixture(raw);
    await run(fixture);
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
  const located = await locatedTaskAuthorityV1(
    persistence.drizzle,
    target,
  );
  const store = makeTaskSystemRunAttemptStoreV1(located, {
    randomUuid: () => ACCEPTED_ATTEMPT_UUID,
  });
  return { persistence, located, store };
}

function taskRunWhere() {
  return and(
    eq(fxSystemDurableTaskRunsV1.scopeId, taskScopeId),
    eq(fxSystemDurableTaskRunsV1.runId, runId),
  );
}

function taskAttemptWhere() {
  return and(
    eq(fxSystemDurableTaskAttemptIdentitiesV1.scopeId, taskScopeId),
    eq(fxSystemDurableTaskAttemptIdentitiesV1.runId, runId),
  );
}

function taskEffectWhere(sequence?: TaskRequestedEffectSequenceV1) {
  const identity = and(
    eq(fxSystemDurableTaskRequestedEffectsV1.scopeId, taskScopeId),
    eq(fxSystemDurableTaskRequestedEffectsV1.runId, runId),
  );
  return sequence === undefined
    ? identity
    : and(
        identity,
        eq(fxSystemDurableTaskRequestedEffectsV1.sequence, sequence),
      );
}

function taskPendingWhere(sequence: TaskRequestedEffectSequenceV1) {
  return and(
    eq(fxSystemDurableTaskComputePendingV1.scopeId, taskScopeId),
    eq(fxSystemDurableTaskComputePendingV1.runId, runId),
    eq(
      fxSystemDurableTaskComputePendingV1.requestedEffectSequence,
      sequence,
    ),
  );
}

async function counts(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
) {
  const [[attempts], [effects], [pendingComputeDeliveries]] =
    await Promise.all([
      persistence.drizzle.select({ count: count() }).from(
        fxSystemDurableTaskAttemptIdentitiesV1,
      ),
      persistence.drizzle.select({ count: count() }).from(
        fxSystemDurableTaskRequestedEffectsV1,
      ),
      persistence.drizzle.select({ count: count() }).from(
        fxSystemDurableTaskComputePendingV1,
      ),
    ]);
  return {
    attempts: attempts?.count ?? -1,
    effects: effects?.count ?? -1,
    pendingComputeDeliveries: pendingComputeDeliveries?.count ?? -1,
  };
}

async function runState(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
) {
  const [result] = await persistence.drizzle.select({
    runVersion: fxSystemDurableTaskRunsV1.runVersion,
    currentAttemptId: fxSystemDurableTaskRunsV1.currentAttemptId,
  }).from(fxSystemDurableTaskRunsV1).where(taskRunWhere());
  return result === undefined
    ? undefined
    : {
        run_version: String(result.runVersion),
        current_attempt_id: result.currentAttemptId,
      };
}
