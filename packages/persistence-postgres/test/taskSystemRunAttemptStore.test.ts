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
  decodeTaskAttemptIdV1,
  decodeTaskCancellationGenerationV1,
  decodeTaskDurationMsV1,
  decodeTaskHeartbeatSequenceV1,
  decodeTaskRequestedEffectSequenceV1,
  decodeTaskRetryJitterV1,
  decodeTaskRunIdV1,
  decodeTaskRunVersionV1,
  encodePersistedTaskRequestedEffectJsonV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { Cause, Effect, Exit, Layer, Result } from "effect";
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
const runVersionOne = Result.getOrThrow(decodeTaskRunVersionV1("1"));
const runVersionThree = Result.getOrThrow(decodeTaskRunVersionV1("3"));
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
      expect(await counts(persistence)).toEqual({ attempts: 1, effects: 15 });
    });
  });

  it("retries only an exact attempt identity primary-key collision and rolls the failed execution back", async () => {
    await withStore(async ({ persistence, located }) => {
      const collisionOwnerRunId =
        "run_72000000-0000-4000-8000-000000000098";
      await seedAdditionalTaskSystemRunV1(persistence, collisionOwnerRunId);
      await persistence.query(`
        insert into fx_system_durable_task_attempt_identity_v1 (
          scope_id, attempt_id, run_id, attempt_number, execution_fence,
          accepted_run_version
        ) values (
          '${TASK_SCOPE_ID}', 'attempt_${COLLIDING_ATTEMPT_UUID}',
          '${collisionOwnerRunId}', 1, 1, 1
        )
      `);
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
      expect(await counts(persistence)).toEqual({ attempts: 2, effects: 4 });
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
      expect(await counts(persistence)).toEqual({ attempts: 0, effects: 0 });
      expect(await runState(persistence)).toMatchObject({ run_version: "1" });

      const missingRun = Result.getOrThrow(
        decodeTaskRunIdV1("run_72000000-0000-4000-8000-000000000099"),
      );
      await expect(runEffectFailure(store.inspectRunAttempt({
        operation: "inspect_current_attempt",
        runId: missingRun,
      }))).resolves.toBeInstanceOf(TaskSystemRunAttemptUnavailableError);

      await persistence.query(`
        update fx_system_durable_task_run_v1
        set aggregate_byte_length = aggregate_byte_length + 1
        where scope_id = '${TASK_SCOPE_ID}' and run_id = '${TASK_RUN_ID}'
      `);
      await expect(runEffectFailure(store.inspectRunAttempt({
        operation: "inspect_current_attempt",
        runId,
      }))).resolves.toBeInstanceOf(TaskSystemRunAttemptCorruptionError);
    });

    await withStore(async ({ persistence, store }) => {
      await persistence.query(`
        update fx_system_scope_clock
        set epoch = 'epoch_72000000-0000-4000-8000-000000000099'
        where scope_id = '${TASK_SCOPE_ID}'
      `);
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

      await persistence.query(`
        update fx_system_durable_task_requested_effect_v1
        set payload_byte_length = payload_byte_length + 1
        where scope_id = '${TASK_SCOPE_ID}' and run_id = '${TASK_RUN_ID}'
          and sequence = 5
      `);
      await expect(runEffectFailure(store.inspectRunAttempt({
        operation: "inspect_current_attempt",
        runId,
      }))).resolves.toMatchObject({
        _tag: "TaskSystemRunAttemptCorruptionError",
        reason: "effect_sequence_invalid",
      });

      await persistence.query(`
        update fx_system_durable_task_requested_effect_v1
        set payload_byte_length = payload_byte_length - 1
        where scope_id = '${TASK_SCOPE_ID}' and run_id = '${TASK_RUN_ID}'
          and sequence = 5
      `);
      await persistence.query(`
        update fx_system_durable_task_attempt_identity_v1
        set accepted_run_version = 1
        where scope_id = '${TASK_SCOPE_ID}' and run_id = '${TASK_RUN_ID}'
      `);
      await expect(runEffectFailure(store.inspectRunAttempt({
        operation: "inspect_current_attempt",
        runId,
      }))).resolves.toMatchObject({
        _tag: "TaskSystemRunAttemptCorruptionError",
        reason: "acceptance_invalid",
      });

      await persistence.query(`
        update fx_system_durable_task_attempt_identity_v1
        set accepted_run_version = 2
        where scope_id = '${TASK_SCOPE_ID}' and run_id = '${TASK_RUN_ID}'
      `);
      await persistence.query(`
        insert into fx_system_durable_task_attempt_identity_v1 (
          scope_id, attempt_id, run_id, attempt_number, execution_fence,
          accepted_run_version
        ) values (
          '${TASK_SCOPE_ID}',
          'attempt_72000000-0000-4000-8000-000000000099',
          '${TASK_RUN_ID}', 2, 2, 2
        )
      `);
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

      const dispatch = await persistence.query<{
        payload_json: unknown;
        sequence: string;
        requested_effect_sequence: string;
      }>(`
        select effect.payload_json, effect.sequence::text as sequence,
          run.requested_effect_sequence::text as requested_effect_sequence
        from fx_system_durable_task_requested_effect_v1 as effect
        join fx_system_durable_task_run_v1 as run
          on run.scope_id = effect.scope_id and run.run_id = effect.run_id
        where effect.scope_id = '${TASK_SCOPE_ID}'
          and effect.run_id = '${TASK_RUN_ID}'
          and effect.kind = 'dispatch_attempt'
        order by effect.sequence
        limit 1
      `);
      const row = dispatch.rows[0];
      if (row === undefined) throw new Error("missing historical dispatch");
      const decoded = Result.getOrThrow(
        decodePersistedTaskRequestedEffectJsonV1(row.payload_json),
      );
      const laterIdentity = await persistence.query<{
        accepted_run_version: string;
      }>(`
        select accepted_run_version::text as accepted_run_version
        from fx_system_durable_task_attempt_identity_v1
        where scope_id = '${TASK_SCOPE_ID}' and run_id = '${TASK_RUN_ID}'
          and attempt_number = 2
      `);
      const laterAcceptedRunVersion = Result.getOrThrow(
        decodeTaskRunVersionV1(
          laterIdentity.rows[0]?.accepted_run_version ?? "missing",
        ),
      );
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
      await persistence.query(`
        update fx_system_durable_task_attempt_identity_v1
        set accepted_run_version = ${laterAcceptedRunVersion}
        where scope_id = '${TASK_SCOPE_ID}' and run_id = '${TASK_RUN_ID}'
          and attempt_number = 1
      `);
      await persistence.query(`
        update fx_system_durable_task_requested_effect_v1
        set accepted_run_version = ${laterAcceptedRunVersion},
          payload_json = $1::jsonb,
          payload_byte_length = ${forgedVersionByteLength}
        where scope_id = '${TASK_SCOPE_ID}' and run_id = '${TASK_RUN_ID}'
          and sequence = ${row.sequence}
      `, [forgedVersionJson]);
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
      await persistence.query(`
        update fx_system_durable_task_attempt_identity_v1
        set accepted_run_version = ${decoded.effect.acceptedRunVersion}
        where scope_id = '${TASK_SCOPE_ID}' and run_id = '${TASK_RUN_ID}'
          and attempt_number = 1
      `);
      await persistence.query(`
        update fx_system_durable_task_requested_effect_v1
        set accepted_run_version = ${decoded.effect.acceptedRunVersion},
          payload_json = $1::jsonb,
          payload_byte_length = ${originalByteLength}
        where scope_id = '${TASK_SCOPE_ID}' and run_id = '${TASK_RUN_ID}'
          and sequence = ${row.sequence}
      `, [originalJson]);
      const forgedSequence = Result.getOrThrow(
        decodeTaskRequestedEffectSequenceV1(
          String(BigInt(row.requested_effect_sequence) + 1n),
        ),
      );
      const forged = Object.freeze({ ...decoded, sequence: forgedSequence });
      const encoded = Result.getOrThrow(
        encodePersistedTaskRequestedEffectJsonV1(forged),
      );
      const encodedJson = JSON.stringify(encoded);
      const byteLength = new TextEncoder().encode(encodedJson).byteLength;
      await persistence.query(`
        update fx_system_durable_task_requested_effect_v1
        set sequence = ${forgedSequence}, payload_json = $1::jsonb,
          payload_byte_length = ${byteLength}
        where scope_id = '${TASK_SCOPE_ID}' and run_id = '${TASK_RUN_ID}'
          and sequence = ${row.sequence}
      `, [encodedJson]);

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

async function counts(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
) {
  const result = await persistence.query<{
    attempts: string;
    effects: string;
  }>(`
    select
      (select count(*)::text
       from fx_system_durable_task_attempt_identity_v1) as attempts,
      (select count(*)::text
       from fx_system_durable_task_requested_effect_v1) as effects
  `);
  return {
    attempts: Number(result.rows[0]?.attempts ?? "-1"),
    effects: Number(result.rows[0]?.effects ?? "-1"),
  };
}

async function runState(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
) {
  const result = await persistence.query<{
    run_version: string;
    current_attempt_id: string | null;
  }>(`
    select run_version::text, current_attempt_id
    from fx_system_durable_task_run_v1
    where scope_id = '${TASK_SCOPE_ID}' and run_id = '${TASK_RUN_ID}'
  `);
  return result.rows[0];
}
