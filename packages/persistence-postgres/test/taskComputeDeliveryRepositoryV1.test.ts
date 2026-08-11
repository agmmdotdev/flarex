import { PGlite } from "@electric-sql/pglite";
import {
  TASK_COMPUTE_CANCELLATION_RECEIPT_VERSION_V1,
  TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1,
  TaskComputeCancellationRejectedError,
  TaskComputeCancellationStaleError,
  TaskComputeCancellationTransportError,
  TaskComputeCancellationUncertainError,
  TaskComputeDispatchRejectedError,
  TaskComputeDispatchTransportError,
  TaskComputeDispatchUncertainError,
  validateTaskComputeDispatchAcceptanceV1,
  validateTaskComputeCancellationReceiptV1,
  validateTaskComputeDispatchRequestV1,
  decodeTaskComputeProviderDescriptorV1,
} from "@flarex/durable-task/internal/compute-provider-v1";
import { makeInMemoryTaskComputeProviderV1 } from
  "@flarex/durable-task/internal/compute-provider-testing-v1";
import {
  RunAttemptLifecycle,
  RunAttemptLifecycleLive,
  TaskSystemRunAttemptStore,
  decodeTaskCancellationGenerationV1,
  decodeTaskRequestedEffectSequenceV1,
  decodeTaskRunVersionV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { Cause, Effect, Exit, Fiber, Layer, Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  createPGliteLocatedTaskSystemRunAttemptTargetV1,
  createPGlitePersistence,
} from "../src/pglite";
import { makeTaskComputeDeliveryCandidateDiscovery } from
  "../src/taskComputeDeliveryDiscovery";
import {
  TaskComputeDeliveryRepositoryConfirmedRollbackV1Error,
  TaskComputeDeliveryRepositoryCorruptionV1Error,
  TaskComputeDeliveryRepositoryInputV1Error,
  TaskComputeDeliveryRepositoryConfigurationV1Error,
  TaskComputeDeliveryRepositoryDecisionUncertainV1Error,
  TaskComputeDeliveryRepositorySqlV1Error,
  TaskComputeDeliveryRepositoryStaleClaimV1Error,
  createLocatedTaskComputeDeliveryTargetV1,
  makeTaskComputeDeliveryRepositoryV1,
  type TaskComputeDeliveryRepositoryErrorV1,
  type TaskComputeDeliveryRepositoryOptionsV1,
  type TaskComputeDeliveryRepositoryV1,
  type TaskComputeCancellationAcquireResultV1,
  type TaskComputeCancellationClaimReleasedV1,
  type TaskComputeCancellationClaimRenewedV1,
  type TaskComputeCancellationDeliveryStartedV1,
  type TaskComputeCancellationKnownFailureRecordedV1,
  type TaskComputeCancellationKnownFailureV1,
  type TaskComputeCancellationReceiptRecordedV1,
  type TaskComputeDispatchAcquireResultV1,
  type TaskComputeDispatchClaimReleasedV1,
  type TaskComputeDispatchClaimRenewedV1,
  type TaskComputeDispatchAcceptanceRecordedV1,
  type TaskComputeDispatchDeliveryStartedV1,
  type TaskComputeDispatchKnownFailureRecordedV1,
  type TaskComputeDispatchKnownFailureV1,
} from "../src/taskComputeDeliveryRepositoryV1";
import { TaskComputeDeliveryEvidenceV1Error } from
  "../src/taskComputeDeliveryEvidenceV1";
import { makeTaskSystemRunAttemptStoreV1 } from
  "../src/taskSystemRunAttemptStoreV1";
import type { AppRowTransaction } from "../src/appRows";
import {
  LocatedReadCommittedTransactionFailureV1,
  type RunLocatedReadCommittedTransactionV1,
} from "../src/transactionSessionAttemptKernel";
import { createDefaultLocatedReadCommittedTransactionRunnerV1 } from
  "../src/transactionSessionActivation";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  ACCEPTED_ATTEMPT_UUID,
  TASK_LOCATOR,
  TASK_SCOPE_ID,
  locatedTaskAuthorityV1,
  seedTaskSystemRunAttemptStoreV1,
} from "./taskSystemRunAttemptStoreTestSupport";
import {
  TASK_SYSTEM_CREATION_RUN_UUID_A,
  installTaskSystemCreationRuntimeBindingV1,
  makeTaskSystemCreationAuthorityV1,
  makeTaskSystemCreationRequestV1,
  makeTaskSystemCreationRuntimeBindingV1,
  makeTaskSystemCreationStoreForTestV1,
  taskSystemCreationRetryJitterV1,
} from "./taskSystemRunCreationTestSupport";

const CLAIM_OWNER_A = "73000000-0000-4000-8000-000000000001";
const DISCOVERY_DEADLINE_POLICY = Object.freeze({
  connectionTimeoutMilliseconds: 1_000,
  lockTimeoutMilliseconds: 250,
  statementTimeoutMilliseconds: 10_000,
  transactionTimeoutMilliseconds: 20_000,
  settlementReserveMilliseconds: 30_000,
});
const CLAIM_OWNER_B = "73000000-0000-4000-8000-000000000002";
const runVersionOne = success(decodeTaskRunVersionV1("1"));
const cancellationGenerationOne = success(
  decodeTaskCancellationGenerationV1("1"),
);
const cancellationGenerationTwo = success(
  decodeTaskCancellationGenerationV1("2"),
);
const cancellationGenerationThree = success(
  decodeTaskCancellationGenerationV1("3"),
);
const computeProviderDescriptor = success(decodeTaskComputeProviderDescriptorV1({
  provider: "test-provider",
  providerVersion: "v1",
}));

describe("DTE06-C2 scope-bound compute delivery repository - PGlite", () => {
  it("exposes an exact typed error channel for each operation", () => {
    expectTypeOf<ReturnType<TaskComputeDeliveryRepositoryV1["acquireDispatch"]>>()
      .toEqualTypeOf<Effect.Effect<
        TaskComputeDispatchAcquireResultV1,
        TaskComputeDeliveryRepositoryErrorV1<"acquire_dispatch">
      >>();
    expectTypeOf<ReturnType<
      TaskComputeDeliveryRepositoryV1["markDispatchDeliveryStarted"]
    >>().toEqualTypeOf<Effect.Effect<
      TaskComputeDispatchDeliveryStartedV1,
      TaskComputeDeliveryRepositoryErrorV1<"mark_dispatch_delivery_started">
    >>();
    expectTypeOf<ReturnType<TaskComputeDeliveryRepositoryV1["renewDispatchClaim"]>>()
      .toEqualTypeOf<Effect.Effect<
        TaskComputeDispatchClaimRenewedV1,
        TaskComputeDeliveryRepositoryErrorV1<"renew_dispatch_claim">
      >>();
    expectTypeOf<ReturnType<
      TaskComputeDeliveryRepositoryV1["releaseDispatchBeforeDelivery"]
    >>().toEqualTypeOf<Effect.Effect<
      TaskComputeDispatchClaimReleasedV1,
      TaskComputeDeliveryRepositoryErrorV1<"release_dispatch_before_delivery">
    >>();
    expectTypeOf<ReturnType<
      TaskComputeDeliveryRepositoryV1["recordDispatchAcceptance"]
    >>().toEqualTypeOf<Effect.Effect<
      TaskComputeDispatchAcceptanceRecordedV1,
      TaskComputeDeliveryRepositoryErrorV1<"record_dispatch_acceptance">
    >>();
    expectTypeOf<ReturnType<
      TaskComputeDeliveryRepositoryV1["recordDispatchKnownFailure"]
    >>().toEqualTypeOf<Effect.Effect<
      TaskComputeDispatchKnownFailureRecordedV1,
      TaskComputeDeliveryRepositoryErrorV1<"record_dispatch_known_failure">
    >>();
    expectTypeOf<ReturnType<TaskComputeDeliveryRepositoryV1["acquireCancellation"]>>()
      .toEqualTypeOf<Effect.Effect<
        TaskComputeCancellationAcquireResultV1,
        TaskComputeDeliveryRepositoryErrorV1<"acquire_cancellation">
      >>();
    expectTypeOf<ReturnType<
      TaskComputeDeliveryRepositoryV1["markCancellationDeliveryStarted"]
    >>().toEqualTypeOf<Effect.Effect<
      TaskComputeCancellationDeliveryStartedV1,
      TaskComputeDeliveryRepositoryErrorV1<"mark_cancellation_delivery_started">
    >>();
    expectTypeOf<ReturnType<
      TaskComputeDeliveryRepositoryV1["renewCancellationClaim"]
    >>().toEqualTypeOf<Effect.Effect<
      TaskComputeCancellationClaimRenewedV1,
      TaskComputeDeliveryRepositoryErrorV1<"renew_cancellation_claim">
    >>();
    expectTypeOf<ReturnType<
      TaskComputeDeliveryRepositoryV1["releaseCancellationBeforeDelivery"]
    >>().toEqualTypeOf<Effect.Effect<
      TaskComputeCancellationClaimReleasedV1,
      TaskComputeDeliveryRepositoryErrorV1<"release_cancellation_before_delivery">
    >>();
    expectTypeOf<ReturnType<
      TaskComputeDeliveryRepositoryV1["recordCancellationReceipt"]
    >>().toEqualTypeOf<Effect.Effect<
      TaskComputeCancellationReceiptRecordedV1,
      TaskComputeDeliveryRepositoryErrorV1<"record_cancellation_receipt">
    >>();
    expectTypeOf<ReturnType<
      TaskComputeDeliveryRepositoryV1["recordCancellationKnownFailure"]
    >>().toEqualTypeOf<Effect.Effect<
      TaskComputeCancellationKnownFailureRecordedV1,
      TaskComputeDeliveryRepositoryErrorV1<"record_cancellation_known_failure">
    >>();
    expectTypeOf<Extract<
      TaskComputeDeliveryRepositoryErrorV1<"acquire_dispatch">,
      { readonly _tag: "TaskComputeDeliveryRepositoryStaleClaimV1Error" }
    >>().toEqualTypeOf<never>();
    expectTypeOf<Extract<
      TaskComputeDeliveryRepositoryErrorV1<"renew_dispatch_claim">,
      { readonly _tag: "TaskComputeDeliveryRepositoryResourceExhaustedV1Error" }
    >>().toEqualTypeOf<never>();
    expectTypeOf<Extract<
      TaskComputeDeliveryRepositoryErrorV1<"release_dispatch_before_delivery">,
      { readonly _tag: "TaskComputeDeliveryRepositoryResourceExhaustedV1Error" }
    >>().toEqualTypeOf<never>();
    expectTypeOf<Extract<
      TaskComputeDeliveryRepositoryErrorV1<"record_dispatch_acceptance">,
      { readonly _tag: "TaskComputeDeliveryRepositoryResourceExhaustedV1Error" }
    >>().toEqualTypeOf<never>();
    expectTypeOf<Extract<
      TaskComputeDeliveryRepositoryErrorV1<"record_dispatch_known_failure">,
      { readonly _tag: "TaskComputeDeliveryRepositoryResourceExhaustedV1Error" }
    >>().toEqualTypeOf<never>();
    expectTypeOf<Extract<
      TaskComputeDeliveryRepositoryErrorV1<"acquire_cancellation">,
      { readonly _tag: "TaskComputeDeliveryRepositoryStaleClaimV1Error" }
    >>().toEqualTypeOf<never>();
    expectTypeOf<Extract<
      TaskComputeDeliveryRepositoryErrorV1<"record_cancellation_receipt">,
      { readonly _tag: "TaskComputeDeliveryRepositoryResourceExhaustedV1Error" }
    >>().toEqualTypeOf<never>();
    expectTypeOf<Extract<
      TaskComputeCancellationKnownFailureV1,
      TaskComputeCancellationStaleError
    >>().toEqualTypeOf<TaskComputeCancellationStaleError>();
    expectTypeOf<Extract<
      Extract<
        TaskComputeCancellationKnownFailureRecordedV1,
        { readonly kind: "retry_scheduled" }
      >["reason"],
      "provider_stale_generation"
    >>().toEqualTypeOf<never>();
  });

  it("captures configuration and rejects inconsistent retry policy", async () => {
    await withFixture(async ({ deliveryLocated }) => {
      const invalid = makeTaskComputeDeliveryRepositoryV1(deliveryLocated, {
        claimDurationMilliseconds: 30_000,
        retryDelayMilliseconds: [1_000],
        maximumDeliveryAttempts: 3,
        randomUuid: () => CLAIM_OWNER_A,
      });
      expect(Result.isFailure(invalid)).toBe(true);
      if (Result.isSuccess(invalid)) throw new Error("invalid policy accepted");
      expect(invalid.failure).toBeInstanceOf(
        TaskComputeDeliveryRepositoryConfigurationV1Error,
      );
      expect(invalid.failure.reason).toBe("invalid_retry_delays");

      let getterInvoked = false;
      const hostile = Object.defineProperty(
        {},
        "claimDurationMilliseconds",
        {
          enumerable: true,
          get: () => {
            getterInvoked = true;
            return 30_000;
          },
        },
      ) as TaskComputeDeliveryRepositoryOptionsV1;
      const hostileResult = makeTaskComputeDeliveryRepositoryV1(
        deliveryLocated,
        hostile,
      );
      expect(Result.isFailure(hostileResult)).toBe(true);
      expect(getterInvoked).toBe(false);

      const hostileProxy = new Proxy({} as TaskComputeDeliveryRepositoryOptionsV1, {
        ownKeys: () => {
          throw new Error("ownKeys must be contained");
        },
      });
      expect(Result.isFailure(makeTaskComputeDeliveryRepositoryV1(
        deliveryLocated,
        hostileProxy,
      ))).toBe(true);
    });
  });

  it("prepares one exact dispatch claim and reports a live competing claim as busy", async () => {
    await withFixture(async ({
      persistence,
      deliveryLocated,
      runId,
      dispatchSequence,
    }) => {
      const firstRepository = repository(deliveryLocated, CLAIM_OWNER_A);
      const secondRepository = repository(deliveryLocated, CLAIM_OWNER_B);

      expect(await pendingDeliveryCount(
        persistence,
        runId,
        dispatchSequence,
      )).toBe(1);

      const first = await runEffect(firstRepository.acquireDispatch({
        runId,
        requestedEffectSequence: dispatchSequence,
      }));
      expect(first.kind).toBe("claimed");
      if (first.kind !== "claimed") throw new Error("dispatch was not claimed");
      expect(first.deliveryMode).toBe("initial");
      expect(first.prepared).toMatchObject({
        version: "flarex.task-compute-prepared-execution.v1",
        dispatchRequest: {
          identity: {
            scopeId: TASK_SCOPE_ID,
            runId,
            requestedEffectSequence: dispatchSequence,
            attemptId: `attempt_${ACCEPTED_ATTEMPT_UUID}`,
            executionFence: 1n,
          },
          attemptNumber: 1,
          leaseVersion: 1n,
          computeProfile: "standard-1x",
          cancellation: { kind: "not_requested", generation: 0n },
          maximumDurationMs: 300_000,
        },
        inputReference: { byteLength: 19 },
      });
      expect("manifest" in first.prepared.runtimeBindingCommitment).toBe(false);
      expect(Object.isFrozen(first.handle)).toBe(true);
      expect(await pendingDeliveryCount(
        persistence,
        runId,
        dispatchSequence,
      )).toBe(0);

      const second = await runEffect(secondRepository.acquireDispatch({
        runId,
        requestedEffectSequence: dispatchSequence,
      }));
      expect(second.kind).toBe("busy");
      if (second.kind !== "busy") throw new Error("competing claim was not busy");
      expect(second.claimExpiresAt.getTime()).toBe(
        first.claimExpiresAt.getTime(),
      );

      const stored = await persistence.query<{
        claim_owner: string;
        claim_fence: string;
        delivery_state: string;
        delivery_attempt_count: string;
      }>(`
        select claim_owner::text, claim_fence::text, delivery_state,
               delivery_attempt_count::text
        from fx_system_durable_task_compute_dispatch_v1
        where scope_id = $1 and run_id = $2
          and requested_effect_sequence = $3
      `, [TASK_SCOPE_ID, runId, dispatchSequence]);
      expect(stored.rows).toEqual([{
        claim_owner: CLAIM_OWNER_A,
        claim_fence: "1",
        delivery_state: "prepared",
        delivery_attempt_count: "0",
      }]);
    });
  });

  it("rolls back checkpoint creation when pending membership has the wrong kind", async () => {
    await withFixture(async ({
      persistence,
      deliveryLocated,
      runId,
      dispatchSequence,
    }) => {
      await persistence.query(`
        update fx_system_durable_task_compute_pending_v1
        set kind = 'request_execution_cancellation'
        where scope_id = $1 and run_id = $2
          and requested_effect_sequence = $3
      `, [TASK_SCOPE_ID, runId, dispatchSequence]);

      const failure = await runEffectFailure(
        repository(deliveryLocated, CLAIM_OWNER_A).acquireDispatch({
          runId,
          requestedEffectSequence: dispatchSequence,
        }),
      );
      expect(failure).toBeInstanceOf(
        TaskComputeDeliveryRepositoryCorruptionV1Error,
      );
      expect(failure).toMatchObject({
        operation: "acquire_dispatch",
        reason: "pending_membership_invalid",
      });
      const checkpoints = await persistence.query<{ count: string }>(`
        select count(*)::text as count
        from fx_system_durable_task_compute_dispatch_v1
        where scope_id = $1 and run_id = $2
          and requested_effect_sequence = $3
      `, [TASK_SCOPE_ID, runId, dispatchSequence]);
      expect(checkpoints.rows).toEqual([{ count: "0" }]);
      const pending = await persistence.query<{ kind: string }>(`
        select kind
        from fx_system_durable_task_compute_pending_v1
        where scope_id = $1 and run_id = $2
          and requested_effect_sequence = $3
      `, [TASK_SCOPE_ID, runId, dispatchSequence]);
      expect(pending.rows).toEqual([{
        kind: "request_execution_cancellation",
      }]);
    });
  });

  it("marks delivery started and renews the same fenced claim", async () => {
    await withFixture(async ({
      persistence,
      deliveryLocated,
      runId,
      dispatchSequence,
    }) => {
      const dispatchRepository = repository(deliveryLocated, CLAIM_OWNER_A);
      const acquired = await runEffect(dispatchRepository.acquireDispatch({
        runId,
        requestedEffectSequence: dispatchSequence,
      }));
      if (acquired.kind !== "claimed") throw new Error("dispatch was not claimed");

      const started = await runEffect(
        dispatchRepository.markDispatchDeliveryStarted(acquired.handle),
      );
      expect(started).toMatchObject({
        kind: "delivery_started",
        deliveryAttemptCount: 1n,
      });
      const duplicateStart = await runEffectFailure(
        dispatchRepository.markDispatchDeliveryStarted(acquired.handle),
      );
      expect(duplicateStart).toBeInstanceOf(
        TaskComputeDeliveryRepositoryStaleClaimV1Error,
      );
      const renewed = await runEffect(
        dispatchRepository.renewDispatchClaim(acquired.handle),
      );
      expect(renewed.kind).toBe("claim_renewed");
      expect(renewed.claimExpiresAt.getTime()).toBeGreaterThanOrEqual(
        acquired.claimExpiresAt.getTime(),
      );

      const stored = await readClaim(persistence, runId, dispatchSequence);
      expect(stored).toEqual({
        claim_owner: CLAIM_OWNER_A,
        claim_fence: "1",
        delivery_state: "delivering",
        delivery_attempt_count: "1",
      });
    });
  });

  it("releases before delivery, closes the handle, and permits a fenced reacquire", async () => {
    await withFixture(async ({
      persistence,
      deliveryLocated,
      runId,
      dispatchSequence,
    }) => {
      const firstRepository = repository(deliveryLocated, CLAIM_OWNER_A);
      const secondRepository = repository(deliveryLocated, CLAIM_OWNER_B);
      const first = await runEffect(firstRepository.acquireDispatch({
        runId,
        requestedEffectSequence: dispatchSequence,
      }));
      if (first.kind !== "claimed") throw new Error("dispatch was not claimed");

      expect(await runEffect(
        firstRepository.releaseDispatchBeforeDelivery(first.handle),
      )).toEqual({ kind: "claim_released" });
      const closedFailure = await runEffectFailure(
        firstRepository.renewDispatchClaim(first.handle),
      );
      expect(closedFailure).toBeInstanceOf(
        TaskComputeDeliveryRepositoryInputV1Error,
      );
      if (!(closedFailure instanceof TaskComputeDeliveryRepositoryInputV1Error)) {
        throw new Error("closed handle did not return an input error");
      }
      expect(closedFailure.reason).toBe("closed_handle");

      const second = await runEffect(secondRepository.acquireDispatch({
        runId,
        requestedEffectSequence: dispatchSequence,
      }));
      if (second.kind !== "claimed") throw new Error("dispatch was not reacquired");
      expect(second.deliveryMode).toBe("initial");
      expect(await readClaim(persistence, runId, dispatchSequence)).toEqual({
        claim_owner: CLAIM_OWNER_B,
        claim_fence: "2",
        delivery_state: "prepared",
        delivery_attempt_count: "0",
      });
    });
  });

  it("serializes concurrent start markers to exactly one delivery attempt", async () => {
    await withFixture(async ({
      persistence,
      deliveryLocated,
      runId,
      dispatchSequence,
    }) => {
      const dispatchRepository = repository(deliveryLocated, CLAIM_OWNER_A);
      const acquired = await runEffect(dispatchRepository.acquireDispatch({
        runId,
        requestedEffectSequence: dispatchSequence,
      }));
      if (acquired.kind !== "claimed") throw new Error("dispatch was not claimed");

      const starts = await Promise.all([
        runEffect(Effect.exit(
          dispatchRepository.markDispatchDeliveryStarted(acquired.handle),
        )),
        runEffect(Effect.exit(
          dispatchRepository.markDispatchDeliveryStarted(acquired.handle),
        )),
      ]);
      expect(starts.filter(Exit.isSuccess)).toHaveLength(1);
      expect(starts.filter(Exit.isFailure)).toHaveLength(1);
      expect(await readClaim(persistence, runId, dispatchSequence)).toEqual({
        claim_owner: CLAIM_OWNER_A,
        claim_fence: "1",
        delivery_state: "delivering",
        delivery_attempt_count: "1",
      });
    });
  });

  it("takes over an expired delivering claim as uncertain replay", async () => {
    await withFixture(async ({
      persistence,
      deliveryLocated,
      runId,
      dispatchSequence,
    }) => {
      const firstRepository = repository(deliveryLocated, CLAIM_OWNER_A);
      const secondRepository = repository(deliveryLocated, CLAIM_OWNER_B);
      const first = await runEffect(firstRepository.acquireDispatch({
        runId,
        requestedEffectSequence: dispatchSequence,
      }));
      if (first.kind !== "claimed") throw new Error("dispatch was not claimed");
      await runEffect(firstRepository.markDispatchDeliveryStarted(first.handle));
      await persistence.query(`
        update fx_system_durable_task_compute_dispatch_v1
        set claimed_at = clock_timestamp() - interval '2 minutes',
            claim_expires_at = clock_timestamp() - interval '1 minute'
        where scope_id = $1 and run_id = $2
          and requested_effect_sequence = $3
      `, [TASK_SCOPE_ID, runId, dispatchSequence]);

      const replay = await runEffect(secondRepository.acquireDispatch({
        runId,
        requestedEffectSequence: dispatchSequence,
      }));
      if (replay.kind !== "claimed") throw new Error("expired claim was not taken over");
      expect(replay.deliveryMode).toBe("uncertain_replay");
      const started = await runEffect(
        secondRepository.markDispatchDeliveryStarted(replay.handle),
      );
      expect(started.deliveryAttemptCount).toBe(2n);
      expect(await readClaim(persistence, runId, dispatchSequence)).toEqual({
        claim_owner: CLAIM_OWNER_B,
        claim_fence: "2",
        delivery_state: "delivering",
        delivery_attempt_count: "2",
      });
    });
  });

  it("records canonical acceptance, releases the fence, and replays the exact receipt", async () => {
    await withFixture(async ({
      persistence,
      deliveryLocated,
      runId,
      dispatchSequence,
    }) => {
      const dispatchRepository = repository(deliveryLocated, CLAIM_OWNER_A);
      const acquired = await runEffect(dispatchRepository.acquireDispatch({
        runId,
        requestedEffectSequence: dispatchSequence,
      }));
      if (acquired.kind !== "claimed") throw new Error("dispatch was not claimed");
      await runEffect(
        dispatchRepository.markDispatchDeliveryStarted(acquired.handle),
      );
      const acceptance = success(validateTaskComputeDispatchAcceptanceV1({
        version: TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1,
        kind: "accepted",
        identity: acquired.prepared.dispatchRequest.identity,
        execution: {
          provider: "test-provider",
          providerVersion: "v1",
          executionId: "execution-1",
        },
      }));
      const recorded = await runEffect(
        dispatchRepository.recordDispatchAcceptance(
          acquired.handle,
          acceptance,
        ),
      );
      expect(recorded).toEqual({
        kind: "dispatch_accepted",
        acceptance,
        disposition: "current",
      });
      const closed = await runEffectFailure(
        dispatchRepository.renewDispatchClaim(acquired.handle),
      );
      expect(closed).toMatchObject({ reason: "closed_handle" });

      const replayed = await runEffect(dispatchRepository.acquireDispatch({
        runId,
        requestedEffectSequence: dispatchSequence,
      }));
      expect(replayed).toEqual({
        kind: "accepted",
        acceptance,
        disposition: "current",
      });
      expect(await readSettlement(persistence, runId, dispatchSequence))
        .toMatchObject({
          delivery_state: "accepted",
          claim_owner: null,
          reason_code: null,
          acceptance_codec_version: 1,
        });
    });
  });

  it("schedules a known retry and closes at the configured attempt ceiling", async () => {
    await withFixture(async ({
      persistence,
      deliveryLocated,
      runId,
      dispatchSequence,
    }) => {
      const firstRepository = repositoryWithPolicy(
        deliveryLocated,
        CLAIM_OWNER_A,
        2,
        [1_000],
      );
      const first = await runEffect(firstRepository.acquireDispatch({
        runId,
        requestedEffectSequence: dispatchSequence,
      }));
      if (first.kind !== "claimed") throw new Error("dispatch was not claimed");
      await runEffect(firstRepository.markDispatchDeliveryStarted(first.handle));
      const knownFailure = new TaskComputeDispatchRejectedError({
        operation: "dispatch",
        reason: "capacity_unavailable",
        retryable: true,
        computeProfile: first.prepared.dispatchRequest.computeProfile,
      });
      const retry = await runEffect(
        firstRepository.recordDispatchKnownFailure(first.handle, knownFailure),
      );
      expect(retry).toMatchObject({
        kind: "retry_scheduled",
        reason: "provider_capacity_unavailable",
      });
      if (retry.kind !== "retry_scheduled") throw new Error("retry not scheduled");
      expect(retry.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
      expect((await runEffect(firstRepository.acquireDispatch({
        runId,
        requestedEffectSequence: dispatchSequence,
      }))).kind).toBe("not_due");

      await persistence.query(`
        update fx_system_durable_task_compute_dispatch_v1
        set delivery_started_at = created_at,
            next_attempt_at = created_at + interval '1 millisecond'
        where scope_id = $1 and run_id = $2
          and requested_effect_sequence = $3
      `, [TASK_SCOPE_ID, runId, dispatchSequence]);
      const secondRepository = repositoryWithPolicy(
        deliveryLocated,
        CLAIM_OWNER_B,
        2,
        [1_000],
      );
      const second = await runEffect(secondRepository.acquireDispatch({
        runId,
        requestedEffectSequence: dispatchSequence,
      }));
      if (second.kind !== "claimed") throw new Error("retry was not claimed");
      expect(second.deliveryMode).toBe("retry");
      expect((await runEffect(
        secondRepository.markDispatchDeliveryStarted(second.handle),
      )).deliveryAttemptCount).toBe(2n);
      const terminal = await runEffect(
        secondRepository.recordDispatchKnownFailure(second.handle, knownFailure),
      );
      expect(terminal).toEqual({
        kind: "dispatch_rejected",
        reason: "delivery_attempts_exhausted",
      });
      expect(await runEffect(secondRepository.acquireDispatch({
        runId,
        requestedEffectSequence: dispatchSequence,
      }))).toEqual({
        kind: "closed",
        state: "rejected",
        reason: "delivery_attempts_exhausted",
      });
    });
  });

  it("stores only safe transport policy and rejects uncertain outcomes before SQL", async () => {
    await withFixture(async ({
      persistence,
      deliveryLocated,
      runId,
      dispatchSequence,
    }) => {
      const dispatchRepository = repository(deliveryLocated, CLAIM_OWNER_A);
      const acquired = await runEffect(dispatchRepository.acquireDispatch({
        runId,
        requestedEffectSequence: dispatchSequence,
      }));
      if (acquired.kind !== "claimed") throw new Error("dispatch was not claimed");
      await runEffect(
        dispatchRepository.markDispatchDeliveryStarted(acquired.handle),
      );
      let causeRead = false;
      const uncertain = new TaskComputeDispatchUncertainError({
        operation: "dispatch",
        identity: acquired.prepared.dispatchRequest.identity,
        cause: "unknown settlement",
      });
      const invalid = await runEffectFailure(
        dispatchRepository.recordDispatchKnownFailure(
          acquired.handle,
          uncertain as unknown as TaskComputeDispatchKnownFailureV1,
        ),
      );
      expect(invalid).toMatchObject({ reason: "invalid_known_failure" });
      expect((await runEffect(
        dispatchRepository.renewDispatchClaim(acquired.handle),
      )).kind).toBe("claim_renewed");

      const providerCause = Object.defineProperty({}, "secret", {
        get: () => {
          causeRead = true;
          throw new Error("cause must remain opaque");
        },
      });
      const transport = new TaskComputeDispatchTransportError({
        operation: "dispatch",
        retryable: false,
        cause: providerCause,
      });
      expect(await runEffect(
        dispatchRepository.recordDispatchKnownFailure(acquired.handle, transport),
      )).toEqual({
        kind: "dispatch_rejected",
        reason: "provider_transport",
      });
      expect(causeRead).toBe(false);
      expect(await readSettlement(persistence, runId, dispatchSequence))
        .toMatchObject({
          delivery_state: "rejected",
          claim_owner: null,
          reason_code: "provider_transport",
          acceptance_codec_version: null,
        });
    });
  });

  it("fails closed on acceptance and provider-rejection correlation drift", async () => {
    await withFixture(async ({
      persistence,
      deliveryLocated,
      runId,
      dispatchSequence,
    }) => {
      const dispatchRepository = repository(deliveryLocated, CLAIM_OWNER_A);
      const acquired = await runEffect(dispatchRepository.acquireDispatch({
        runId,
        requestedEffectSequence: dispatchSequence,
      }));
      if (acquired.kind !== "claimed") throw new Error("dispatch was not claimed");
      await runEffect(
        dispatchRepository.markDispatchDeliveryStarted(acquired.handle),
      );
      const mismatched = success(validateTaskComputeDispatchAcceptanceV1({
        version: TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1,
        kind: "accepted",
        identity: {
          ...acquired.prepared.dispatchRequest.identity,
          runId: "run_73000000-0000-4000-8000-000000000099",
        },
        execution: {
          provider: "test-provider",
          providerVersion: "v1",
          executionId: "execution-mismatch",
        },
      }));
      const failure = await runEffectFailure(
        dispatchRepository.recordDispatchAcceptance(
          acquired.handle,
          mismatched,
        ),
      );
      expect(failure).toMatchObject({
        operation: "record_dispatch_acceptance",
        reason: "acceptance_correlation_mismatch",
      });
      expect(await readClaim(persistence, runId, dispatchSequence)).toEqual({
        claim_owner: CLAIM_OWNER_A,
        claim_fence: "1",
        delivery_state: "delivering",
        delivery_attempt_count: "1",
      });
    });

    await withFixture(async ({
      persistence,
      deliveryLocated,
      runId,
      dispatchSequence,
    }) => {
      const dispatchRepository = repository(deliveryLocated, CLAIM_OWNER_A);
      const acquired = await runEffect(dispatchRepository.acquireDispatch({
        runId,
        requestedEffectSequence: dispatchSequence,
      }));
      if (acquired.kind !== "claimed") throw new Error("dispatch was not claimed");
      await runEffect(
        dispatchRepository.markDispatchDeliveryStarted(acquired.handle),
      );
      const differentProfile = success(validateTaskComputeDispatchRequestV1({
        ...acquired.prepared.dispatchRequest,
        computeProfile: "different-profile",
      })).computeProfile;
      const failure = await runEffectFailure(
        dispatchRepository.recordDispatchKnownFailure(
          acquired.handle,
          new TaskComputeDispatchRejectedError({
            operation: "dispatch",
            reason: "provider_disabled",
            retryable: false,
            computeProfile: differentProfile,
          }),
        ),
      );
      expect(failure).toMatchObject({
        operation: "record_dispatch_known_failure",
        reason: "known_failure_correlation_mismatch",
      });
      expect(await readClaim(persistence, runId, dispatchSequence)).toEqual({
        claim_owner: CLAIM_OWNER_A,
        claim_fence: "1",
        delivery_state: "delivering",
        delivery_attempt_count: "1",
      });
    });
  });

  it("replays a final-attempt uncertain dispatch beyond the known-failure ceiling", async () => {
    await withFixture(async ({
      persistence,
      deliveryLocated,
      runId,
      dispatchSequence,
    }) => {
      const firstRepository = repositoryWithPolicy(
        deliveryLocated,
        CLAIM_OWNER_A,
        2,
        [1],
      );
      const first = await runEffect(firstRepository.acquireDispatch({
        runId,
        requestedEffectSequence: dispatchSequence,
      }));
      if (first.kind !== "claimed") throw new Error("dispatch was not claimed");
      await runEffect(firstRepository.markDispatchDeliveryStarted(first.handle));
      await runEffect(firstRepository.recordDispatchKnownFailure(
        first.handle,
        new TaskComputeDispatchTransportError({
          operation: "dispatch",
          retryable: true,
          cause: "definite transport failure",
        }),
      ));
      await persistence.query(`
        update fx_system_durable_task_compute_dispatch_v1
        set delivery_started_at = created_at,
            next_attempt_at = created_at + interval '1 millisecond'
        where scope_id = $1 and run_id = $2
          and requested_effect_sequence = $3
      `, [TASK_SCOPE_ID, runId, dispatchSequence]);

      const secondRepository = repositoryWithPolicy(
        deliveryLocated,
        CLAIM_OWNER_B,
        2,
        [1],
      );
      const second = await runEffect(secondRepository.acquireDispatch({
        runId,
        requestedEffectSequence: dispatchSequence,
      }));
      if (second.kind !== "claimed") throw new Error("retry was not claimed");
      expect((await runEffect(
        secondRepository.markDispatchDeliveryStarted(second.handle),
      )).deliveryAttemptCount).toBe(2n);
      await persistence.query(`
        update fx_system_durable_task_compute_dispatch_v1
        set claimed_at = clock_timestamp() - interval '2 minutes',
            claim_expires_at = clock_timestamp() - interval '1 minute'
        where scope_id = $1 and run_id = $2
          and requested_effect_sequence = $3
      `, [TASK_SCOPE_ID, runId, dispatchSequence]);

      const recoveryRepository = repositoryWithPolicy(
        deliveryLocated,
        CLAIM_OWNER_A,
        2,
        [1],
      );
      const replay = await runEffect(recoveryRepository.acquireDispatch({
        runId,
        requestedEffectSequence: dispatchSequence,
      }));
      if (replay.kind !== "claimed") throw new Error("uncertain replay not claimed");
      expect(replay.deliveryMode).toBe("uncertain_replay");
      expect((await runEffect(
        recoveryRepository.markDispatchDeliveryStarted(replay.handle),
      )).deliveryAttemptCount).toBe(3n);
      const acceptance = success(validateTaskComputeDispatchAcceptanceV1({
        version: TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1,
        kind: "accepted",
        identity: replay.prepared.dispatchRequest.identity,
        execution: {
          provider: "test-provider",
          providerVersion: "v1",
          executionId: "recovered-execution",
        },
      }));
      expect(await runEffect(recoveryRepository.recordDispatchAcceptance(
        replay.handle,
        acceptance,
      ))).toMatchObject({ kind: "dispatch_accepted", acceptance });
    });
  });

  it("keeps cancellation discoverable until dispatch creates its checkpoint", async () => {
    await withFixture(async (fixture) => {
      const deliveryRepository = repository(
        fixture.deliveryLocated,
        CLAIM_OWNER_A,
      );
      const cancellationSequence = await requestFixtureCancellation(fixture);
      expect(await runEffect(deliveryRepository.acquireCancellation({
        runId: fixture.runId,
        requestedEffectSequence: cancellationSequence,
      }))).toEqual({ kind: "waiting_dispatch" });
      expect(await pendingDeliveryCount(
        fixture.persistence,
        fixture.runId,
        cancellationSequence,
      )).toBe(1);

      const discovery = success(makeTaskComputeDeliveryCandidateDiscovery(
        fixture.deliveryLocated,
        DISCOVERY_DEADLINE_POLICY,
      ));
      const beforeDispatch = await runEffect(
        discovery.discoverCancellationCandidates({ limit: 10 }),
      );
      expect(beforeDispatch.candidates).toHaveLength(1);
      expect(beforeDispatch.candidates[0]).toMatchObject({
        runId: fixture.runId,
        requestedEffectSequence: cancellationSequence,
      });

      const dispatch = await runEffect(deliveryRepository.acquireDispatch({
        runId: fixture.runId,
        requestedEffectSequence: fixture.dispatchSequence,
      }));
      if (dispatch.kind !== "claimed") throw new Error("dispatch was not claimed");
      await runEffect(
        deliveryRepository.markDispatchDeliveryStarted(dispatch.handle),
      );
      const acceptance = success(validateTaskComputeDispatchAcceptanceV1({
        version: TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1,
        kind: "accepted",
        identity: dispatch.prepared.dispatchRequest.identity,
        execution: {
          provider: "test-provider",
          providerVersion: "v1",
          executionId: "pre-dispatch-cancellation-race",
        },
      }));
      await runEffect(deliveryRepository.recordDispatchAcceptance(
        dispatch.handle,
        acceptance,
      ));

      const cancellation = await runEffect(
        deliveryRepository.acquireCancellation({
          runId: fixture.runId,
          requestedEffectSequence: cancellationSequence,
        }),
      );
      expect(cancellation.kind).toBe("claimed");
      expect(await pendingDeliveryCount(
        fixture.persistence,
        fixture.runId,
        cancellationSequence,
      )).toBe(0);
    });
  });

  it("waits for dispatch acceptance, then fences cancellation start, renew, release, and reacquire", async () => {
    await withFixture(async (fixture) => {
      const firstRepository = repository(
        fixture.deliveryLocated,
        CLAIM_OWNER_A,
      );
      const dispatch = await runEffect(firstRepository.acquireDispatch({
        runId: fixture.runId,
        requestedEffectSequence: fixture.dispatchSequence,
      }));
      if (dispatch.kind !== "claimed") throw new Error("dispatch was not claimed");
      const cancellationSequence = await requestFixtureCancellation(fixture);
      expect(await runEffect(firstRepository.acquireCancellation({
        runId: fixture.runId,
        requestedEffectSequence: cancellationSequence,
      }))).toEqual({ kind: "waiting_dispatch" });
      expect(await readCancellationClaim(
        fixture.persistence,
        fixture.runId,
        cancellationSequence,
      )).toEqual({
        claim_owner: null,
        claim_fence: "0",
        delivery_state: "waiting_dispatch",
        delivery_attempt_count: "0",
      });

      await runEffect(
        firstRepository.markDispatchDeliveryStarted(dispatch.handle),
      );
      const acceptance = success(validateTaskComputeDispatchAcceptanceV1({
        version: TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1,
        kind: "accepted",
        identity: dispatch.prepared.dispatchRequest.identity,
        execution: {
          provider: "test-provider",
          providerVersion: "v1",
          executionId: "cancellation-execution-1",
        },
      }));
      await runEffect(firstRepository.recordDispatchAcceptance(
        dispatch.handle,
        acceptance,
      ));
      const first = await runEffect(firstRepository.acquireCancellation({
        runId: fixture.runId,
        requestedEffectSequence: cancellationSequence,
      }));
      if (first.kind !== "claimed") {
        throw new Error("cancellation was not claimed after dispatch acceptance");
      }
      expect(first).toMatchObject({
        deliveryMode: "initial",
        request: {
          identity: {
            runId: fixture.runId,
            requestedEffectSequence: fixture.dispatchSequence,
          },
          execution: acceptance.execution,
          cancellationGeneration: 1n,
        },
      });
      expect((await runEffect(
        firstRepository.renewCancellationClaim(first.handle),
      )).kind).toBe("claim_renewed");
      expect(await runEffect(
        firstRepository.releaseCancellationBeforeDelivery(first.handle),
      )).toEqual({ kind: "claim_released" });
      expect(await runEffectFailure(
        firstRepository.renewCancellationClaim(first.handle),
      )).toMatchObject({ reason: "closed_handle" });

      const secondRepository = repository(
        fixture.deliveryLocated,
        CLAIM_OWNER_B,
      );
      const second = await runEffect(secondRepository.acquireCancellation({
        runId: fixture.runId,
        requestedEffectSequence: cancellationSequence,
      }));
      if (second.kind !== "claimed") {
        throw new Error("released cancellation was not reacquired");
      }
      const started = await runEffect(
        secondRepository.markCancellationDeliveryStarted(second.handle),
      );
      expect(started).toMatchObject({
        kind: "delivery_started",
        deliveryAttemptCount: 1n,
      });
      expect(await runEffectFailure(
        secondRepository.markCancellationDeliveryStarted(second.handle),
      )).toBeInstanceOf(TaskComputeDeliveryRepositoryStaleClaimV1Error);
      expect(await readCancellationClaim(
        fixture.persistence,
        fixture.runId,
        cancellationSequence,
      )).toEqual({
        claim_owner: CLAIM_OWNER_B,
        claim_fence: "2",
        delivery_state: "delivering",
        delivery_attempt_count: "1",
      });
    });
  });

  it("records and exactly replays a cancellation receipt without acknowledging Task cancellation", async () => {
    await withFixture(async (fixture) => {
      const cancellationRepository = repository(
        fixture.deliveryLocated,
        CLAIM_OWNER_A,
      );
      await acceptFixtureDispatch(fixture, cancellationRepository);
      const cancellationSequence = await requestFixtureCancellation(fixture);
      const acquired = await runEffect(cancellationRepository.acquireCancellation({
        runId: fixture.runId,
        requestedEffectSequence: cancellationSequence,
      }));
      if (acquired.kind !== "claimed") {
        throw new Error("cancellation was not claimed");
      }
      await runEffect(
        cancellationRepository.markCancellationDeliveryStarted(acquired.handle),
      );
      const receipt = cancellationReceipt(acquired.request);
      expect(await runEffect(cancellationRepository.recordCancellationReceipt(
        acquired.handle,
        receipt,
      ))).toEqual({
        kind: "cancellation_delivered",
        receipt,
        disposition: "current",
      });
      expect(await runEffectFailure(
        cancellationRepository.renewCancellationClaim(acquired.handle),
      )).toMatchObject({ reason: "closed_handle" });
      expect(await runEffect(cancellationRepository.acquireCancellation({
        runId: fixture.runId,
        requestedEffectSequence: cancellationSequence,
      }))).toEqual({
        kind: "delivered",
        receipt,
        disposition: "current",
      });

      const inspection = await inspectFixtureAttempt(fixture);
      expect(inspection.state).toMatchObject({
        phase: "attempt_granted",
        cancellation: { kind: "requested", generation: 1n },
      });
      expect(await readCancellationSettlement(
        fixture.persistence,
        fixture.runId,
        cancellationSequence,
      )).toMatchObject({
        delivery_state: "delivered",
        claim_owner: null,
        reason_code: null,
        receipt_codec_version: 1,
      });
    });
  });

  it("settles a started terminal race as cleanup-only without reopening Task authority", async () => {
    await withFixture(async (fixture) => {
      const firstRepository = repository(
        fixture.deliveryLocated,
        CLAIM_OWNER_A,
      );
      await acceptFixtureDispatch(fixture, firstRepository);
      const cancellationSequence = await requestFixtureCancellation(fixture);
      const first = await runEffect(firstRepository.acquireCancellation({
        runId: fixture.runId,
        requestedEffectSequence: cancellationSequence,
      }));
      if (first.kind !== "claimed") throw new Error("cancellation was not claimed");
      await runEffect(
        firstRepository.markCancellationDeliveryStarted(first.handle),
      );
      await fixture.persistence.query(`
        update fx_system_durable_task_compute_cancellation_v1
        set claimed_at = clock_timestamp() - interval '2 minutes',
            claim_expires_at = clock_timestamp() - interval '1 minute'
        where scope_id = $1 and run_id = $2
          and requested_effect_sequence = $3
      `, [TASK_SCOPE_ID, fixture.runId, cancellationSequence]);
      await acknowledgeFixtureCancellation(fixture);

      const recoveryRepository = repository(
        fixture.deliveryLocated,
        CLAIM_OWNER_B,
      );
      const replay = await runEffect(recoveryRepository.acquireCancellation({
        runId: fixture.runId,
        requestedEffectSequence: cancellationSequence,
      }));
      if (replay.kind !== "claimed") {
        throw new Error("started cancellation race was not recoverable");
      }
      expect(replay.deliveryMode).toBe("uncertain_replay");
      expect((await runEffect(
        recoveryRepository.markCancellationDeliveryStarted(replay.handle),
      )).deliveryAttemptCount).toBe(2n);
      const receipt = cancellationReceipt(replay.request);
      expect(await runEffect(recoveryRepository.recordCancellationReceipt(
        replay.handle,
        receipt,
      ))).toEqual({
        kind: "cancellation_delivered",
        receipt,
        disposition: "cleanup_only",
      });
      expect((await inspectFixtureAttempt(fixture)).state).toMatchObject({
        phase: "terminal",
        terminal: { kind: "cancelled", resolution: "acknowledged" },
      });
    });
  });

  it("makes lifecycle supersession dominate waiting, live prestart, and future retry availability", async () => {
    await withFixture(async (fixture) => {
      const firstRepository = repository(
        fixture.deliveryLocated,
        CLAIM_OWNER_A,
      );
      const dispatch = await runEffect(firstRepository.acquireDispatch({
        runId: fixture.runId,
        requestedEffectSequence: fixture.dispatchSequence,
      }));
      if (dispatch.kind !== "claimed") throw new Error("dispatch was not claimed");
      const cancellationSequence = await requestFixtureCancellation(fixture);
      expect((await runEffect(firstRepository.acquireCancellation({
        runId: fixture.runId,
        requestedEffectSequence: cancellationSequence,
      }))).kind).toBe("waiting_dispatch");
      await acknowledgeFixtureCancellation(fixture);

      expect(await runEffect(repository(
        fixture.deliveryLocated,
        CLAIM_OWNER_B,
      ).acquireCancellation({
        runId: fixture.runId,
        requestedEffectSequence: cancellationSequence,
      }))).toEqual({
        kind: "closed",
        state: "obsolete",
        reason: "lifecycle_obsolete",
      });
    });

    await withFixture(async (fixture) => {
      const firstRepository = repository(
        fixture.deliveryLocated,
        CLAIM_OWNER_A,
      );
      await acceptFixtureDispatch(fixture, firstRepository);
      const cancellationSequence = await requestFixtureCancellation(fixture);
      const claimed = await runEffect(firstRepository.acquireCancellation({
        runId: fixture.runId,
        requestedEffectSequence: cancellationSequence,
      }));
      if (claimed.kind !== "claimed") throw new Error("cancellation was not claimed");
      await acknowledgeFixtureCancellation(fixture);

      expect(await runEffect(repository(
        fixture.deliveryLocated,
        CLAIM_OWNER_B,
      ).acquireCancellation({
        runId: fixture.runId,
        requestedEffectSequence: cancellationSequence,
      }))).toEqual({
        kind: "closed",
        state: "obsolete",
        reason: "lifecycle_obsolete",
      });
      expect(await runEffectFailure(
        firstRepository.renewCancellationClaim(claimed.handle),
      )).toBeInstanceOf(TaskComputeDeliveryRepositoryStaleClaimV1Error);
    });

    await withFixture(async (fixture) => {
      const firstRepository = repository(
        fixture.deliveryLocated,
        CLAIM_OWNER_A,
      );
      await acceptFixtureDispatch(fixture, firstRepository);
      const cancellationSequence = await requestFixtureCancellation(fixture);
      const claimed = await runEffect(firstRepository.acquireCancellation({
        runId: fixture.runId,
        requestedEffectSequence: cancellationSequence,
      }));
      if (claimed.kind !== "claimed") throw new Error("cancellation was not claimed");
      await runEffect(
        firstRepository.markCancellationDeliveryStarted(claimed.handle),
      );
      await runEffect(firstRepository.recordCancellationKnownFailure(
        claimed.handle,
        new TaskComputeCancellationTransportError({
          operation: "request_cancellation",
          retryable: true,
          cause: "definite transport failure",
        }),
      ));
      await acknowledgeFixtureCancellation(fixture);

      expect(await runEffect(repository(
        fixture.deliveryLocated,
        CLAIM_OWNER_B,
      ).acquireCancellation({
        runId: fixture.runId,
        requestedEffectSequence: cancellationSequence,
      }))).toEqual({
        kind: "closed",
        state: "rejected",
        reason: "lifecycle_obsolete",
      });
      expect(await readCancellationSettlement(
        fixture.persistence,
        fixture.runId,
        cancellationSequence,
      )).toMatchObject({
        delivery_state: "rejected",
        claim_owner: null,
        reason_code: "lifecycle_obsolete",
      });
    });
  });

  it("records only known cancellation failures and closes at the retry ceiling", async () => {
    await withFixture(async (fixture) => {
      const firstRepository = repositoryWithPolicy(
        fixture.deliveryLocated,
        CLAIM_OWNER_A,
        2,
        [1],
      );
      await acceptFixtureDispatch(fixture, firstRepository);
      const cancellationSequence = await requestFixtureCancellation(fixture);
      const first = await runEffect(firstRepository.acquireCancellation({
        runId: fixture.runId,
        requestedEffectSequence: cancellationSequence,
      }));
      if (first.kind !== "claimed") throw new Error("cancellation was not claimed");
      await runEffect(
        firstRepository.markCancellationDeliveryStarted(first.handle),
      );
      const uncertain = new TaskComputeCancellationUncertainError({
        operation: "request_cancellation",
        identity: first.request.identity,
        cause: "unknown settlement",
      });
      expect(await runEffectFailure(
        firstRepository.recordCancellationKnownFailure(
          first.handle,
          uncertain as unknown as TaskComputeCancellationKnownFailureV1,
        ),
      )).toMatchObject({ reason: "invalid_known_failure" });
      expect((await runEffect(
        firstRepository.renewCancellationClaim(first.handle),
      )).kind).toBe("claim_renewed");

      expect(await runEffect(firstRepository.recordCancellationKnownFailure(
        first.handle,
        new TaskComputeCancellationRejectedError({
          operation: "request_cancellation",
          reason: "execution_not_found",
          retryable: true,
        }),
      ))).toMatchObject({
        kind: "retry_scheduled",
        reason: "provider_execution_not_found",
      });
      await fixture.persistence.query(`
        update fx_system_durable_task_compute_cancellation_v1
        set delivery_started_at = created_at,
            next_attempt_at = created_at + interval '1 millisecond'
        where scope_id = $1 and run_id = $2
          and requested_effect_sequence = $3
      `, [TASK_SCOPE_ID, fixture.runId, cancellationSequence]);

      const secondRepository = repositoryWithPolicy(
        fixture.deliveryLocated,
        CLAIM_OWNER_B,
        2,
        [1],
      );
      const second = await runEffect(secondRepository.acquireCancellation({
        runId: fixture.runId,
        requestedEffectSequence: cancellationSequence,
      }));
      if (second.kind !== "claimed") throw new Error("retry was not claimed");
      expect((await runEffect(
        secondRepository.markCancellationDeliveryStarted(second.handle),
      )).deliveryAttemptCount).toBe(2n);
      expect(await runEffect(secondRepository.recordCancellationKnownFailure(
        second.handle,
        new TaskComputeCancellationTransportError({
          operation: "request_cancellation",
          retryable: true,
          cause: Object.freeze({ secret: "must not persist" }),
        }),
      ))).toEqual({
        kind: "cancellation_rejected",
        reason: "delivery_attempts_exhausted",
      });
      expect(await runEffect(secondRepository.acquireCancellation({
        runId: fixture.runId,
        requestedEffectSequence: cancellationSequence,
      }))).toEqual({
        kind: "closed",
        state: "rejected",
        reason: "delivery_attempts_exhausted",
      });
    });
  });

  it("settles a provider stale generation as terminal non-receipt evidence", async () => {
    await withFixture(async (fixture) => {
      const deliveryRepository = repository(
        fixture.deliveryLocated,
        CLAIM_OWNER_A,
      );
      const provider = success(makeInMemoryTaskComputeProviderV1(
        computeProviderDescriptor,
      ));
      const dispatch = await runEffect(deliveryRepository.acquireDispatch({
        runId: fixture.runId,
        requestedEffectSequence: fixture.dispatchSequence,
      }));
      if (dispatch.kind !== "claimed") throw new Error("dispatch was not claimed");
      const acceptance = await runEffect(
        provider.dispatch(dispatch.prepared.dispatchRequest),
      );
      await runEffect(
        deliveryRepository.markDispatchDeliveryStarted(dispatch.handle),
      );
      await runEffect(deliveryRepository.recordDispatchAcceptance(
        dispatch.handle,
        acceptance,
      ));

      const cancellationSequence = await requestFixtureCancellation(fixture);
      const cancellation = await runEffect(
        deliveryRepository.acquireCancellation({
          runId: fixture.runId,
          requestedEffectSequence: cancellationSequence,
        }),
      );
      if (cancellation.kind !== "claimed") {
        throw new Error("cancellation was not claimed");
      }
      await runEffect(
        deliveryRepository.markCancellationDeliveryStarted(cancellation.handle),
      );

      const newerRequest = Object.freeze({
        ...cancellation.request,
        cancellationGeneration: cancellationGenerationTwo,
      });
      await runEffect(provider.requestCancellation(newerRequest));
      const stale = await runEffect(
        provider.requestCancellation(cancellation.request).pipe(Effect.flip),
      );
      expect(stale).toBeInstanceOf(TaskComputeCancellationStaleError);
      expect(stale).toMatchObject({
        identity: cancellation.request.identity,
        receivedGeneration: cancellationGenerationOne,
        acceptedGeneration: cancellationGenerationTwo,
      });
      if (!(stale instanceof TaskComputeCancellationStaleError)) {
        throw new Error("provider did not return a stale-generation result");
      }

      expect(await runEffect(deliveryRepository.recordCancellationKnownFailure(
        cancellation.handle,
        stale,
      ))).toEqual({
        kind: "cancellation_rejected",
        reason: "provider_stale_generation",
      });
      expect(await runEffectFailure(
        deliveryRepository.renewCancellationClaim(cancellation.handle),
      )).toMatchObject({ reason: "closed_handle" });
      expect(await readCancellationSettlement(
        fixture.persistence,
        fixture.runId,
        cancellationSequence,
      )).toEqual({
        delivery_state: "rejected",
        claim_owner: null,
        reason_code: "provider_stale_generation",
        receipt_codec_version: null,
      });
      expect(await runEffect(repository(
        fixture.deliveryLocated,
        CLAIM_OWNER_B,
      ).acquireCancellation({
        runId: fixture.runId,
        requestedEffectSequence: cancellationSequence,
      }))).toEqual({
        kind: "closed",
        state: "rejected",
        reason: "provider_stale_generation",
      });
      expect((await inspectFixtureAttempt(fixture)).state).toMatchObject({
        phase: "attempt_granted",
        cancellation: { kind: "requested", generation: 1n },
      });
    });
  });

  it("rejects hostile and mismatched stale-generation evidence", async () => {
    await withFixture(async (fixture) => {
      const deliveryRepository = repository(
        fixture.deliveryLocated,
        CLAIM_OWNER_A,
      );
      await acceptFixtureDispatch(fixture, deliveryRepository);
      const cancellationSequence = await requestFixtureCancellation(fixture);
      const cancellation = await runEffect(
        deliveryRepository.acquireCancellation({
          runId: fixture.runId,
          requestedEffectSequence: cancellationSequence,
        }),
      );
      if (cancellation.kind !== "claimed") {
        throw new Error("cancellation was not claimed");
      }
      await runEffect(
        deliveryRepository.markCancellationDeliveryStarted(cancellation.handle),
      );

      let identityGetterInvoked = false;
      const hostile = Object.create(
        TaskComputeCancellationStaleError.prototype,
        {
          identity: {
            get: () => {
              identityGetterInvoked = true;
              return cancellation.request.identity;
            },
          },
          receivedGeneration: { value: cancellationGenerationOne },
          acceptedGeneration: { value: cancellationGenerationTwo },
        },
      ) as TaskComputeCancellationStaleError;
      expect(await runEffectFailure(
        deliveryRepository.recordCancellationKnownFailure(
          cancellation.handle,
          hostile,
        ),
      )).toMatchObject({ reason: "invalid_known_failure" });
      expect(identityGetterInvoked).toBe(false);
      expect((await runEffect(
        deliveryRepository.renewCancellationClaim(cancellation.handle),
      )).kind).toBe("claim_renewed");

      expect(await runEffectFailure(
        deliveryRepository.recordCancellationKnownFailure(
          cancellation.handle,
          new TaskComputeCancellationStaleError({
            identity: cancellation.request.identity,
            receivedGeneration: cancellationGenerationTwo,
            acceptedGeneration: cancellationGenerationOne,
          }),
        ),
      )).toMatchObject({ reason: "invalid_known_failure" });
      expect((await runEffect(
        deliveryRepository.renewCancellationClaim(cancellation.handle),
      )).kind).toBe("claim_renewed");

      const mismatched = new TaskComputeCancellationStaleError({
        identity: cancellation.request.identity,
        receivedGeneration: cancellationGenerationTwo,
        acceptedGeneration: cancellationGenerationThree,
      });
      expect(await runEffectFailure(
        deliveryRepository.recordCancellationKnownFailure(
          cancellation.handle,
          mismatched,
        ),
      )).toMatchObject({ reason: "known_failure_correlation_mismatch" });
      expect(await runEffectFailure(
        deliveryRepository.renewCancellationClaim(cancellation.handle),
      )).toMatchObject({ reason: "closed_handle" });
      expect(await readCancellationSettlement(
        fixture.persistence,
        fixture.runId,
        cancellationSequence,
      )).toMatchObject({
        delivery_state: "delivering",
        claim_owner: CLAIM_OWNER_A,
        reason_code: null,
        receipt_codec_version: null,
      });
    });

    await withFixture(async (fixture) => {
      const deliveryRepository = repository(
        fixture.deliveryLocated,
        CLAIM_OWNER_A,
      );
      await acceptFixtureDispatch(fixture, deliveryRepository);
      const cancellationSequence = await requestFixtureCancellation(fixture);
      const cancellation = await runEffect(
        deliveryRepository.acquireCancellation({
          runId: fixture.runId,
          requestedEffectSequence: cancellationSequence,
        }),
      );
      if (cancellation.kind !== "claimed") {
        throw new Error("cancellation was not claimed");
      }
      await runEffect(
        deliveryRepository.markCancellationDeliveryStarted(cancellation.handle),
      );
      const otherSequence = success(decodeTaskRequestedEffectSequenceV1(
        (cancellation.request.identity.requestedEffectSequence + 1n).toString(),
      ));
      expect(await runEffectFailure(
        deliveryRepository.recordCancellationKnownFailure(
          cancellation.handle,
          new TaskComputeCancellationStaleError({
            identity: Object.freeze({
              ...cancellation.request.identity,
              requestedEffectSequence: otherSequence,
            }),
            receivedGeneration: cancellationGenerationOne,
            acceptedGeneration: cancellationGenerationTwo,
          }),
        ),
      )).toMatchObject({ reason: "known_failure_correlation_mismatch" });
      expect(await runEffectFailure(
        deliveryRepository.renewCancellationClaim(cancellation.handle),
      )).toMatchObject({ reason: "closed_handle" });
      expect(await readCancellationSettlement(
        fixture.persistence,
        fixture.runId,
        cancellationSequence,
      )).toMatchObject({
        delivery_state: "delivering",
        claim_owner: CLAIM_OWNER_A,
        reason_code: null,
        receipt_codec_version: null,
      });
    });
  });

  it("replays final-attempt uncertain cancellation beyond the known-failure ceiling", async () => {
    await withFixture(async (fixture) => {
      const firstRepository = repositoryWithPolicy(
        fixture.deliveryLocated,
        CLAIM_OWNER_A,
        2,
        [1],
      );
      await acceptFixtureDispatch(fixture, firstRepository);
      const cancellationSequence = await requestFixtureCancellation(fixture);
      const first = await runEffect(firstRepository.acquireCancellation({
        runId: fixture.runId,
        requestedEffectSequence: cancellationSequence,
      }));
      if (first.kind !== "claimed") throw new Error("cancellation was not claimed");
      await runEffect(
        firstRepository.markCancellationDeliveryStarted(first.handle),
      );
      await runEffect(firstRepository.recordCancellationKnownFailure(
        first.handle,
        new TaskComputeCancellationTransportError({
          operation: "request_cancellation",
          retryable: true,
          cause: "definite transport failure",
        }),
      ));
      await fixture.persistence.query(`
        update fx_system_durable_task_compute_cancellation_v1
        set delivery_started_at = created_at,
            next_attempt_at = created_at + interval '1 millisecond'
        where scope_id = $1 and run_id = $2
          and requested_effect_sequence = $3
      `, [TASK_SCOPE_ID, fixture.runId, cancellationSequence]);

      const secondRepository = repositoryWithPolicy(
        fixture.deliveryLocated,
        CLAIM_OWNER_B,
        2,
        [1],
      );
      const second = await runEffect(secondRepository.acquireCancellation({
        runId: fixture.runId,
        requestedEffectSequence: cancellationSequence,
      }));
      if (second.kind !== "claimed") throw new Error("retry was not claimed");
      expect((await runEffect(
        secondRepository.markCancellationDeliveryStarted(second.handle),
      )).deliveryAttemptCount).toBe(2n);
      await fixture.persistence.query(`
        update fx_system_durable_task_compute_cancellation_v1
        set claimed_at = clock_timestamp() - interval '2 minutes',
            claim_expires_at = clock_timestamp() - interval '1 minute'
        where scope_id = $1 and run_id = $2
          and requested_effect_sequence = $3
      `, [TASK_SCOPE_ID, fixture.runId, cancellationSequence]);

      const recoveryRepository = repositoryWithPolicy(
        fixture.deliveryLocated,
        CLAIM_OWNER_A,
        2,
        [1],
      );
      const replay = await runEffect(recoveryRepository.acquireCancellation({
        runId: fixture.runId,
        requestedEffectSequence: cancellationSequence,
      }));
      if (replay.kind !== "claimed") throw new Error("uncertain replay not claimed");
      expect(replay.deliveryMode).toBe("uncertain_replay");
      expect((await runEffect(
        recoveryRepository.markCancellationDeliveryStarted(replay.handle),
      )).deliveryAttemptCount).toBe(3n);
      const receipt = cancellationReceipt(replay.request);
      expect(await runEffect(recoveryRepository.recordCancellationReceipt(
        replay.handle,
        receipt,
      ))).toMatchObject({ kind: "cancellation_delivered", receipt });
    });
  });

  it("rejects hostile acquisition values and foreign handles before SQL without closing a current handle", async () => {
    await withFixture(async (fixture) => {
      const base = createDefaultLocatedReadCommittedTransactionRunnerV1(
        fixture.persistence.drizzle,
      );
      let transactionCalls = 0;
      const observedRunner: RunLocatedReadCommittedTransactionV1 =
        async <Value>(work: (tx: AppRowTransaction) => Promise<Value>) => {
          transactionCalls += 1;
          return base(work);
        };
      const located = deliveryLocatedWithRunner(fixture, observedRunner);
      const dispatchRepository = repository(located, CLAIM_OWNER_A);

      let getterInvoked = false;
      const hostileRequest = Object.defineProperties({}, {
        runId: {
          enumerable: true,
          get: () => {
            getterInvoked = true;
            return fixture.runId;
          },
        },
        requestedEffectSequence: {
          enumerable: true,
          value: fixture.dispatchSequence,
        },
      });
      expect(await runEffectFailure(dispatchRepository.acquireDispatch(
        hostileRequest as Parameters<
          TaskComputeDeliveryRepositoryV1["acquireDispatch"]
        >[0],
      ))).toMatchObject({
        operation: "acquire_dispatch",
        reason: "invalid_request",
      });
      expect(getterInvoked).toBe(false);
      expect(transactionCalls).toBe(0);

      const invalidOwnerRepository = success(
        makeTaskComputeDeliveryRepositoryV1(located, {
          claimDurationMilliseconds: 30_000,
          retryDelayMilliseconds: [1_000, 2_000],
          maximumDeliveryAttempts: 3,
          randomUuid: () => "not-a-uuid",
        }),
      );
      expect(await runEffectFailure(invalidOwnerRepository.acquireDispatch({
        runId: fixture.runId,
        requestedEffectSequence: fixture.dispatchSequence,
      }))).toMatchObject({
        operation: "acquire_dispatch",
        reason: "claim_owner_invalid",
      });
      expect(transactionCalls).toBe(0);

      const acquired = await runEffect(dispatchRepository.acquireDispatch({
        runId: fixture.runId,
        requestedEffectSequence: fixture.dispatchSequence,
      }));
      if (acquired.kind !== "claimed") throw new Error("dispatch was not claimed");
      expect(transactionCalls).toBe(1);

      const forged = Object.freeze({});
      expect(await runEffectFailure(dispatchRepository.renewDispatchClaim(
        forged as Parameters<
          TaskComputeDeliveryRepositoryV1["renewDispatchClaim"]
        >[0],
      ))).toMatchObject({ reason: "invalid_handle" });
      expect(await runEffectFailure(dispatchRepository.renewCancellationClaim(
        acquired.handle as unknown as Parameters<
          TaskComputeDeliveryRepositoryV1["renewCancellationClaim"]
        >[0],
      ))).toMatchObject({ reason: "invalid_handle" });
      expect(await runEffectFailure(repository(
        located,
        CLAIM_OWNER_B,
      ).renewDispatchClaim(acquired.handle))).toMatchObject({
        reason: "invalid_handle",
      });
      expect(transactionCalls).toBe(1);

      const revoked = Proxy.revocable({}, {});
      revoked.revoke();
      expect(await runEffectFailure(dispatchRepository.recordDispatchAcceptance(
        acquired.handle,
        revoked.proxy as Parameters<
          TaskComputeDeliveryRepositoryV1["recordDispatchAcceptance"]
        >[1],
      ))).toMatchObject({ reason: "invalid_acceptance" });
      expect(transactionCalls).toBe(1);
      expect((await runEffect(
        dispatchRepository.renewDispatchClaim(acquired.handle),
      )).kind).toBe("claim_renewed");
      expect(transactionCalls).toBe(2);
    });
  });

  it("fails closed on stored dispatch and cancellation digest corruption without regenerating evidence", async () => {
    await withFixture(async (fixture) => {
      const dispatchRepository = repository(
        fixture.deliveryLocated,
        CLAIM_OWNER_A,
      );
      const acquired = await runEffect(dispatchRepository.acquireDispatch({
        runId: fixture.runId,
        requestedEffectSequence: fixture.dispatchSequence,
      }));
      if (acquired.kind !== "claimed") throw new Error("dispatch was not claimed");
      await runEffect(
        dispatchRepository.releaseDispatchBeforeDelivery(acquired.handle),
      );
      await fixture.persistence.query(`
        update fx_system_durable_task_compute_dispatch_v1
        set request_sha256 = $4
        where scope_id = $1 and run_id = $2
          and requested_effect_sequence = $3
      `, [
        TASK_SCOPE_ID,
        fixture.runId,
        fixture.dispatchSequence,
        new Uint8Array(32),
      ]);

      const failure = await runEffectFailure(repository(
        fixture.deliveryLocated,
        CLAIM_OWNER_B,
      ).acquireDispatch({
        runId: fixture.runId,
        requestedEffectSequence: fixture.dispatchSequence,
      }));
      expect(failure).toBeInstanceOf(TaskComputeDeliveryEvidenceV1Error);
      expect(failure).toMatchObject({
        operation: "decode_dispatch_request",
        reason: "invalid_digest",
      });
      expect(await readClaim(
        fixture.persistence,
        fixture.runId,
        fixture.dispatchSequence,
      )).toEqual({
        claim_owner: null,
        claim_fence: "1",
        delivery_state: "prepared",
        delivery_attempt_count: "0",
      });
    });

    await withFixture(async (fixture) => {
      const cancellationRepository = repository(
        fixture.deliveryLocated,
        CLAIM_OWNER_A,
      );
      await acceptFixtureDispatch(fixture, cancellationRepository);
      const cancellationSequence = await requestFixtureCancellation(fixture);
      const acquired = await runEffect(cancellationRepository.acquireCancellation({
        runId: fixture.runId,
        requestedEffectSequence: cancellationSequence,
      }));
      if (acquired.kind !== "claimed") {
        throw new Error("cancellation was not claimed");
      }
      await runEffect(
        cancellationRepository.markCancellationDeliveryStarted(acquired.handle),
      );
      await runEffect(cancellationRepository.recordCancellationReceipt(
        acquired.handle,
        cancellationReceipt(acquired.request),
      ));
      await fixture.persistence.query(`
        update fx_system_durable_task_compute_cancellation_v1
        set receipt_sha256 = $4
        where scope_id = $1 and run_id = $2
          and requested_effect_sequence = $3
      `, [
        TASK_SCOPE_ID,
        fixture.runId,
        cancellationSequence,
        new Uint8Array(32),
      ]);

      const failure = await runEffectFailure(repository(
        fixture.deliveryLocated,
        CLAIM_OWNER_B,
      ).acquireCancellation({
        runId: fixture.runId,
        requestedEffectSequence: cancellationSequence,
      }));
      expect(failure).toBeInstanceOf(TaskComputeDeliveryEvidenceV1Error);
      expect(failure).toMatchObject({
        operation: "decode_cancellation_receipt",
        reason: "invalid_digest",
      });
      expect(await readCancellationSettlement(
        fixture.persistence,
        fixture.runId,
        cancellationSequence,
      )).toMatchObject({
        delivery_state: "delivered",
        claim_owner: null,
        receipt_codec_version: 1,
      });
    });
  });

  it("retries one direct serialization rollback and exposes second rollback exhaustion", async () => {
    await withFixture(async (fixture) => {
      const injected = selectFailureRunner(fixture, 1, "40001");
      const acquired = await runEffect(repository(
        deliveryLocatedWithRunner(fixture, injected.run),
        CLAIM_OWNER_A,
      ).acquireDispatch({
        runId: fixture.runId,
        requestedEffectSequence: fixture.dispatchSequence,
      }));
      expect(acquired.kind).toBe("claimed");
      expect(injected.invocations()).toBe(2);
      expect(injected.failures()).toBe(1);
    });

    await withFixture(async (fixture) => {
      const injected = selectFailureRunner(fixture, 2, "40P01");
      const failure = await runEffectFailure(repository(
        deliveryLocatedWithRunner(fixture, injected.run),
        CLAIM_OWNER_A,
      ).acquireDispatch({
        runId: fixture.runId,
        requestedEffectSequence: fixture.dispatchSequence,
      }));
      expect(failure).toBeInstanceOf(
        TaskComputeDeliveryRepositoryConfirmedRollbackV1Error,
      );
      expect(failure).toMatchObject({ operation: "acquire_dispatch" });
      expect(injected.invocations()).toBe(2);
      expect(injected.failures()).toBe(2);
      expect(await dispatchCheckpointCount(fixture)).toBe(0);
    });
  });

  it("classifies decision uncertainty and cleanup failure while permanently closing dispatched handles", async () => {
    await withFixture(async (fixture) => {
      const base = createDefaultLocatedReadCommittedTransactionRunnerV1(
        fixture.persistence.drizzle,
      );
      let calls = 0;
      const uncertainRunner: RunLocatedReadCommittedTransactionV1 =
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
      const dispatchRepository = repository(
        deliveryLocatedWithRunner(fixture, uncertainRunner),
        CLAIM_OWNER_A,
      );
      const acquired = await runEffect(dispatchRepository.acquireDispatch({
        runId: fixture.runId,
        requestedEffectSequence: fixture.dispatchSequence,
      }));
      if (acquired.kind !== "claimed") throw new Error("dispatch was not claimed");
      const failure = await runEffectFailure(
        dispatchRepository.markDispatchDeliveryStarted(acquired.handle),
      );
      expect(failure).toBeInstanceOf(
        TaskComputeDeliveryRepositoryDecisionUncertainV1Error,
      );
      expect(failure).toMatchObject({
        operation: "mark_dispatch_delivery_started",
      });
      expect(await runEffectFailure(
        dispatchRepository.renewDispatchClaim(acquired.handle),
      )).toMatchObject({ reason: "closed_handle" });
      expect(calls).toBe(2);
      expect(await readClaim(
        fixture.persistence,
        fixture.runId,
        fixture.dispatchSequence,
      )).toMatchObject({
        delivery_state: "delivering",
        delivery_attempt_count: "1",
      });
    });

    await withFixture(async (fixture) => {
      const base = createDefaultLocatedReadCommittedTransactionRunnerV1(
        fixture.persistence.drizzle,
      );
      let calls = 0;
      const cleanupRunner: RunLocatedReadCommittedTransactionV1 =
        async <Value>(work: (tx: AppRowTransaction) => Promise<Value>) => {
          calls += 1;
          if (calls === 2) {
            throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
              kind: "callbackCleanupFailed",
              callbackCause: new Error("callback failed"),
              transactionCause: new Error("rollback cleanup failed"),
            }));
          }
          return base(work);
        };
      const dispatchRepository = repository(
        deliveryLocatedWithRunner(fixture, cleanupRunner),
        CLAIM_OWNER_A,
      );
      const acquired = await runEffect(dispatchRepository.acquireDispatch({
        runId: fixture.runId,
        requestedEffectSequence: fixture.dispatchSequence,
      }));
      if (acquired.kind !== "claimed") throw new Error("dispatch was not claimed");
      const failure = await runEffectFailure(
        dispatchRepository.markDispatchDeliveryStarted(acquired.handle),
      );
      expect(failure).toBeInstanceOf(TaskComputeDeliveryRepositorySqlV1Error);
      expect(failure).toMatchObject({
        operation: "mark_dispatch_delivery_started",
        phase: "cleanup",
      });
      expect(await runEffectFailure(
        dispatchRepository.renewDispatchClaim(acquired.handle),
      )).toMatchObject({ reason: "closed_handle" });
      expect(calls).toBe(2);
    });
  });

  it("preserves raw defects and waits for a dispatched transaction before interruption closes the handle", async () => {
    await withFixture(async (fixture) => {
      const base = createDefaultLocatedReadCommittedTransactionRunnerV1(
        fixture.persistence.drizzle,
      );
      const defect = new Error("runner defect");
      let calls = 0;
      const defectRunner: RunLocatedReadCommittedTransactionV1 =
        async <Value>(work: (tx: AppRowTransaction) => Promise<Value>) => {
          calls += 1;
          if (calls === 2) {
            return base(async (tx) => {
              await work(tx);
              throw defect;
            });
          }
          return base(work);
        };
      const dispatchRepository = repository(
        deliveryLocatedWithRunner(fixture, defectRunner),
        CLAIM_OWNER_A,
      );
      const acquired = await runEffect(dispatchRepository.acquireDispatch({
        runId: fixture.runId,
        requestedEffectSequence: fixture.dispatchSequence,
      }));
      if (acquired.kind !== "claimed") throw new Error("dispatch was not claimed");
      const exit = await runEffect(Effect.exit(
        dispatchRepository.markDispatchDeliveryStarted(acquired.handle),
      ));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const observed = Cause.findDefect(exit.cause);
        expect(Result.isSuccess(observed)).toBe(true);
        if (Result.isSuccess(observed)) expect(observed.success).toBe(defect);
      }
      expect(await runEffectFailure(
        dispatchRepository.renewDispatchClaim(acquired.handle),
      )).toMatchObject({ reason: "closed_handle" });
      expect(await readClaim(
        fixture.persistence,
        fixture.runId,
        fixture.dispatchSequence,
      )).toMatchObject({
        delivery_state: "prepared",
        delivery_attempt_count: "0",
      });
    });

    await withFixture(async (fixture) => {
      const base = createDefaultLocatedReadCommittedTransactionRunnerV1(
        fixture.persistence.drizzle,
      );
      const entered = latch<void>();
      const release = latch<void>();
      let calls = 0;
      const blockedRunner: RunLocatedReadCommittedTransactionV1 =
        async <Value>(work: (tx: AppRowTransaction) => Promise<Value>) => {
          calls += 1;
          if (calls !== 2) return base(work);
          return base(async (tx) => {
            const value = await work(tx);
            entered.resolve(undefined);
            await release.promise;
            return value;
          });
        };
      const dispatchRepository = repository(
        deliveryLocatedWithRunner(fixture, blockedRunner),
        CLAIM_OWNER_A,
      );
      const acquired = await runEffect(dispatchRepository.acquireDispatch({
        runId: fixture.runId,
        requestedEffectSequence: fixture.dispatchSequence,
      }));
      if (acquired.kind !== "claimed") throw new Error("dispatch was not claimed");

      const interruptedAfterSettlement = await runEffect(Effect.gen(function* () {
        const operationFiber = yield* dispatchRepository
          .markDispatchDeliveryStarted(acquired.handle)
          .pipe(Effect.forkChild);
        yield* Effect.promise(() => entered.promise);
        let interruptCompleted = false;
        const interruptFiber = yield* Fiber.interrupt(operationFiber).pipe(
            Effect.tap(() => Effect.sync(() => {
              interruptCompleted = true;
            })),
            Effect.forkChild({ startImmediately: true }),
          );
        const completedBeforeSettlement = interruptCompleted;
        release.resolve(undefined);
        yield* Fiber.join(interruptFiber);
        return { completedBeforeSettlement, interruptCompleted };
      }));
      expect(interruptedAfterSettlement).toEqual({
        completedBeforeSettlement: false,
        interruptCompleted: true,
      });
      expect(await runEffectFailure(
        dispatchRepository.renewDispatchClaim(acquired.handle),
      )).toMatchObject({ reason: "closed_handle" });
      expect(await readClaim(
        fixture.persistence,
        fixture.runId,
        fixture.dispatchSequence,
      )).toMatchObject({
        delivery_state: "delivering",
        delivery_attempt_count: "1",
      });
    });
  });
});

async function acceptFixtureDispatch(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  deliveryRepository: TaskComputeDeliveryRepositoryV1,
) {
  const acquired = await runEffect(deliveryRepository.acquireDispatch({
    runId: fixture.runId,
    requestedEffectSequence: fixture.dispatchSequence,
  }));
  if (acquired.kind !== "claimed") throw new Error("dispatch was not claimed");
  await runEffect(
    deliveryRepository.markDispatchDeliveryStarted(acquired.handle),
  );
  const acceptance = success(validateTaskComputeDispatchAcceptanceV1({
    version: TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1,
    kind: "accepted",
    identity: acquired.prepared.dispatchRequest.identity,
    execution: {
      provider: "test-provider",
      providerVersion: "v1",
      executionId: "cancellation-execution-1",
    },
  }));
  await runEffect(deliveryRepository.recordDispatchAcceptance(
    acquired.handle,
    acceptance,
  ));
  return acceptance;
}

async function requestFixtureCancellation(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
) {
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

function inspectFixtureAttempt(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
) {
  return runEffect(Effect.gen(function* () {
    const lifecycle = yield* RunAttemptLifecycle;
    return yield* lifecycle.inspectCurrentAttempt({
      type: "inspect_current_attempt",
      runId: fixture.runId,
    });
  }).pipe(Effect.provide(fixture.lifecycleLayer)));
}

async function acknowledgeFixtureCancellation(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
) {
  await runEffect(Effect.gen(function* () {
    const lifecycle = yield* RunAttemptLifecycle;
    return yield* lifecycle.completeAttempt({
      type: "complete_attempt",
      runId: fixture.runId,
      attemptId: fixture.attemptGrant.attempt.attemptId,
      executionFence: fixture.attemptGrant.attempt.executionFence,
      completion: {
        kind: "cancellation_acknowledged",
        cancellationGeneration: cancellationGenerationOne,
        executionDurationMs: null,
      },
    });
  }).pipe(Effect.provide(fixture.lifecycleLayer)));
}

function cancellationReceipt(
  request: Extract<
    TaskComputeCancellationAcquireResultV1,
    { readonly kind: "claimed" }
  >["request"],
) {
  return success(validateTaskComputeCancellationReceiptV1({
    version: TASK_COMPUTE_CANCELLATION_RECEIPT_VERSION_V1,
    kind: "interruption_requested",
    identity: request.identity,
    execution: request.execution,
    cancellationGeneration: request.cancellationGeneration,
  }));
}

async function readClaim(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
  runId: string,
  dispatchSequence: bigint,
) {
  const stored = await persistence.query<{
    claim_owner: string | null;
    claim_fence: string;
    delivery_state: string;
    delivery_attempt_count: string;
  }>(`
    select claim_owner::text, claim_fence::text, delivery_state,
           delivery_attempt_count::text
    from fx_system_durable_task_compute_dispatch_v1
    where scope_id = $1 and run_id = $2
      and requested_effect_sequence = $3
  `, [TASK_SCOPE_ID, runId, dispatchSequence]);
  return stored.rows[0];
}

async function readSettlement(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
  runId: string,
  dispatchSequence: bigint,
) {
  const stored = await persistence.query<{
    delivery_state: string;
    claim_owner: string | null;
    reason_code: string | null;
    acceptance_codec_version: number | null;
  }>(`
    select delivery_state, claim_owner::text, reason_code,
           acceptance_codec_version
    from fx_system_durable_task_compute_dispatch_v1
    where scope_id = $1 and run_id = $2
      and requested_effect_sequence = $3
  `, [TASK_SCOPE_ID, runId, dispatchSequence]);
  return stored.rows[0];
}

async function readCancellationClaim(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
  runId: string,
  cancellationSequence: bigint,
) {
  const stored = await persistence.query<{
    claim_owner: string | null;
    claim_fence: string;
    delivery_state: string;
    delivery_attempt_count: string;
  }>(`
    select claim_owner::text, claim_fence::text, delivery_state,
           delivery_attempt_count::text
    from fx_system_durable_task_compute_cancellation_v1
    where scope_id = $1 and run_id = $2
      and requested_effect_sequence = $3
  `, [TASK_SCOPE_ID, runId, cancellationSequence]);
  return stored.rows[0];
}

async function readCancellationSettlement(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
  runId: string,
  cancellationSequence: bigint,
) {
  const stored = await persistence.query<{
    delivery_state: string;
    claim_owner: string | null;
    reason_code: string | null;
    receipt_codec_version: number | null;
  }>(`
    select delivery_state, claim_owner::text, reason_code,
           receipt_codec_version
    from fx_system_durable_task_compute_cancellation_v1
    where scope_id = $1 and run_id = $2
      and requested_effect_sequence = $3
  `, [TASK_SCOPE_ID, runId, cancellationSequence]);
  return stored.rows[0];
}

function repository(
  located: Parameters<typeof makeTaskComputeDeliveryRepositoryV1>[0],
  claimOwner: string,
) {
  return success(makeTaskComputeDeliveryRepositoryV1(located, {
    claimDurationMilliseconds: 30_000,
    retryDelayMilliseconds: [1_000, 2_000],
    maximumDeliveryAttempts: 3,
    randomUuid: () => claimOwner,
  }));
}

function repositoryWithPolicy(
  located: Parameters<typeof makeTaskComputeDeliveryRepositoryV1>[0],
  claimOwner: string,
  maximumDeliveryAttempts: number,
  retryDelayMilliseconds: ReadonlyArray<number>,
) {
  return success(makeTaskComputeDeliveryRepositoryV1(located, {
    claimDurationMilliseconds: 30_000,
    retryDelayMilliseconds,
    maximumDeliveryAttempts,
    randomUuid: () => claimOwner,
  }));
}

type DeliveryFixture = Awaited<ReturnType<typeof makeFixture>>;

function deliveryLocatedWithRunner(
  fixture: DeliveryFixture,
  runner: RunLocatedReadCommittedTransactionV1,
) {
  return Object.freeze({
    authority: fixture.deliveryLocated.authority,
    target: createLocatedTaskComputeDeliveryTargetV1(
      fixture.persistence.drizzle,
      TASK_LOCATOR,
      runner,
    ),
  });
}

function selectFailureRunner(
  fixture: DeliveryFixture,
  maximumFailures: number,
  code: "40001" | "40P01",
) {
  const base = createDefaultLocatedReadCommittedTransactionRunnerV1(
    fixture.persistence.drizzle,
  );
  let invocationCount = 0;
  let failureCount = 0;
  const run: RunLocatedReadCommittedTransactionV1 =
    async <Value>(work: (tx: AppRowTransaction) => Promise<Value>) => {
      invocationCount += 1;
      return base((tx) => {
        if (failureCount >= maximumFailures) return work(tx);
        failureCount += 1;
        return work(new Proxy(tx, {
          get(target, property) {
            if (property === "select") {
              return () => {
                const failure = new Error("injected retryable conflict");
                Object.defineProperty(failure, "code", {
                  value: code,
                  enumerable: true,
                });
                throw failure;
              };
            }
            return Reflect.get(target, property, target);
          },
        }));
      });
    };
  return Object.freeze({
    run,
    invocations: () => invocationCount,
    failures: () => failureCount,
  });
}

async function dispatchCheckpointCount(fixture: DeliveryFixture) {
  const result = await fixture.persistence.query<{ count: string }>(`
    select count(*)::text as count
    from fx_system_durable_task_compute_dispatch_v1
    where scope_id = $1 and run_id = $2
      and requested_effect_sequence = $3
  `, [TASK_SCOPE_ID, fixture.runId, fixture.dispatchSequence]);
  return Number(result.rows[0]?.count ?? "-1");
}

async function pendingDeliveryCount(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
  runId: string,
  requestedEffectSequence: bigint,
) {
  const result = await persistence.query<{ count: string }>(`
    select count(*)::text as count
    from fx_system_durable_task_compute_pending_v1
    where scope_id = $1 and run_id = $2
      and requested_effect_sequence = $3
  `, [TASK_SCOPE_ID, runId, requestedEffectSequence]);
  return Number(result.rows[0]?.count ?? "-1");
}

function latch<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return Object.freeze({ promise, resolve });
}

async function withFixture(
  run: (fixture: Awaited<ReturnType<typeof makeFixture>>) => Promise<void>,
): Promise<void> {
  const raw = new PGlite();
  try {
    await run(await makeFixture(raw));
  } finally {
    await raw.close();
  }
}

async function makeFixture(raw: PGlite) {
  const persistence = await createPGlitePersistence({ db: raw });
  await persistence.migrate();
  await seedTaskSystemRunAttemptStoreV1(persistence);
  await persistence.query(`
    delete from fx_system_durable_task_run_v1
    where scope_id = '${TASK_SCOPE_ID}'
  `);
  const runtimeBinding = await makeTaskSystemCreationRuntimeBindingV1();
  const creationAuthority = makeTaskSystemCreationAuthorityV1();
  await installTaskSystemCreationRuntimeBindingV1(
    persistence.drizzle,
    runtimeBinding,
    creationAuthority,
  );
  const lifecycleTarget = createPGliteLocatedTaskSystemRunAttemptTargetV1(
    persistence,
    TASK_LOCATOR,
  );
  const lifecycleLocated = await locatedTaskAuthorityV1(
    persistence.drizzle,
    lifecycleTarget,
  );
  const creationStore = makeTaskSystemCreationStoreForTestV1({
    located: lifecycleLocated,
    runtimeBinding,
    creationAuthority,
  }, {
    randomUuid: () => TASK_SYSTEM_CREATION_RUN_UUID_A,
  });
  const created = await runEffect(creationStore.createRun(
    makeTaskSystemCreationRequestV1("delivery-repository", 0x71),
  ));
  const lifecycleStore = makeTaskSystemRunAttemptStoreV1(lifecycleLocated, {
    randomUuid: () => ACCEPTED_ATTEMPT_UUID,
  });
  const lifecycleLayer = RunAttemptLifecycleLive.pipe(
    Layer.provide(Layer.succeed(TaskSystemRunAttemptStore, lifecycleStore)),
  );
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
  );
  const deliveryLocated = Object.freeze({
    authority: lifecycleLocated.authority,
    target: deliveryTarget,
  });
  return Object.freeze({
    persistence,
    deliveryLocated,
    runId: created.runId,
    dispatchSequence: dispatch.sequence,
    lifecycleLayer,
    attemptGrant: started.outcome.grant,
  });
}

function success<Success, Failure>(
  result: Result.Result<Success, Failure>,
): Success {
  return Result.getOrThrow(result);
}
