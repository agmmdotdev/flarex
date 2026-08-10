import { PGlite } from "@electric-sql/pglite";
import {
  RunAttemptLifecycle,
  RunAttemptLifecycleLive,
  TaskSystemRunAttemptStore,
  decodeTaskRunVersionV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { Effect, Exit, Layer, Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  createPGliteLocatedTaskSystemRunAttemptTargetV1,
  createPGlitePersistence,
} from "../src/pglite";
import {
  TaskComputeDeliveryRepositoryInputV1Error,
  TaskComputeDeliveryRepositoryConfigurationV1Error,
  TaskComputeDeliveryRepositoryStaleClaimV1Error,
  createLocatedTaskComputeDeliveryTargetV1,
  makeTaskComputeDeliveryRepositoryV1,
  type TaskComputeDeliveryRepositoryErrorV1,
  type TaskComputeDeliveryRepositoryOptionsV1,
  type TaskComputeDeliveryRepositoryV1,
  type TaskComputeDispatchAcquireResultV1,
  type TaskComputeDispatchClaimReleasedV1,
  type TaskComputeDispatchClaimRenewedV1,
  type TaskComputeDispatchDeliveryStartedV1,
} from "../src/taskComputeDeliveryRepositoryV1";
import { makeTaskSystemRunAttemptStoreV1 } from
  "../src/taskSystemRunAttemptStoreV1";
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
const CLAIM_OWNER_B = "73000000-0000-4000-8000-000000000002";
const runVersionOne = success(decodeTaskRunVersionV1("1"));

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
});

async function readClaim(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
  runId: string,
  dispatchSequence: bigint,
) {
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
  });
}

function success<Success, Failure>(
  result: Result.Result<Success, Failure>,
): Success {
  return Result.getOrThrow(result);
}
