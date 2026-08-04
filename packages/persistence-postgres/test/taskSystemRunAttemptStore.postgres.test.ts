import { setTimeout as delay } from "node:timers/promises";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import {
  RunAttemptLifecycle,
  RunAttemptLifecycleLive,
  StaleTaskRunVersionError,
  TaskSystemRunAttemptStore,
  decodeTaskHeartbeatSequenceV1,
  decodeTaskRetryJitterV1,
  decodeTaskRunIdV1,
  decodeTaskRunVersionV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { Effect, Layer, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  createPostgresLocatedApplicationRevisionRegistrationTargetV1,
  createPostgresLocatedTaskSystemRunAttemptTargetV1,
} from "../src/postgres";
import {
  makeTaskSystemRunAttemptStoreV1,
} from "../src/taskSystemRunAttemptStoreV1";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import {
  ACCEPTED_ATTEMPT_UUID,
  TASK_LOCATOR,
  TASK_RUN_ID,
  locatedTaskAuthorityV1,
  seedTaskSystemRunAttemptStoreV1,
  type TaskSystemRunAttemptParentV1,
} from "./taskSystemRunAttemptStoreTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const runId = Result.getOrThrow(decodeTaskRunIdV1(TASK_RUN_ID));
const runVersionOne = Result.getOrThrow(decodeTaskRunVersionV1("1"));
const retryJitter = Result.getOrThrow(decodeTaskRetryJitterV1(0.25));
const heartbeatOne = Result.getOrThrow(decodeTaskHeartbeatSequenceV1(1));

describePostgres("DTE04-B scope-bound Task System lifecycle store - PostgreSQL", () => {
  it("serializes same-run writers, reads time after the lock wait, and rolls decision failure back", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const parent = await seedRegisteredTaskDefinitionParent(persistence);
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
});

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

async function seedRegisteredTaskDefinitionParent(
  persistence: Parameters<Parameters<typeof withTemporaryPostgresPersistence>[0]>[0],
): Promise<TaskSystemRunAttemptParentV1> {
  const registrationTarget =
    createPostgresLocatedApplicationRevisionRegistrationTargetV1(
      persistence,
      TASK_LOCATOR,
    );
  const registrationFixtureState = globalThis as typeof globalThis & {
    __flarexRegistrationFixtureOnlyV1?: boolean;
  };
  registrationFixtureState.__flarexRegistrationFixtureOnlyV1 = true;
  const { authenticatedRegistrationFixtureForPersistence } =
    await import("./applicationRevisionRegistrationV1.test");
  return runEffect(Effect.scoped(Effect.gen(function* () {
    const fixture = yield* authenticatedRegistrationFixtureForPersistence(
      persistence,
      registrationTarget,
    );
    const registration = yield* fixture.context.register(
      fixture.analysis,
      "dte04-b:task-store-parent",
    );
    return Object.freeze({
      scopeId: "scope_61000000-0000-0000-0000-000000000001",
      deploymentId: "deployment_registration_v1",
      applicationRevisionId: registration.revisionId,
      candidateSha256Hex: encodeBytesToLowercaseHex(
        fixture.preparation.candidateSha256,
      ),
    });
  })));
}
