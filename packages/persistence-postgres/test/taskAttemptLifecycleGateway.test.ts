import { PGlite } from "@electric-sql/pglite";
import {
  decideApplicationStartAttemptV1,
  decideStartAttemptV1,
  decodeTaskCancellationGenerationV1,
  decodeTaskDurationMsV1,
  decodeTaskExecutionFenceV1,
  decodeTaskRequestedEffectSequenceV1,
  decodeTaskRetryJitterV1,
  decodeTaskRunIdV1,
  decodeTaskRunVersionV1,
  type TaskAttemptGrantV1,
  type ApplicationTaskAttemptGrantV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  decodeApplicationTaskRunCreationRequestV1,
  makeTaskInputReferenceV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  makeStandardApplicationTaskSha256V1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { Effect, Result } from "effect";
import { ReplacementScopeIdV1Schema } from
  "flarex-protocol/storage-authority";
import { describe, expect, it, vi } from "vitest";

import {
  makeApplicationTaskSystemRunCreationStore,
} from "../src/applicationTaskSystemRunCreation";
import {
  selectApplicationTask,
} from "../src/applicationTaskSelection";
import {
  createPGliteLocatedTaskSystemRunAttemptTargetV1,
  createPGlitePersistence,
} from "../src/pglite";
import type { ScopeMetadataRecord } from "../src/scopeMetadata";
import {
  createTaskAttemptLifecycleGateway,
} from "../src/taskAttemptLifecycleGateway";
import {
  makeApplicationTaskSystemRunAttemptStoreV1,
  makeTaskSystemRunAttemptStoreV1,
} from "../src/taskSystemRunAttemptStoreV1";
import {
  createApplicationNativeMutationPGliteFixture,
} from "./fixtures/applicationNativeMutationTestFixture";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  ACCEPTED_ATTEMPT_UUID,
  TASK_LOCATOR,
  TASK_RUN_ID,
  TASK_SCOPE_ID,
  locatedTaskAuthorityV1,
  seedTaskSystemRunAttemptStoreV1,
} from "./taskSystemRunAttemptStoreTestSupport";

describe("DTE06-E3 scope-bound lifecycle gateway", () => {
  it("resolves a Legacy attempt and reuses database-time heartbeat and completion semantics", async () => {
    const raw = new PGlite();
    try {
      const persistence = await createPGlitePersistence({ db: raw });
      await persistence.migrate();
      const seeded = await seedTaskSystemRunAttemptStoreV1(persistence);
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
      const started = await runEffect(store.transactRunAttempt({
        operation: "start_attempt",
        runId: legacyRunId(),
        decide: input => decideStartAttemptV1({
          type: "start_attempt",
          runId: legacyRunId(),
          expectedRunVersion: Result.getOrThrow(decodeTaskRunVersionV1("1")),
          retryJitter: Result.getOrThrow(decodeTaskRetryJitterV1(0.5)),
        }, input),
      }));
      if (started.outcome.kind !== "attempt_granted") {
        throw new Error("Expected the fixture attempt to start.");
      }
      const dispatch = legacyDispatch(started.outcome.grant);
      const metadata = Object.freeze({
        scopeId: located.authority.scopeId,
        deploymentId: seeded.deploymentId,
        isolationKind: TASK_LOCATOR.kind,
        physicalLocator: TASK_LOCATOR,
        activeSchemaVersionId: null,
        createdAt: new Date("2026-08-16T00:00:00.000Z"),
      } satisfies ScopeMetadataRecord);
      const scopeMetadata = {
        expectedDeploymentId: seeded.deploymentId,
        async getScopeMetadataByDeploymentId(deploymentId: string) {
          if (deploymentId !== this.expectedDeploymentId) return null;
          return metadata;
        },
      };
      const scopeClockTargets = {
        expectedLocator: TASK_LOCATOR,
        async resolve(physicalLocator: typeof TASK_LOCATOR) {
          expect(physicalLocator).toEqual(this.expectedLocator);
          return target;
        },
      };
      const splitRead = vi.fn(async () => {
        throw new Error("Shared scope resolution must not read split receipts.");
      });
      const gateway = createTaskAttemptLifecycleGateway({
        scopeMetadata,
        provisioningReceipts: {
          getScopeAuthorityProvisioningReceipt: splitRead,
        },
        scopeClockTargets,
      });
      await expect(runEffectFailure(gateway.resolve(
        seeded.deploymentId,
        {
          ...dispatch,
          identity: {
            ...dispatch.identity,
            scopeId: ReplacementScopeIdV1Schema.make(
              "scope_72000000-0000-4000-8000-000000000099",
            ),
          },
        },
      ))).resolves.toMatchObject({
        _tag: "TaskAttemptLifecycleGatewayInputError",
        operation: "resolve",
        reason: "scope_mismatch",
      });
      const staleFenceCapability = await runEffect(gateway.resolve(
        seeded.deploymentId,
        {
          ...dispatch,
          identity: {
            ...dispatch.identity,
            executionFence: Result.getOrThrow(decodeTaskExecutionFenceV1("99")),
          },
        },
      ));
      if (staleFenceCapability.generation !== "legacy_dynamic_worker_v1") {
        throw new Error("Expected a Legacy lifecycle capability.");
      }
      expect(await runEffect(staleFenceCapability.heartbeat(1))).toMatchObject({
        disposition: "current",
        outcome: { kind: "current", reason: "stale_fence" },
      });
      const capability = await runEffect(gateway.resolve(
        seeded.deploymentId,
        dispatch,
      ));
      if (capability.generation !== "legacy_dynamic_worker_v1") {
        throw new Error("Expected a Legacy lifecycle capability.");
      }

      expect(capability).toMatchObject({
        generation: "legacy_dynamic_worker_v1",
        deploymentId: seeded.deploymentId,
        scopeId: dispatch.identity.scopeId,
        runId: dispatch.identity.runId,
        attemptId: dispatch.identity.attemptId,
        executionFence: dispatch.identity.executionFence,
        leaseVersion: dispatch.leaseVersion,
      });
      expect(Object.isFrozen(capability)).toBe(true);
      expect(splitRead).not.toHaveBeenCalled();
      const before = await runEffect(capability.inspect());
      await expect(runEffectFailure(capability.heartbeat(0))).resolves
        .toMatchObject({
          _tag: "TaskAttemptLifecycleGatewayInputError",
          operation: "heartbeat",
          reason: "invalid_heartbeat_sequence",
        });
      const heartbeat = await runEffect(capability.heartbeat(1));
      expect(heartbeat).toMatchObject({
        disposition: "accepted",
        outcome: { kind: "lease_renewed", enteredExecuting: true },
      });
      expect(heartbeat.observedAtMs).toBeGreaterThanOrEqual(before.observedAtMs);
      const completion = Object.freeze({
        kind: "succeeded" as const,
        result: null,
        executionDurationMs: null,
      });
      await expect(runEffectFailure(capability.complete({
        kind: "succeeded",
        result: { codec: "wrong", byteLength: 1, sha256: new Uint8Array(32) },
        executionDurationMs: null,
      }))).resolves.toMatchObject({
        _tag: "TaskAttemptLifecycleGatewayInputError",
        operation: "complete",
        reason: "invalid_completion",
      });
      let oversizedDigestIteratorReads = 0;
      const oversizedDigest = new Uint8Array(33);
      Object.defineProperty(oversizedDigest, Symbol.iterator, {
        get: () => {
          oversizedDigestIteratorReads += 1;
          throw new Error("oversized digest must not be copied");
        },
      });
      await expect(runEffectFailure(capability.complete({
        kind: "succeeded",
        result: {
          codec: "flarex.task-result.canonical-value.v1",
          byteLength: 1,
          sha256: oversizedDigest,
        },
        executionDurationMs: null,
      }))).resolves.toMatchObject({
        _tag: "TaskAttemptLifecycleGatewayInputError",
        operation: "complete",
        reason: "invalid_completion",
      });
      expect(oversizedDigestIteratorReads).toBe(0);
      let hostileGetterReads = 0;
      const hostileCompletion = Object.create(null);
      Object.defineProperties(hostileCompletion, {
        kind: {
          enumerable: true,
          get: () => {
            hostileGetterReads += 1;
            throw new Error("hostile completion getter");
          },
        },
        result: { enumerable: true, value: null },
        executionDurationMs: { enumerable: true, value: null },
      });
      await expect(runEffectFailure(capability.complete(hostileCompletion)))
        .resolves.toMatchObject({
          _tag: "TaskAttemptLifecycleGatewayInputError",
          operation: "complete",
          reason: "invalid_completion",
        });
      expect(hostileGetterReads).toBe(0);
      const completed = await runEffect(capability.complete(completion));
      const replayed = await runEffect(capability.complete(completion));
      expect(completed).toMatchObject({
        disposition: "accepted",
        outcome: { kind: "terminal_succeeded" },
      });
      expect(replayed).toEqual({ ...completed, disposition: "idempotent" });
      await expect(runEffectFailure(capability.complete({
        kind: "failed",
        failure: {
          kind: "task_failure",
          code: "handler_failed",
          message: null,
        },
        retry: { kind: "do_not_retry" },
        executionDurationMs: null,
      }))).resolves.toMatchObject({
        _tag: "ConflictingTaskAttemptCompletionError",
        operation: "complete_attempt",
      });
      expect((await runEffect(capability.inspect())).current.phase)
        .toBe("terminal");
    } finally {
      await raw.close();
    }
  });

  it("selects the Application aggregate decoder and preserves exact replay", {
    timeout: 180_000,
  }, async () => {
    const runtimeHostIdentity = "flarex.test/task-lifecycle-gateway";
    const compatibilityDate = "2026-08-16";
    const fixture = await createApplicationNativeMutationPGliteFixture({
      runtimeHostIdentity,
      compatibilityDate,
      includeTask: true,
    });
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
    const target = createPGliteLocatedTaskSystemRunAttemptTargetV1(
      fixture.target,
      fixture.active.basis.authority.physicalLocator,
    );
    const located = Object.freeze({
      authority: fixture.active.basis.authority,
      target,
    });
    const creation = makeApplicationTaskSystemRunCreationStore(located, {
      sha256: makeStandardApplicationTaskSha256V1(input =>
        globalThis.crypto.subtle.digest("SHA-256", input)
      ),
      leaseDurationMs: Result.getOrThrow(decodeTaskDurationMsV1(30_000)),
      immediateRetryThresholdMs:
        Result.getOrThrow(decodeTaskDurationMsV1(5_000)),
      randomUuid: uuidSequence(20),
    });
    const created = await runEffect(creation.createRun(
      selected.selection,
      Result.getOrThrow(decodeApplicationTaskRunCreationRequestV1({
        version: 1,
        requestKey: "task-lifecycle-gateway-application",
        applicationTaskRuntimeTargetSha256:
          selected.metadata.runtimeTargetSha256,
        input: Result.getOrThrow(makeTaskInputReferenceV1(
          new Uint8Array(32).fill(0x73),
          19,
        )),
      })),
    ));
    const store = makeApplicationTaskSystemRunAttemptStoreV1(located, {
      randomUuid: uuidSequence(21),
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
      throw new Error("Expected the Application attempt to start.");
    }
    const gateway = createTaskAttemptLifecycleGateway({
      scopeMetadata: fixture.authorityPorts.scopeMetadata,
      provisioningReceipts: fixture.authorityPorts.provisioningReceipts,
      scopeClockTargets: {
        resolve: async () => target,
      },
    });
    const capability = await runEffect(gateway.resolve(
      fixture.deploymentId,
      applicationDispatch(
        started.outcome.grant,
        fixture.active.basis.authority.scopeId,
      ),
    ));
    expect(capability.generation).toBe("application_v1");
    if (capability.generation !== "application_v1") {
      throw new Error("Expected an Application lifecycle capability.");
    }
    const heartbeat = await runEffect(capability.heartbeat(1));
    expect(heartbeat).toMatchObject({
      disposition: "accepted",
      outcome: { kind: "lease_renewed", enteredExecuting: true },
    });
    const completion = Object.freeze({
      kind: "succeeded" as const,
      result: null,
      executionDurationMs: null,
    });
    const completed = await runEffect(capability.complete(completion));
    expect(await runEffect(capability.complete(completion)))
      .toEqual({ ...completed, disposition: "idempotent" });
    const inspection = await runEffect(capability.inspect());
    expect(inspection.current).toMatchObject({
      phase: "terminal",
      applicationTaskRuntimeTargetSha256:
        started.outcome.grant.applicationTaskRuntimeTargetSha256,
    });
  });

  it("fails closed before resolution for invalid inputs and cross-scope dispatch", async () => {
    const scopeMetadataRead = vi.fn(async () => null);
    const gateway = createTaskAttemptLifecycleGateway({
      scopeMetadata: {
        getScopeMetadataByDeploymentId: scopeMetadataRead,
      },
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => null,
      },
      scopeClockTargets: {
        resolve: async () => {
          throw new Error("invalid input must not resolve a target");
        },
      },
    });
    await expect(runEffectFailure(gateway.resolve(" ", {}))).resolves
      .toMatchObject({
        _tag: "TaskAttemptLifecycleGatewayInputError",
        operation: "resolve",
        reason: "invalid_deployment_id",
      });
    await expect(runEffectFailure(gateway.resolve("deployment", {}))).resolves
      .toMatchObject({
        _tag: "TaskAttemptLifecycleGatewayInputError",
        operation: "resolve",
        reason: "invalid_dispatch",
      });
    expect(scopeMetadataRead).not.toHaveBeenCalled();
  });
});

function legacyRunId() {
  return Result.getOrThrow(decodeTaskRunIdV1(TASK_RUN_ID));
}

function legacyDispatch(grant: TaskAttemptGrantV1) {
  return Object.freeze({
    version: "flarex.task-compute-dispatch-request.v1" as const,
    identity: Object.freeze({
      version: "flarex.task-compute-dispatch-identity.v1" as const,
      scopeId: ReplacementScopeIdV1Schema.make(TASK_SCOPE_ID),
      runId: grant.runId,
      requestedEffectSequence: Result.getOrThrow(
        decodeTaskRequestedEffectSequenceV1("1"),
      ),
      attemptId: grant.attempt.attemptId,
      executionFence: grant.attempt.executionFence,
    }),
    taskDefinitionRevisionId: grant.taskDefinitionRevisionId,
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

function uuidSequence(offset: number): () => string {
  let next = offset;
  return () => `72000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
}
