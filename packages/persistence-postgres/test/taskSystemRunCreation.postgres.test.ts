import { setTimeout as delay } from "node:timers/promises";
import {
  decodeTaskRunCreationReceiptV1,
  type TaskRunCreationReceiptV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import { Effect, Encoding, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  createPostgresLocatedTaskSystemRunAttemptTargetV1,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import {
  createPostgresLocatedReadCommittedTransactionRunnerV1,
} from "../src/postgresLocatedReadCommitted";
import {
  TaskSystemRunCreationTransientStoreError,
  type TaskSystemRunCreationErrorV1,
} from "../src/taskSystemRunCreationV1";
import {
  createLocatedTaskSystemRunAttemptTargetV1,
} from "../src/taskSystemRunAttemptStoreV1";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import { seedRegisteredTaskSystemParentV1 } from
  "./taskSystemPostgresTestSupport";
import {
  TASK_SYSTEM_CREATION_RUN_UUID_A,
  TASK_SYSTEM_CREATION_RUN_UUID_B,
  installTaskSystemCreationRuntimeBindingV1,
  makeTaskSystemCreationAuthorityV1,
  makeTaskSystemCreationRequestV1,
  makeTaskSystemCreationRuntimeBindingV1,
  makeTaskSystemCreationStoreForTestV1,
  taskSystemCreationCountsV1,
} from "./taskSystemRunCreationTestSupport";
import {
  TASK_LOCATOR,
  locatedTaskAuthorityV1,
  seedTaskSystemRunAttemptStoreV1,
} from "./taskSystemRunAttemptStoreTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const CREATION_INSERT_ADVISORY_LOCK = 73_004_001;

describePostgres("DTE04-E Task System run creation - PostgreSQL", () => {
  it("converges two blocked exact creators and reads database time after the lock", async () => {
    await withCreationFixture(async fixture => {
      const stores = [
        TASK_SYSTEM_CREATION_RUN_UUID_A,
        TASK_SYSTEM_CREATION_RUN_UUID_B,
      ].map(randomUuid => makeTaskSystemCreationStoreForTestV1(fixture, {
        randomUuid: () => randomUuid,
      }));
      const raced = await runBehindScopeBlocker(
        fixture.persistence,
        fixture.scopeId,
        stores.map(store => () => runEffect(store.createRun(fixture.request))),
      );
      const [first, second] = raced.values;
      expect(first).toBeDefined();
      expect(second).toEqual(first);
      expect(Number(first?.createdAtMs)).toBeGreaterThanOrEqual(
        raced.releasedAfterMs,
      );
      expect(await taskSystemCreationCountsV1(fixture.persistence)).toEqual({
        runs: 1,
        requests: 1,
        attempts: 0,
        effects: 0,
      });
      let replayAllocations = 0;
      const replayStore = makeTaskSystemCreationStoreForTestV1(fixture, {
        randomUuid: () => {
          replayAllocations += 1;
          throw new Error("exact replay must not allocate a run ID");
        },
      });
      await expect(runEffect(replayStore.createRun(fixture.request)))
        .resolves.toEqual(first);
      expect(replayAllocations).toBe(0);
    });
  }, 480_000);

  it("admits one conflicting first creator and returns one typed conflict", async () => {
    await withCreationFixture(async fixture => {
      const first = makeTaskSystemCreationStoreForTestV1(fixture, {
        randomUuid: () => TASK_SYSTEM_CREATION_RUN_UUID_A,
      });
      const second = makeTaskSystemCreationStoreForTestV1(fixture, {
        randomUuid: () => TASK_SYSTEM_CREATION_RUN_UUID_B,
      });
      const raced = await runBehindScopeBlocker(
        fixture.persistence,
        fixture.scopeId,
        [
          () => creationOutcome(first.createRun(fixture.request)),
          () => creationOutcome(second.createRun(
            makeTaskSystemCreationRequestV1("request-a", 0x66),
          )),
        ],
      );
      const successes = raced.values.filter(
        outcome => outcome.kind === "success",
      );
      const failures = raced.values.filter(
        outcome => outcome.kind === "failure",
      );
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.error).toMatchObject({
        _tag: "TaskRunCreationIdempotencyConflictError",
        requestKey: "request-a",
        reason: "request_digest_mismatch",
      });
      expect(await taskSystemCreationCountsV1(fixture.persistence)).toEqual({
        runs: 1,
        requests: 1,
        attempts: 0,
        effects: 0,
      });
    });
  }, 480_000);

  it("recovers a committed creation whose successful response was hidden", async () => {
    await withCreationFixture(async fixture => {
      let releaseCalls = 0;
      const hiddenRelease = new Error("hide the committed creation response");
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
      const hiddenStore = makeTaskSystemCreationStoreForTestV1({
        ...fixture,
        located: hiddenLocated,
      }, {
        randomUuid: () => TASK_SYSTEM_CREATION_RUN_UUID_A,
      });
      const failure = await runEffectFailure(
        hiddenStore.createRun(fixture.request),
      );
      expect(failure).toBeInstanceOf(TaskSystemRunCreationTransientStoreError);
      expect(failure).toMatchObject({ reason: "driver_failure" });
      expect(releaseCalls).toBe(1);
      expect(await taskSystemCreationCountsV1(fixture.persistence)).toEqual({
        runs: 1,
        requests: 1,
        attempts: 0,
        effects: 0,
      });
      const beforeReplay = await creationReplaySnapshot(
        fixture.persistence,
        fixture.scopeId,
        `run_${TASK_SYSTEM_CREATION_RUN_UUID_A}`,
      );

      let replayAllocations = 0;
      const replayStore = makeTaskSystemCreationStoreForTestV1(fixture, {
        randomUuid: () => {
          replayAllocations += 1;
          throw new Error("post-commit replay must not allocate a run ID");
        },
      });
      const replay = await runEffect(replayStore.createRun(fixture.request));
      expect(replay).toEqual(beforeReplay.receipt);
      expect(replayAllocations).toBe(0);
      const afterReplay = await creationReplaySnapshot(
        fixture.persistence,
        fixture.scopeId,
        replay.runId,
      );
      expect(afterReplay).toEqual(beforeReplay);
      expect(await taskSystemCreationCountsV1(fixture.persistence)).toEqual({
        runs: 1,
        requests: 1,
        attempts: 0,
        effects: 0,
      });
    });
  }, 480_000);

  it("rolls back a run-ID collision before retrying a fresh candidate", async () => {
    await withCreationFixture(async fixture => {
      const firstStore = makeTaskSystemCreationStoreForTestV1(fixture, {
        randomUuid: () => TASK_SYSTEM_CREATION_RUN_UUID_A,
      });
      await runEffect(firstStore.createRun(fixture.request));

      const allocations = [
        TASK_SYSTEM_CREATION_RUN_UUID_A,
        TASK_SYSTEM_CREATION_RUN_UUID_B,
      ];
      let allocationIndex = 0;
      const retryStore = makeTaskSystemCreationStoreForTestV1(fixture, {
        randomUuid: () => allocations[allocationIndex++]!,
      });
      const created = await runEffect(retryStore.createRun(
        makeTaskSystemCreationRequestV1("request-b", 0x55),
      ));
      expect(created.runId).toBe(`run_${TASK_SYSTEM_CREATION_RUN_UUID_B}`);
      expect(allocationIndex).toBe(2);
      expect(await taskSystemCreationCountsV1(fixture.persistence)).toEqual({
        runs: 2,
        requests: 2,
        attempts: 0,
        effects: 0,
      });
    });
  }, 480_000);
});

async function withCreationFixture(
  run: (
    fixture: Awaited<ReturnType<typeof makeCreationFixture>>,
  ) => Promise<void>,
): Promise<void> {
  await withTemporaryPostgresPersistence(async persistence => {
    await run(await makeCreationFixture(persistence));
  }, { historicalApplicationAnalysis: true });
}

async function makeCreationFixture(persistence: PostgresFlarexPersistence) {
  const parent = await seedRegisteredTaskSystemParentV1(
    persistence,
    "dte04-e:task-creation-parent",
  );
  const seeded = await seedTaskSystemRunAttemptStoreV1(persistence, { parent });
  await persistence.query(`
    delete from fx_system_durable_task_run_v1
    where scope_id = $1
  `, [seeded.scopeId]);
  const candidateSha256 = Result.getOrThrow(
    Encoding.decodeHex(parent.candidateSha256Hex),
  );
  const identity = Object.freeze({
    applicationRevisionId: parent.applicationRevisionId,
    candidateSha256,
  });
  const runtimeBinding = await makeTaskSystemCreationRuntimeBindingV1(identity);
  const creationAuthority = makeTaskSystemCreationAuthorityV1(identity);
  await installTaskSystemCreationRuntimeBindingV1(
    persistence.drizzle,
    runtimeBinding,
    creationAuthority,
  );
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
  return Object.freeze({
    persistence,
    scopeId: seeded.scopeId,
    deploymentId: seeded.deploymentId,
    located,
    request: makeTaskSystemCreationRequestV1("request-a", 0x55),
    runtimeBinding,
    creationAuthority,
  });
}

async function runBehindScopeBlocker<Value>(
  persistence: PostgresFlarexPersistence,
  scopeId: string,
  operations: ReadonlyArray<() => Promise<Value>>,
): Promise<Readonly<{
  readonly releasedAfterMs: number;
  readonly values: ReadonlyArray<Value>;
}>> {
  await installCreationInsertBarrier(persistence);
  const blocker = await persistence.pool.connect();
  try {
    await blocker.query(
      "select pg_advisory_lock($1::bigint)",
      [CREATION_INSERT_ADVISORY_LOCK],
    );
    await blocker.query("begin");
    await blocker.query(`
      select scope_id
      from fx_system_scope_clock
      where scope_id = $1
      for update
    `, [scopeId]);
    const pidResult = await blocker.query<{ pid: number }>(
      "select pg_backend_pid()::int as pid",
    );
    const blockerPid = pidResult.rows[0]?.pid;
    if (blockerPid === undefined) throw new Error("missing blocker pid");
    const pending = operations.map(operation => operation().then(
      value => Object.freeze({ kind: "success" as const, value }),
      cause => Object.freeze({ kind: "failure" as const, cause }),
    ));
    await waitForBlockedCreationReaders(
      persistence,
      blockerPid,
      operations.length,
    );
    const clockResult = await blocker.query<{ milliseconds: string }>(`
      select floor(
        extract(epoch from clock_timestamp()) * 1000
      )::bigint::text as milliseconds
    `);
    const milliseconds = clockResult.rows[0]?.milliseconds;
    if (milliseconds === undefined) throw new Error("missing server clock");
    await blocker.query("commit");
    await waitForBlockedCreationInserts(
      persistence,
      blockerPid,
      operations.length,
    );
    await blocker.query(
      "select pg_advisory_unlock($1::bigint)",
      [CREATION_INSERT_ADVISORY_LOCK],
    );
    const settled = await Promise.all(pending);
    const failed = settled.find(result => result.kind === "failure");
    if (failed?.kind === "failure") throw failed.cause;
    return Object.freeze({
      releasedAfterMs: Number(milliseconds),
      values: Object.freeze(settled.map(result => {
        if (result.kind === "failure") throw result.cause;
        return result.value;
      })),
    });
  } finally {
    await blocker.query("rollback").catch(() => undefined);
    await blocker.query(
      "select pg_advisory_unlock($1::bigint)",
      [CREATION_INSERT_ADVISORY_LOCK],
    ).catch(() => undefined);
    blocker.release();
  }
}

async function installCreationInsertBarrier(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  await persistence.query(`
    create function fx_test_task_creation_insert_barrier_v1()
    returns trigger
    language plpgsql
    as $function$
    begin
      perform pg_advisory_xact_lock_shared(${CREATION_INSERT_ADVISORY_LOCK});
      return new;
    end
    $function$
  `);
  await persistence.query(`
    create trigger fx_test_task_creation_insert_barrier_v1
    before insert on fx_system_durable_task_run_v1
    for each row execute function fx_test_task_creation_insert_barrier_v1()
  `);
}

async function waitForBlockedCreationReaders(
  persistence: PostgresFlarexPersistence,
  blockerPid: number,
  expectedCount: number,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ blocked_count: number }>(`
      select count(*)::int as blocked_count
      from pg_stat_activity as activity
      where $1::int = any(pg_blocking_pids(activity.pid))
        and activity.datname = current_database()
        and activity.wait_event_type = 'Lock'
        and activity.query ilike '%fx_system_scope_clock%'
        and activity.query ilike '%for share%'
    `, [blockerPid]);
    if ((result.rows[0]?.blocked_count ?? 0) >= expectedCount) return;
    await delay(25);
  }
  throw new Error(
    `timed out waiting for ${expectedCount} blocked creation readers`,
  );
}

async function waitForBlockedCreationInserts(
  persistence: PostgresFlarexPersistence,
  blockerPid: number,
  expectedCount: number,
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
        and activity.query ilike '%insert%'
    `, [blockerPid]);
    if ((result.rows[0]?.blocked_count ?? 0) >= expectedCount) return;
    await delay(25);
  }
  throw new Error(
    `timed out waiting for ${expectedCount} blocked creation inserts`,
  );
}

function creationOutcome(
  effect: Effect.Effect<
    TaskRunCreationReceiptV1,
    TaskSystemRunCreationErrorV1
  >,
) {
  return runEffect(effect.pipe(Effect.match({
    onSuccess: receipt => Object.freeze({ kind: "success" as const, receipt }),
    onFailure: error => Object.freeze({ kind: "failure" as const, error }),
  })));
}

async function creationReplaySnapshot(
  persistence: PostgresFlarexPersistence,
  scopeId: string,
  runId: string,
) {
  const result = await persistence.query<{
    run_id: string;
    task_definition_revision_id: string;
    created_at_ms: string;
    request_key_sha256_hex: string;
    request_sha256_hex: string;
    creation_authority_sha256_hex: string;
    fingerprint: string;
  }>(`
    select run.run_id,
      run.task_definition_revision_id,
      run.created_at_ms::text,
      encode(request.request_key_sha256, 'hex') as request_key_sha256_hex,
      encode(request.request_sha256, 'hex') as request_sha256_hex,
      encode(run.creation_authority_sha256, 'hex')
        as creation_authority_sha256_hex,
      jsonb_build_object(
        'run', to_jsonb(run),
        'request', to_jsonb(request),
        'runXmin', run.xmin::text,
        'requestXmin', request.xmin::text
      )::text as fingerprint
    from fx_system_durable_task_run_v1 as run
    join fx_system_durable_task_run_request_v1 as request
      on request.scope_id = run.scope_id and request.run_id = run.run_id
    where run.scope_id = $1 and run.run_id = $2
  `, [scopeId, runId]);
  const row = result.rows[0];
  if (row === undefined) throw new Error("creation replay snapshot missing");
  const receipt = Result.getOrThrow(decodeTaskRunCreationReceiptV1({
    status: "created",
    version: 1,
    runId: row.run_id,
    taskDefinitionRevisionId: row.task_definition_revision_id,
    createdAtMs: Number(row.created_at_ms),
    requestKeySha256: Result.getOrThrow(
      Encoding.decodeHex(row.request_key_sha256_hex),
    ),
    requestSha256: Result.getOrThrow(
      Encoding.decodeHex(row.request_sha256_hex),
    ),
    creationAuthoritySha256: Result.getOrThrow(
      Encoding.decodeHex(row.creation_authority_sha256_hex),
    ),
  }));
  return Object.freeze({ receipt, fingerprint: row.fingerprint });
}
