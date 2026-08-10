import { setTimeout as delay } from "node:timers/promises";

import {
  TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1,
  validateTaskComputeDispatchAcceptanceV1,
  type TaskComputeDispatchIdentityV1,
} from "@flarex/durable-task/internal/compute-provider-v1";
import {
  RunAttemptLifecycle,
  RunAttemptLifecycleLive,
  TaskSystemRunAttemptStore,
  decodeTaskRunVersionV1,
  type TaskAttemptGrantV1,
  type TaskRequestedEffectSequenceV1,
  type TaskRunIdV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { isNonArrayRecord } from "@flarex/utils/records";
import { sql } from "drizzle-orm";
import { Effect, Encoding, Layer, Result } from "effect";
import { Client, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import type { AppRowTransaction } from "../src/appRows";
import {
  createPostgresLocatedTaskSystemRunAttemptTargetV1,
  createPostgresPersistence,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import {
  createPostgresLocatedReadCommittedTransactionRunnerV1,
} from "../src/postgresLocatedReadCommitted";
import {
  TaskComputeDeliveryRepositoryConfirmedRollbackV1Error,
  TaskComputeDeliveryRepositoryDecisionUncertainV1Error,
  TaskComputeDeliveryRepositorySqlV1Error,
  createLocatedTaskComputeDeliveryTargetV1,
  makeTaskComputeDeliveryRepositoryV1,
  type LocatedTaskComputeDeliveryTargetV1,
  type TaskComputeDeliveryRepositoryV1,
} from "../src/taskComputeDeliveryRepositoryV1";
import { makeTaskSystemRunAttemptStoreV1 } from
  "../src/taskSystemRunAttemptStoreV1";
import {
  applyTaskRepairPostgresDeadlinePolicyV1,
  createTaskRepairPostgresDeadlinePolicyV1,
  type TaskRepairPostgresDeadlinePolicyV1,
} from "../src/taskRepairPostgresDeadlinePolicyV1";
import {
  LocatedReadCommittedTransactionFailureV1,
  type RunLocatedReadCommittedTransactionV1,
} from "../src/transactionSessionAttemptKernel";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresSchema,
} from "./postgresHelpers";
import {
  ACCEPTED_ATTEMPT_UUID,
  TASK_LOCATOR,
  locatedTaskAuthorityV1,
  seedTaskSystemRunAttemptStoreV1,
} from "./taskSystemRunAttemptStoreTestSupport";
import { seedRegisteredTaskSystemParentV1 } from
  "./taskSystemPostgresTestSupport";
import {
  TASK_SYSTEM_CREATION_RUN_UUID_A,
  installTaskSystemCreationRuntimeBindingV1,
  makeTaskSystemCreationAuthorityV1,
  makeTaskSystemCreationRequestV1,
  makeTaskSystemCreationRuntimeBindingV1,
  makeTaskSystemCreationStoreForTestV1,
  taskSystemCreationRetryJitterV1,
} from "./taskSystemRunCreationTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const CLAIM_OWNER_A = "73000000-0000-4000-8000-000000000011";
const CLAIM_OWNER_B = "73000000-0000-4000-8000-000000000012";
const CLAIM_OWNER_C = "73000000-0000-4000-8000-000000000013";
const CLAIM_OWNER_D = "73000000-0000-4000-8000-000000000014";
const LIFECYCLE_BARRIER_LOCK = 6_206_001;
const ACCEPTANCE_BARRIER_LOCK = 6_206_002;
const runVersionOne = success(decodeTaskRunVersionV1("1"));

const concurrencyPolicy = success(createTaskRepairPostgresDeadlinePolicyV1({
  connectionTimeoutMilliseconds: 1_000,
  lockTimeoutMilliseconds: 5_000,
  statementTimeoutMilliseconds: 10_000,
  transactionTimeoutMilliseconds: 15_000,
  settlementReserveMilliseconds: 20_000,
}));

const strictDeadlinePolicy = success(createTaskRepairPostgresDeadlinePolicyV1({
  connectionTimeoutMilliseconds: 1_000,
  lockTimeoutMilliseconds: 200,
  statementTimeoutMilliseconds: 500,
  transactionTimeoutMilliseconds: 1_000,
  settlementReserveMilliseconds: 3_000,
}));

describe("DTE06-C2 PostgreSQL acceptance environment", () => {
  it("requires an authenticated PostgreSQL 18 URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting DTE06-C2.",
    ).not.toBeNull();
  });
});

describePostgres("real PostgreSQL DTE06-C2 compute delivery repository", () => {
  it("uses an ordinary role and admits one concurrent claimant and one expired takeover", async () => {
    await withDeliveryFixture(concurrencyPolicy, 4, async (fixture) => {
      const role = await fixture.persistence.query<{
        role_name: string;
        is_superuser: boolean;
        can_create_database: boolean;
        can_create_role: boolean;
      }>(`
        select current_user as role_name,
               rolsuper as is_superuser,
               rolcreatedb as can_create_database,
               rolcreaterole as can_create_role
        from pg_roles
        where rolname = current_user
      `);
      expect(role.rows).toHaveLength(1);
      expect(role.rows[0]).toMatchObject({
        is_superuser: false,
        can_create_database: false,
        can_create_role: false,
      });
      expect(role.rows[0]?.role_name).toEqual(expect.any(String));
      const version = await fixture.persistence.query<{
        server_version: string;
      }>("show server_version");
      expect(version.rows[0]?.server_version).toMatch(/^18\./);

      const first = await Promise.all([
        runEffect(repository(fixture.deliveryLocated, CLAIM_OWNER_A, 250)
          .acquireDispatch(dispatchRequest(fixture))),
        runEffect(repository(fixture.deliveryLocated, CLAIM_OWNER_B, 250)
          .acquireDispatch(dispatchRequest(fixture))),
      ]);
      expect(first.map((value) => value.kind).sort()).toEqual([
        "busy",
        "claimed",
      ]);
      expect(first.filter((value) => value.kind === "claimed")).toHaveLength(1);
      expect(await readDispatchClaim(fixture)).toMatchObject({
        claim_fence: "1",
        delivery_state: "prepared",
      });

      await waitForDispatchClaimExpiry(fixture);
      const takeover = await Promise.all([
        runEffect(repository(fixture.deliveryLocated, CLAIM_OWNER_C, 250)
          .acquireDispatch(dispatchRequest(fixture))),
        runEffect(repository(fixture.deliveryLocated, CLAIM_OWNER_D, 250)
          .acquireDispatch(dispatchRequest(fixture))),
      ]);
      expect(takeover.map((value) => value.kind).sort()).toEqual([
        "busy",
        "claimed",
      ]);
      expect(takeover.filter((value) => value.kind === "claimed"))
        .toHaveLength(1);
      expect(await readDispatchClaim(fixture)).toMatchObject({
        claim_fence: "2",
        delivery_state: "prepared",
      });
    });
  }, 120_000);

  it("serializes lifecycle completion ahead of stale dispatch preparation", async () => {
    await withDeliveryFixture(
      concurrencyPolicy,
      4,
      async (fixture, connectionOptions) => {
        await installLifecycleBarrier(fixture.persistence);
        await withAdvisoryBlocker(
          fixture.persistence,
          connectionOptions,
          LIFECYCLE_BARRIER_LOCK,
          async (blockerPid, release) => {
            const completion = settle(completeFixtureAttempt(fixture));
            await waitForBlockedTransactions(
              fixture.persistence,
              blockerPid,
              1,
            );
            const acquisition = settle(runEffect(repository(
              fixture.deliveryLocated,
              CLAIM_OWNER_A,
            ).acquireDispatch(dispatchRequest(fixture))));
            await waitForBlockedTransactions(
              fixture.persistence,
              blockerPid,
              2,
            );
            await release();

            expect(success(await completion)).toMatchObject({
              disposition: "accepted",
              outcome: { kind: "terminal_succeeded" },
            });
            expect(success(await acquisition)).toEqual({
              kind: "closed",
              state: "obsolete",
              reason: "lifecycle_obsolete",
            });
          },
        );
      },
    );
  }, 120_000);

  it("orders dispatch acceptance before cancellation preparation without deadlock", async () => {
    await withDeliveryFixture(
      concurrencyPolicy,
      4,
      async (fixture, connectionOptions) => {
        const dispatchRepository = repository(
          fixture.deliveryLocated,
          CLAIM_OWNER_A,
        );
        const acquired = await runEffect(dispatchRepository.acquireDispatch(
          dispatchRequest(fixture),
        ));
        if (acquired.kind !== "claimed") {
          throw new Error("dispatch was not claimed");
        }
        await runEffect(
          dispatchRepository.markDispatchDeliveryStarted(acquired.handle),
        );
        const cancellationSequence = await requestFixtureCancellation(fixture);
        await installAcceptanceBarrier(fixture.persistence);

        await withAdvisoryBlocker(
          fixture.persistence,
          connectionOptions,
          ACCEPTANCE_BARRIER_LOCK,
          async (blockerPid, release) => {
            const acceptance = settle(runEffect(
              dispatchRepository.recordDispatchAcceptance(
                acquired.handle,
                dispatchAcceptance(acquired.prepared.dispatchRequest.identity),
              ),
            ));
            await waitForBlockedTransactions(
              fixture.persistence,
              blockerPid,
              1,
            );
            const cancellation = settle(runEffect(repository(
              fixture.deliveryLocated,
              CLAIM_OWNER_B,
            ).acquireCancellation({
              runId: fixture.runId,
              requestedEffectSequence: cancellationSequence,
            })));
            await waitForBlockedTransactions(
              fixture.persistence,
              blockerPid,
              2,
            );
            await release();

            expect(success(await acceptance)).toMatchObject({
              kind: "dispatch_accepted",
              disposition: "current",
            });
            expect(success(await cancellation)).toMatchObject({
              kind: "claimed",
              deliveryMode: "initial",
            });
          },
        );
      },
    );
  }, 120_000);

  it("bounds blocked locks and long statements, rolls back, and reuses the connection", async () => {
    await withDeliveryFixture(
      strictDeadlinePolicy,
      1,
      async (fixture, connectionOptions) => {
        const beforePid = await backendPid(fixture.persistence);
        const blocker = new Client(connectionOptions);
        await blocker.connect();
        try {
          await blocker.query("begin");
          await blocker.query(`
            select 1
            from fx_system_durable_task_run_v1
            where scope_id = $1 and run_id = $2
            for update
          `, [fixture.scopeId, fixture.runId]);
          const startedAt = Date.now();
          const failure = await runEffectFailure(repository(
            fixture.deliveryLocated,
            CLAIM_OWNER_A,
          ).acquireDispatch(dispatchRequest(fixture)));
          expect(Date.now() - startedAt).toBeLessThan(2_000);
          expect(failure).toBeInstanceOf(
            TaskComputeDeliveryRepositoryConfirmedRollbackV1Error,
          );
          expect(failure).toMatchObject({ operation: "acquire_dispatch" });
          if (
            failure instanceof
              TaskComputeDeliveryRepositoryConfirmedRollbackV1Error
          ) {
            expect(postgresCode(failure.cause)).toBe("55P03");
          }
        } finally {
          await blocker.query("rollback").catch(() => undefined);
          await blocker.end();
        }
        expect(await backendPid(fixture.persistence)).toBe(beforePid);

        await installLongDispatchStatement(fixture.persistence);
        const statementStartedAt = Date.now();
        const statementFailure = await runEffectFailure(repository(
          fixture.deliveryLocated,
          CLAIM_OWNER_A,
        ).acquireDispatch(dispatchRequest(fixture)));
        expect(Date.now() - statementStartedAt).toBeLessThan(2_000);
        expect(statementFailure).toBeInstanceOf(
          TaskComputeDeliveryRepositoryConfirmedRollbackV1Error,
        );
        expect(statementFailure).toMatchObject({
          operation: "acquire_dispatch",
        });
        if (
          statementFailure instanceof
            TaskComputeDeliveryRepositoryConfirmedRollbackV1Error
        ) {
          expect(postgresCode(statementFailure.cause)).toBe("57014");
        }
        expect(await dispatchCheckpointCount(fixture)).toBe(0);
        expect(await backendPid(fixture.persistence)).toBe(beforePid);

        await removeLongDispatchStatement(fixture.persistence);
        await expect(runEffect(repository(
          fixture.deliveryLocated,
          CLAIM_OWNER_A,
        ).acquireDispatch(dispatchRequest(fixture)))).resolves
          .toMatchObject({ kind: "claimed", deliveryMode: "initial" });
      },
    );
  }, 120_000);

  it("discards a whole-transaction timeout and uses a healthy replacement", async () => {
    await withDeliveryFixture(
      strictDeadlinePolicy,
      1,
      async (fixture) => {
        let terminatedPid: number | undefined;
        let observedDiscard: Error | undefined;
        let releaseCompleted = false;
        const base = createPostgresLocatedReadCommittedTransactionRunnerV1(
          fixture.persistence.pool,
          {
            afterAcquire: async (client) => {
              terminatedPid = await clientBackendPid(client);
            },
            release: (client, discardError) => {
              observedDiscard = discardError;
              client.release(discardError);
              releaseCompleted = true;
            },
          },
        );
        const delayed: RunLocatedReadCommittedTransactionV1 =
          async <Value>(work: (tx: AppRowTransaction) => Promise<Value>) =>
            base(async (tx) => {
              const value = await work(tx);
              await delay(1_250);
              await tx.execute(sql`select 1`);
              return value;
            });
        const delayedRepository = repository(
          deliveryLocatedWithRunner(fixture, delayed),
          CLAIM_OWNER_A,
        );

        const startedAt = Date.now();
        const failure = await runEffectFailure(
          delayedRepository.acquireDispatch(dispatchRequest(fixture)),
        );
        expect(Date.now() - startedAt).toBeLessThan(3_000);
        expect(failure).toBeInstanceOf(TaskComputeDeliveryRepositorySqlV1Error);
        expect(failure).toMatchObject({
          operation: "acquire_dispatch",
          phase: "cleanup",
        });
        expect(releaseCompleted).toBe(true);
        expect(observedDiscard).toBeInstanceOf(Error);
        expect(terminatedPid).toEqual(expect.any(Number));
        expect(await dispatchCheckpointCount(fixture)).toBe(0);
        expect(await backendPid(fixture.persistence)).not.toBe(terminatedPid);
        await expect(runEffect(repository(
          fixture.deliveryLocated,
          CLAIM_OWNER_B,
        ).acquireDispatch(dispatchRequest(fixture)))).resolves
          .toMatchObject({ kind: "claimed", deliveryMode: "initial" });
      },
    );
  }, 120_000);

  it("reports committed response loss as uncertain and recovers the durable marker", async () => {
    await withDeliveryFixture(concurrencyPolicy, 2, async (fixture) => {
      const base = createPostgresLocatedReadCommittedTransactionRunnerV1(
        fixture.persistence.pool,
      );
      let calls = 0;
      const uncertain: RunLocatedReadCommittedTransactionV1 =
        async <Value>(work: (tx: AppRowTransaction) => Promise<Value>) => {
          calls += 1;
          const value = await base(work);
          if (calls === 2) {
            throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
              kind: "decisionUncertain",
              settlementCause: new Error("committed response lost"),
            }));
          }
          return value;
        };
      const uncertainRepository = repository(
        deliveryLocatedWithRunner(fixture, uncertain),
        CLAIM_OWNER_A,
        250,
      );
      const acquired = await runEffect(uncertainRepository.acquireDispatch(
        dispatchRequest(fixture),
      ));
      if (acquired.kind !== "claimed") throw new Error("dispatch was not claimed");

      const failure = await runEffectFailure(
        uncertainRepository.markDispatchDeliveryStarted(acquired.handle),
      );
      expect(failure).toBeInstanceOf(
        TaskComputeDeliveryRepositoryDecisionUncertainV1Error,
      );
      expect(failure).toMatchObject({
        operation: "mark_dispatch_delivery_started",
      });
      expect(await readDispatchClaim(fixture)).toMatchObject({
        claim_owner: CLAIM_OWNER_A,
        claim_fence: "1",
        delivery_state: "delivering",
        delivery_attempt_count: "1",
      });
      expect(await runEffectFailure(
        uncertainRepository.renewDispatchClaim(acquired.handle),
      )).toMatchObject({ reason: "closed_handle" });

      await waitForDispatchClaimExpiry(fixture);
      const recovery = await runEffect(repository(
        fixture.deliveryLocated,
        CLAIM_OWNER_B,
        250,
      ).acquireDispatch(dispatchRequest(fixture)));
      expect(recovery).toMatchObject({
        kind: "claimed",
        deliveryMode: "uncertain_replay",
      });
    });
  }, 120_000);
});

interface DeliveryFixture {
  readonly persistence: PostgresFlarexPersistence;
  readonly deliveryLocated: Readonly<{
    authority: Awaited<ReturnType<typeof locatedTaskAuthorityV1>>["authority"];
    target: LocatedTaskComputeDeliveryTargetV1;
  }>;
  readonly lifecycleLayer: ReturnType<typeof makeLifecycleLayer>;
  readonly scopeId: string;
  readonly runId: TaskRunIdV1;
  readonly dispatchSequence: TaskRequestedEffectSequenceV1;
  readonly attemptGrant: TaskAttemptGrantV1;
}

interface ConnectionOptions {
  readonly connectionString: string;
  readonly options: string | undefined;
}

async function withDeliveryFixture(
  policy: TaskRepairPostgresDeadlinePolicyV1,
  maximumPoolSize: number,
  operation: (
    fixture: DeliveryFixture,
    connectionOptions: ConnectionOptions,
  ) => Promise<void>,
): Promise<void> {
  await withTemporaryPostgresSchema(async (databaseOptions) => {
    const migrationPersistence = await createPostgresPersistence({
      migrationsSchema: databaseOptions.migrationsSchema,
      poolConfig: {
        ...databaseOptions.poolConfig,
        connectionString: databaseOptions.connectionString,
        max: 1,
      },
    });
    try {
      await migrationPersistence.migrate();
    } finally {
      await migrationPersistence.close();
    }
    const poolConfig = success(applyTaskRepairPostgresDeadlinePolicyV1({
      ...databaseOptions.poolConfig,
      connectionString: databaseOptions.connectionString,
      max: maximumPoolSize,
    }, policy));
    const persistence = await createPostgresPersistence({
      migrationsSchema: databaseOptions.migrationsSchema,
      poolConfig,
    });
    try {
      const fixture = await makeFixture(persistence);
      await operation(fixture, Object.freeze({
        connectionString: databaseOptions.connectionString,
        options: databaseOptions.poolConfig.options,
      }));
    } finally {
      await persistence.close();
    }
  });
}

async function makeFixture(persistence: PostgresFlarexPersistence) {
  const parent = await seedRegisteredTaskSystemParentV1(
    persistence,
    "dte06-c2:compute-delivery-repository",
  );
  const seeded = await seedTaskSystemRunAttemptStoreV1(persistence, { parent });
  await persistence.query(`
    delete from fx_system_durable_task_run_v1
    where scope_id = $1
  `, [seeded.scopeId]);
  const candidateSha256 = success(
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
  const lifecycleTarget = createPostgresLocatedTaskSystemRunAttemptTargetV1(
    persistence,
    TASK_LOCATOR,
  );
  const lifecycleLocated = await locatedTaskAuthorityV1(
    persistence.drizzle,
    lifecycleTarget,
    seeded.scopeId,
    seeded.deploymentId,
  );
  const creationStore = makeTaskSystemCreationStoreForTestV1({
    located: lifecycleLocated,
    runtimeBinding,
    creationAuthority,
  }, {
    randomUuid: () => TASK_SYSTEM_CREATION_RUN_UUID_A,
  });
  const created = await runEffect(creationStore.createRun(
    makeTaskSystemCreationRequestV1("delivery-repository-postgres", 0x72),
  ));
  const lifecycleStore = makeTaskSystemRunAttemptStoreV1(lifecycleLocated, {
    randomUuid: () => ACCEPTED_ATTEMPT_UUID,
  });
  const lifecycleLayer = makeLifecycleLayer(lifecycleStore);
  const started = await runEffect(Effect.gen(function* () {
    const lifecycle = yield* RunAttemptLifecycle;
    return yield* lifecycle.startAttempt({
      type: "start_attempt",
      runId: created.runId,
      expectedRunVersion: runVersionOne,
      retryJitter: taskSystemCreationRetryJitterV1,
    });
  }).pipe(Effect.provide(lifecycleLayer)));
  const dispatch = started.requestedEffects.find(
    (item) => item.effect.kind === "dispatch_attempt",
  );
  if (dispatch === undefined) throw new Error("dispatch effect was not emitted");
  if (started.outcome.kind !== "attempt_granted") {
    throw new Error("attempt was not granted");
  }
  const deliveryTarget = createLocatedTaskComputeDeliveryTargetV1(
    persistence.drizzle,
    TASK_LOCATOR,
    createPostgresLocatedReadCommittedTransactionRunnerV1(persistence.pool),
  );
  return Object.freeze({
    persistence,
    deliveryLocated: Object.freeze({
      authority: lifecycleLocated.authority,
      target: deliveryTarget,
    }),
    lifecycleLayer,
    scopeId: seeded.scopeId,
    runId: created.runId,
    dispatchSequence: dispatch.sequence,
    attemptGrant: started.outcome.grant,
  });
}

function makeLifecycleLayer(
  store: ReturnType<typeof makeTaskSystemRunAttemptStoreV1>,
) {
  return RunAttemptLifecycleLive.pipe(
    Layer.provide(Layer.succeed(TaskSystemRunAttemptStore, store)),
  );
}

function repository(
  located: DeliveryFixture["deliveryLocated"],
  claimOwner: string,
  claimDurationMilliseconds = 30_000,
): TaskComputeDeliveryRepositoryV1 {
  return success(makeTaskComputeDeliveryRepositoryV1(located, {
    claimDurationMilliseconds,
    retryDelayMilliseconds: [1_000, 2_000],
    maximumDeliveryAttempts: 3,
    randomUuid: () => claimOwner,
  }));
}

function deliveryLocatedWithRunner(
  fixture: DeliveryFixture,
  runner: RunLocatedReadCommittedTransactionV1,
): DeliveryFixture["deliveryLocated"] {
  return Object.freeze({
    authority: fixture.deliveryLocated.authority,
    target: createLocatedTaskComputeDeliveryTargetV1(
      fixture.persistence.drizzle,
      TASK_LOCATOR,
      runner,
    ),
  });
}

function dispatchRequest(
  fixture: DeliveryFixture,
): Parameters<TaskComputeDeliveryRepositoryV1["acquireDispatch"]>[0] {
  return Object.freeze({
    runId: fixture.runId,
    requestedEffectSequence: fixture.dispatchSequence,
  });
}

function dispatchAcceptance(
  identity: TaskComputeDispatchIdentityV1,
) {
  return success(validateTaskComputeDispatchAcceptanceV1({
    version: TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1,
    kind: "accepted",
    identity,
    execution: {
      provider: "test-provider",
      providerVersion: "postgres-v1",
      executionId: "postgres-execution-1",
    },
  }));
}

async function requestFixtureCancellation(fixture: DeliveryFixture) {
  const result = await runEffect(Effect.gen(function* () {
    const lifecycle = yield* RunAttemptLifecycle;
    return yield* lifecycle.requestCancellation({
      type: "request_cancellation",
      runId: fixture.runId,
      reason: { code: "requested", message: null },
    });
  }).pipe(Effect.provide(fixture.lifecycleLayer)));
  const cancellation = result.requestedEffects.find(
    (item) => item.effect.kind === "request_execution_cancellation",
  );
  if (cancellation === undefined) {
    throw new Error("cancellation effect was not emitted");
  }
  return cancellation.sequence;
}

async function completeFixtureAttempt(fixture: DeliveryFixture) {
  return runEffect(Effect.gen(function* () {
    const lifecycle = yield* RunAttemptLifecycle;
    return yield* lifecycle.completeAttempt({
      type: "complete_attempt",
      runId: fixture.runId,
      attemptId: fixture.attemptGrant.attempt.attemptId,
      executionFence: fixture.attemptGrant.attempt.executionFence,
      completion: {
        kind: "succeeded",
        result: null,
        executionDurationMs: null,
      },
    });
  }).pipe(Effect.provide(fixture.lifecycleLayer)));
}

async function readDispatchClaim(fixture: DeliveryFixture) {
  const result = await fixture.persistence.query<{
    claim_owner: string | null;
    claim_fence: string;
    claim_expires_at_ms: string;
    delivery_state: string;
    delivery_attempt_count: string;
  }>(`
    select claim_owner::text, claim_fence::text,
           floor(extract(epoch from claim_expires_at) * 1000)::bigint::text
             as claim_expires_at_ms,
           delivery_state, delivery_attempt_count::text
    from fx_system_durable_task_compute_dispatch_v1
    where scope_id = $1 and run_id = $2
      and requested_effect_sequence = $3
  `, [fixture.scopeId, fixture.runId, fixture.dispatchSequence]);
  const row = result.rows[0];
  if (row === undefined) throw new Error("dispatch checkpoint is missing");
  return row;
}

async function dispatchCheckpointCount(fixture: DeliveryFixture) {
  const result = await fixture.persistence.query<{ count: number }>(`
    select count(*)::int as count
    from fx_system_durable_task_compute_dispatch_v1
    where scope_id = $1 and run_id = $2
      and requested_effect_sequence = $3
  `, [fixture.scopeId, fixture.runId, fixture.dispatchSequence]);
  return result.rows[0]?.count ?? -1;
}

async function waitForDispatchClaimExpiry(fixture: DeliveryFixture) {
  const claim = await readDispatchClaim(fixture);
  const expiry = Number(claim.claim_expires_at_ms);
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await fixture.persistence.query<{ database_now_ms: string }>(`
      select floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
        as database_now_ms
    `);
    if (Number(result.rows[0]?.database_now_ms ?? "0") >= expiry) return;
    await delay(5);
  }
  throw new Error("timed out waiting for the dispatch claim to expire");
}

async function installLifecycleBarrier(
  persistence: PostgresFlarexPersistence,
) {
  await persistence.query(`
    create function fx_test_dte06_c2_lifecycle_barrier()
    returns trigger
    language plpgsql
    as $function$
    begin
      if new.phase = 'terminal' then
        perform pg_advisory_xact_lock(${LIFECYCLE_BARRIER_LOCK});
      end if;
      return new;
    end
    $function$
  `);
  await persistence.query(`
    create trigger fx_test_dte06_c2_lifecycle_barrier
    before update on fx_system_durable_task_run_v1
    for each row execute function fx_test_dte06_c2_lifecycle_barrier()
  `);
}

async function installAcceptanceBarrier(
  persistence: PostgresFlarexPersistence,
) {
  await persistence.query(`
    create function fx_test_dte06_c2_acceptance_barrier()
    returns trigger
    language plpgsql
    as $function$
    begin
      if new.delivery_state = 'accepted' then
        perform pg_advisory_xact_lock(${ACCEPTANCE_BARRIER_LOCK});
      end if;
      return new;
    end
    $function$
  `);
  await persistence.query(`
    create trigger fx_test_dte06_c2_acceptance_barrier
    before update on fx_system_durable_task_compute_dispatch_v1
    for each row execute function fx_test_dte06_c2_acceptance_barrier()
  `);
}

async function withAdvisoryBlocker(
  persistence: PostgresFlarexPersistence,
  connectionOptions: ConnectionOptions,
  lock: number,
  operation: (
    blockerPid: number,
    release: () => Promise<void>,
  ) => Promise<void>,
): Promise<void> {
  const blocker = new Client(connectionOptions);
  await blocker.connect();
  let primaryFailure: unknown;
  let released = false;
  const release = async () => {
    if (released) return;
    const result = await blocker.query<{ unlocked: boolean }>(
      "select pg_advisory_unlock($1::bigint) as unlocked",
      [lock],
    );
    if (result.rows[0]?.unlocked !== true) {
      throw new Error(`PostgreSQL advisory lock ${lock} was not held`);
    }
    released = true;
  };
  try {
    await blocker.query("select pg_advisory_lock($1::bigint)", [lock]);
    const blockerPid = await clientBackendPid(blocker);
    await operation(blockerPid, release);
  } catch (cause) {
    primaryFailure = cause;
    throw cause;
  } finally {
    const unlockFailure = released
      ? undefined
      : await release().then(() => undefined, (cause: unknown) => cause);
    await blocker.end();
    if (primaryFailure === undefined && unlockFailure !== undefined) {
      throw unlockFailure;
    }
  }
}

async function waitForBlockedTransactions(
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
  throw new Error(`timed out waiting for ${expectedCount} blocked transactions`);
}

async function installLongDispatchStatement(
  persistence: PostgresFlarexPersistence,
) {
  await persistence.query(`
    create function fx_test_dte06_c2_long_dispatch_statement()
    returns trigger
    language plpgsql
    as $function$
    begin
      perform pg_sleep(2);
      return new;
    end
    $function$
  `);
  await persistence.query(`
    create trigger fx_test_dte06_c2_long_dispatch_statement
    before insert on fx_system_durable_task_compute_dispatch_v1
    for each row execute function fx_test_dte06_c2_long_dispatch_statement()
  `);
}

async function removeLongDispatchStatement(
  persistence: PostgresFlarexPersistence,
) {
  await persistence.query(`
    drop trigger fx_test_dte06_c2_long_dispatch_statement
    on fx_system_durable_task_compute_dispatch_v1
  `);
  await persistence.query(
    "drop function fx_test_dte06_c2_long_dispatch_statement()",
  );
}

async function backendPid(
  persistence: PostgresFlarexPersistence,
): Promise<number> {
  const result = await persistence.query<{ pid: number }>(
    "select pg_backend_pid()::int as pid",
  );
  const pid = result.rows[0]?.pid;
  if (typeof pid !== "number") throw new Error("PostgreSQL PID is missing");
  return pid;
}

async function clientBackendPid(
  client: Pick<PoolClient, "query">,
): Promise<number> {
  const result = await client.query<{ pid: number }>(
    "select pg_backend_pid()::int as pid",
  );
  const pid = result.rows[0]?.pid;
  if (typeof pid !== "number") throw new Error("PostgreSQL PID is missing");
  return pid;
}

function settle<Value>(
  promise: Promise<Value>,
): Promise<Result.Result<Value, unknown>> {
  return promise.then(Result.succeed, Result.fail);
}

function postgresCode(cause: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current = cause;
  while (current !== null && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (!isNonArrayRecord(current)) return undefined;
    const code = Reflect.get(current, "code");
    if (typeof code === "string") return code;
    current = Reflect.get(current, "cause");
  }
  return undefined;
}

function success<Success, Failure>(
  result: Result.Result<Success, Failure>,
): Success {
  return Result.getOrThrow(result);
}
