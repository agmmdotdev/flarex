import { setTimeout as delay } from "node:timers/promises";
import {
  RunAttemptLifecycle,
  RunAttemptLifecycleLive,
  TaskSystemRunAttemptStore,
  decodeTaskHeartbeatSequenceV1,
  decodeTaskRetryJitterV1,
  decodeTaskRunIdV1,
  decodeTaskRunVersionV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { Effect, Layer, Result } from "effect";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import {
  createPostgresLocatedTaskSystemRunAttemptTargetV1,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import { makeTaskSystemRunAttemptStoreV1 } from
  "../src/taskSystemRunAttemptStoreV1";
import {
  TaskSystemRunReadUnavailableError,
  makeTaskSystemDueDiscoveryV1,
  makeTaskSystemRequestedEffectLedgerV1,
  type TaskSystemRunReadQueryObserverV1,
} from "../src/taskSystemRunReadV1";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
  type RunLocatedReadCommittedTransactionV1,
} from "../src/transactionSessionAttemptKernel";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import { seedRegisteredTaskSystemParentV1 } from
  "./taskSystemPostgresTestSupport";
import {
  ACCEPTED_ATTEMPT_UUID,
  TASK_LOCATOR,
  TASK_RUN_ID,
  locatedTaskAuthorityV1,
  seedAdditionalTaskSystemRunV1,
  seedTaskSystemRunAttemptStoreV1,
} from "./taskSystemRunAttemptStoreTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const EARLY_RUN_ID = "run_72000000-0000-4000-8000-000000000001";
const LATE_RUN_ID = "run_72000000-0000-4000-8000-000000000005";
const FOREIGN_READER_SCOPE_ID =
  "scope_72000000-0000-4000-8000-000000000098";
const PLAN_RUN_COUNT = 256;
const runId = Result.getOrThrow(decodeTaskRunIdV1(TASK_RUN_ID));
const runVersionOne = Result.getOrThrow(decodeTaskRunVersionV1("1"));
const heartbeatOne = Result.getOrThrow(decodeTaskHeartbeatSequenceV1(1));
const retryJitter = Result.getOrThrow(decodeTaskRetryJitterV1(0.25));

type QueryObservation = Parameters<TaskSystemRunReadQueryObserverV1>[0];

describe("DTE04-E PostgreSQL acceptance environment", () => {
  it("requires an authenticated PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting DTE04-E.",
    ).not.toBeNull();
  });
});

describePostgres("DTE04-E Task System reads - PostgreSQL", () => {
  it("preserves bounded snapshots and uses the admitted discovery and ledger indexes", async () => {
    await withReadFixture(async fixture => {
      await seedAdditionalTaskSystemRunV1(
        fixture.persistence,
        LATE_RUN_ID,
        fixture.scopeId,
      );
      await seedAdditionalTaskSystemRunV1(
        fixture.persistence,
        EARLY_RUN_ID,
        fixture.scopeId,
      );
      const observations: QueryObservation[] = [];
      const observeQuery: TaskSystemRunReadQueryObserverV1 = observation => {
        observations.push(observation);
      };
      const discovery = makeTaskSystemDueDiscoveryV1(
        fixture.located,
        { observeQuery },
      );
      const beforeDiscovery = await taskCounts(fixture.persistence);
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
      expect([second.throughMs, third.throughMs]).toEqual([
        first.throughMs,
        first.throughMs,
      ]);
      expect(third.nextCursor).toBeNull();
      expect(await taskCounts(fixture.persistence)).toEqual(beforeDiscovery);

      const lifecycle = lifecycleLayer(fixture.lifecycleStore);
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
      const ledger = makeTaskSystemRequestedEffectLedgerV1(
        fixture.located,
        { observeQuery },
      );
      const effectFirst = await runEffect(ledger.readRequestedEffects({
        version: 1,
        runId,
        pageSize: 2,
        cursor: null,
      }));
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
      const effectSecond = await runEffect(ledger.readRequestedEffects({
        version: 1,
        runId,
        pageSize: 2,
        cursor: effectFirst.nextCursor,
      }));
      expect(effectFirst.effects.map(effect => effect.sequence))
        .toEqual([1n, 2n]);
      expect(effectSecond.effects.map(effect => effect.sequence))
        .toEqual([3n, 4n]);
      expect(effectSecond.throughSequence).toBe(effectFirst.throughSequence);
      expect(effectSecond.nextCursor).toBeNull();

      const dueQuery = requireObservation(observations, "discoverDueRuns");
      const effectQuery = requireObservation(observations, "requestedEffects");
      await seedRepresentativePlanPopulation(
        fixture.persistence,
        fixture.scopeId,
      );
      await fixture.persistence.query(
        "analyze fx_system_durable_task_run_v1",
      );
      await fixture.persistence.query(
        "analyze fx_system_durable_task_requested_effect_v1",
      );
      const planClient = await fixture.persistence.pool.connect();
      try {
        const plans = Object.freeze({
          due: await explainObserved(planClient, dueQuery),
          effects: await explainObserved(planClient, effectQuery),
        });
        expect(plans.due).toContain("fx_task_run_v1_due_discovery_idx");
        expect(plans.effects).toContain("fx_task_requested_effect_v1_pk");
      } finally {
        planClient.release();
      }
    });
  }, 480_000);

  it("blocks the effect snapshot behind the run lock and then reads one committed ledger", async () => {
    await withReadFixture(async fixture => {
      await startSeededAttempt(fixture.lifecycleStore);
      const blocker = await fixture.persistence.pool.connect();
      try {
        await blocker.query("begin");
        await blocker.query(`
          select run_id
          from fx_system_durable_task_run_v1
          where scope_id = $1 and run_id = $2
          for update
        `, [fixture.scopeId, TASK_RUN_ID]);
        const pidResult = await blocker.query<{ pid: number }>(
          "select pg_backend_pid()::int as pid",
        );
        const blockerPid = pidResult.rows[0]?.pid;
        if (blockerPid === undefined) throw new Error("missing blocker pid");

        const pending = runEffect(
          makeTaskSystemRequestedEffectLedgerV1(
            fixture.located,
          ).readRequestedEffects({
            version: 1,
            runId,
            pageSize: 100,
            cursor: null,
          }),
        );
        await waitForBlockedTaskRunReader(
          fixture.persistence,
          blockerPid,
        );
        await blocker.query("commit");
        const page = await pending;
        expect(page.effects.map(effect => effect.sequence))
          .toEqual([1n, 2n, 3n, 4n]);
        expect(page.throughSequence).toBe(4n);
      } finally {
        await blocker.query("rollback").catch(() => undefined);
        blocker.release();
      }
    });
  }, 480_000);

  it("retries hidden successful reads and releases invalid-snapshot locks", async () => {
    await withReadFixture(async fixture => {
      const baseTarget = fixture.located.target;
      let executions = 0;
      let workInvocations = 0;
      const runReadCommitted: RunLocatedReadCommittedTransactionV1 =
        async work => {
          executions += 1;
          const value = await baseTarget[RUN_LOCATED_READ_COMMITTED_V1](
            async tx => {
              workInvocations += 1;
              return work(tx);
            },
          );
          if (executions < 3) {
            throw new LocatedReadCommittedTransactionFailureV1({
              kind: "decisionUncertain",
              settlementCause: new Error("hidden read settlement"),
            });
          }
          return value;
        };
      const retryTarget = Object.freeze({
        physicalLocator: baseTarget.physicalLocator,
        getCurrentClock: baseTarget.getCurrentClock,
        [RUN_LOCATED_READ_COMMITTED_V1]: runReadCommitted,
      }) satisfies LocatedReadCommittedAttemptTargetV1;
      const retryLocated = Object.freeze({
        authority: fixture.located.authority,
        target: retryTarget,
      });
      const page = await runEffect(
        makeTaskSystemDueDiscoveryV1(retryLocated).discoverDueRuns({
          version: 1,
          dueKind: "start_attempt",
          pageSize: 10,
          cursor: null,
        }),
      );
      expect(executions).toBe(3);
      expect(workInvocations).toBe(3);
      expect(page.candidates.map(candidate => candidate.runId))
        .toEqual([TASK_RUN_ID]);

      const lockVerifier = await fixture.persistence.pool.connect();
      try {
        const ledger = makeTaskSystemRequestedEffectLedgerV1(fixture.located);
        await expect(runEffectFailure(ledger.readRequestedEffects({
          version: 1,
          runId,
          pageSize: 10,
          cursor: {
            version: 1,
            runId,
            throughSequence: 1n,
            afterSequence: 0n,
          },
        }))).resolves.toMatchObject({
          _tag: "InvalidTaskSystemRunReadRequestError",
          issue: "invalid_cursor",
        });
        await assertTaskRunLockReleased(
          lockVerifier,
          fixture.scopeId,
        );
      } finally {
        await lockVerifier.query("rollback").catch(() => undefined);
        lockVerifier.release();
      }

      await fixture.persistence.query(`
        insert into fx_system_scope_clock
          (scope_id, storage_generation, epoch)
        values ($1, 'flarexdb_v1',
          'epoch_72000000-0000-4000-8000-000000000097')
      `, [FOREIGN_READER_SCOPE_ID]);
      const foreignLocated = await locatedTaskAuthorityV1(
        fixture.persistence.drizzle,
        fixture.located.target,
        FOREIGN_READER_SCOPE_ID,
        "deployment_foreign_task_read_v1",
      );
      const unavailable = await runEffectFailure(
        makeTaskSystemRequestedEffectLedgerV1(
          foreignLocated,
        ).readRequestedEffects({
          version: 1,
          runId,
          pageSize: 10,
          cursor: null,
        }),
      );
      expect(unavailable).toBeInstanceOf(TaskSystemRunReadUnavailableError);
    });
  }, 480_000);
});

async function withReadFixture(
  run: (fixture: Awaited<ReturnType<typeof makeReadFixture>>) => Promise<void>,
): Promise<void> {
  await withTemporaryPostgresPersistence(async persistence => {
    await run(await makeReadFixture(persistence));
  }, { historicalApplicationAnalysis: true });
}

async function makeReadFixture(persistence: PostgresFlarexPersistence) {
  const parent = await seedRegisteredTaskSystemParentV1(
    persistence,
    "dte04-e:task-read-parent",
  );
  const seeded = await seedTaskSystemRunAttemptStoreV1(persistence, { parent });
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
  const lifecycleStore = makeTaskSystemRunAttemptStoreV1(located, {
    randomUuid: () => ACCEPTED_ATTEMPT_UUID,
  });
  return Object.freeze({
    persistence,
    scopeId: seeded.scopeId,
    located,
    lifecycleStore,
  });
}

function lifecycleLayer(
  store: ReturnType<typeof makeTaskSystemRunAttemptStoreV1>,
) {
  return RunAttemptLifecycleLive.pipe(
    Layer.provide(Layer.succeed(TaskSystemRunAttemptStore, store)),
  );
}

async function startSeededAttempt(
  store: ReturnType<typeof makeTaskSystemRunAttemptStoreV1>,
): Promise<void> {
  await runEffect(Effect.gen(function* () {
    const service = yield* RunAttemptLifecycle;
    return yield* service.startAttempt({
      type: "start_attempt",
      runId,
      expectedRunVersion: runVersionOne,
      retryJitter,
    });
  }).pipe(Effect.provide(lifecycleLayer(store))));
}

async function taskCounts(persistence: PostgresFlarexPersistence) {
  const result = await persistence.query<{
    runs: number;
    attempts: number;
    effects: number;
  }>(`
    select
      (select count(*)::int from fx_system_durable_task_run_v1) as runs,
      (select count(*)::int
       from fx_system_durable_task_attempt_identity_v1) as attempts,
      (select count(*)::int
       from fx_system_durable_task_requested_effect_v1) as effects
  `);
  const counts = result.rows[0];
  if (counts === undefined) throw new Error("task counts returned no row");
  return Object.freeze(counts);
}

function requireObservation(
  observations: ReadonlyArray<QueryObservation>,
  name: QueryObservation["name"],
): QueryObservation {
  const observation = observations.find(candidate => candidate.name === name);
  if (observation === undefined) {
    throw new Error(`Task System read did not execute ${name}.`);
  }
  return observation;
}

async function explainObserved(
  client: {
    readonly query: (
      text: string,
      values?: ReadonlyArray<unknown>,
    ) => Promise<{ readonly rows: ReadonlyArray<Record<string, unknown>> }>;
  },
  observation: QueryObservation,
): Promise<string> {
  const result = await client.query(
    `explain (format json) ${observation.sql}`,
    [...observation.params],
  );
  return JSON.stringify(result.rows);
}

async function seedRepresentativePlanPopulation(
  persistence: PostgresFlarexPersistence,
  scopeId: string,
): Promise<void> {
  for (let ordinal = 1; ordinal <= PLAN_RUN_COUNT; ordinal += 1) {
    await seedAdditionalTaskSystemRunV1(
      persistence,
      `run_73000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
      scopeId,
    );
  }
  await persistence.query(`
    insert into fx_system_durable_task_requested_effect_v1 (
      scope_id, run_id, sequence, accepted_run_version, kind,
      payload_codec_version, payload_byte_length, payload_json, not_before_ms
    )
    select effect.scope_id, run.run_id, effect.sequence,
      effect.accepted_run_version, effect.kind, effect.payload_codec_version,
      effect.payload_byte_length, effect.payload_json, effect.not_before_ms
    from fx_system_durable_task_requested_effect_v1 as effect
    cross join fx_system_durable_task_run_v1 as run
    where effect.scope_id = $1 and effect.run_id = $2
      and run.scope_id = $1 and run.run_id like 'run_73000000-%'
  `, [scopeId, TASK_RUN_ID]);
}

async function assertTaskRunLockReleased(
  client: PoolClient,
  scopeId: string,
): Promise<void> {
  try {
    await client.query("begin");
    await client.query("set local lock_timeout = '1s'");
    await client.query(`
      select run_id
      from fx_system_durable_task_run_v1
      where scope_id = $1 and run_id = $2
      for update
    `, [scopeId, TASK_RUN_ID]);
  } finally {
    await client.query("rollback").catch(() => undefined);
  }
}

async function waitForBlockedTaskRunReader(
  persistence: PostgresFlarexPersistence,
  blockerPid: number,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ blocked_count: number }>(`
      select count(*)::int as blocked_count
      from pg_stat_activity as activity
      where $1::int = any(pg_blocking_pids(activity.pid))
        and activity.datname = current_database()
        and activity.wait_event_type = 'Lock'
        and activity.query ilike '%fx_system_durable_task_run_v1%'
        and activity.query ilike '%for share%'
    `, [blockerPid]);
    if ((result.rows[0]?.blocked_count ?? 0) >= 1) return;
    await delay(25);
  }
  throw new Error("timed out waiting for the blocked task-run reader");
}
