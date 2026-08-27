import {
  TASK_COMPUTE_CANCELLATION_RECEIPT_VERSION_V1,
  TASK_COMPUTE_CANCELLATION_REQUEST_VERSION_V1,
  TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1,
  decodeTaskComputeCancellationReceiptV1,
  decodeTaskComputeCancellationRequestV1,
  decodeTaskComputeDispatchAcceptanceV1,
  decodeTaskComputeDispatchRequestV1,
  type TaskComputeDispatchRequestV1,
} from "@flarex/durable-task/internal/compute-provider-v1";
import {
  decodeTaskDefinitionRevisionIdV1,
  type TaskAttemptIdV1,
  type TaskAttemptNumberV1,
  type TaskCancellationGenerationV1,
  type TaskDurationMsV1,
  type TaskExecutionFenceV1,
  type TaskLeaseVersionV1,
  type TaskRequestedEffectSequenceV1,
  type TaskRunIdV1,
  type TaskRunVersionV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { and, eq, sql } from "drizzle-orm";
import { Brand, Effect, Result } from "effect";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";

import {
  fxSystemDurableTaskComputeCancellationsV1,
  fxSystemDurableTaskComputeDispatchesV1,
  fxSystemDurableTaskComputePendingV1,
  fxSystemDurableTaskRequestedEffectsV1,
} from "../src/schema";
import {
  TASK_COMPUTE_PROFILE_STORAGE_CODEC_V1,
  decodeTaskComputeCancellationReceiptEvidenceV1,
  decodeTaskComputeCancellationRequestEvidenceV1,
  decodeTaskComputeDispatchAcceptanceEvidenceV1,
  decodeTaskComputeDispatchRequestEvidenceV1,
  encodeTaskComputeCancellationReceiptEvidenceV1,
  encodeTaskComputeCancellationRequestEvidenceV1,
  encodeTaskComputeDispatchAcceptanceEvidenceV1,
  encodeTaskComputeDispatchRequestEvidenceV1,
  decodeTaskComputeProfileStorageBytesV1,
  encodeTaskComputeProfileStorageBytesV1,
  type TaskComputeDeliveryEvidenceV1,
} from "../src/taskComputeDeliveryEvidenceV1";
import {
  ACCEPTED_ATTEMPT_UUID,
  seedTaskSystemRunAttemptStoreV1,
  TASK_DEFINITION_ID,
  TASK_RUN_ID,
  type TaskSystemRunAttemptFixturePersistenceV1,
  type TaskSystemRunAttemptParentV1,
} from "./taskSystemRunAttemptStoreTestSupport";

const taskRunId = Brand.nominal<TaskRunIdV1>();
const taskRunVersion = Brand.nominal<TaskRunVersionV1>();
const taskRequestedEffectSequence =
  Brand.nominal<TaskRequestedEffectSequenceV1>();
const taskAttemptId = Brand.nominal<TaskAttemptIdV1>();
const taskAttemptNumber = Brand.nominal<TaskAttemptNumberV1>();
const taskExecutionFence = Brand.nominal<TaskExecutionFenceV1>();
const taskLeaseVersion = Brand.nominal<TaskLeaseVersionV1>();
const taskCancellationGeneration =
  Brand.nominal<TaskCancellationGenerationV1>();
const taskDuration = Brand.nominal<TaskDurationMsV1>();
const fixtureRunId = taskRunId(TASK_RUN_ID);
const fixtureTaskDefinitionRevisionId = Result.getOrThrow(
  decodeTaskDefinitionRevisionIdV1(TASK_DEFINITION_ID),
);
const fixtureAttemptId = taskAttemptId(`attempt_${ACCEPTED_ATTEMPT_UUID}`);

export async function seedTaskComputeDeliverySchemaV1(
  persistence: TaskSystemRunAttemptFixturePersistenceV1,
  parent?: TaskSystemRunAttemptParentV1,
  options: Readonly<{
    readonly legacySchema?: boolean;
    readonly principalSchema?: boolean;
  }> = {},
) {
  const seeded = await seedTaskSystemRunAttemptStoreV1(
    persistence,
    {
      ...(parent === undefined ? {} : { parent }),
      ...(options.legacySchema === true ? { legacySchema: true } : {}),
      ...(options.principalSchema === false ? { principalSchema: false } : {}),
    },
  );
  const evidence = await makeCanonicalTaskComputeDeliveryEvidenceV1(
    seeded.scopeId,
  );
  const computeProfileBytes = success(
    encodeTaskComputeProfileStorageBytesV1("compute-small"),
  );
  const scopeId = ScopeIdSchema.make(seeded.scopeId);
  const acceptedRunVersion = taskRunVersion(1n);
  const dispatchSequence = taskRequestedEffectSequence(1n);
  const cancellationSequence = taskRequestedEffectSequence(2n);
  await persistence.drizzle.insert(
    fxSystemDurableTaskRequestedEffectsV1,
  ).values([
    {
      scopeId,
      runId: fixtureRunId,
      sequence: dispatchSequence,
      acceptedRunVersion,
      kind: "dispatch_attempt",
      payloadCodecVersion: 1,
      payloadByteLength: 2n,
      payloadJson: {},
      notBeforeMs: null,
    },
    {
      scopeId,
      runId: fixtureRunId,
      sequence: cancellationSequence,
      acceptedRunVersion,
      kind: "request_execution_cancellation",
      payloadCodecVersion: 1,
      payloadByteLength: 2n,
      payloadJson: {},
      notBeforeMs: null,
    },
  ]);
  if (options.legacySchema === true) {
    await seedLegacyTaskComputeDispatchV1(
      persistence,
      seeded.scopeId,
      computeProfileBytes,
      evidence.dispatchRequest,
    );
  } else {
    await persistence.drizzle.insert(
      fxSystemDurableTaskComputeDispatchesV1,
    ).values({
      scopeId,
      runId: fixtureRunId,
      requestedEffectSequence: dispatchSequence,
      acceptedRunVersion,
      definitionGeneration: "legacy_definition_v1",
      taskDefinitionRevisionId: fixtureTaskDefinitionRevisionId,
      applicationTaskRuntimeTargetSha256: null,
      attemptId: fixtureAttemptId,
      attemptNumber: taskAttemptNumber(1),
      executionFence: taskExecutionFence(1n),
      leaseVersion: taskLeaseVersion(1n),
      computeProfileCodecVersion: TASK_COMPUTE_PROFILE_STORAGE_CODEC_V1,
      computeProfileByteLength: computeProfileBytes.byteLength,
      computeProfileBytes,
      cancellationKind: "not_requested",
      cancellationGeneration: taskCancellationGeneration(0n),
      maximumDurationMs: taskDuration(300_000),
      requestCodecVersion: evidence.dispatchRequest.codecVersion,
      requestByteLength: BigInt(evidence.dispatchRequest.byteLength),
      requestSha256: evidence.dispatchRequest.sha256,
      requestBytes: evidence.dispatchRequest.canonicalBytes,
      deliveryState: "prepared",
      claimFence: 0n,
      deliveryAttemptCount: 0n,
    });
  }
  await persistence.drizzle.insert(
    fxSystemDurableTaskComputeCancellationsV1,
  ).values({
    scopeId,
    runId: fixtureRunId,
    requestedEffectSequence: cancellationSequence,
    acceptedRunVersion,
    dispatchRequestedEffectSequence: dispatchSequence,
    attemptId: fixtureAttemptId,
    executionFence: taskExecutionFence(1n),
    cancellationGeneration: taskCancellationGeneration(1n),
    deliveryState: "waiting_dispatch",
    claimFence: 0n,
    deliveryAttemptCount: 0n,
  });
  return Object.freeze({
    scopeId: seeded.scopeId,
    deploymentId: seeded.deploymentId,
    runId: TASK_RUN_ID,
    evidence,
  });
}

export const invalidTaskComputeDeliveryStatementsV1 = Object.freeze([
  `update fx_system_durable_task_compute_dispatch_v1
   set compute_profile_codec_version = 2`,
  `update fx_system_durable_task_compute_dispatch_v1
   set compute_profile_byte_length = 3`,
  `update fx_system_durable_task_compute_dispatch_v1
   set request_sha256 = decode('00', 'hex')`,
  `update fx_system_durable_task_compute_dispatch_v1
   set claim_owner = '93000000-0000-4000-8000-000000000001'`,
  `update fx_system_durable_task_compute_dispatch_v1
   set delivery_state = 'delivering', delivery_attempt_count = 1,
       delivery_started_at = now()`,
  `update fx_system_durable_task_compute_dispatch_v1
   set delivery_state = 'accepted', delivery_attempt_count = 1,
       delivery_started_at = now(), settled_at = now()`,
  `update fx_system_durable_task_compute_dispatch_v1
   set delivery_state = 'obsolete', reason_code = 'invalid reason',
       settled_at = now()`,
  `update fx_system_durable_task_compute_dispatch_v1
   set updated_at = 'infinity'::timestamptz`,
  `update fx_system_durable_task_compute_cancellation_v1
   set request_codec_version = 1`,
  `update fx_system_durable_task_compute_cancellation_v1
   set delivery_state = 'delivering', delivery_attempt_count = 1,
       delivery_started_at = now()`,
  `update fx_system_durable_task_compute_cancellation_v1
   set delivery_state = 'delivered', delivery_attempt_count = 1,
       delivery_started_at = now(), settled_at = now()`,
  `update fx_system_durable_task_compute_cancellation_v1
   set dispatch_requested_effect_sequence = 3`,
  `update fx_system_durable_task_compute_cancellation_v1
   set claim_expires_at = '-infinity'::timestamptz`,
]);

export const invalidTaskComputePendingStatementsV1 = Object.freeze([
  `update fx_system_durable_task_compute_pending_v1
   set kind = 'wake_retry'`,
  `update fx_system_durable_task_compute_pending_v1
   set eligible_at = '2026-08-11T00:00:00.000001Z'`,
  `insert into fx_system_durable_task_compute_pending_v1 (
     scope_id, run_id, requested_effect_sequence, kind, eligible_at
   )
   select scope_id, run_id, 99, 'dispatch_attempt',
          date_trunc('milliseconds', statement_timestamp())
   from fx_system_durable_task_run_v1
   limit 1`,
]);

export async function seedTaskComputePendingConstraintRowV1(
  persistence: TaskSystemRunAttemptFixturePersistenceV1,
  scopeId: string,
  runId: string,
): Promise<void> {
  await persistence.drizzle.insert(
    fxSystemDurableTaskComputePendingV1,
  ).values({
    scopeId: ScopeIdSchema.make(scopeId),
    runId: taskRunId(runId),
    requestedEffectSequence: taskRequestedEffectSequence(1n),
    kind: "dispatch_attempt",
    eligibleAt: sql<Date>`date_trunc('milliseconds', statement_timestamp())`,
  });
}

export async function deleteTaskComputePendingConstraintRowV1(
  persistence: TaskSystemRunAttemptFixturePersistenceV1,
  scopeId: string,
  runId: string,
): Promise<void> {
  await persistence.drizzle.delete(
    fxSystemDurableTaskComputePendingV1,
  ).where(and(
    eq(fxSystemDurableTaskComputePendingV1.scopeId, ScopeIdSchema.make(scopeId)),
    eq(fxSystemDurableTaskComputePendingV1.runId, taskRunId(runId)),
  ));
}

export async function settleTaskComputeDeliverySchemaV1(
  persistence: TaskSystemRunAttemptFixturePersistenceV1,
  evidence: CanonicalTaskComputeDeliveryEvidenceV1,
): Promise<void> {
  const databaseNow = sql<Date>`now()`;
  await persistence.drizzle.update(
    fxSystemDurableTaskComputeDispatchesV1,
  ).set({
    deliveryState: "accepted",
    claimFence: 1n,
    deliveryAttemptCount: 1n,
    deliveryStartedAt: databaseNow,
    acceptanceCodecVersion: evidence.dispatchAcceptance.codecVersion,
    acceptanceByteLength: BigInt(evidence.dispatchAcceptance.byteLength),
    acceptanceSha256: evidence.dispatchAcceptance.sha256,
    acceptanceBytes: evidence.dispatchAcceptance.canonicalBytes,
    settledAt: databaseNow,
    updatedAt: databaseNow,
  });
  await persistence.drizzle.update(
    fxSystemDurableTaskComputeCancellationsV1,
  ).set({
    deliveryState: "delivered",
    requestCodecVersion: evidence.cancellationRequest.codecVersion,
    requestByteLength: BigInt(evidence.cancellationRequest.byteLength),
    requestSha256: evidence.cancellationRequest.sha256,
    requestBytes: evidence.cancellationRequest.canonicalBytes,
    claimFence: 1n,
    deliveryAttemptCount: 1n,
    deliveryStartedAt: databaseNow,
    receiptCodecVersion: evidence.cancellationReceipt.codecVersion,
    receiptByteLength: BigInt(evidence.cancellationReceipt.byteLength),
    receiptSha256: evidence.cancellationReceipt.sha256,
    receiptBytes: evidence.cancellationReceipt.canonicalBytes,
    settledAt: databaseNow,
    updatedAt: databaseNow,
  });
}

export async function proveLosslessComputeProfileStorageV1(
  persistence: TaskSystemRunAttemptFixturePersistenceV1,
): Promise<void> {
  for (const profile of ["   ", "\u0000", "\ud800"]) {
    const bytes = success(encodeTaskComputeProfileStorageBytesV1(profile));
    await persistence.drizzle.update(
      fxSystemDurableTaskComputeDispatchesV1,
    ).set({
      computeProfileCodecVersion: TASK_COMPUTE_PROFILE_STORAGE_CODEC_V1,
      computeProfileByteLength: bytes.byteLength,
      computeProfileBytes: bytes,
    });
    const stored = await persistence.drizzle.select({
      profileBytes: fxSystemDurableTaskComputeDispatchesV1.computeProfileBytes,
    }).from(fxSystemDurableTaskComputeDispatchesV1);
    expectSingleProfile(
      stored[0]?.profileBytes,
      profile,
    );
  }
  const reset = success(encodeTaskComputeProfileStorageBytesV1("compute-small"));
  await persistence.drizzle.update(
    fxSystemDurableTaskComputeDispatchesV1,
  ).set({
    computeProfileCodecVersion: TASK_COMPUTE_PROFILE_STORAGE_CODEC_V1,
    computeProfileByteLength: reset.byteLength,
    computeProfileBytes: reset,
  });
}

export async function decodeStoredTaskComputeDeliveryEvidenceV1(
  persistence: TaskSystemRunAttemptFixturePersistenceV1,
) {
  const rows = await persistence.drizzle.select({
    dispatchRequestCodecVersion:
      fxSystemDurableTaskComputeDispatchesV1.requestCodecVersion,
    dispatchRequestByteLength:
      fxSystemDurableTaskComputeDispatchesV1.requestByteLength,
    dispatchRequestSha256: fxSystemDurableTaskComputeDispatchesV1.requestSha256,
    dispatchRequestBytes: fxSystemDurableTaskComputeDispatchesV1.requestBytes,
    computeProfileCodecVersion:
      fxSystemDurableTaskComputeDispatchesV1.computeProfileCodecVersion,
    computeProfileByteLength:
      fxSystemDurableTaskComputeDispatchesV1.computeProfileByteLength,
    computeProfileBytes: fxSystemDurableTaskComputeDispatchesV1.computeProfileBytes,
    dispatchAcceptanceCodecVersion:
      fxSystemDurableTaskComputeDispatchesV1.acceptanceCodecVersion,
    dispatchAcceptanceByteLength:
      fxSystemDurableTaskComputeDispatchesV1.acceptanceByteLength,
    dispatchAcceptanceSha256:
      fxSystemDurableTaskComputeDispatchesV1.acceptanceSha256,
    dispatchAcceptanceBytes:
      fxSystemDurableTaskComputeDispatchesV1.acceptanceBytes,
    cancellationRequestCodecVersion:
      fxSystemDurableTaskComputeCancellationsV1.requestCodecVersion,
    cancellationRequestByteLength:
      fxSystemDurableTaskComputeCancellationsV1.requestByteLength,
    cancellationRequestSha256:
      fxSystemDurableTaskComputeCancellationsV1.requestSha256,
    cancellationRequestBytes:
      fxSystemDurableTaskComputeCancellationsV1.requestBytes,
    cancellationReceiptCodecVersion:
      fxSystemDurableTaskComputeCancellationsV1.receiptCodecVersion,
    cancellationReceiptByteLength:
      fxSystemDurableTaskComputeCancellationsV1.receiptByteLength,
    cancellationReceiptSha256:
      fxSystemDurableTaskComputeCancellationsV1.receiptSha256,
    cancellationReceiptBytes:
      fxSystemDurableTaskComputeCancellationsV1.receiptBytes,
  }).from(fxSystemDurableTaskComputeDispatchesV1).innerJoin(
    fxSystemDurableTaskComputeCancellationsV1,
    and(
      eq(
        fxSystemDurableTaskComputeCancellationsV1.scopeId,
        fxSystemDurableTaskComputeDispatchesV1.scopeId,
      ),
      eq(
        fxSystemDurableTaskComputeCancellationsV1.runId,
        fxSystemDurableTaskComputeDispatchesV1.runId,
      ),
      eq(
        fxSystemDurableTaskComputeCancellationsV1
          .dispatchRequestedEffectSequence,
        fxSystemDurableTaskComputeDispatchesV1.requestedEffectSequence,
      ),
    ),
  );
  const row = rows[0];
  if (row === undefined) throw new Error("compute delivery evidence row missing");
  if (
    row.computeProfileCodecVersion !== TASK_COMPUTE_PROFILE_STORAGE_CODEC_V1
    || row.computeProfileByteLength !== row.computeProfileBytes.byteLength
  ) {
    throw new Error("compute profile storage envelope mismatch");
  }
  return Effect.runPromise(Effect.all({
    computeProfile: Effect.fromResult(
      decodeTaskComputeProfileStorageBytesV1(row.computeProfileBytes),
    ),
    dispatchRequest: decodeTaskComputeDispatchRequestEvidenceV1(
      storedEvidence({
        codecVersion: row.dispatchRequestCodecVersion,
        byteLength: row.dispatchRequestByteLength,
        sha256: row.dispatchRequestSha256,
        canonicalBytes: row.dispatchRequestBytes,
      }),
    ),
    dispatchAcceptance: decodeTaskComputeDispatchAcceptanceEvidenceV1(
      storedEvidence({
        codecVersion: row.dispatchAcceptanceCodecVersion,
        byteLength: row.dispatchAcceptanceByteLength,
        sha256: row.dispatchAcceptanceSha256,
        canonicalBytes: row.dispatchAcceptanceBytes,
      }),
    ),
    cancellationRequest: decodeTaskComputeCancellationRequestEvidenceV1(
      storedEvidence({
        codecVersion: row.cancellationRequestCodecVersion,
        byteLength: row.cancellationRequestByteLength,
        sha256: row.cancellationRequestSha256,
        canonicalBytes: row.cancellationRequestBytes,
      }),
    ),
    cancellationReceipt: decodeTaskComputeCancellationReceiptEvidenceV1(
      storedEvidence({
        codecVersion: row.cancellationReceiptCodecVersion,
        byteLength: row.cancellationReceiptByteLength,
        sha256: row.cancellationReceiptSha256,
        canonicalBytes: row.cancellationReceiptBytes,
      }),
    ),
  }));
}

interface CanonicalTaskComputeDeliveryEvidenceV1 {
  readonly dispatchRequest: TaskComputeDeliveryEvidenceV1;
  readonly dispatchAcceptance: TaskComputeDeliveryEvidenceV1;
  readonly cancellationRequest: TaskComputeDeliveryEvidenceV1;
  readonly cancellationReceipt: TaskComputeDeliveryEvidenceV1;
}

async function makeCanonicalTaskComputeDeliveryEvidenceV1(
  scopeId: string,
): Promise<CanonicalTaskComputeDeliveryEvidenceV1> {
  const dispatchRequest = success(decodeTaskComputeDispatchRequestV1({
    version: "flarex.task-compute-dispatch-request.v1",
    identity: {
      version: "flarex.task-compute-dispatch-identity.v1",
      scopeId,
      runId: TASK_RUN_ID,
      requestedEffectSequence: "1",
      attemptId: "attempt_72000000-0000-4000-8000-000000000005",
      executionFence: "1",
    },
    taskDefinitionRevisionId:
      "taskdef_72000000-0000-4000-8000-000000000002",
    attemptNumber: 1,
    leaseVersion: "1",
    computeProfile: "compute-small",
    cancellation: { kind: "not_requested", generation: "0" },
    maximumDurationMs: 300_000,
  }));
  const identity = wireIdentity(dispatchRequest);
  const execution = {
    provider: "memory",
    providerVersion: "in-memory-v1",
    executionId: "memory-execution-000000000001",
  } as const;
  const dispatchAcceptance = success(decodeTaskComputeDispatchAcceptanceV1({
    version: TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1,
    kind: "accepted",
    identity,
    execution,
  }));
  const cancellationRequest = success(decodeTaskComputeCancellationRequestV1({
    version: TASK_COMPUTE_CANCELLATION_REQUEST_VERSION_V1,
    identity,
    execution,
    cancellationGeneration: "1",
  }));
  const cancellationReceipt = success(decodeTaskComputeCancellationReceiptV1({
    version: TASK_COMPUTE_CANCELLATION_RECEIPT_VERSION_V1,
    kind: "interruption_requested",
    identity,
    execution,
    cancellationGeneration: "1",
  }));
  return Effect.runPromise(Effect.all({
    dispatchRequest: encodeTaskComputeDispatchRequestEvidenceV1(dispatchRequest),
    dispatchAcceptance:
      encodeTaskComputeDispatchAcceptanceEvidenceV1(dispatchAcceptance),
    cancellationRequest:
      encodeTaskComputeCancellationRequestEvidenceV1(cancellationRequest),
    cancellationReceipt:
      encodeTaskComputeCancellationReceiptEvidenceV1(cancellationReceipt),
  }));
}

function wireIdentity(request: TaskComputeDispatchRequestV1) {
  return {
    ...request.identity,
    requestedEffectSequence:
      request.identity.requestedEffectSequence.toString(10),
    executionFence: request.identity.executionFence.toString(10),
  };
}

function storedEvidence(input: Readonly<{
  readonly codecVersion: number | null;
  readonly byteLength: bigint | null;
  readonly canonicalBytes: Uint8Array | null;
  readonly sha256: Uint8Array | null;
}>) {
  if (
    input.codecVersion === null
    || input.byteLength === null
    || input.canonicalBytes === null
    || input.sha256 === null
  ) throw new Error("compute delivery evidence envelope incomplete");
  const byteLength = Number(input.byteLength);
  if (!Number.isSafeInteger(byteLength)) {
    throw new Error("compute delivery evidence byte length is unsafe");
  }
  return {
    codecVersion: input.codecVersion,
    byteLength,
    canonicalBytes: input.canonicalBytes,
    sha256: input.sha256,
  };
}

/** Historical migration fixture: the pre-generation table lacks this column. */
async function seedLegacyTaskComputeDispatchV1(
  persistence: TaskSystemRunAttemptFixturePersistenceV1,
  scopeId: string,
  computeProfileBytes: Uint8Array,
  evidence: TaskComputeDeliveryEvidenceV1,
): Promise<void> {
  await persistence.query(`
    insert into fx_system_durable_task_compute_dispatch_v1 (
      scope_id, run_id, requested_effect_sequence, accepted_run_version,
      task_definition_revision_id, attempt_id, attempt_number,
      execution_fence, lease_version, compute_profile_codec_version,
      compute_profile_byte_length, compute_profile_bytes, cancellation_kind,
      cancellation_generation, maximum_duration_ms,
      request_codec_version, request_byte_length, request_sha256,
      request_bytes, delivery_state, claim_fence, delivery_attempt_count
    ) values (
      $1, $2, 1, 1,
      'taskdef_72000000-0000-4000-8000-000000000002',
      'attempt_72000000-0000-4000-8000-000000000005', 1,
      1, 1, $3, $4, $5, 'not_requested', 0, 300000,
      $6, $7, $8, $9,
      'prepared', 0, 0
    )
  `, [
    scopeId,
    TASK_RUN_ID,
    TASK_COMPUTE_PROFILE_STORAGE_CODEC_V1,
    computeProfileBytes.byteLength,
    computeProfileBytes,
    evidence.codecVersion,
    evidence.byteLength,
    evidence.sha256,
    evidence.canonicalBytes,
  ]);
}

function success<Success, Failure>(
  result: Result.Result<Success, Failure>,
): Success {
  return Result.getOrThrow(result);
}

function expectSingleProfile(
  bytes: Uint8Array | undefined,
  expected: string,
): void {
  if (bytes === undefined) throw new Error("compute profile row missing");
  const decoded = success(decodeTaskComputeProfileStorageBytesV1(bytes));
  if (decoded !== expected) {
    throw new Error("compute profile storage round-trip mismatch");
  }
}
