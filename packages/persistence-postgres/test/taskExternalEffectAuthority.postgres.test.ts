import { setTimeout as delay } from "node:timers/promises";

import { isNonArrayRecord } from "@flarex/utils/records";
import {
  decideApplicationStartAttemptV1,
  decodeTaskCancellationGenerationV1,
  decodeTaskDurationMsV1,
  decodeTaskRequestedEffectSequenceV1,
  decodeTaskRetryJitterV1,
  decodeTaskRunVersionV1,
  type ApplicationTaskAttemptGrantV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  decodeApplicationTaskRunCreationRequestV1,
  makeTaskExecutionPrincipalReferenceV1,
  makeTaskInputReferenceV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  makeStandardApplicationTaskSha256V1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { Effect, Result } from "effect";
import { ReplacementScopeIdV1Schema } from
  "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import {
  makeApplicationTaskSystemRunCreationStore,
} from "../src/applicationTaskSystemRunCreation";
import { selectApplicationTask } from "../src/applicationTaskSelection";
import {
  createPostgresLocatedTaskSystemRunAttemptTargetV1,
} from "../src/postgres";
import {
  createPostgresTaskExternalEffectAuthorityResource,
} from "../src/postgresTaskExternalEffectAuthority";
import { createTaskAttemptLifecycleGateway } from
  "../src/taskAttemptLifecycleGateway";
import {
  createLocatedTaskExternalEffectAuthorityTarget,
  issueApplicationTaskExternalEffectSubject,
  prepareTaskChildMutationEffect,
  type TaskExternalEffectAuthorityHashContext,
} from "../src/taskExternalEffectAuthority";
import {
  makeApplicationTaskSystemRunAttemptStoreV1,
} from "../src/taskSystemRunAttemptStoreV1";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  createApplicationNativeMutationPostgresFixture,
} from "./fixtures/applicationNativeMutationTestFixture";
import {
  postgresUrl,
  withTemporaryPostgresPersistencePair,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const DEADLINE_POLICY = Object.freeze({
  connectionTimeoutMilliseconds: 500,
  lockTimeoutMilliseconds: 5_000,
  statementTimeoutMilliseconds: 10_000,
  transactionTimeoutMilliseconds: 20_000,
  settlementReserveMilliseconds: 25_000,
});
const SETTLED_DEADLINE_POLICY = Object.freeze({
  connectionTimeoutMilliseconds: 250,
  lockTimeoutMilliseconds: 150,
  statementTimeoutMilliseconds: 500,
  transactionTimeoutMilliseconds: 1_000,
  settlementReserveMilliseconds: 1_500,
});

describePostgres(
  "DTE06-F0b Task external-effect lease lock race on PostgreSQL",
  { timeout: 180_000 },
  () => {
    it("rejects a transaction that began before expiry but acquired the run lock after expiry", async () => {
      await withTemporaryPostgresPersistencePair(async (control, target) => {
        const setup = await makeExecutingApplicationTask(control, target);
        const leaseRows = await target.query<{ expires_at_ms: string }>(
          `select current_lease_expires_at_ms::text as expires_at_ms
             from fx_system_durable_task_run_v1
            where scope_id = $1 and run_id = $2`,
          [setup.context.authority.scopeId, setup.dispatch.identity.runId],
        );
        const expiresAtMs = Number(leaseRows.rows[0]?.expires_at_ms);
        expect(Number.isSafeInteger(expiresAtMs)).toBe(true);

        const blocker = await target.pool.connect();
        let blockerReleased = false;
        let operation: Promise<unknown> | undefined;
        try {
          await blocker.query("begin");
          await blocker.query(
            `select 1 from fx_system_durable_task_run_v1
              where scope_id = $1 and run_id = $2 for update`,
            [setup.context.authority.scopeId, setup.dispatch.identity.runId],
          );
          const blockerPidRows = await blocker.query<{ pid: number }>(
            "select pg_backend_pid()::int as pid",
          );
          const blockerPid = blockerPidRows.rows[0]?.pid;
          if (blockerPid === undefined) {
            throw new Error("Expected the blocker backend PID.");
          }

          operation = runEffectFailure(prepareTaskChildMutationEffect(
            setup.subject,
            Object.freeze({
              effectOrdinal: 1n,
              requestIdentitySha256: digest(0xa1),
              functionPath: "users:write",
              argumentsSha256: digest(0xa2),
            }),
            setup.context,
          ));
          const transactionStartedAtMs = await waitForBlockedRunLock(
            target,
            blockerPid,
          );
          expect(transactionStartedAtMs).toBeLessThan(expiresAtMs);
          await waitForDatabaseTime(target, expiresAtMs);
          await blocker.query("commit");
          blocker.release();
          blockerReleased = true;

          await expect(operation).resolves.toMatchObject({
            _tag: "TaskExternalEffectAuthorityStaleError",
            reason: "lease",
          });
          const evidenceRows = await target.query<{ count: string }>(
            `select count(*)::text as count
               from fx_system_external_effect_attempt_v1
              where scope_id = $1`,
            [setup.context.authority.scopeId],
          );
          expect(evidenceRows.rows[0]?.count).toBe("0");
        } finally {
          if (!blockerReleased) {
            await blocker.query("rollback").catch(() => undefined);
            blocker.release();
          }
          if (operation !== undefined) await operation;
        }
      });
    });

    it("settles a server lock timeout, releases the client, and safely reuses the bounded pool", async () => {
      await withTemporaryPostgresPersistencePair(async (control, target) => {
        const setup = await makeExecutingApplicationTask(control, target);
        const resource = Result.getOrThrow(
          createPostgresTaskExternalEffectAuthorityResource(
            {
              connectionString: target.pool.options.connectionString,
              options: target.pool.options.options,
              max: 1,
            },
            setup.context.authority.physicalLocator,
            SETTLED_DEADLINE_POLICY,
          ),
        );
        const context = Object.freeze({
          ...setup.context,
          target: resource.target,
        });
        const subject = await runEffect(
          issueApplicationTaskExternalEffectSubject(setup.dispatch, context),
        );
        const blocker = await target.pool.connect();
        let blockerReleased = false;
        try {
          await blocker.query("begin");
          await blocker.query(
            `select 1 from fx_system_durable_task_run_v1
              where scope_id = $1 and run_id = $2 for update`,
            [context.authority.scopeId, setup.dispatch.identity.runId],
          );

          const startedAt = performance.now();
          const failure = await runEffectFailure(
            prepareTaskChildMutationEffect(
              subject,
              Object.freeze({
                effectOrdinal: 1n,
                requestIdentitySha256: digest(0xc1),
                functionPath: "users:write",
                argumentsSha256: digest(0xc2),
              }),
              context,
            ),
          );
          expect(performance.now() - startedAt).toBeLessThan(
            SETTLED_DEADLINE_POLICY.settlementReserveMilliseconds,
          );
          expect(postgresCode(failure)).toBe("55P03");
          expect(resource.pool.waitingCount).toBe(0);
          expect(resource.pool.totalCount).toBe(1);
          expect(resource.pool.idleCount).toBe(1);

          await blocker.query("rollback");
          blocker.release();
          blockerReleased = true;

          await expect(runEffect(prepareTaskChildMutationEffect(
            subject,
            Object.freeze({
              effectOrdinal: 1n,
              requestIdentitySha256: digest(0xc1),
              functionPath: "users:write",
              argumentsSha256: digest(0xc2),
            }),
            context,
          ))).resolves.toMatchObject({
            disposition: "applied",
            effect: { state: "prepared" },
          });
          expect(resource.pool.waitingCount).toBe(0);
          expect(resource.pool.totalCount).toBe(1);
          expect(resource.pool.idleCount).toBe(1);
        } finally {
          if (!blockerReleased) {
            await blocker.query("rollback").catch(() => undefined);
            blocker.release();
          }
          await resource.close();
        }
      });
    });
  },
);

async function makeExecutingApplicationTask(
  control: Parameters<typeof createApplicationNativeMutationPostgresFixture>[1]["control"],
  target: Parameters<typeof createApplicationNativeMutationPostgresFixture>[1]["target"],
) {
  const runtimeHostIdentity = "flarex.test/task-effect-lease-postgres";
  const compatibilityDate = "2026-08-20";
  const fixture = await createApplicationNativeMutationPostgresFixture({
    runtimeHostIdentity,
    compatibilityDate,
    includeTask: true,
  }, { control, target });
  const selected = await runEffect(selectApplicationTask(
    fixture.active.selection,
    "tasks.users.task",
    {
      deploymentId: fixture.deploymentId,
      runtimeHostIdentity,
      compatibilityDate,
      authority: fixture.authorityPorts,
    },
  ));
  const lifecycleTarget = createPostgresLocatedTaskSystemRunAttemptTargetV1(
    target,
    fixture.active.basis.authority.physicalLocator,
  );
  const located = Object.freeze({
    authority: fixture.active.basis.authority,
    target: lifecycleTarget,
  });
  const creation = makeApplicationTaskSystemRunCreationStore(located, {
    sha256: makeStandardApplicationTaskSha256V1(input =>
      globalThis.crypto.subtle.digest("SHA-256", input)
    ),
    leaseDurationMs: Result.getOrThrow(decodeTaskDurationMsV1(2_000)),
    immediateRetryThresholdMs: Result.getOrThrow(decodeTaskDurationMsV1(250)),
    randomUuid: uuidSequence(40),
  });
  const created = await runEffect(creation.createRun(
    selected.selection,
    Result.getOrThrow(decodeApplicationTaskRunCreationRequestV1({
      version: 1,
      requestKey: "task-effect-lease-postgres",
      applicationTaskRuntimeTargetSha256: selected.metadata.runtimeTargetSha256,
      input: Result.getOrThrow(makeTaskInputReferenceV1(digest(0xb1), 19)),
      principal: Result.getOrThrow(
        makeTaskExecutionPrincipalReferenceV1(digest(0xb2), 23),
      ),
    })),
  ));
  const store = makeApplicationTaskSystemRunAttemptStoreV1(located, {
    randomUuid: uuidSequence(50),
  });
  const started = await runEffect(store.transactRunAttempt({
    operation: "start_attempt",
    runId: created.runId,
    decide: input => decideApplicationStartAttemptV1({
      type: "start_attempt",
      runId: created.runId,
      expectedRunVersion: Result.getOrThrow(decodeTaskRunVersionV1("1")),
      retryJitter: Result.getOrThrow(decodeTaskRetryJitterV1(0.5)),
    }, input),
  }));
  if (started.outcome.kind !== "attempt_granted") {
    throw new Error("Expected an Application attempt grant.");
  }
  const dispatch = applicationDispatch(
    started.outcome.grant,
    fixture.active.basis.authority.scopeId,
  );
  const context = Object.freeze({
    target: Result.getOrThrow(createLocatedTaskExternalEffectAuthorityTarget(
      target.drizzle,
      fixture.active.basis.authority.physicalLocator,
      DEADLINE_POLICY,
    )),
    authority: fixture.active.basis.authority,
    sha256: Object.freeze({
      hash: (bytes: Uint8Array) => Effect.promise(async () =>
        new Uint8Array(await globalThis.crypto.subtle.digest(
          "SHA-256",
          bytes.slice().buffer,
        ))
      ),
    }),
  } satisfies TaskExternalEffectAuthorityHashContext<never>);
  const subject = await runEffect(issueApplicationTaskExternalEffectSubject(
    dispatch,
    context,
  ));
  const gateway = createTaskAttemptLifecycleGateway({
    scopeMetadata: fixture.authorityPorts.scopeMetadata,
    provisioningReceipts: fixture.authorityPorts.provisioningReceipts,
    scopeClockTargets: { resolve: async () => lifecycleTarget },
  });
  const lifecycle = await runEffect(gateway.resolve(
    fixture.deploymentId,
    dispatch,
  ));
  if (lifecycle.generation !== "application_v1") {
    throw new Error("Expected an Application lifecycle capability.");
  }
  await runEffect(lifecycle.heartbeat(1));
  return Object.freeze({ fixture, dispatch, context, subject });
}

function applicationDispatch(
  grant: ApplicationTaskAttemptGrantV1,
  scopeId: string,
) {
  return Object.freeze({
    version: "flarex.task-compute-dispatch-request.v1" as const,
    identity: Object.freeze({
      version: "flarex.task-compute-dispatch-identity.v1" as const,
      scopeId: ReplacementScopeIdV1Schema.make(scopeId),
      runId: grant.runId,
      requestedEffectSequence: Result.getOrThrow(
        decodeTaskRequestedEffectSequenceV1("1"),
      ),
      attemptId: grant.attempt.attemptId,
      executionFence: grant.attempt.executionFence,
    }),
    applicationTaskRuntimeTargetSha256:
      grant.applicationTaskRuntimeTargetSha256,
    attemptNumber: grant.attempt.attemptNumber,
    leaseVersion: grant.lease.version,
    computeProfile: grant.computeProfile,
    cancellation: Object.freeze({
      kind: "not_requested" as const,
      generation: Result.getOrThrow(decodeTaskCancellationGenerationV1("0")),
    }),
    maximumDurationMs: Result.getOrThrow(decodeTaskDurationMsV1(300_000)),
  });
}

async function waitForBlockedRunLock(
  target: Parameters<typeof createApplicationNativeMutationPostgresFixture>[1]["target"],
  blockerPid: number,
): Promise<number> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await target.query<{ xact_start_ms: string }>(
      `select floor(extract(epoch from activity.xact_start) * 1000)::bigint::text
                as xact_start_ms
         from pg_stat_activity as activity
        where $1::int = any(pg_blocking_pids(activity.pid))
          and activity.wait_event_type = 'Lock'
        limit 1`,
      [blockerPid],
    );
    const xactStartMs = Number(result.rows[0]?.xact_start_ms);
    if (Number.isSafeInteger(xactStartMs)) return xactStartMs;
    await delay(20);
  }
  throw new Error("Timed out waiting for the Task run lock race.");
}

async function waitForDatabaseTime(
  target: Parameters<typeof createApplicationNativeMutationPostgresFixture>[1]["target"],
  expiresAtMs: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await target.query<{ now_ms: string }>(
      `select floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
                as now_ms`,
    );
    if (Number(result.rows[0]?.now_ms) >= expiresAtMs) return;
    await delay(20);
  }
  throw new Error("Timed out waiting for the Task lease to expire.");
}

function digest(seed: number): Uint8Array {
  return new Uint8Array(32).fill(seed);
}

function uuidSequence(offset: number): () => string {
  let next = offset;
  return () =>
    `75000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
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
