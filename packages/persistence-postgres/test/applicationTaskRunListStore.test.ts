import {
  decodeApplicationTaskRunCreationRequestV1,
  makeTaskExecutionPrincipalReferenceV1,
  makeTaskInputReferenceV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  decideApplicationStartAttemptV1,
  decideApplicationRequestCancellationV1,
  decodeTaskCancellationGenerationV1,
  decodeTaskDurationMsV1,
  decodeTaskRequestedEffectSequenceV1,
  decodeTaskRetryJitterV1,
  decodeTaskRunIdV1,
  decodeTaskRunVersionV1,
  type ApplicationTaskAttemptGrantV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { makeStandardApplicationTaskSha256V1 } from
  "@flarex/standard-application-definition/internal/task-definition-v1";
import {
  ReplacementScopeIdV1Schema,
  ScopeEpochSchema,
} from "flarex-protocol/storage-authority";
import { eq, sql } from "drizzle-orm";
import { Cause, Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import { makeApplicationTaskRunListStore } from
  "../src/applicationTaskRunListStore";
import { makeApplicationTaskSystemRunCreationStore } from
  "../src/applicationTaskSystemRunCreation";
import { selectApplicationTask } from "../src/applicationTaskSelection";
import {
  createPGliteLocatedTaskSystemRunAttemptTargetV1,
} from "../src/pglite";
import { fxSystemDurableTaskRunsV1, fxSystemScopeClocks } from "../src/schema";
import { createTaskAttemptLifecycleGateway } from
  "../src/taskAttemptLifecycleGateway";
import { makeApplicationTaskSystemRunAttemptStoreV1 } from
  "../src/taskSystemRunAttemptStoreV1";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
} from "../src/transactionSessionAttemptKernel";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  createApplicationNativeMutationPGliteFixture,
} from "./fixtures/applicationNativeMutationTestFixture";

const RUN_UUID_A = "73000000-0000-4000-8000-000000000001";
const RUN_UUID_B = "73000000-0000-4000-8000-000000000002";
const RUN_UUID_C = "73000000-0000-4000-8000-000000000003";
const RUN_UUID_D = "73000000-0000-4000-8000-000000000004";
const RUN_UUID_E = "73000000-0000-4000-8000-000000000005";
const CREATED_AT_MS = 5_000;
const RUNTIME_HOST_IDENTITY = "flarex.test/dte07-task-run-list";
const COMPATIBILITY_DATE = "2026-08-30";
const sha256 = makeStandardApplicationTaskSha256V1(input =>
  globalThis.crypto.subtle.digest("SHA-256", input)
);
const leaseDurationMs = Result.getOrThrow(decodeTaskDurationMsV1(30_000));
const immediateRetryThresholdMs = Result.getOrThrow(
  decodeTaskDurationMsV1(5_000),
);

describe("DTE07 located Application Task-run list store - PGlite", () => {
  it("uses deterministic bounded keyset pages and excludes newer inserts", async () => {
    await withFixture(async fixture => {
      await createRuns(fixture, [RUN_UUID_A, RUN_UUID_B, RUN_UUID_C]);
      await setCreatedAt(fixture, [RUN_UUID_A, RUN_UUID_B, RUN_UUID_C]);
      const seeded = await fixture.persistence.drizzle.select({
        runId: fxSystemDurableTaskRunsV1.runId,
        generation: fxSystemDurableTaskRunsV1.definitionGeneration,
        createdAtMs: fxSystemDurableTaskRunsV1.createdAtMs,
      }).from(fxSystemDurableTaskRunsV1);
      expect(seeded).toHaveLength(3);

      const store = makeApplicationTaskRunListStore(fixture.located);
      const first = await runEffect(store.listRuns({
        pageSize: 2,
        cursor: null,
      }));
      expect(first.runs.map(run => run.runId)).toEqual([
        `run_${RUN_UUID_C}`,
        `run_${RUN_UUID_B}`,
      ]);
      expect(first.hasMore).toBe(true);
      expect(first.observedAtMs).toBeGreaterThanOrEqual(CREATED_AT_MS);
      expect(first.runs.map(run => run.state)).toEqual([
        {
          kind: "ready",
          eligibleAtMs: CREATED_AT_MS,
          retry: null,
          cancellation: { kind: "not_requested" },
        },
        {
          kind: "ready",
          eligibleAtMs: CREATED_AT_MS,
          retry: null,
          cancellation: { kind: "not_requested" },
        },
      ]);

      await createRuns(fixture, [RUN_UUID_D]);
      const last = first.runs.at(-1);
      expect(last).toBeDefined();
      const second = await runEffect(store.listRuns({
        pageSize: 2,
        cursor: {
          version: 1,
          createdAtMs: last!.createdAtMs,
          runId: last!.runId,
        },
      }));
      expect(second.hasMore).toBe(false);
      expect(second.runs.map(run => run.runId)).toEqual([
        `run_${RUN_UUID_A}`,
      ]);
    });
  });

  it("maps stale authority and malformed compact state to typed failures", async () => {
    await withFixture(async fixture => {
      await createRuns(fixture, [RUN_UUID_A]);
      const store = makeApplicationTaskRunListStore(fixture.located);
      await fixture.persistence.drizzle.update(fxSystemScopeClocks).set({
        epoch: ScopeEpochSchema.make(
          "epoch_73000000-0000-4000-8000-000000000099",
        ),
      }).where(eq(
        fxSystemScopeClocks.scopeId,
        fixture.located.authority.scopeId,
      ));
      await expect(runEffectFailure(store.listRuns({
        pageSize: 1,
        cursor: null,
      }))).resolves.toMatchObject({
        _tag: "TaskRunListStoreError",
        operation: "list_task_runs",
        reason: "stale_scope_authority",
      });
    });

    await withFixture(async fixture => {
      await createRuns(fixture, [RUN_UUID_A]);
      await fixture.persistence.drizzle.update(fxSystemDurableTaskRunsV1).set({
        aggregateJson: sql`jsonb_set(
          ${fxSystemDurableTaskRunsV1.aggregateJson},
          '{aggregate,ready,eligibleAtMs}',
          '"invalid"'::jsonb
        )`,
      }).where(sql`${fxSystemDurableTaskRunsV1.runId} = ${`run_${RUN_UUID_A}`}`);
      const [corrupted] = await fixture.persistence.drizzle.select({
        eligibleAtMs: sql<unknown>`${fxSystemDurableTaskRunsV1.aggregateJson}
          #> '{aggregate,ready,eligibleAtMs}'`,
      }).from(fxSystemDurableTaskRunsV1);
      expect(corrupted?.eligibleAtMs).toBe("invalid");
      const store = makeApplicationTaskRunListStore(fixture.located);
      await expect(runEffectFailure(store.listRuns({
        pageSize: 1,
        cursor: null,
      }))).resolves.toMatchObject({
        _tag: "TaskRunListStoreError",
        operation: "list_task_runs",
        reason: "corrupt_data",
      });
    });

    await withFixture(async fixture => {
      await createRuns(fixture, [RUN_UUID_A]);
      await fixture.persistence.drizzle.update(fxSystemDurableTaskRunsV1).set({
        aggregateJson: sql`jsonb_set(
          ${fxSystemDurableTaskRunsV1.aggregateJson},
          '{codec}',
          '"unsupported.task-run-codec"'::jsonb
        )`,
      });
      const store = makeApplicationTaskRunListStore(fixture.located);
      await expect(runEffectFailure(store.listRuns({
        pageSize: 1,
        cursor: null,
      }))).resolves.toMatchObject({
        _tag: "TaskRunListStoreError",
        reason: "corrupt_data",
      });
    });
  });

  it("classifies lock timeout and cleanup failure without losing typed recovery", async () => {
    await withFixture(async fixture => {
      const lockTimeout = Object.freeze({ code: "55P03" });
      const base = fixture.located.target;
      const timedOut = makeApplicationTaskRunListStore(Object.freeze({
        authority: fixture.located.authority,
        target: Object.freeze({
          physicalLocator: base.physicalLocator,
          getCurrentClock: base.getCurrentClock,
          [RUN_LOCATED_READ_COMMITTED_V1]: <Value>(): Promise<Value> =>
            Promise.reject(new LocatedReadCommittedTransactionFailureV1(
              Object.freeze({
                kind: "callbackRolledBack",
                callbackCause: lockTimeout,
              }),
            )),
        }),
      }));
      await expect(runEffectFailure(timedOut.listRuns({
        pageSize: 1,
        cursor: null,
      }))).resolves.toMatchObject({
        _tag: "TaskRunListStoreError",
        reason: "transient",
      });

      const cleanupFailed = makeApplicationTaskRunListStore(Object.freeze({
        authority: fixture.located.authority,
        target: Object.freeze({
          physicalLocator: base.physicalLocator,
          getCurrentClock: base.getCurrentClock,
          [RUN_LOCATED_READ_COMMITTED_V1]: <Value>(): Promise<Value> =>
            Promise.reject(new LocatedReadCommittedTransactionFailureV1(
              Object.freeze({
                kind: "callbackCleanupFailed",
                callbackCause: lockTimeout,
                transactionCause: new Error("rollback failed"),
              }),
            )),
        }),
      }));
      const exit = await runEffect(Effect.exit(cleanupFailed.listRuns({
        pageSize: 1,
        cursor: null,
      })));
      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        const failure = Result.match(Cause.findError(exit.cause), {
          onFailure: () => null,
          onSuccess: value => value,
        });
        expect(failure).toMatchObject({
          _tag: "TaskRunListStoreError",
          reason: "transient",
        });
      }
    });
  });

  it("decodes active and successful result projections without loading histories", async () => {
    await withFixture(async fixture => {
      await createRuns(fixture, [RUN_UUID_A]);
      const runId = Result.getOrThrow(decodeTaskRunIdV1(`run_${RUN_UUID_A}`));
      const attempts = makeApplicationTaskSystemRunAttemptStoreV1(
        fixture.located,
        { randomUuid: () => RUN_UUID_D },
      );
      const started = await runEffect(attempts.transactRunAttempt({
        operation: "start_attempt",
        runId,
        decide: input => decideApplicationStartAttemptV1({
          type: "start_attempt",
          runId,
          expectedRunVersion: Result.getOrThrow(
            decodeTaskRunVersionV1("1"),
          ),
          retryJitter: Result.getOrThrow(decodeTaskRetryJitterV1(0.5)),
        }, input),
      }));
      if (started.outcome.kind !== "attempt_granted") {
        throw new Error("Expected the Application attempt to start.");
      }
      const listStore = makeApplicationTaskRunListStore(fixture.located);
      const granted = await runEffect(listStore.listRuns({
        pageSize: 1,
        cursor: null,
      }));
      expect(granted.runs[0]?.state).toMatchObject({
        kind: "attempt_granted",
        attempt: {
          attemptNumber: 1,
          computeProfile: "standard-1x",
        },
        cancellation: { kind: "not_requested" },
      });

      const gateway = createTaskAttemptLifecycleGateway({
        scopeMetadata: fixture.host.authorityPorts.scopeMetadata,
        provisioningReceipts:
          fixture.host.authorityPorts.provisioningReceipts,
        scopeClockTargets: { resolve: async () => fixture.located.target },
      });
      const capability = await runEffect(gateway.resolve(
        fixture.host.deploymentId,
        applicationDispatch(
          started.outcome.grant,
          fixture.located.authority.scopeId,
        ),
      ));
      if (capability.generation !== "application_v1") {
        throw new Error("Expected an Application lifecycle capability.");
      }
      await runEffect(capability.heartbeat(1));
      const executing = await runEffect(listStore.listRuns({
        pageSize: 1,
        cursor: null,
      }));
      expect(executing.runs[0]?.state.kind).toBe("executing");

      await runEffect(capability.complete({
        kind: "succeeded",
        result: {
          codec: "flarex.task-result.v1",
          byteLength: 19,
          sha256: new Uint8Array(32).fill(0x44),
        },
        executionDurationMs: 25,
      }));
      const completed = await runEffect(listStore.listRuns({
        pageSize: 1,
        cursor: null,
      }));
      expect(completed.runs[0]?.state).toMatchObject({
        kind: "succeeded",
        attemptNumber: 1,
        executionDurationMs: 25,
        result: {
          codec: "flarex.task-result.v1",
          byteLength: 19,
          sha256Hex: "44".repeat(32),
        },
        cancellation: { kind: "not_requested" },
      });
    });
  });

  it("decodes retry, failure, and cancellation lifecycle branches", async () => {
    await withFixture(async fixture => {
      const immediate = await startApplicationRun(
        fixture,
        RUN_UUID_A,
        "74000000-0000-4000-8000-000000000001",
      );
      await runEffect(immediate.capability.heartbeat(1));
      await runEffect(immediate.capability.complete({
        kind: "failed",
        failure: {
          kind: "task_failure",
          code: "handler_failed",
          message: null,
        },
        retry: { kind: "override_delay", delayMs: 1 },
        executionDurationMs: 11,
      }));

      const waiting = await startApplicationRun(
        fixture,
        RUN_UUID_B,
        "74000000-0000-4000-8000-000000000002",
      );
      await runEffect(waiting.capability.heartbeat(1));
      await runEffect(waiting.capability.complete({
        kind: "failed",
        failure: {
          kind: "system_failure",
          code: "provider_failure",
          message: null,
        },
        retry: { kind: "override_delay", delayMs: 6_000 },
        executionDurationMs: null,
      }));

      const failed = await startApplicationRun(
        fixture,
        RUN_UUID_C,
        "74000000-0000-4000-8000-000000000003",
      );
      await runEffect(failed.capability.heartbeat(1));
      await runEffect(failed.capability.complete({
        kind: "failed",
        failure: {
          kind: "resource_exhaustion",
          code: "out_of_memory",
          message: null,
        },
        retry: { kind: "do_not_retry" },
        executionDurationMs: 17,
      }));

      const acknowledged = await startApplicationRun(
        fixture,
        RUN_UUID_D,
        "74000000-0000-4000-8000-000000000004",
      );
      await runEffect(acknowledged.store.transactRunAttempt({
        operation: "request_cancellation",
        runId: acknowledged.runId,
        decide: input => decideApplicationRequestCancellationV1({
          type: "request_cancellation",
          runId: acknowledged.runId,
          reason: { code: "requested", message: null },
        }, input),
      }));
      const listStore = makeApplicationTaskRunListStore(fixture.located);
      const requested = await runEffect(listStore.listRuns({
        pageSize: 10,
        cursor: null,
      }));
      expect(requested.runs.find(run => run.runId === acknowledged.runId)?.state)
        .toMatchObject({
          kind: "attempt_granted",
          cancellation: {
            kind: "requested",
            code: "requested",
          },
        });
      await runEffect(acknowledged.capability.complete({
        kind: "cancellation_acknowledged",
        cancellationGeneration: "1",
        executionDurationMs: 19,
      }));

      await createRuns(fixture, [RUN_UUID_E]);
      const withoutAttemptRunId = Result.getOrThrow(
        decodeTaskRunIdV1(`run_${RUN_UUID_E}`),
      );
      const withoutAttempt = makeApplicationTaskSystemRunAttemptStoreV1(
        fixture.located,
      );
      await runEffect(withoutAttempt.transactRunAttempt({
        operation: "request_cancellation",
        runId: withoutAttemptRunId,
        decide: input => decideApplicationRequestCancellationV1({
          type: "request_cancellation",
          runId: withoutAttemptRunId,
          reason: { code: "policy_cancelled", message: null },
        }, input),
      }));

      const page = await runEffect(listStore.listRuns({
        pageSize: 10,
        cursor: null,
      }));
      const states = new Map(page.runs.map(run => [run.runId, run.state]));
      expect(states.get(immediate.runId)).toMatchObject({
        kind: "ready",
        retry: {
          previousAttemptNumber: 1,
          cause: {
            kind: "failed_completion",
            failure: { kind: "task_failure", code: "handler_failed" },
          },
        },
      });
      expect(states.get(waiting.runId)).toMatchObject({
        kind: "retry_waiting",
        retry: {
          previousAttemptNumber: 1,
          cause: {
            kind: "failed_completion",
            failure: { kind: "system_failure", code: "provider_failure" },
          },
        },
      });
      expect(states.get(failed.runId)).toMatchObject({
        kind: "failed",
        attemptNumber: 1,
        executionDurationMs: 17,
        failure: { kind: "resource_exhaustion", code: "out_of_memory" },
        cancellation: { kind: "not_requested" },
      });
      expect(states.get(acknowledged.runId)).toMatchObject({
        kind: "cancelled",
        attemptNumber: 1,
        executionDurationMs: 19,
        cancellation: {
          kind: "resolved",
          code: "requested",
          resolution: "acknowledged",
        },
      });
      expect(states.get(withoutAttemptRunId)).toMatchObject({
        kind: "cancelled",
        attemptNumber: null,
        executionDurationMs: null,
        cancellation: {
          kind: "resolved",
          code: "policy_cancelled",
          resolution: "without_active_attempt",
        },
      });
    });
  });
});

async function withFixture(
  run: (fixture: Awaited<ReturnType<typeof makeFixture>>) => Promise<void>,
): Promise<void> {
  await run(await makeFixture());
}

async function makeFixture() {
  const fixture = await createApplicationNativeMutationPGliteFixture({
    runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
    compatibilityDate: COMPATIBILITY_DATE,
    includeTask: true,
  });
  const selected = await runEffect(selectApplicationTask(
    fixture.active.selection,
    "tasks.users.task",
    {
      deploymentId: fixture.deploymentId,
      runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
      compatibilityDate: COMPATIBILITY_DATE,
      authority: fixture.authorityPorts,
    },
  ));
  const target = createPGliteLocatedTaskSystemRunAttemptTargetV1(
    fixture.target,
    fixture.active.basis.authority.physicalLocator,
  );
  const located = Object.freeze({
    authority: fixture.active.basis.authority,
    target,
  });
  return Object.freeze({
    host: fixture,
    persistence: fixture.target,
    located,
    selected,
  });
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
      generation: Result.getOrThrow(
        decodeTaskCancellationGenerationV1("0"),
      ),
    }),
    maximumDurationMs: Result.getOrThrow(decodeTaskDurationMsV1(300_000)),
  });
}

async function startApplicationRun(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  runUuid: string,
  attemptUuid: string,
) {
  await createRuns(fixture, [runUuid]);
  const runId = Result.getOrThrow(decodeTaskRunIdV1(`run_${runUuid}`));
  const store = makeApplicationTaskSystemRunAttemptStoreV1(
    fixture.located,
    { randomUuid: () => attemptUuid },
  );
  const started = await runEffect(store.transactRunAttempt({
    operation: "start_attempt",
    runId,
    decide: input => decideApplicationStartAttemptV1({
      type: "start_attempt",
      runId,
      expectedRunVersion: Result.getOrThrow(decodeTaskRunVersionV1("1")),
      retryJitter: Result.getOrThrow(decodeTaskRetryJitterV1(0.5)),
    }, input),
  }));
  if (started.outcome.kind !== "attempt_granted") {
    throw new Error("Expected the Application attempt to start.");
  }
  const gateway = createTaskAttemptLifecycleGateway({
    scopeMetadata: fixture.host.authorityPorts.scopeMetadata,
    provisioningReceipts: fixture.host.authorityPorts.provisioningReceipts,
    scopeClockTargets: { resolve: async () => fixture.located.target },
  });
  const capability = await runEffect(gateway.resolve(
    fixture.host.deploymentId,
    applicationDispatch(started.outcome.grant, fixture.located.authority.scopeId),
  ));
  if (capability.generation !== "application_v1") {
    throw new Error("Expected an Application lifecycle capability.");
  }
  return Object.freeze({ runId, store, capability });
}

async function createRuns(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  runUuids: readonly string[],
): Promise<void> {
  for (const runUuid of runUuids) {
    const store = makeApplicationTaskSystemRunCreationStore(fixture.located, {
      sha256,
      leaseDurationMs,
      immediateRetryThresholdMs,
      randomUuid: () => runUuid,
    });
    const seed = Number.parseInt(runUuid.at(-1) ?? "0", 10) + 0x50;
    await runEffect(store.createRun(
      fixture.selected.selection,
      Result.getOrThrow(decodeApplicationTaskRunCreationRequestV1({
        version: 1,
        requestKey: `request-${runUuid}`,
        applicationTaskRuntimeTargetSha256:
          fixture.selected.metadata.runtimeTargetSha256,
        input: Result.getOrThrow(makeTaskInputReferenceV1(
          new Uint8Array(32).fill(seed),
          19,
        )),
        principal: Result.getOrThrow(makeTaskExecutionPrincipalReferenceV1(
          new Uint8Array(32).fill(seed + 1),
          23,
        )),
      })),
    ));
  }
}

async function setCreatedAt(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  runUuids: readonly string[],
): Promise<void> {
  await fixture.persistence.drizzle.update(fxSystemDurableTaskRunsV1).set({
    createdAtMs: BigInt(CREATED_AT_MS),
    aggregateJson: sql`jsonb_set(
      jsonb_set(
        ${fxSystemDurableTaskRunsV1.aggregateJson},
        '{aggregate,createdAtMs}',
        ${JSON.stringify(CREATED_AT_MS)}::jsonb
      ),
      '{aggregate,ready,eligibleAtMs}',
      ${JSON.stringify(CREATED_AT_MS)}::jsonb
    )`,
  }).where(sql`${fxSystemDurableTaskRunsV1.runId} in (
    ${sql.join(runUuids.map(uuid => sql`${`run_${uuid}`}`), sql`, `)}
  )`);
}
