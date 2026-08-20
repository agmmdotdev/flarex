import {
  decideApplicationStartAttemptV1,
  decodeTaskAttemptIdV1,
  decodeTaskCancellationGenerationV1,
  decodeTaskDatabaseTimeMsV1,
  decodeTaskDurationMsV1,
  decodeTaskExecutionFenceV1,
  decodeTaskRequestedEffectSequenceV1,
  decodeTaskRetryJitterV1,
  decodeTaskRunVersionV1,
  decodeApplicationTaskRunAttemptAggregateJsonV1,
  encodeApplicationTaskRunAttemptAggregateJsonV1,
  projectApplicationTaskRunAttemptPersistenceV1,
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
import {
  applicationTaskMutationRequestKeyV1FromDigest,
  encodeApplicationTaskMutationStableKeyPreimageV1,
} from "flarex-protocol/internal/application-task-mutation-callback-v1";
import { ReplacementScopeIdV1Schema } from
  "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import {
  makeApplicationTaskSystemRunCreationStore,
} from "../src/applicationTaskSystemRunCreation";
import { selectApplicationTask } from "../src/applicationTaskSelection";
import {
  createPGliteLocatedTaskSystemRunAttemptTargetV1,
} from "../src/pglite";
import { createTaskAttemptLifecycleGateway } from
  "../src/taskAttemptLifecycleGateway";
import {
  confirmTaskChildMutationEffect,
  createLocatedTaskExternalEffectAuthorityTarget,
  declareTaskChildMutationDispatch,
  failTaskChildMutationBeforeDispatch,
  issueApplicationTaskExternalEffectSubject,
  markTaskChildMutationUncertain,
  prepareTaskChildMutationEffect,
  revokeApplicationTaskExternalEffectSubject,
  type ApplicationTaskExternalEffectSubject,
  type TaskExternalEffectAuthorityHashContext,
  type TaskExternalEffectAuthorityTransactionStep,
} from "../src/taskExternalEffectAuthority";
import {
  makeApplicationTaskSystemRunAttemptStoreV1,
} from "../src/taskSystemRunAttemptStoreV1";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  createApplicationNativeMutationPGliteFixture,
} from "./fixtures/applicationNativeMutationTestFixture";

describe("DTE06-F0b Task external-effect authority", () => {
  it("owns exact child-mutation sequencing, replay, and lifecycle transitions", {
    timeout: 180_000,
  }, async () => {
    const setup = await makeExecutingApplicationTask();
    const first = effectInput(1n, 0x11);

    const concurrentPrepare = await Promise.all([
      runEffect(prepareTaskChildMutationEffect(
        setup.subject,
        first,
        setup.context,
      )),
      runEffect(prepareTaskChildMutationEffect(
        setup.subject,
        first,
        setup.context,
      )),
    ]);
    expect(concurrentPrepare.map(receipt => receipt.disposition).sort())
      .toEqual(["applied", "replayed"]);
    expect(concurrentPrepare).toEqual(expect.arrayContaining([
      expect.objectContaining({
        effect: expect.objectContaining({ effectOrdinal: 1n, state: "prepared" }),
      }),
    ]));
    await expect(runEffectFailure(prepareTaskChildMutationEffect(
      setup.subject,
      { ...first, argumentsSha256: digest(0xee) },
      setup.context,
    ))).resolves.toMatchObject({
      _tag: "TaskExternalEffectRequestConflictError",
      effectOrdinal: 1n,
      field: "argumentsSha256",
    });
    await expect(runEffectFailure(prepareTaskChildMutationEffect(
      setup.subject,
      effectInput(3n, 0x13),
      setup.context,
    ))).resolves.toMatchObject({
      _tag: "TaskExternalEffectSequenceConflictError",
      expectedOrdinal: 2n,
      suppliedOrdinal: 3n,
    });

    expect(await runEffect(declareTaskChildMutationDispatch(
      setup.subject,
      1n,
      setup.context,
    ))).toMatchObject({ disposition: "applied", effect: { state: "dispatching" } });
    expect(await runEffect(declareTaskChildMutationDispatch(
      setup.subject,
      1n,
      setup.context,
    ))).toMatchObject({ disposition: "replayed", effect: { state: "dispatching" } });
    expect(await runEffect(confirmTaskChildMutationEffect(
      setup.subject,
      1n,
      digest(0x21),
      setup.context,
    ))).toMatchObject({ disposition: "applied", effect: { state: "confirmed" } });
    expect(await runEffect(confirmTaskChildMutationEffect(
      setup.subject,
      1n,
      digest(0x21),
      setup.context,
    ))).toMatchObject({ disposition: "replayed", effect: { state: "confirmed" } });
    await expect(runEffectFailure(confirmTaskChildMutationEffect(
      setup.subject,
      1n,
      digest(0x22),
      setup.context,
    ))).resolves.toMatchObject({
      _tag: "TaskExternalEffectRequestConflictError",
      field: "outcomeSha256",
    });

    await runEffect(prepareTaskChildMutationEffect(
      setup.subject,
      effectInput(2n, 0x12),
      setup.context,
    ));
    expect(await runEffect(failTaskChildMutationBeforeDispatch(
      setup.subject,
      2n,
      "mutation_input_invalid",
      setup.context,
    ))).toMatchObject({
      disposition: "applied",
      effect: { state: "failed_before_dispatch" },
    });
    expect(await runEffect(failTaskChildMutationBeforeDispatch(
      setup.subject,
      2n,
      "mutation_input_invalid",
      setup.context,
    ))).toMatchObject({ disposition: "replayed" });
    await expect(runEffectFailure(failTaskChildMutationBeforeDispatch(
      setup.subject,
      2n,
      "different_failure",
      setup.context,
    ))).resolves.toMatchObject({
      _tag: "TaskExternalEffectRequestConflictError",
      field: "terminalCode",
    });

    await runEffect(prepareTaskChildMutationEffect(
      setup.subject,
      effectInput(3n, 0x13),
      setup.context,
    ));
    await runEffect(declareTaskChildMutationDispatch(
      setup.subject,
      3n,
      setup.context,
    ));
    expect(await runEffect(markTaskChildMutationUncertain(
      setup.subject,
      3n,
      "dispatch_settlement_unknown",
      setup.context,
    ))).toMatchObject({
      disposition: "applied",
      effect: { state: "uncertain" },
    });
    expect(await runEffect(markTaskChildMutationUncertain(
      setup.subject,
      3n,
      "dispatch_settlement_unknown",
      setup.context,
    ))).toMatchObject({ disposition: "replayed" });

    const rows = await setup.fixture.target.query<{
      subject_kind: string;
      effect_kind: string;
      effect_ordinal: bigint | number | string;
      stable_effect_key: string;
      child_mutation_request_key: string;
    }>(`select subject_kind, effect_kind, effect_ordinal, stable_effect_key,
              child_mutation_request_key
         from fx_system_external_effect_attempt_v1
        where scope_id = $1
        order by effect_ordinal`, [setup.context.authority.scopeId]);
    expect(rows.rows).toHaveLength(3);
    expect(rows.rows.every(row =>
      row.subject_kind === "durable_task_attempt" &&
      row.effect_kind === "child_mutation" &&
      row.stable_effect_key === row.child_mutation_request_key
    )).toBe(true);
    await expect(Promise.all(rows.rows.map(async row => [
      BigInt(row.effect_ordinal),
      await expectedStableRequestKey(
        setup.context.authority.scopeId,
        setup.dispatch.identity.runId,
        BigInt(row.effect_ordinal),
      ),
    ] as const))).resolves.toEqual(rows.rows.map(row => [
      BigInt(row.effect_ordinal),
      row.stable_effect_key,
    ]));
  });

  it("fails closed for unissued, revoked, stale, and pre-execution subjects", {
    timeout: 180_000,
  }, async () => {
    const setup = await makeApplicationTask(false);
    await expect(runEffectFailure(prepareTaskChildMutationEffect(
      setup.subject,
      effectInput(1n, 0x31),
      setup.context,
    ))).resolves.toMatchObject({
      _tag: "TaskExternalEffectAuthorityStaleError",
      reason: "phase",
    });
    await expect(runEffectFailure(issueApplicationTaskExternalEffectSubject(
      {
        ...setup.dispatch,
        identity: {
          ...setup.dispatch.identity,
          executionFence: Result.getOrThrow(decodeTaskExecutionFenceV1("99")),
        },
      },
      setup.context,
    ))).resolves.toMatchObject({
      _tag: "TaskExternalEffectAuthorityStaleError",
      reason: "execution_fence",
    });
    await expect(runEffectFailure(issueApplicationTaskExternalEffectSubject(
      {
        ...setup.dispatch,
        identity: {
          ...setup.dispatch.identity,
          attemptId: Result.getOrThrow(decodeTaskAttemptIdV1(
            "attempt_74000000-0000-4000-8000-000000000098",
          )),
        },
      },
      setup.context,
    ))).resolves.toMatchObject({
      _tag: "TaskExternalEffectAuthorityStaleError",
      reason: "attempt",
    });
    await expect(runEffectFailure(issueApplicationTaskExternalEffectSubject(
      {
        ...setup.dispatch,
        identity: {
          ...setup.dispatch.identity,
          scopeId: ReplacementScopeIdV1Schema.make(
            "scope_74000000-0000-4000-8000-000000000099",
          ),
        },
      },
      setup.context,
    ))).resolves.toMatchObject({
      _tag: "TaskExternalEffectAuthorityStaleError",
      reason: "scope",
    });

    // SAFETY: this intentionally forged handle proves that structural shape
    // alone cannot mint the WeakMap-backed capability.
    const forged = Object.freeze({}) as ApplicationTaskExternalEffectSubject;
    await expect(runEffectFailure(prepareTaskChildMutationEffect(
      forged,
      effectInput(1n, 0x31),
      setup.context,
    ))).resolves.toMatchObject({
      _tag: "InvalidApplicationTaskExternalEffectSubjectError",
      reason: "revoked",
    });
    let hostileReads = 0;
    const hostileInput = Object.create(null);
    Object.defineProperties(hostileInput, {
      effectOrdinal: { enumerable: true, value: 1n },
      requestIdentitySha256: {
        enumerable: true,
        get: () => {
          hostileReads += 1;
          throw new Error("hostile request digest getter");
        },
      },
      functionPath: { enumerable: true, value: "users:write" },
      argumentsSha256: { enumerable: true, value: digest(0x32) },
    });
    await expect(runEffectFailure(prepareTaskChildMutationEffect(
      setup.subject,
      hostileInput,
      setup.context,
    ))).resolves.toMatchObject({
      _tag: "TaskExternalEffectAuthorityInputError",
      field: "requestIdentitySha256",
    });
    expect(hostileReads).toBe(0);
    revokeApplicationTaskExternalEffectSubject(setup.subject);
    await expect(runEffectFailure(prepareTaskChildMutationEffect(
      setup.subject,
      effectInput(1n, 0x31),
      setup.context,
    ))).resolves.toMatchObject({
      _tag: "InvalidApplicationTaskExternalEffectSubjectError",
      reason: "revoked",
    });
  });

  it("rolls back every persisted transition before admitting exact retry", {
    timeout: 180_000,
  }, async () => {
    const setup = await makeExecutingApplicationTask();

    await expectInjectedRollback(
      setup,
      "afterPrepareInsert",
      context => prepareTaskChildMutationEffect(
        setup.subject,
        effectInput(1n, 0x41),
        context,
      ),
      null,
    );
    await runEffect(prepareTaskChildMutationEffect(
      setup.subject,
      effectInput(1n, 0x41),
      setup.context,
    ));
    await expectInjectedRollback(
      setup,
      "afterDispatchUpdate",
      context => declareTaskChildMutationDispatch(setup.subject, 1n, context),
      "prepared",
    );
    await runEffect(declareTaskChildMutationDispatch(
      setup.subject,
      1n,
      setup.context,
    ));
    await expectInjectedRollback(
      setup,
      "afterConfirmationUpdate",
      context => confirmTaskChildMutationEffect(
        setup.subject,
        1n,
        digest(0x51),
        context,
      ),
      "dispatching",
    );
    await runEffect(confirmTaskChildMutationEffect(
      setup.subject,
      1n,
      digest(0x51),
      setup.context,
    ));

    await runEffect(prepareTaskChildMutationEffect(
      setup.subject,
      effectInput(2n, 0x42),
      setup.context,
    ));
    await expectInjectedRollback(
      setup,
      "afterFailedBeforeDispatchUpdate",
      context => failTaskChildMutationBeforeDispatch(
        setup.subject,
        2n,
        "input_invalid",
        context,
      ),
      "prepared",
    );
    await runEffect(failTaskChildMutationBeforeDispatch(
      setup.subject,
      2n,
      "input_invalid",
      setup.context,
    ));

    await runEffect(prepareTaskChildMutationEffect(
      setup.subject,
      effectInput(3n, 0x43),
      setup.context,
    ));
    await runEffect(declareTaskChildMutationDispatch(
      setup.subject,
      3n,
      setup.context,
    ));
    await expectInjectedRollback(
      setup,
      "afterUncertainUpdate",
      context => markTaskChildMutationUncertain(
        setup.subject,
        3n,
        "settlement_unknown",
        context,
      ),
      "dispatching",
    );
    await runEffect(markTaskChildMutationUncertain(
      setup.subject,
      3n,
      "settlement_unknown",
      setup.context,
    ));
  });

  it("rejects aggregate/projection contradiction before writing effect evidence", {
    timeout: 180_000,
  }, async () => {
    const setup = await makeExecutingApplicationTask();
    await setup.fixture.target.query(
      `update fx_system_durable_task_run_v1
          set run_version = run_version + 1
        where scope_id = $1 and run_id = $2`,
      [setup.context.authority.scopeId, setup.dispatch.identity.runId],
    );
    await expect(runEffectFailure(prepareTaskChildMutationEffect(
      setup.subject,
      effectInput(1n, 0x61),
      setup.context,
    ))).resolves.toMatchObject({
      _tag: "TaskExternalEffectAuthorityCorruptionError",
      detail: expect.stringContaining("aggregate/projection correlation failed"),
    });
    const rows = await setup.fixture.target.query<{ count: string }>(
      `select count(*)::text as count
         from fx_system_external_effect_attempt_v1
        where scope_id = $1`,
      [setup.context.authority.scopeId],
    );
    expect(rows.rows[0]?.count).toBe("0");
  });

  it("requires a live database-time lease for issue, prepare, and dispatch only", {
    timeout: 180_000,
  }, async () => {
    const setup = await makeExecutingApplicationTask();
    const databaseNowMs = await readDatabaseNowMs(setup);

    await setCurrentLeaseExpiry(setup, databaseNowMs + 60_000);
    await expect(runEffect(prepareTaskChildMutationEffect(
      setup.subject,
      effectInput(1n, 0x81),
      setup.context,
    ))).resolves.toMatchObject({
      disposition: "applied",
      effect: { state: "prepared" },
    });

    await setCurrentLeaseExpiry(setup, await readDatabaseNowMs(setup));
    await expect(runEffectFailure(declareTaskChildMutationDispatch(
      setup.subject,
      1n,
      setup.context,
    ))).resolves.toMatchObject({
      _tag: "TaskExternalEffectAuthorityStaleError",
      reason: "lease",
    });
    await expect(runEffectFailure(prepareTaskChildMutationEffect(
      setup.subject,
      effectInput(2n, 0x82),
      setup.context,
    ))).resolves.toMatchObject({
      _tag: "TaskExternalEffectAuthorityStaleError",
      reason: "lease",
    });

    await setCurrentLeaseExpiry(setup, (await readDatabaseNowMs(setup)) - 1);
    await expect(runEffectFailure(issueApplicationTaskExternalEffectSubject(
      setup.dispatch,
      setup.context,
    ))).resolves.toMatchObject({
      _tag: "TaskExternalEffectAuthorityStaleError",
      reason: "lease",
    });

    await setCurrentLeaseExpiry(setup, (await readDatabaseNowMs(setup)) + 60_000);
    await runEffect(declareTaskChildMutationDispatch(
      setup.subject,
      1n,
      setup.context,
    ));
    await setCurrentLeaseExpiry(setup, await readDatabaseNowMs(setup));
    await expect(runEffect(confirmTaskChildMutationEffect(
      setup.subject,
      1n,
      digest(0x91),
      setup.context,
    ))).resolves.toMatchObject({
      disposition: "applied",
      effect: { state: "confirmed" },
    });
  });
});

async function makeExecutingApplicationTask() {
  return makeApplicationTask(true);
}

async function makeApplicationTask(enterExecuting: boolean) {
  const runtimeHostIdentity = "flarex.test/task-external-effect-authority";
  const compatibilityDate = "2026-08-20";
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
  const lifecycleTarget = createPGliteLocatedTaskSystemRunAttemptTargetV1(
    fixture.target,
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
    leaseDurationMs: Result.getOrThrow(decodeTaskDurationMsV1(30_000)),
    immediateRetryThresholdMs: Result.getOrThrow(decodeTaskDurationMsV1(5_000)),
    randomUuid: uuidSequence(40),
  });
  const created = await runEffect(creation.createRun(
    selected.selection,
    Result.getOrThrow(decodeApplicationTaskRunCreationRequestV1({
      version: 1,
      requestKey: "task-external-effect-authority",
      applicationTaskRuntimeTargetSha256: selected.metadata.runtimeTargetSha256,
      input: Result.getOrThrow(makeTaskInputReferenceV1(digest(0x71), 19)),
      principal: Result.getOrThrow(
        makeTaskExecutionPrincipalReferenceV1(digest(0x72), 23),
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
    throw new Error("Expected the Application attempt to start.");
  }
  const dispatch = applicationDispatch(
    started.outcome.grant,
    fixture.active.basis.authority.scopeId,
  );
  const context = Object.freeze({
    target: createLocatedTaskExternalEffectAuthorityTarget(
      fixture.target.drizzle,
      fixture.active.basis.authority.physicalLocator,
    ),
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
  if (enterExecuting) {
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
  }
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

function effectInput(effectOrdinal: bigint, seed: number) {
  return Object.freeze({
    effectOrdinal,
    requestIdentitySha256: digest(seed),
    functionPath: "users:write",
    argumentsSha256: digest(seed + 1),
  });
}

function digest(seed: number): Uint8Array {
  return new Uint8Array(32).fill(seed);
}

async function expectedStableRequestKey(
  scopeId: string,
  runId: string,
  operationOrdinal: bigint,
) {
  const preimage = Result.getOrThrow(
    encodeApplicationTaskMutationStableKeyPreimageV1({
      scopeId,
      runId,
      operationOrdinal,
    }),
  );
  const sha256 = new Uint8Array(await globalThis.crypto.subtle.digest(
    "SHA-256",
    preimage.canonicalBytes.slice().buffer,
  ));
  return Result.getOrThrow(applicationTaskMutationRequestKeyV1FromDigest(sha256));
}

function uuidSequence(offset: number): () => string {
  let next = offset;
  return () =>
    `74000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
}

async function expectInjectedRollback(
  setup: Awaited<ReturnType<typeof makeExecutingApplicationTask>>,
  step: TaskExternalEffectAuthorityTransactionStep,
  operation: (
    context: TaskExternalEffectAuthorityHashContext<never>,
  ) => Effect.Effect<unknown, unknown>,
  expectedState: string | null,
) {
  const failingContext = Object.freeze({
    ...setup.context,
    proofAfterTransactionStep: (
      observed: TaskExternalEffectAuthorityTransactionStep,
    ) => {
      if (observed === step) throw new Error(`injected ${step} failure`);
    },
  });
  await expect(runEffect(operation(failingContext))).rejects.toThrow(
    `injected ${step} failure`,
  );
  expect(await effectState(setup, step === "afterPrepareInsert" ? 1n :
    step === "afterFailedBeforeDispatchUpdate" ? 2n :
    step === "afterUncertainUpdate" ? 3n : 1n)).toBe(expectedState);
}

async function effectState(
  setup: Awaited<ReturnType<typeof makeExecutingApplicationTask>>,
  effectOrdinal: bigint,
) {
  const rows = await setup.fixture.target.query<{ state: string }>(
    `select state from fx_system_external_effect_attempt_v1
      where scope_id = $1 and effect_ordinal = $2`,
    [setup.context.authority.scopeId, effectOrdinal],
  );
  return rows.rows[0]?.state ?? null;
}

async function readDatabaseNowMs(
  setup: Awaited<ReturnType<typeof makeExecutingApplicationTask>>,
): Promise<number> {
  const rows = await setup.fixture.target.query<{ now_ms: string }>(
    `select floor(extract(epoch from current_timestamp) * 1000)::text as now_ms`,
  );
  const nowMs = Number(rows.rows[0]?.now_ms);
  if (!Number.isSafeInteger(nowMs)) {
    throw new Error("Expected a safe database timestamp.");
  }
  return nowMs;
}

async function setCurrentLeaseExpiry(
  setup: Awaited<ReturnType<typeof makeExecutingApplicationTask>>,
  expiresAtMs: number,
): Promise<void> {
  const rows = await setup.fixture.target.query<{ aggregate_json: unknown }>(
    `select aggregate_json
       from fx_system_durable_task_run_v1
      where scope_id = $1 and run_id = $2`,
    [setup.context.authority.scopeId, setup.dispatch.identity.runId],
  );
  const aggregate = Result.getOrThrow(
    decodeApplicationTaskRunAttemptAggregateJsonV1(
      rows.rows[0]?.aggregate_json,
    ),
  );
  if (aggregate.phase !== "executing") {
    throw new Error("Expected an executing Application Task aggregate.");
  }
  if (
    aggregate.lastLifecycleAcceptance?.kind !== "heartbeat_attempt" ||
    aggregate.lastLifecycleAcceptance.accepted.outcome.kind !== "lease_renewed"
  ) {
    throw new Error("Expected the latest heartbeat lease acceptance.");
  }
  const expiresAt = Result.getOrThrow(
    decodeTaskDatabaseTimeMsV1(expiresAtMs),
  );
  const leaseDurationMs = Result.getOrThrow(decodeTaskDurationMsV1(
    expiresAtMs - aggregate.currentAttempt.lease.renewedAtMs,
  ));
  const lastLifecycleAcceptance = aggregate.lastLifecycleAcceptance;
  const updated = Object.freeze({
    ...aggregate,
    boundPolicy: Object.freeze({
      ...aggregate.boundPolicy,
      leaseDurationMs,
    }),
    currentAttempt: Object.freeze({
      ...aggregate.currentAttempt,
      lease: Object.freeze({
        ...aggregate.currentAttempt.lease,
        expiresAtMs: expiresAt,
      }),
    }),
    lastLifecycleAcceptance: Object.freeze({
      ...lastLifecycleAcceptance,
      accepted: Object.freeze({
        ...lastLifecycleAcceptance.accepted,
        evidence: Object.freeze(
          lastLifecycleAcceptance.accepted.evidence.map(evidence =>
            evidence.kind === "heartbeat_accepted"
              ? Object.freeze({
                ...evidence,
                renewedLease: Object.freeze({
                  ...evidence.renewedLease,
                  expiresAtMs: expiresAt,
                }),
              })
              : evidence
          ),
        ),
        requestedEffects: Object.freeze(
          lastLifecycleAcceptance.accepted.requestedEffects.map(requested =>
            requested.effect.kind === "wake_lease_expiry"
              ? Object.freeze({
                ...requested,
                effect: Object.freeze({
                  ...requested.effect,
                  notBeforeMs: expiresAt,
                }),
              })
              : requested
          ),
        ),
        outcome: Object.freeze({
          ...lastLifecycleAcceptance.accepted.outcome,
          lease: Object.freeze({
            ...lastLifecycleAcceptance.accepted.outcome.lease,
            expiresAtMs: expiresAt,
          }),
        }),
      }),
    }),
  });
  const encoded = Result.getOrThrow(
    encodeApplicationTaskRunAttemptAggregateJsonV1(updated),
  );
  const projection = projectApplicationTaskRunAttemptPersistenceV1(updated);
  const aggregateJson = JSON.stringify(encoded);
  const aggregateByteLength = new TextEncoder().encode(aggregateJson).byteLength;
  await setup.fixture.target.query(
    `update fx_system_durable_task_run_v1
        set aggregate_json = $3::jsonb,
            aggregate_byte_length = $4,
            current_lease_expires_at_ms = $5,
            due_at_ms = $6
      where scope_id = $1 and run_id = $2`,
    [
      setup.context.authority.scopeId,
      setup.dispatch.identity.runId,
      aggregateJson,
      aggregateByteLength,
      projection.currentLeaseExpiresAtMs,
      projection.dueAtMs,
    ],
  );
}
