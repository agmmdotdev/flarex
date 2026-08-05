import { setTimeout as delay } from "node:timers/promises";
import {
  RunAttemptLifecycle,
  RunAttemptLifecycleLive,
  StaleTaskRunVersionError,
  TaskSystemRunAttemptStore,
  TaskSystemRunAttemptTransientStoreError,
  decideStartAttemptV1,
  decodeTaskAttemptIdV1,
  decodeTaskDurationMsV1,
  decodeTaskHeartbeatSequenceV1,
  decodeTaskRetryJitterV1,
  decodeTaskRunIdV1,
  decodeTaskRunVersionV1,
  type TaskAttemptGrantV1,
  type TaskRunAttemptAggregateV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { Effect, Exit, Layer, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  createPostgresLocatedTaskSystemRunAttemptTargetV1,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import {
  createPostgresLocatedReadCommittedTransactionRunnerV1,
} from "../src/postgresLocatedReadCommitted";
import {
  createLocatedTaskSystemRunAttemptTargetV1,
  makeTaskSystemRunAttemptStoreV1,
} from "../src/taskSystemRunAttemptStoreV1";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import {
  ACCEPTED_ATTEMPT_UUID,
  COLLIDING_ATTEMPT_UUID,
  TASK_LOCATOR,
  TASK_RUN_ID,
  locatedTaskAuthorityV1,
  readyTaskRunAggregateV1,
  seedAdditionalTaskSystemRunV1,
  seedTaskSystemRunAttemptStoreV1,
} from "./taskSystemRunAttemptStoreTestSupport";
import { seedRegisteredTaskSystemParentV1 } from
  "./taskSystemPostgresTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const runId = Result.getOrThrow(decodeTaskRunIdV1(TASK_RUN_ID));
const runVersionOne = Result.getOrThrow(decodeTaskRunVersionV1("1"));
const retryJitter = Result.getOrThrow(decodeTaskRetryJitterV1(0.25));
const heartbeatOne = Result.getOrThrow(decodeTaskHeartbeatSequenceV1(1));
const oneMillisecond = Result.getOrThrow(decodeTaskDurationMsV1(1));
const acceptedAttemptId = Result.getOrThrow(
  decodeTaskAttemptIdV1(`attempt_${ACCEPTED_ATTEMPT_UUID}`),
);
const LIFECYCLE_UPDATE_ADVISORY_LOCK = 73_004_101;

describePostgres("DTE04-B/E scope-bound Task System lifecycle store - PostgreSQL", () => {
  it("serializes same-run writers, reads time after the lock wait, and rolls decision failure back", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const parent = await seedRegisteredTaskSystemParentV1(
        persistence,
        "dte04-b:task-store-parent",
      );
      const seeded = await seedTaskSystemRunAttemptStoreV1(persistence, {
        parent,
      });
      const scopeId = seeded.scopeId;
      const target = createPostgresLocatedTaskSystemRunAttemptTargetV1(
        persistence,
        TASK_LOCATOR,
      );
      const located = await locatedTaskAuthorityV1(
        persistence.drizzle,
        target,
        scopeId,
        seeded.deploymentId,
      );
      let allocation = 5;
      const store = makeTaskSystemRunAttemptStoreV1(located, {
        randomUuid: () =>
          `72000000-0000-4000-8000-${String(allocation++).padStart(12, "0")}`,
      });
      const layer = RunAttemptLifecycleLive.pipe(
        Layer.provide(Layer.succeed(TaskSystemRunAttemptStore, store)),
      );
      const start = () => runEffect(Effect.gen(function* () {
        const lifecycle = yield* RunAttemptLifecycle;
        return yield* lifecycle.startAttempt({
          type: "start_attempt",
          runId,
          expectedRunVersion: runVersionOne,
          retryJitter,
        });
      }).pipe(Effect.provide(layer)));
      const blocker = await persistence.pool.connect();
      let releasedAfterMs: number;
      let simultaneous: Awaited<ReturnType<typeof start>>[];
      try {
        await blocker.query("begin");
        await blocker.query(`
          select run_id
          from fx_system_durable_task_run_v1
          where scope_id = $1 and run_id = $2
          for update
        `, [scopeId, TASK_RUN_ID]);
        const pidResult = await blocker.query<{ pid: number }>(
          "select pg_backend_pid()::int as pid",
        );
        const blockerPid = pidResult.rows[0]?.pid;
        if (blockerPid === undefined) throw new Error("missing blocker pid");
        const pending = [start(), start()];
        await waitForBlockedTaskRunWriters(persistence, blockerPid, 2);
        const clockResult = await blocker.query<{ milliseconds: string }>(`
          select floor(
            extract(epoch from clock_timestamp()) * 1000
          )::bigint::text as milliseconds
        `);
        const milliseconds = clockResult.rows[0]?.milliseconds;
        if (milliseconds === undefined) throw new Error("missing server clock");
        releasedAfterMs = Number(milliseconds);
        await blocker.query("commit");
        simultaneous = await Promise.all(pending);
      } finally {
        await blocker.query("rollback").catch(() => undefined);
        blocker.release();
      }
      expect(simultaneous.map(receipt => receipt.disposition).sort())
        .toEqual(["accepted", "idempotent"]);
      const accepted = simultaneous.find(
        receipt => receipt.disposition === "accepted",
      );
      if (accepted?.outcome.kind !== "attempt_granted") {
        throw new Error("expected one accepted attempt grant");
      }
      expect(Number(accepted.observedAtMs)).toBeGreaterThanOrEqual(
        releasedAfterMs,
      );
      const grant = accepted.outcome.grant;
      expect(await counts(persistence)).toEqual({ attempts: 1, effects: 4 });

      const heartbeat = await runEffect(Effect.gen(function* () {
        const lifecycle = yield* RunAttemptLifecycle;
        return yield* lifecycle.heartbeatAttempt({
          type: "heartbeat_attempt",
          runId,
          attemptId: grant.attempt.attemptId,
          executionFence: grant.attempt.executionFence,
          heartbeatSequence: heartbeatOne,
        });
      }).pipe(Effect.provide(layer)));
      expect(heartbeat).toMatchObject({
        disposition: "accepted",
        runVersion: 3n,
        outcome: { kind: "lease_renewed", enteredExecuting: true },
      });

      const before = await runVersion(persistence, scopeId);
      const expected = new StaleTaskRunVersionError({
        operation: "heartbeat_attempt",
        runId,
        reason: "commit_basis_disagrees_with_decoded_state",
      });
      const failure = await runEffectFailure(store.transactRunAttempt({
        operation: "heartbeat_attempt",
        runId,
        decide: () => Result.fail(expected),
      }));
      expect(failure).toBe(expected);
      expect(await runVersion(persistence, scopeId)).toBe(before);
      expect(await counts(persistence)).toEqual({ attempts: 1, effects: 8 });
    });
  }, 480_000);

  it("orders terminal completion before a blocked heartbeat and returns the current terminal state", async () => {
    await withLifecycleFixture({}, async fixture => {
      const grant = await startGrantedAttempt(fixture.layer);
      const [completion, heartbeat] = await runWithForcedFirstLifecycleWriter(
        fixture.persistence,
        "terminal",
        () => completeSucceeded(fixture.layer, grant),
        () => heartbeatAttempt(fixture.layer, grant),
      );

      expect(completion).toMatchObject({
        disposition: "accepted",
        runVersion: 3n,
        outcome: { kind: "terminal_succeeded" },
      });
      expect(heartbeat).toMatchObject({
        disposition: "current",
        runVersion: 3n,
        outcome: {
          kind: "current",
          reason: "phase_not_active",
          state: { phase: "terminal" },
        },
      });
      expect(await effectSequences(fixture.persistence, fixture.scopeId))
        .toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(await counts(fixture.persistence)).toEqual({ attempts: 1, effects: 8 });
    });
  }, 480_000);

  it("orders an admitted lease expiry before a blocked completion at the database deadline", async () => {
    await withLifecycleFixture({ aggregate: shortLeaseReadyAggregate() }, async fixture => {
      const grant = await startGrantedAttempt(fixture.layer);
      await waitForDatabaseTimeAtLeast(
        fixture.persistence,
        Number(grant.lease.expiresAtMs),
      );
      const [expiry, completion] = await runWithForcedFirstLifecycleWriter(
        fixture.persistence,
        "retry_waiting",
        () => expireLease(fixture.layer, grant),
        () => completeSucceeded(fixture.layer, grant),
      );

      expect(expiry).toMatchObject({
        disposition: "accepted",
        runVersion: 3n,
        outcome: { kind: "retry_scheduled", delivery: "durable" },
      });
      expect(completion).toMatchObject({
        disposition: "current",
        runVersion: 3n,
        outcome: {
          kind: "current",
          reason: "phase_not_active",
          state: { phase: "retry_waiting" },
        },
      });
      expect(await effectSequences(fixture.persistence, fixture.scopeId))
        .toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(await counts(fixture.persistence)).toEqual({ attempts: 1, effects: 8 });
    });
  }, 480_000);

  it("preserves both cancellation/completion serializations under simultaneous pressure", async () => {
    await withLifecycleFixture({}, async fixture => {
      const grant = await startGrantedAttempt(fixture.layer);
      const [completion, cancellation] = await runWithForcedFirstLifecycleWriter(
        fixture.persistence,
        "terminal",
        () => completeSucceeded(fixture.layer, grant),
        () => requestCancellation(fixture.layer),
      );

      expect(completion).toMatchObject({
        disposition: "accepted",
        outcome: { kind: "terminal_succeeded" },
      });
      expect(cancellation).toMatchObject({
        disposition: "current",
        runVersion: 3n,
        outcome: { kind: "current", reason: "already_terminal" },
      });
      expect(await effectSequences(fixture.persistence, fixture.scopeId))
        .toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    await withLifecycleFixture({}, async fixture => {
      const grant = await startGrantedAttempt(fixture.layer);
      const [cancellation, completion] = await runWithForcedFirstLifecycleWriter(
        fixture.persistence,
        "cancellation_requested",
        () => requestCancellation(fixture.layer),
        () => completeSucceeded(fixture.layer, grant),
      );

      expect(cancellation).toMatchObject({
        disposition: "accepted",
        runVersion: 3n,
        outcome: { kind: "cancellation_requested" },
      });
      expect(completion).toMatchObject({
        disposition: "accepted",
        runVersion: 4n,
        outcome: {
          kind: "terminal_succeeded",
          cancellation: { kind: "resolved", resolution: "superseded_by_completion" },
        },
      });
      expect(await effectSequences(fixture.persistence, fixture.scopeId))
        .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      expect(await counts(fixture.persistence)).toEqual({ attempts: 1, effects: 11 });
    });
  }, 480_000);

  it("rolls back aggregate and partial effects together, then fills the next sequence without a gap", async () => {
    await withLifecycleFixture({}, async fixture => {
      const grant = await startGrantedAttempt(fixture.layer);
      await installRequestedEffectRejection(fixture.persistence, 6);

      const rejected = await runEffect(Effect.exit(
        completeSucceededEffect(grant).pipe(Effect.provide(fixture.layer)),
      ));
      expect(Exit.isFailure(rejected)).toBe(true);
      expect(await runVersion(fixture.persistence, fixture.scopeId)).toBe("2");
      expect(await effectSequences(fixture.persistence, fixture.scopeId))
        .toEqual([1, 2, 3, 4]);

      await removeRequestedEffectRejection(fixture.persistence);
      const accepted = await completeSucceeded(fixture.layer, grant);
      expect(accepted).toMatchObject({
        disposition: "accepted",
        runVersion: 3n,
        outcome: { kind: "terminal_succeeded" },
      });
      expect(await effectSequences(fixture.persistence, fixture.scopeId))
        .toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });
  }, 480_000);

  it("reinvokes the pure start decision after a whole-transaction identity collision without publishing the unused candidate", async () => {
    await withLifecycleFixture({}, async fixture => {
      const collisionOwnerRunId =
        "run_72000000-0000-4000-8000-000000000098";
      await seedAdditionalTaskSystemRunV1(
        fixture.persistence,
        collisionOwnerRunId,
        fixture.scopeId,
      );
      await fixture.persistence.query(`
        insert into fx_system_durable_task_attempt_identity_v1 (
          scope_id, attempt_id, run_id, attempt_number, execution_fence,
          accepted_run_version
        ) values ($1, $2, $3, 1, 1, 1)
      `, [
        fixture.scopeId,
        `attempt_${COLLIDING_ATTEMPT_UUID}`,
        collisionOwnerRunId,
      ]);
      const candidates = [COLLIDING_ATTEMPT_UUID, ACCEPTED_ATTEMPT_UUID];
      let allocations = 0;
      let decisions = 0;
      const store = makeTaskSystemRunAttemptStoreV1(fixture.located, {
        randomUuid: () => candidates[allocations++] ?? ACCEPTED_ATTEMPT_UUID,
      });
      const command = {
        type: "start_attempt" as const,
        runId,
        expectedRunVersion: runVersionOne,
        retryJitter,
      };
      const receipt = await runEffect(store.transactRunAttempt({
        operation: "start_attempt",
        runId,
        decide: input => {
          decisions += 1;
          return decideStartAttemptV1(command, input);
        },
      }));

      expect(allocations).toBe(2);
      expect(decisions).toBe(2);
      expect(receipt).toMatchObject({
        disposition: "accepted",
        outcome: {
          kind: "attempt_granted",
          grant: { attempt: { attemptId: acceptedAttemptId } },
        },
      });
      expect(await taskRunAttemptCount(fixture.persistence, fixture.scopeId)).toBe(1);
      expect(await effectSequences(fixture.persistence, fixture.scopeId))
        .toEqual([1, 2, 3, 4]);
      expect(await counts(fixture.persistence)).toEqual({ attempts: 2, effects: 4 });
    });
  }, 480_000);

  it("recovers a committed completion whose successful response was hidden without rewriting lifecycle state", async () => {
    await withLifecycleFixture({}, async fixture => {
      const grant = await startGrantedAttempt(fixture.layer);
      let releaseCalls = 0;
      const hiddenRelease = new Error("hide the committed completion response");
      const runner = createPostgresLocatedReadCommittedTransactionRunnerV1(
        fixture.persistence.pool,
        {
          release: (client, discard) => {
            releaseCalls += 1;
            if (releaseCalls === 1 && discard === undefined) {
              throw hiddenRelease;
            }
            client.release(discard);
          },
        },
      );
      const hiddenTarget = createLocatedTaskSystemRunAttemptTargetV1(
        fixture.persistence.drizzle,
        TASK_LOCATOR,
        runner,
      );
      const hiddenLocated = await locatedTaskAuthorityV1(
        fixture.persistence.drizzle,
        hiddenTarget,
        fixture.scopeId,
        fixture.deploymentId,
      );
      const hiddenStore = makeTaskSystemRunAttemptStoreV1(hiddenLocated);
      const hiddenLayer = createLifecycleLayer(hiddenStore);

      const failure = await runEffectFailure(
        completeSucceededEffect(grant).pipe(Effect.provide(hiddenLayer)),
      );
      expect(failure).toBeInstanceOf(TaskSystemRunAttemptTransientStoreError);
      expect(failure).toMatchObject({ reason: "driver_failure" });
      expect(releaseCalls).toBe(1);

      const beforeReplay = await lifecycleStorageSnapshot(
        fixture.persistence,
        fixture.scopeId,
      );
      const inspected = await runEffect(fixture.store.inspectRunAttempt({
        operation: "inspect_current_attempt",
        runId,
      }));
      const accepted = inspected.current.completionReplays[0]?.accepted;
      if (accepted === undefined) {
        throw new Error("committed completion replay was not persisted");
      }
      const replay = await completeSucceeded(fixture.layer, grant);
      expect(replay).toEqual({
        disposition: "idempotent",
        observedAtMs: accepted.observedAtMs,
        runVersion: accepted.acceptedRunVersion,
        outcome: accepted.outcome,
        evidence: accepted.evidence,
        requestedEffects: accepted.requestedEffects,
      });
      expect(await lifecycleStorageSnapshot(
        fixture.persistence,
        fixture.scopeId,
      )).toEqual(beforeReplay);
      expect(await effectSequences(fixture.persistence, fixture.scopeId))
        .toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(await counts(fixture.persistence)).toEqual({ attempts: 1, effects: 8 });
    });
  }, 480_000);
});

function createLifecycleLayer(
  store: ReturnType<typeof makeTaskSystemRunAttemptStoreV1>,
) {
  return RunAttemptLifecycleLive.pipe(
    Layer.provide(Layer.succeed(TaskSystemRunAttemptStore, store)),
  );
}

type LifecycleLayer = ReturnType<typeof createLifecycleLayer>;

interface LifecycleFixture {
  readonly persistence: PostgresFlarexPersistence;
  readonly scopeId: string;
  readonly deploymentId: string;
  readonly located: Awaited<ReturnType<typeof locatedTaskAuthorityV1>>;
  readonly store: ReturnType<typeof makeTaskSystemRunAttemptStoreV1>;
  readonly layer: LifecycleLayer;
}

async function withLifecycleFixture(
  options: Readonly<{ readonly aggregate?: TaskRunAttemptAggregateV1 }>,
  run: (fixture: LifecycleFixture) => Promise<void>,
): Promise<void> {
  await withTemporaryPostgresPersistence(async persistence => {
    const parent = await seedRegisteredTaskSystemParentV1(
      persistence,
      "dte04-e:task-lifecycle-parent",
    );
    const seeded = await seedTaskSystemRunAttemptStoreV1(persistence, {
      parent,
      ...(options.aggregate === undefined
        ? {}
        : { aggregate: options.aggregate }),
    });
    const target = createPostgresLocatedTaskSystemRunAttemptTargetV1(
      persistence,
      TASK_LOCATOR,
    );
    const located = await locatedTaskAuthorityV1(
      persistence.drizzle,
      target,
      seeded.scopeId,
      seeded.deploymentId,
    );
    const store = makeTaskSystemRunAttemptStoreV1(located, {
      randomUuid: () => ACCEPTED_ATTEMPT_UUID,
    });
    await run(Object.freeze({
      persistence,
      scopeId: seeded.scopeId,
      deploymentId: seeded.deploymentId,
      located,
      store,
      layer: createLifecycleLayer(store),
    }));
  });
}

function shortLeaseReadyAggregate(): TaskRunAttemptAggregateV1 {
  const ready = readyTaskRunAggregateV1();
  return {
    ...ready,
    boundPolicy: {
      ...ready.boundPolicy,
      leaseDurationMs: oneMillisecond,
    },
  };
}

async function startGrantedAttempt(
  layer: LifecycleLayer,
): Promise<TaskAttemptGrantV1> {
  const receipt = await runEffect(Effect.gen(function* () {
    const lifecycle = yield* RunAttemptLifecycle;
    return yield* lifecycle.startAttempt({
      type: "start_attempt",
      runId,
      expectedRunVersion: runVersionOne,
      retryJitter,
    });
  }).pipe(Effect.provide(layer)));
  if (receipt.outcome.kind !== "attempt_granted") {
    throw new Error("expected an accepted attempt grant");
  }
  return receipt.outcome.grant;
}

function heartbeatAttempt(
  layer: LifecycleLayer,
  grant: TaskAttemptGrantV1,
) {
  return runEffect(Effect.gen(function* () {
    const lifecycle = yield* RunAttemptLifecycle;
    return yield* lifecycle.heartbeatAttempt({
      type: "heartbeat_attempt",
      runId,
      attemptId: grant.attempt.attemptId,
      executionFence: grant.attempt.executionFence,
      heartbeatSequence: heartbeatOne,
    });
  }).pipe(Effect.provide(layer)));
}

const completeSucceededEffect = Effect.fn(function* (
  grant: TaskAttemptGrantV1,
) {
  const lifecycle = yield* RunAttemptLifecycle;
  return yield* lifecycle.completeAttempt({
    type: "complete_attempt",
    runId,
    attemptId: grant.attempt.attemptId,
    executionFence: grant.attempt.executionFence,
    completion: {
      kind: "succeeded",
      result: null,
      executionDurationMs: null,
    },
  });
});

function completeSucceeded(
  layer: LifecycleLayer,
  grant: TaskAttemptGrantV1,
) {
  return runEffect(
    completeSucceededEffect(grant).pipe(Effect.provide(layer)),
  );
}

function requestCancellation(layer: LifecycleLayer) {
  return runEffect(Effect.gen(function* () {
    const lifecycle = yield* RunAttemptLifecycle;
    return yield* lifecycle.requestCancellation({
      type: "request_cancellation",
      runId,
      reason: { code: "requested", message: null },
    });
  }).pipe(Effect.provide(layer)));
}

function expireLease(
  layer: LifecycleLayer,
  grant: TaskAttemptGrantV1,
) {
  return runEffect(Effect.gen(function* () {
    const lifecycle = yield* RunAttemptLifecycle;
    return yield* lifecycle.handleLeaseExpiry({
      type: "handle_lease_expiry",
      runId,
      attemptId: grant.attempt.attemptId,
      executionFence: grant.attempt.executionFence,
      expectedLeaseVersion: grant.lease.version,
    });
  }).pipe(Effect.provide(layer)));
}

type LifecycleBarrierKind =
  | "terminal"
  | "retry_waiting"
  | "cancellation_requested";

async function runWithForcedFirstLifecycleWriter<First, Second>(
  persistence: PostgresFlarexPersistence,
  barrier: LifecycleBarrierKind,
  first: () => Promise<First>,
  second: () => Promise<Second>,
): Promise<readonly [First, Second]> {
  await installLifecycleUpdateBarrier(persistence, barrier);
  const blocker = await persistence.pool.connect();
  const pendingSettlements: Promise<unknown>[] = [];
  try {
    await blocker.query(
      "select pg_advisory_lock($1::bigint)",
      [LIFECYCLE_UPDATE_ADVISORY_LOCK],
    );
    const pidResult = await blocker.query<{ pid: number }>(
      "select pg_backend_pid()::int as pid",
    );
    const blockerPid = pidResult.rows[0]?.pid;
    if (blockerPid === undefined) throw new Error("missing blocker pid");

    const firstPending = settle(first());
    pendingSettlements.push(firstPending);
    await waitForBlockedLifecycleTransactions(persistence, blockerPid, 1);
    const secondPending = settle(second());
    pendingSettlements.push(secondPending);
    await waitForBlockedLifecycleTransactions(persistence, blockerPid, 2);
    await blocker.query(
      "select pg_advisory_unlock($1::bigint)",
      [LIFECYCLE_UPDATE_ADVISORY_LOCK],
    );
    const [firstResult, secondResult] = await Promise.all([
      firstPending,
      secondPending,
    ]);
    const firstValue = Result.getOrThrow(firstResult);
    const secondValue = Result.getOrThrow(secondResult);
    return Object.freeze([firstValue, secondValue] as const);
  } finally {
    const unlockFailure = await blocker.query(
      "select pg_advisory_unlock($1::bigint)",
      [LIFECYCLE_UPDATE_ADVISORY_LOCK],
    ).then(
      () => undefined,
      cause => cause,
    );
    blocker.release(unlockFailure === undefined
      ? undefined
      : unlockFailure instanceof Error
      ? unlockFailure
      : new Error("failed to release lifecycle advisory lock"));
    await Promise.all(pendingSettlements);
  }
}

function settle<Value>(
  promise: Promise<Value>,
): Promise<Result.Result<Value, unknown>> {
  return promise.then(
    value => Result.succeed(value),
    cause => Result.fail(cause),
  );
}

async function installLifecycleUpdateBarrier(
  persistence: PostgresFlarexPersistence,
  barrier: LifecycleBarrierKind,
): Promise<void> {
  const predicate = barrier === "terminal"
    ? "new.phase = 'terminal'"
    : barrier === "retry_waiting"
    ? "new.phase = 'retry_waiting'"
    : "new.cancellation_generation = old.cancellation_generation + 1";
  await persistence.query(`
    create function fx_test_task_lifecycle_update_barrier_v1()
    returns trigger
    language plpgsql
    as $function$
    begin
      if ${predicate} then
        perform pg_advisory_xact_lock(${LIFECYCLE_UPDATE_ADVISORY_LOCK});
      end if;
      return new;
    end
    $function$
  `);
  await persistence.query(`
    create trigger fx_test_task_lifecycle_update_barrier_v1
    before update on fx_system_durable_task_run_v1
    for each row execute function fx_test_task_lifecycle_update_barrier_v1()
  `);
}

async function waitForBlockedLifecycleTransactions(
  persistence: PostgresFlarexPersistence,
  blockerPid: number,
  expectedCount: number,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ blocked_count: number }>(`
      with recursive blocked(pid) as (
        select activity.pid
        from pg_stat_activity as activity
        where $1::int = any(pg_blocking_pids(activity.pid))

        union

        select activity.pid
        from pg_stat_activity as activity
        join blocked as blocker
          on blocker.pid = any(pg_blocking_pids(activity.pid))
      )
      select count(*)::int as blocked_count
      from blocked
      join pg_stat_activity as activity using (pid)
      where activity.datname = current_database()
        and activity.wait_event_type = 'Lock'
    `, [blockerPid]);
    if ((result.rows[0]?.blocked_count ?? 0) >= expectedCount) return;
    await delay(25);
  }
  throw new Error(
    `timed out waiting for ${expectedCount} blocked lifecycle transactions`,
  );
}

async function waitForDatabaseTimeAtLeast(
  persistence: PostgresFlarexPersistence,
  targetMs: number,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ milliseconds: string }>(`
      select floor(
        extract(epoch from clock_timestamp()) * 1000
      )::bigint::text as milliseconds
    `);
    if (Number(result.rows[0]?.milliseconds ?? "0") >= targetMs) return;
    await delay(1);
  }
  throw new Error(`timed out waiting for database time ${targetMs}`);
}

async function installRequestedEffectRejection(
  persistence: PostgresFlarexPersistence,
  rejectedSequence: number,
): Promise<void> {
  await persistence.query(`
    create function fx_test_task_effect_rejection_v1()
    returns trigger
    language plpgsql
    as $function$
    begin
      if new.sequence = ${rejectedSequence} then
        raise exception 'test requested-effect rejection'
          using errcode = '23514';
      end if;
      return new;
    end
    $function$
  `);
  await persistence.query(`
    create trigger fx_test_task_effect_rejection_v1
    before insert on fx_system_durable_task_requested_effect_v1
    for each row execute function fx_test_task_effect_rejection_v1()
  `);
}

async function removeRequestedEffectRejection(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  await persistence.query(`
    drop trigger fx_test_task_effect_rejection_v1
    on fx_system_durable_task_requested_effect_v1
  `);
  await persistence.query("drop function fx_test_task_effect_rejection_v1()");
}

async function effectSequences(
  persistence: PostgresFlarexPersistence,
  scopeId: string,
): Promise<readonly number[]> {
  const result = await persistence.query<{ sequence: number }>(`
    select sequence::int
    from fx_system_durable_task_requested_effect_v1
    where scope_id = $1 and run_id = $2
    order by sequence
  `, [scopeId, TASK_RUN_ID]);
  return Object.freeze(result.rows.map(row => row.sequence));
}

async function taskRunAttemptCount(
  persistence: PostgresFlarexPersistence,
  scopeId: string,
): Promise<number> {
  const result = await persistence.query<{ count: number }>(`
    select count(*)::int as count
    from fx_system_durable_task_attempt_identity_v1
    where scope_id = $1 and run_id = $2
  `, [scopeId, TASK_RUN_ID]);
  return result.rows[0]?.count ?? -1;
}

async function lifecycleStorageSnapshot(
  persistence: PostgresFlarexPersistence,
  scopeId: string,
) {
  const result = await persistence.query<{
    run_json: string;
    run_xmin: string;
    effects_json: string;
    effect_xmins: string;
  }>(`
    select
      to_jsonb(run_row)::text as run_json,
      run_row.xmin::text as run_xmin,
      coalesce((
        select jsonb_agg(to_jsonb(effect_row) order by effect_row.sequence)::text
        from fx_system_durable_task_requested_effect_v1 as effect_row
        where effect_row.scope_id = run_row.scope_id
          and effect_row.run_id = run_row.run_id
      ), '[]') as effects_json,
      coalesce((
        select jsonb_agg(effect_row.xmin::text order by effect_row.sequence)::text
        from fx_system_durable_task_requested_effect_v1 as effect_row
        where effect_row.scope_id = run_row.scope_id
          and effect_row.run_id = run_row.run_id
      ), '[]') as effect_xmins
    from fx_system_durable_task_run_v1 as run_row
    where run_row.scope_id = $1 and run_row.run_id = $2
  `, [scopeId, TASK_RUN_ID]);
  const snapshot = result.rows[0];
  if (snapshot === undefined) throw new Error("missing lifecycle snapshot");
  return Object.freeze({ ...snapshot });
}

async function counts(
  persistence: Parameters<Parameters<typeof withTemporaryPostgresPersistence>[0]>[0],
) {
  const result = await persistence.query<{
    attempts: number;
    effects: number;
  }>(`
    select
      (select count(*)::int
       from fx_system_durable_task_attempt_identity_v1) as attempts,
      (select count(*)::int
       from fx_system_durable_task_requested_effect_v1) as effects
  `);
  return result.rows[0];
}

async function waitForBlockedTaskRunWriters(
  persistence: Parameters<Parameters<typeof withTemporaryPostgresPersistence>[0]>[0],
  blockerPid: number,
  expectedCount: number,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ blocked_count: number }>(`
      with recursive blocked(pid) as (
        select activity.pid
        from pg_stat_activity as activity
        where $1::int = any(pg_blocking_pids(activity.pid))

        union

        select activity.pid
        from pg_stat_activity as activity
        join blocked as blocker
          on blocker.pid = any(pg_blocking_pids(activity.pid))
      )
      select count(*)::int as blocked_count
      from blocked
      join pg_stat_activity as activity using (pid)
      where activity.datname = current_database()
        and activity.wait_event_type = 'Lock'
        and activity.query ilike '%fx_system_durable_task_run_v1%'
        and activity.query ilike '%for update%'
    `, [blockerPid]);
    if ((result.rows[0]?.blocked_count ?? 0) >= expectedCount) return;
    await delay(25);
  }
  throw new Error(
    `timed out waiting for ${expectedCount} blocked task-run writers`,
  );
}

async function runVersion(
  persistence: Parameters<Parameters<typeof withTemporaryPostgresPersistence>[0]>[0],
  scopeId: string,
): Promise<string> {
  const result = await persistence.query<{ run_version: string }>(`
    select run_version::text
    from fx_system_durable_task_run_v1
    where scope_id = $1 and run_id = $2
  `, [scopeId, TASK_RUN_ID]);
  return result.rows[0]?.run_version ?? "missing";
}
