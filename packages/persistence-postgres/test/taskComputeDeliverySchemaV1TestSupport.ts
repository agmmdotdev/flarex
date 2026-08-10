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
import { Effect, Result } from "effect";

import type { FlarexSqlClient } from "../src/index";
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
  seedTaskSystemRunAttemptStoreV1,
  TASK_RUN_ID,
  type TaskSystemRunAttemptParentV1,
} from "./taskSystemRunAttemptStoreTestSupport";

export async function seedTaskComputeDeliverySchemaV1(
  persistence: Pick<FlarexSqlClient, "query">,
  parent?: TaskSystemRunAttemptParentV1,
) {
  const seeded = await seedTaskSystemRunAttemptStoreV1(
    persistence,
    parent === undefined ? {} : { parent },
  );
  const evidence = await makeCanonicalTaskComputeDeliveryEvidenceV1(
    seeded.scopeId,
  );
  const computeProfileBytes = success(
    encodeTaskComputeProfileStorageBytesV1("compute-small"),
  );
  await persistence.query(`
    insert into fx_system_durable_task_requested_effect_v1 (
      scope_id, run_id, sequence, accepted_run_version, kind,
      payload_codec_version, payload_byte_length, payload_json,
      not_before_ms
    ) values
      ($1, $2, 1, 1, 'dispatch_attempt', 1, 2, '{}'::jsonb, null),
      ($1, $2, 2, 1, 'request_execution_cancellation',
        1, 2, '{}'::jsonb, null)
  `, [seeded.scopeId, TASK_RUN_ID]);
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
    seeded.scopeId,
    TASK_RUN_ID,
    TASK_COMPUTE_PROFILE_STORAGE_CODEC_V1,
    computeProfileBytes.byteLength,
    computeProfileBytes,
    evidence.dispatchRequest.codecVersion,
    evidence.dispatchRequest.byteLength,
    evidence.dispatchRequest.sha256,
    evidence.dispatchRequest.canonicalBytes,
  ]);
  await persistence.query(`
    insert into fx_system_durable_task_compute_cancellation_v1 (
      scope_id, run_id, requested_effect_sequence, accepted_run_version,
      dispatch_requested_effect_sequence, attempt_id, execution_fence,
      cancellation_generation, delivery_state, claim_fence,
      delivery_attempt_count
    ) values (
      $1, $2, 2, 1, 1,
      'attempt_72000000-0000-4000-8000-000000000005', 1, 1,
      'waiting_dispatch', 0, 0
    )
  `, [seeded.scopeId, TASK_RUN_ID]);
  return Object.freeze({
    scopeId: seeded.scopeId,
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

export async function settleTaskComputeDeliverySchemaV1(
  persistence: Pick<FlarexSqlClient, "query">,
  evidence: CanonicalTaskComputeDeliveryEvidenceV1,
): Promise<void> {
  await persistence.query(`
    update fx_system_durable_task_compute_dispatch_v1
    set delivery_state = 'accepted',
        claim_fence = 1,
        delivery_attempt_count = 1,
        delivery_started_at = now(),
        acceptance_codec_version = $1,
        acceptance_byte_length = $2,
        acceptance_sha256 = $3,
        acceptance_bytes = $4,
        settled_at = now(),
        updated_at = now()
  `, [
    evidence.dispatchAcceptance.codecVersion,
    evidence.dispatchAcceptance.byteLength,
    evidence.dispatchAcceptance.sha256,
    evidence.dispatchAcceptance.canonicalBytes,
  ]);
  await persistence.query(`
    update fx_system_durable_task_compute_cancellation_v1
    set delivery_state = 'delivered',
        request_codec_version = $1,
        request_byte_length = $2,
        request_sha256 = $3,
        request_bytes = $4,
        claim_fence = 1,
        delivery_attempt_count = 1,
        delivery_started_at = now(),
        receipt_codec_version = $5,
        receipt_byte_length = $6,
        receipt_sha256 = $7,
        receipt_bytes = $8,
        settled_at = now(),
        updated_at = now()
  `, [
    evidence.cancellationRequest.codecVersion,
    evidence.cancellationRequest.byteLength,
    evidence.cancellationRequest.sha256,
    evidence.cancellationRequest.canonicalBytes,
    evidence.cancellationReceipt.codecVersion,
    evidence.cancellationReceipt.byteLength,
    evidence.cancellationReceipt.sha256,
    evidence.cancellationReceipt.canonicalBytes,
  ]);
}

export async function proveLosslessComputeProfileStorageV1(
  persistence: Pick<FlarexSqlClient, "query">,
): Promise<void> {
  for (const profile of ["   ", "\u0000", "\ud800"]) {
    const bytes = success(encodeTaskComputeProfileStorageBytesV1(profile));
    await persistence.query(`
      update fx_system_durable_task_compute_dispatch_v1
      set compute_profile_codec_version = $1,
          compute_profile_byte_length = $2,
          compute_profile_bytes = $3
    `, [TASK_COMPUTE_PROFILE_STORAGE_CODEC_V1, bytes.byteLength, bytes]);
    const stored = await persistence.query<{ profile_bytes: Uint8Array }>(`
      select compute_profile_bytes as profile_bytes
      from fx_system_durable_task_compute_dispatch_v1
    `);
    expectSingleProfile(
      stored.rows[0]?.profile_bytes,
      profile,
    );
  }
  const reset = success(encodeTaskComputeProfileStorageBytesV1("compute-small"));
  await persistence.query(`
    update fx_system_durable_task_compute_dispatch_v1
    set compute_profile_codec_version = $1,
        compute_profile_byte_length = $2,
        compute_profile_bytes = $3
  `, [TASK_COMPUTE_PROFILE_STORAGE_CODEC_V1, reset.byteLength, reset]);
}

export async function decodeStoredTaskComputeDeliveryEvidenceV1(
  persistence: Pick<FlarexSqlClient, "query">,
) {
  const result = await persistence.query<StoredTaskComputeDeliveryEvidenceRowV1>(`
    select
      d.request_codec_version as dispatch_request_codec_version,
      d.request_byte_length::int as dispatch_request_byte_length,
      d.request_sha256 as dispatch_request_sha256,
      d.request_bytes as dispatch_request_bytes,
      d.compute_profile_codec_version as compute_profile_codec_version,
      d.compute_profile_byte_length as compute_profile_byte_length,
      d.compute_profile_bytes as compute_profile_bytes,
      d.acceptance_codec_version as dispatch_acceptance_codec_version,
      d.acceptance_byte_length::int as dispatch_acceptance_byte_length,
      d.acceptance_sha256 as dispatch_acceptance_sha256,
      d.acceptance_bytes as dispatch_acceptance_bytes,
      c.request_codec_version as cancellation_request_codec_version,
      c.request_byte_length::int as cancellation_request_byte_length,
      c.request_sha256 as cancellation_request_sha256,
      c.request_bytes as cancellation_request_bytes,
      c.receipt_codec_version as cancellation_receipt_codec_version,
      c.receipt_byte_length::int as cancellation_receipt_byte_length,
      c.receipt_sha256 as cancellation_receipt_sha256,
      c.receipt_bytes as cancellation_receipt_bytes
    from fx_system_durable_task_compute_dispatch_v1 d
    join fx_system_durable_task_compute_cancellation_v1 c
      on c.scope_id = d.scope_id
      and c.run_id = d.run_id
      and c.dispatch_requested_effect_sequence = d.requested_effect_sequence
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("compute delivery evidence row missing");
  if (
    row.compute_profile_codec_version !== TASK_COMPUTE_PROFILE_STORAGE_CODEC_V1
    || row.compute_profile_byte_length !== row.compute_profile_bytes.byteLength
  ) {
    throw new Error("compute profile storage envelope mismatch");
  }
  return Effect.runPromise(Effect.all({
    computeProfile: Effect.fromResult(
      decodeTaskComputeProfileStorageBytesV1(row.compute_profile_bytes),
    ),
    dispatchRequest: decodeTaskComputeDispatchRequestEvidenceV1(
      storedEvidence(row, "dispatch_request"),
    ),
    dispatchAcceptance: decodeTaskComputeDispatchAcceptanceEvidenceV1(
      storedEvidence(row, "dispatch_acceptance"),
    ),
    cancellationRequest: decodeTaskComputeCancellationRequestEvidenceV1(
      storedEvidence(row, "cancellation_request"),
    ),
    cancellationReceipt: decodeTaskComputeCancellationReceiptEvidenceV1(
      storedEvidence(row, "cancellation_receipt"),
    ),
  }));
}

interface CanonicalTaskComputeDeliveryEvidenceV1 {
  readonly dispatchRequest: TaskComputeDeliveryEvidenceV1;
  readonly dispatchAcceptance: TaskComputeDeliveryEvidenceV1;
  readonly cancellationRequest: TaskComputeDeliveryEvidenceV1;
  readonly cancellationReceipt: TaskComputeDeliveryEvidenceV1;
}

interface StoredTaskComputeDeliveryEvidenceRowV1
  extends Record<string, unknown> {
  readonly dispatch_request_codec_version: number;
  readonly dispatch_request_byte_length: number;
  readonly dispatch_request_sha256: Uint8Array;
  readonly dispatch_request_bytes: Uint8Array;
  readonly compute_profile_codec_version: number;
  readonly compute_profile_byte_length: number;
  readonly compute_profile_bytes: Uint8Array;
  readonly dispatch_acceptance_codec_version: number;
  readonly dispatch_acceptance_byte_length: number;
  readonly dispatch_acceptance_sha256: Uint8Array;
  readonly dispatch_acceptance_bytes: Uint8Array;
  readonly cancellation_request_codec_version: number;
  readonly cancellation_request_byte_length: number;
  readonly cancellation_request_sha256: Uint8Array;
  readonly cancellation_request_bytes: Uint8Array;
  readonly cancellation_receipt_codec_version: number;
  readonly cancellation_receipt_byte_length: number;
  readonly cancellation_receipt_sha256: Uint8Array;
  readonly cancellation_receipt_bytes: Uint8Array;
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

function storedEvidence(
  row: StoredTaskComputeDeliveryEvidenceRowV1,
  prefix:
    | "dispatch_request"
    | "dispatch_acceptance"
    | "cancellation_request"
    | "cancellation_receipt",
) {
  return {
    codecVersion: row[`${prefix}_codec_version`],
    byteLength: row[`${prefix}_byte_length`],
    canonicalBytes: row[`${prefix}_bytes`],
    sha256: row[`${prefix}_sha256`],
  };
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
