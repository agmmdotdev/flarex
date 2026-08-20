import {
  TASK_COMPUTE_DISPATCH_IDENTITY_VERSION_V1,
  TASK_COMPUTE_CANCELLATION_REQUEST_VERSION_V1,
  TASK_COMPUTE_DISPATCH_REQUEST_VERSION_V1,
  TaskComputeCancellationRejectedError,
  TaskComputeCancellationStaleError,
  TaskComputeCancellationTransportError,
  TaskComputeDispatchRejectedError,
  TaskComputeDispatchTransportError,
  type TaskComputeCancellationReceiptV1,
  type TaskComputeCancellationRequestV1,
  type TaskComputeDispatchAcceptanceV1,
  type TaskComputeDispatchIdentityV1,
  type TaskComputeDispatchRequestV1,
  type CurrentTaskComputeDispatchRequestV1,
  validateApplicationTaskComputeDispatchRequestV1,
  validateCurrentTaskComputeDispatchRequestV1,
  validateTaskComputeCancellationReceiptV1,
  validateTaskComputeCancellationRequestV1,
  validateTaskComputeDispatchAcceptanceV1,
  validateTaskComputeDispatchRequestV1,
} from "@flarex/durable-task/internal/compute-provider-v1";
import {
  decodeTaskExecutionPrincipalReferenceV1,
  decodeTaskInputReferenceV1,
  type TaskExecutionPrincipalReferenceV1,
  type TaskInputReferenceV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  decodeTaskRequestedEffectSequenceV1,
  decodeTaskAttemptIdV1,
  decodeTaskCancellationGenerationV1,
  decodeTaskExecutionFenceV1,
  decodeTaskRunIdV1,
  type TaskCancellationGenerationV1,
  type PersistedTaskRequestedEffectV1,
  type TaskRequestedEffectSequenceV1,
  type TaskRunAttemptAggregateV1,
  type ApplicationTaskRunAttemptAggregateV1,
  type ApplicationPersistedTaskRequestedEffectV1,
  type TaskRunIdV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  decodeApplicationTaskCatalogBindingV1,
  decodeApplicationTaskDefinitionBindingV1,
  decodeApplicationTaskRunCreationAuthorityPreimageV1,
  encodeApplicationTaskCatalogBindingPreimageV1,
  encodeApplicationTaskDefinitionBindingPreimageV1,
  encodeApplicationTaskRuntimeTargetPreimageV1,
  MAX_APPLICATION_TASK_BINDING_CANONICAL_BYTES_V1,
  MAX_APPLICATION_TASK_BINDING_EVIDENCE_BYTES_V1,
  type ApplicationTaskCatalogBindingV1,
  type ApplicationTaskDefinitionBindingV1,
  type ApplicationTaskRunCreationAuthorityV1,
  type ApplicationTaskRuntimeTargetV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import {
  decodeCanonicalTaskManifestPreimageV1,
  encodeCanonicalTaskManifestPreimageV1,
  MAX_TASK_DEFINITION_CANONICAL_BYTES_V1,
  type CanonicalTaskManifestV1,
  decodeTaskDefinitionRuntimeBindingCommitmentPreimageV1,
  decodeTaskRunCreationAuthorityReceiptPreimageV1,
  type TaskDefinitionRuntimeBindingCommitmentV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import {
  bytesEqual,
  bytesEqualFullScan,
  copyBytes,
  encodeBytesToLowercaseHex,
  uint8ArrayByteLength,
} from "@flarex/utils/bytes";
import { copyFiniteDate } from "@flarex/utils/dates";
import { isLowercaseUuidText } from "@flarex/utils/strings";
import { and, eq, sql } from "drizzle-orm";
import { Cause, Data, Effect, Exit, Result, Schema, Semaphore } from "effect";
import {
  ReplacementScopeIdV1Schema,
  type ReplacementScopeIdV1,
  type ScopeId,
} from "flarex-protocol/storage-authority";

import type { AppRowTransaction } from "./appRows";
import type { FlarexMetadataDatabase } from "./deployments";
import { getScopeClock } from "./scopeClock";
import {
  fxSystemDurableTaskComputeDispatchesV1,
  fxSystemDurableTaskComputeCancellationsV1,
  fxSystemDurableTaskComputePendingV1,
  fxSystemDurableTaskDefinitionRevisionsV1,
  fxSystemApplicationTaskCatalogsV1,
  fxSystemApplicationTaskDefinitionsV1,
  fxSystemDurableTaskRequestedEffectsV1,
  fxSystemDurableTaskRunsV1,
  fxSystemScopeClocks,
} from "./schema";
import type {
  LocatedTrustedScopeAuthority,
  TrustedScopeAuthority,
} from "./scopeAuthorityResolution";
import type { ScopePhysicalLocator } from "./scopeMetadataTypes";
import { captureScopePhysicalLocator } from "./scopePhysicalLocator";
import {
  decodeTaskComputeDispatchAcceptanceEvidenceWithObservedSha256V1,
  decodeCurrentTaskComputeDispatchRequestEvidenceWithObservedSha256V1,
  decodeTaskComputeCancellationReceiptEvidenceWithObservedSha256V1,
  decodeTaskComputeCancellationRequestEvidenceWithObservedSha256V1,
  decodeTaskComputeProfileStorageBytesV1,
  encodeTaskComputeDispatchAcceptanceCanonicalBytesV1,
  encodeTaskComputeDispatchAcceptanceEvidenceWithObservedSha256V1,
  encodeTaskComputeCancellationReceiptCanonicalBytesV1,
  encodeTaskComputeCancellationReceiptEvidenceWithObservedSha256V1,
  encodeTaskComputeCancellationRequestCanonicalBytesV1,
  encodeTaskComputeCancellationRequestEvidenceWithObservedSha256V1,
  encodeCurrentTaskComputeDispatchRequestCanonicalBytesV1,
  encodeCurrentTaskComputeDispatchRequestEvidenceWithObservedSha256V1,
  encodeTaskComputeProfileStorageBytesV1,
  TASK_COMPUTE_DELIVERY_EVIDENCE_CODEC_V1,
  TASK_COMPUTE_PREPARED_EXECUTION_VERSION_V1,
  TASK_COMPUTE_PROFILE_STORAGE_CODEC_V1,
  TaskComputeDeliveryEvidenceV1Error,
  type TaskComputeDeliveryEvidenceV1,
  type CurrentTaskComputePreparedExecutionV1,
} from "./taskComputeDeliveryEvidenceV1";
import {
  correlateApplicationTaskSystemLifecycleLedgerV1,
  correlateTaskSystemLifecycleLedgerV1,
  taskSystemPersistedValueEqualV1,
} from "./taskSystemLifecycleLedgerCorrelationV1";
import {
  decodeAndCorrelateApplicationTaskSystemRequestedEffectRowV1,
  decodeAndCorrelateTaskSystemRequestedEffectRowV1,
} from
  "./taskSystemRequestedEffectRowV1";
import { decodeAndCorrelateTaskSystemRunRowV1 } from
  "./taskSystemRunRowV1";
import {
  captureTaskSystemTrustedScopeAuthorityV1,
  requireLockedTaskSystemScopeAuthorityV1,
  type TaskSystemScopeAuthorityMismatchV1,
} from "./taskSystemScopeAuthorityV1";
import {
  createDefaultLocatedReadCommittedTransactionRunnerV1,
} from "./transactionSessionActivation";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
  type RunLocatedReadCommittedTransactionV1,
} from "./transactionSessionAttemptKernel";

const TARGET_DB: unique symbol = Symbol(
  "FlarexDB/taskComputeDeliveryRepositoryTargetDbV1",
);
const POSTGRES_SIGNED_BIGINT_MAX = 9_223_372_036_854_775_807n;
const MAXIMUM_DELIVERY_ATTEMPTS_V1 = 250;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const decodeReplacementScopeIdResult = Schema.decodeUnknownResult(
  ReplacementScopeIdV1Schema,
);

type DispatchRow =
  typeof fxSystemDurableTaskComputeDispatchesV1.$inferSelect;
type CancellationRow =
  typeof fxSystemDurableTaskComputeCancellationsV1.$inferSelect;
type DefinitionRow =
  typeof fxSystemDurableTaskDefinitionRevisionsV1.$inferSelect;
type ApplicationCatalogRow =
  typeof fxSystemApplicationTaskCatalogsV1.$inferSelect;
type ApplicationDefinitionRow =
  typeof fxSystemApplicationTaskDefinitionsV1.$inferSelect;
type RequestedEffectRow =
  typeof fxSystemDurableTaskRequestedEffectsV1.$inferSelect;
type RunRow = typeof fxSystemDurableTaskRunsV1.$inferSelect;
type AggregateForDelivery =
  | TaskRunAttemptAggregateV1
  | ApplicationTaskRunAttemptAggregateV1;
type DispatchEffectForDelivery =
  | (PersistedTaskRequestedEffectV1 & Readonly<{
      readonly effect: Extract<
        PersistedTaskRequestedEffectV1["effect"],
        { readonly kind: "dispatch_attempt" }
      >;
    }>)
  | (ApplicationPersistedTaskRequestedEffectV1 & Readonly<{
      readonly effect: Extract<
        ApplicationPersistedTaskRequestedEffectV1["effect"],
        { readonly kind: "dispatch_attempt" }
      >;
    }>);
type CancellationEffectForDelivery =
  | (PersistedTaskRequestedEffectV1 & Readonly<{
      readonly effect: Extract<
        PersistedTaskRequestedEffectV1["effect"],
        { readonly kind: "request_execution_cancellation" }
      >;
    }>)
  | (ApplicationPersistedTaskRequestedEffectV1 & Readonly<{
      readonly effect: Extract<
        ApplicationPersistedTaskRequestedEffectV1["effect"],
        { readonly kind: "request_execution_cancellation" }
      >;
    }>);

export type TaskComputeDeliveryModeV1 =
  | "initial"
  | "retry"
  | "uncertain_replay";
export type TaskComputeDeliveryLifecycleDispositionV1 =
  | "current"
  | "cleanup_only";
export type TaskComputeDispatchClosedStateV1 =
  | "rejected"
  | "obsolete"
  | "quarantined";
export type TaskComputeDispatchClosedReasonV1 =
  | "lifecycle_obsolete"
  | "checkpoint_corrupt"
  | "provider_unsupported_compute_profile"
  | "provider_capacity_unavailable"
  | "provider_disabled"
  | "provider_transport"
  | "delivery_attempts_exhausted";

export type TaskComputeDeliveryRepositoryOperationV1 =
  | "acquire_dispatch"
  | "verify_dispatch_recovery"
  | "mark_dispatch_delivery_started"
  | "renew_dispatch_claim"
  | "release_dispatch_before_delivery"
  | "record_dispatch_acceptance"
  | "record_dispatch_known_failure"
  | "acquire_cancellation"
  | "verify_cancellation_recovery"
  | "mark_cancellation_delivery_started"
  | "renew_cancellation_claim"
  | "release_cancellation_before_delivery"
  | "record_cancellation_receipt"
  | "record_cancellation_known_failure";
type TaskComputeDeliveryRepositoryHandleOperationV1 = Exclude<
  TaskComputeDeliveryRepositoryOperationV1,
  "acquire_dispatch" | "acquire_cancellation"
>;
interface TaskComputeDeliveryRepositoryEvidenceOperationByOperationV1 {
  readonly acquire_dispatch:
    | "encode_dispatch_request"
    | "decode_dispatch_request"
    | "decode_dispatch_acceptance";
  readonly verify_dispatch_recovery: "decode_dispatch_request";
  readonly mark_dispatch_delivery_started: "decode_dispatch_request";
  readonly renew_dispatch_claim: "decode_dispatch_request";
  readonly release_dispatch_before_delivery: "decode_dispatch_request";
  readonly record_dispatch_acceptance:
    | "decode_dispatch_request"
    | "encode_dispatch_acceptance"
    | "decode_dispatch_acceptance";
  readonly record_dispatch_known_failure: "decode_dispatch_request";
  readonly acquire_cancellation:
    | "decode_dispatch_request"
    | "decode_dispatch_acceptance"
    | "encode_cancellation_request"
    | "decode_cancellation_request"
    | "decode_cancellation_receipt";
  readonly verify_cancellation_recovery:
    | "decode_dispatch_request"
    | "decode_dispatch_acceptance"
    | "decode_cancellation_request";
  readonly mark_cancellation_delivery_started:
    | "decode_dispatch_request"
    | "decode_dispatch_acceptance"
    | "decode_cancellation_request";
  readonly renew_cancellation_claim:
    | "decode_dispatch_request"
    | "decode_dispatch_acceptance"
    | "decode_cancellation_request";
  readonly release_cancellation_before_delivery:
    | "decode_dispatch_request"
    | "decode_dispatch_acceptance"
    | "decode_cancellation_request";
  readonly record_cancellation_receipt:
    | "decode_dispatch_request"
    | "decode_dispatch_acceptance"
    | "decode_cancellation_request"
    | "encode_cancellation_receipt"
    | "decode_cancellation_receipt";
  readonly record_cancellation_known_failure:
    | "decode_dispatch_request"
    | "decode_dispatch_acceptance"
    | "decode_cancellation_request";
}
interface TaskComputeDeliveryRepositoryInputReasonByOperationV1 {
  readonly acquire_dispatch: "invalid_request" | "claim_owner_invalid";
  readonly verify_dispatch_recovery: "invalid_handle" | "closed_handle";
  readonly mark_dispatch_delivery_started: "invalid_handle" | "closed_handle";
  readonly renew_dispatch_claim: "invalid_handle" | "closed_handle";
  readonly release_dispatch_before_delivery: "invalid_handle" | "closed_handle";
  readonly record_dispatch_acceptance:
    | "invalid_handle"
    | "closed_handle"
    | "invalid_acceptance"
    | "acceptance_correlation_mismatch";
  readonly record_dispatch_known_failure:
    | "invalid_handle"
    | "closed_handle"
    | "invalid_known_failure"
    | "known_failure_correlation_mismatch";
  readonly acquire_cancellation: "invalid_request" | "claim_owner_invalid";
  readonly verify_cancellation_recovery: "invalid_handle" | "closed_handle";
  readonly mark_cancellation_delivery_started:
    | "invalid_handle"
    | "closed_handle";
  readonly renew_cancellation_claim: "invalid_handle" | "closed_handle";
  readonly release_cancellation_before_delivery:
    | "invalid_handle"
    | "closed_handle";
  readonly record_cancellation_receipt:
    | "invalid_handle"
    | "closed_handle"
    | "invalid_receipt"
    | "receipt_correlation_mismatch";
  readonly record_cancellation_known_failure:
    | "invalid_handle"
    | "closed_handle"
    | "invalid_known_failure"
    | "known_failure_correlation_mismatch";
}
interface TaskComputeDeliveryRepositoryStaleErrorByOperationV1 {
  readonly acquire_dispatch: never;
  readonly verify_dispatch_recovery:
    TaskComputeDeliveryRepositoryStaleClaimV1Error<
      "verify_dispatch_recovery"
    >;
  readonly mark_dispatch_delivery_started:
    TaskComputeDeliveryRepositoryStaleClaimV1Error<
      "mark_dispatch_delivery_started"
    >;
  readonly renew_dispatch_claim:
    TaskComputeDeliveryRepositoryStaleClaimV1Error<"renew_dispatch_claim">;
  readonly release_dispatch_before_delivery:
    TaskComputeDeliveryRepositoryStaleClaimV1Error<
      "release_dispatch_before_delivery"
    >;
  readonly record_dispatch_acceptance:
    TaskComputeDeliveryRepositoryStaleClaimV1Error<
      "record_dispatch_acceptance"
    >;
  readonly record_dispatch_known_failure:
    TaskComputeDeliveryRepositoryStaleClaimV1Error<
      "record_dispatch_known_failure"
    >;
  readonly acquire_cancellation: never;
  readonly verify_cancellation_recovery:
    TaskComputeDeliveryRepositoryStaleClaimV1Error<
      "verify_cancellation_recovery"
    >;
  readonly mark_cancellation_delivery_started:
    TaskComputeDeliveryRepositoryStaleClaimV1Error<
      "mark_cancellation_delivery_started"
    >;
  readonly renew_cancellation_claim:
    TaskComputeDeliveryRepositoryStaleClaimV1Error<"renew_cancellation_claim">;
  readonly release_cancellation_before_delivery:
    TaskComputeDeliveryRepositoryStaleClaimV1Error<
      "release_cancellation_before_delivery"
    >;
  readonly record_cancellation_receipt:
    TaskComputeDeliveryRepositoryStaleClaimV1Error<
      "record_cancellation_receipt"
    >;
  readonly record_cancellation_known_failure:
    TaskComputeDeliveryRepositoryStaleClaimV1Error<
      "record_cancellation_known_failure"
    >;
}
interface TaskComputeDeliveryRepositoryResourceErrorByOperationV1 {
  readonly acquire_dispatch:
    TaskComputeDeliveryRepositoryResourceExhaustedV1Error<"acquire_dispatch">;
  readonly verify_dispatch_recovery: never;
  readonly mark_dispatch_delivery_started:
    TaskComputeDeliveryRepositoryResourceExhaustedV1Error<
      "mark_dispatch_delivery_started"
    >;
  readonly renew_dispatch_claim: never;
  readonly release_dispatch_before_delivery: never;
  readonly record_dispatch_acceptance: never;
  readonly record_dispatch_known_failure: never;
  readonly acquire_cancellation:
    TaskComputeDeliveryRepositoryResourceExhaustedV1Error<
      "acquire_cancellation"
    >;
  readonly verify_cancellation_recovery: never;
  readonly mark_cancellation_delivery_started:
    TaskComputeDeliveryRepositoryResourceExhaustedV1Error<
      "mark_cancellation_delivery_started"
    >;
  readonly renew_cancellation_claim: never;
  readonly release_cancellation_before_delivery: never;
  readonly record_cancellation_receipt: never;
  readonly record_cancellation_known_failure: never;
}
type TaskComputeDeliveryRepositoryEvidenceOperationV1<
  Operation extends TaskComputeDeliveryRepositoryOperationV1,
> = TaskComputeDeliveryRepositoryEvidenceOperationByOperationV1[Operation];

export class TaskComputeDeliveryRepositoryConfigurationV1Error
  extends Data.TaggedError(
    "TaskComputeDeliveryRepositoryConfigurationV1Error",
  )<{
    readonly reason:
      | "invalid_options"
      | "invalid_claim_duration"
      | "invalid_retry_delays"
      | "invalid_maximum_delivery_attempts"
      | "invalid_random_uuid"
      | "invalid_scope";
  }> {}

export class TaskComputePreparedExecutionReadV1Error extends Data.TaggedError(
  "TaskComputePreparedExecutionReadV1Error",
)<{
  readonly reason:
    | "invalid_request"
    | "not_found"
    | "corrupt"
    | "stale_authority"
    | "resource_failure";
  readonly cause?: unknown;
}> {}

export class TaskComputeDeliveryRepositoryInputV1Error<
  Operation extends TaskComputeDeliveryRepositoryOperationV1 =
    TaskComputeDeliveryRepositoryOperationV1,
>
  extends Data.TaggedError("TaskComputeDeliveryRepositoryInputV1Error")<{
    readonly operation: Operation;
    readonly reason:
      TaskComputeDeliveryRepositoryInputReasonByOperationV1[Operation];
  }> {}

export class TaskComputeDeliveryRepositoryUnavailableV1Error<
  Operation extends TaskComputeDeliveryRepositoryOperationV1 =
    TaskComputeDeliveryRepositoryOperationV1,
>
  extends Data.TaggedError(
    "TaskComputeDeliveryRepositoryUnavailableV1Error",
  )<{
    readonly operation: Operation;
    readonly runId: TaskRunIdV1;
    readonly reason: "run_unavailable" | "effect_unavailable";
  }> {}

export class TaskComputeDeliveryRepositoryStaleScopeAuthorityV1Error<
  Operation extends TaskComputeDeliveryRepositoryOperationV1 =
    TaskComputeDeliveryRepositoryOperationV1,
>
  extends Data.TaggedError(
    "TaskComputeDeliveryRepositoryStaleScopeAuthorityV1Error",
  )<{
    readonly operation: Operation;
    readonly runId: TaskRunIdV1;
    readonly authority: TaskSystemScopeAuthorityMismatchV1;
  }> {}

export class TaskComputeDeliveryRepositoryStaleClaimV1Error<
  Operation extends TaskComputeDeliveryRepositoryHandleOperationV1 =
    TaskComputeDeliveryRepositoryHandleOperationV1,
>
  extends Data.TaggedError("TaskComputeDeliveryRepositoryStaleClaimV1Error")<{
    readonly operation: Operation;
    readonly runId: TaskRunIdV1;
    readonly reason:
      | "owner_mismatch"
      | "fence_mismatch"
      | "state_mismatch"
      | "claim_expired"
      | "lifecycle_obsolete";
  }> {}

export type TaskComputeDeliveryRepositoryCorruptionReasonV1 =
  | "aggregate_invalid"
  | "effect_invalid"
  | "effect_sequence_invalid"
  | "acceptance_invalid"
  | "definition_invalid"
  | "creation_authority_invalid"
  | "input_invalid"
  | "principal_invalid"
  | "checkpoint_invalid"
  | "pending_membership_invalid"
  | "database_clock_invalid";

export class TaskComputeDeliveryRepositoryCorruptionV1Error<
  Operation extends TaskComputeDeliveryRepositoryOperationV1 =
    TaskComputeDeliveryRepositoryOperationV1,
>
  extends Data.TaggedError("TaskComputeDeliveryRepositoryCorruptionV1Error")<{
    readonly operation: Operation;
    readonly runId: TaskRunIdV1;
    readonly reason: TaskComputeDeliveryRepositoryCorruptionReasonV1;
  }> {}

export class TaskComputeDeliveryRepositoryResourceExhaustedV1Error<
  Operation extends
    | "acquire_dispatch"
    | "mark_dispatch_delivery_started"
    | "acquire_cancellation"
    | "mark_cancellation_delivery_started" =
      | "acquire_dispatch"
      | "mark_dispatch_delivery_started"
      | "acquire_cancellation"
      | "mark_cancellation_delivery_started",
>
  extends Data.TaggedError(
    "TaskComputeDeliveryRepositoryResourceExhaustedV1Error",
  )<{
    readonly operation: Operation;
    readonly runId: TaskRunIdV1;
    readonly dimension: Operation extends
      "acquire_dispatch" | "acquire_cancellation"
      ? "claim_fence"
      : "delivery_attempt_count";
    readonly observed: bigint;
    readonly maximum: bigint;
  }> {}

export class TaskComputeDeliveryRepositoryConfirmedRollbackV1Error<
  Operation extends TaskComputeDeliveryRepositoryOperationV1 =
    TaskComputeDeliveryRepositoryOperationV1,
>
  extends Data.TaggedError(
    "TaskComputeDeliveryRepositoryConfirmedRollbackV1Error",
  )<{
    readonly operation: Operation;
    readonly cause: LocatedReadCommittedTransactionFailureV1;
  }> {}

export class TaskComputeDeliveryRepositoryDecisionUncertainV1Error<
  Operation extends TaskComputeDeliveryRepositoryOperationV1 =
    TaskComputeDeliveryRepositoryOperationV1,
>
  extends Data.TaggedError(
    "TaskComputeDeliveryRepositoryDecisionUncertainV1Error",
  )<{
    readonly operation: Operation;
    readonly cause: LocatedReadCommittedTransactionFailureV1;
  }> {}

export class TaskComputeDeliveryRepositorySqlV1Error<
  Operation extends TaskComputeDeliveryRepositoryOperationV1 =
    TaskComputeDeliveryRepositoryOperationV1,
>
  extends Data.TaggedError("TaskComputeDeliveryRepositorySqlV1Error")<{
    readonly operation: Operation;
    readonly phase: "cleanup" | "infrastructure";
    readonly cause: unknown;
  }> {}

export class TaskComputeDeliveryRepositoryCryptoV1Error<
  Operation extends TaskComputeDeliveryRepositoryOperationV1 =
    TaskComputeDeliveryRepositoryOperationV1,
>
  extends Data.TaggedError("TaskComputeDeliveryRepositoryCryptoV1Error")<{
    readonly operation: Operation;
    readonly cause: unknown;
  }> {}

type TaskComputeDeliveryRepositoryErrorForOperationV1<
  Operation extends TaskComputeDeliveryRepositoryOperationV1,
> =
  | TaskComputeDeliveryRepositoryInputV1Error<Operation>
  | TaskComputeDeliveryRepositoryUnavailableV1Error<Operation>
  | TaskComputeDeliveryRepositoryStaleScopeAuthorityV1Error<Operation>
  | TaskComputeDeliveryRepositoryStaleErrorByOperationV1[Operation]
  | TaskComputeDeliveryRepositoryCorruptionV1Error<Operation>
  | TaskComputeDeliveryRepositoryResourceErrorByOperationV1[Operation]
  | TaskComputeDeliveryRepositoryConfirmedRollbackV1Error<Operation>
  | TaskComputeDeliveryRepositoryDecisionUncertainV1Error<Operation>
  | TaskComputeDeliveryRepositorySqlV1Error<Operation>
  | TaskComputeDeliveryRepositoryCryptoV1Error<Operation>
  | TaskComputeDeliveryEvidenceV1Error<
      TaskComputeDeliveryRepositoryEvidenceOperationV1<Operation>
    >;

export type TaskComputeDeliveryRepositoryErrorV1<
  Operation extends TaskComputeDeliveryRepositoryOperationV1 =
    TaskComputeDeliveryRepositoryOperationV1,
> = TaskComputeDeliveryRepositoryErrorForOperationV1<Operation>;

type TaskComputeDeliveryRepositoryBroadErrorV1 =
  | TaskComputeDeliveryRepositoryInputV1Error
  | TaskComputeDeliveryRepositoryUnavailableV1Error
  | TaskComputeDeliveryRepositoryStaleScopeAuthorityV1Error
  | TaskComputeDeliveryRepositoryStaleClaimV1Error
  | TaskComputeDeliveryRepositoryCorruptionV1Error
  | TaskComputeDeliveryRepositoryResourceExhaustedV1Error
  | TaskComputeDeliveryRepositoryConfirmedRollbackV1Error
  | TaskComputeDeliveryRepositoryDecisionUncertainV1Error
  | TaskComputeDeliveryRepositorySqlV1Error
  | TaskComputeDeliveryRepositoryCryptoV1Error
  | TaskComputeDeliveryEvidenceV1Error;

const TASK_COMPUTE_DISPATCH_CLAIM_HANDLE_V1: unique symbol = Symbol(
  "FlarexDB/taskComputeDispatchClaimHandleV1",
);
export interface TaskComputeDispatchClaimHandleV1 {
  readonly [TASK_COMPUTE_DISPATCH_CLAIM_HANDLE_V1]: true;
}

const TASK_COMPUTE_CANCELLATION_CLAIM_HANDLE_V1: unique symbol = Symbol(
  "FlarexDB/taskComputeCancellationClaimHandleV1",
);
export interface TaskComputeCancellationClaimHandleV1 {
  readonly [TASK_COMPUTE_CANCELLATION_CLAIM_HANDLE_V1]: true;
}

export interface TaskComputeDispatchAcquireRequestV1 {
  readonly runId: TaskRunIdV1;
  readonly requestedEffectSequence: TaskRequestedEffectSequenceV1;
}

export type TaskComputeDispatchAcquireResultV1 =
  | Readonly<{
      readonly kind: "claimed";
      readonly prepared: CurrentTaskComputePreparedExecutionV1;
      readonly handle: TaskComputeDispatchClaimHandleV1;
      readonly deliveryMode: TaskComputeDeliveryModeV1;
      readonly claimExpiresAt: Date;
    }>
  | Readonly<{
      readonly kind: "busy";
      readonly claimExpiresAt: Date;
    }>
  | Readonly<{
      readonly kind: "not_due";
      readonly nextAttemptAt: Date;
    }>
  | Readonly<{
      readonly kind: "accepted";
      readonly acceptance: TaskComputeDispatchAcceptanceV1;
      readonly disposition: TaskComputeDeliveryLifecycleDispositionV1;
    }>
  | Readonly<{
      readonly kind: "closed";
      readonly state: TaskComputeDispatchClosedStateV1;
      readonly reason: TaskComputeDispatchClosedReasonV1;
    }>;

export interface TaskComputeDispatchDeliveryStartedV1 {
  readonly kind: "delivery_started";
  readonly deliveryAttemptCount: bigint;
  readonly deliveryStartedAt: Date;
}

type TaskComputeDeliveryRecoveryProbeOperationV1 =
  | "verify_dispatch_recovery"
  | "verify_cancellation_recovery";

export type TaskComputeDeliveryRecoveryProbeUncertainCauseV1<
  Operation extends TaskComputeDeliveryRecoveryProbeOperationV1 =
    TaskComputeDeliveryRecoveryProbeOperationV1,
> =
  | TaskComputeDeliveryRepositoryConfirmedRollbackV1Error<Operation>
  | TaskComputeDeliveryRepositoryDecisionUncertainV1Error<Operation>
  | TaskComputeDeliveryRepositorySqlV1Error<Operation>;

export type TaskComputeDeliveryRecoveryProbeErrorV1<
  Operation extends TaskComputeDeliveryRecoveryProbeOperationV1 =
    TaskComputeDeliveryRecoveryProbeOperationV1,
> = Exclude<
  TaskComputeDeliveryRepositoryErrorV1<Operation>,
  TaskComputeDeliveryRecoveryProbeUncertainCauseV1<Operation>
>;

export type TaskComputeDeliveryRecoveryObservationV1<
  Operation extends TaskComputeDeliveryRecoveryProbeOperationV1 =
    TaskComputeDeliveryRecoveryProbeOperationV1,
> =
  | Readonly<{ readonly kind: "state_moved" }>
  | Readonly<{ readonly kind: "state_unchanged" }>
  | Readonly<{
      readonly kind: "probe_uncertain";
      readonly cause: TaskComputeDeliveryRecoveryProbeUncertainCauseV1<Operation>;
    }>;

export interface TaskComputeDispatchClaimRenewedV1 {
  readonly kind: "claim_renewed";
  readonly claimExpiresAt: Date;
}

export interface TaskComputeDispatchClaimReleasedV1 {
  readonly kind: "claim_released";
}

export interface TaskComputeDispatchAcceptanceRecordedV1 {
  readonly kind: "dispatch_accepted";
  readonly acceptance: TaskComputeDispatchAcceptanceV1;
  readonly disposition: TaskComputeDeliveryLifecycleDispositionV1;
}

export type TaskComputeDispatchKnownFailureV1 =
  | TaskComputeDispatchRejectedError
  | TaskComputeDispatchTransportError;

export type TaskComputeDispatchKnownFailureRecordedV1 =
  | Readonly<{
      readonly kind: "retry_scheduled";
      readonly reason: Exclude<
        TaskComputeDispatchClosedReasonV1,
        "lifecycle_obsolete" | "checkpoint_corrupt" | "delivery_attempts_exhausted"
      >;
      readonly nextAttemptAt: Date;
    }>
  | Readonly<{
      readonly kind: "dispatch_rejected";
      readonly reason: Exclude<
        TaskComputeDispatchClosedReasonV1,
        "lifecycle_obsolete" | "checkpoint_corrupt"
      >;
    }>;

export type TaskComputeCancellationClosedReasonV1 =
  | "lifecycle_obsolete"
  | "checkpoint_corrupt"
  | "provider_disabled"
  | "provider_execution_not_found"
  | "provider_execution_mismatch"
  | "provider_stale_generation"
  | "provider_transport"
  | "delivery_attempts_exhausted";

export type TaskComputeCancellationAcquireResultV1 =
  | Readonly<{
      readonly kind: "claimed";
      readonly request: TaskComputeCancellationRequestV1;
      readonly handle: TaskComputeCancellationClaimHandleV1;
      readonly deliveryMode: TaskComputeDeliveryModeV1;
      readonly claimExpiresAt: Date;
    }>
  | Readonly<{ readonly kind: "waiting_dispatch" }>
  | Readonly<{ readonly kind: "busy"; readonly claimExpiresAt: Date }>
  | Readonly<{ readonly kind: "not_due"; readonly nextAttemptAt: Date }>
  | Readonly<{
      readonly kind: "delivered";
      readonly receipt: TaskComputeCancellationReceiptV1;
      readonly disposition: TaskComputeDeliveryLifecycleDispositionV1;
    }>
  | Readonly<{
      readonly kind: "closed";
      readonly state: TaskComputeDispatchClosedStateV1;
      readonly reason: TaskComputeCancellationClosedReasonV1;
    }>;

export interface TaskComputeCancellationDeliveryStartedV1 {
  readonly kind: "delivery_started";
  readonly deliveryAttemptCount: bigint;
  readonly deliveryStartedAt: Date;
}

export interface TaskComputeCancellationClaimRenewedV1 {
  readonly kind: "claim_renewed";
  readonly claimExpiresAt: Date;
}

export interface TaskComputeCancellationClaimReleasedV1 {
  readonly kind: "claim_released";
}

export interface TaskComputeCancellationReceiptRecordedV1 {
  readonly kind: "cancellation_delivered";
  readonly receipt: TaskComputeCancellationReceiptV1;
  readonly disposition: TaskComputeDeliveryLifecycleDispositionV1;
}

export type TaskComputeCancellationKnownFailureV1 =
  | TaskComputeCancellationRejectedError
  | TaskComputeCancellationStaleError
  | TaskComputeCancellationTransportError;

export type TaskComputeCancellationKnownFailureRecordedV1 =
  | Readonly<{
      readonly kind: "retry_scheduled";
      readonly reason: Exclude<
        TaskComputeCancellationClosedReasonV1,
        | "lifecycle_obsolete"
        | "checkpoint_corrupt"
        | "provider_stale_generation"
        | "delivery_attempts_exhausted"
      >;
      readonly nextAttemptAt: Date;
    }>
  | Readonly<{
      readonly kind: "cancellation_rejected";
      readonly reason: Exclude<
        TaskComputeCancellationClosedReasonV1,
        "lifecycle_obsolete" | "checkpoint_corrupt"
      >;
    }>;

export interface TaskComputeDeliveryRepositoryV1 {
  readonly acquireDispatch: (
    request: TaskComputeDispatchAcquireRequestV1,
  ) => Effect.Effect<
    TaskComputeDispatchAcquireResultV1,
    TaskComputeDeliveryRepositoryErrorV1<"acquire_dispatch">
  >;
  readonly verifyDispatchRecovery: (
    handle: TaskComputeDispatchClaimHandleV1,
  ) => Effect.Effect<
    TaskComputeDeliveryRecoveryObservationV1<"verify_dispatch_recovery">,
    TaskComputeDeliveryRecoveryProbeErrorV1<"verify_dispatch_recovery">
  >;
  readonly markDispatchDeliveryStarted: (
    handle: TaskComputeDispatchClaimHandleV1,
  ) => Effect.Effect<
    TaskComputeDispatchDeliveryStartedV1,
    TaskComputeDeliveryRepositoryErrorV1<"mark_dispatch_delivery_started">
  >;
  readonly renewDispatchClaim: (
    handle: TaskComputeDispatchClaimHandleV1,
  ) => Effect.Effect<
    TaskComputeDispatchClaimRenewedV1,
    TaskComputeDeliveryRepositoryErrorV1<"renew_dispatch_claim">
  >;
  readonly releaseDispatchBeforeDelivery: (
    handle: TaskComputeDispatchClaimHandleV1,
  ) => Effect.Effect<
    TaskComputeDispatchClaimReleasedV1,
    TaskComputeDeliveryRepositoryErrorV1<"release_dispatch_before_delivery">
  >;
  readonly recordDispatchAcceptance: (
    handle: TaskComputeDispatchClaimHandleV1,
    acceptance: TaskComputeDispatchAcceptanceV1,
  ) => Effect.Effect<
    TaskComputeDispatchAcceptanceRecordedV1,
    TaskComputeDeliveryRepositoryErrorV1<"record_dispatch_acceptance">
  >;
  readonly recordDispatchKnownFailure: (
    handle: TaskComputeDispatchClaimHandleV1,
    failure: TaskComputeDispatchKnownFailureV1,
  ) => Effect.Effect<
    TaskComputeDispatchKnownFailureRecordedV1,
    TaskComputeDeliveryRepositoryErrorV1<"record_dispatch_known_failure">
  >;
  readonly acquireCancellation: (
    request: TaskComputeDispatchAcquireRequestV1,
  ) => Effect.Effect<
    TaskComputeCancellationAcquireResultV1,
    TaskComputeDeliveryRepositoryErrorV1<"acquire_cancellation">
  >;
  readonly verifyCancellationRecovery: (
    handle: TaskComputeCancellationClaimHandleV1,
  ) => Effect.Effect<
    TaskComputeDeliveryRecoveryObservationV1<"verify_cancellation_recovery">,
    TaskComputeDeliveryRecoveryProbeErrorV1<"verify_cancellation_recovery">
  >;
  readonly markCancellationDeliveryStarted: (
    handle: TaskComputeCancellationClaimHandleV1,
  ) => Effect.Effect<
    TaskComputeCancellationDeliveryStartedV1,
    TaskComputeDeliveryRepositoryErrorV1<"mark_cancellation_delivery_started">
  >;
  readonly renewCancellationClaim: (
    handle: TaskComputeCancellationClaimHandleV1,
  ) => Effect.Effect<
    TaskComputeCancellationClaimRenewedV1,
    TaskComputeDeliveryRepositoryErrorV1<"renew_cancellation_claim">
  >;
  readonly releaseCancellationBeforeDelivery: (
    handle: TaskComputeCancellationClaimHandleV1,
  ) => Effect.Effect<
    TaskComputeCancellationClaimReleasedV1,
    TaskComputeDeliveryRepositoryErrorV1<"release_cancellation_before_delivery">
  >;
  readonly recordCancellationReceipt: (
    handle: TaskComputeCancellationClaimHandleV1,
    receipt: TaskComputeCancellationReceiptV1,
  ) => Effect.Effect<
    TaskComputeCancellationReceiptRecordedV1,
    TaskComputeDeliveryRepositoryErrorV1<"record_cancellation_receipt">
  >;
  readonly recordCancellationKnownFailure: (
    handle: TaskComputeCancellationClaimHandleV1,
    failure: TaskComputeCancellationKnownFailureV1,
  ) => Effect.Effect<
    TaskComputeCancellationKnownFailureRecordedV1,
    TaskComputeDeliveryRepositoryErrorV1<"record_cancellation_known_failure">
  >;
}

export interface LocatedTaskComputeDeliveryTargetV1
  extends LocatedReadCommittedAttemptTargetV1 {
  readonly [TARGET_DB]: FlarexMetadataDatabase;
}

export interface TaskComputeDeliveryRepositoryOptionsV1 {
  readonly claimDurationMilliseconds: number;
  readonly retryDelayMilliseconds: ReadonlyArray<number>;
  readonly maximumDeliveryAttempts: number;
  readonly randomUuid: () => string;
}

interface CapturedConfigurationV1 {
  readonly claimDurationMilliseconds: number;
  readonly retryDelayMilliseconds: ReadonlyArray<number>;
  readonly maximumDeliveryAttempts: number;
  readonly randomUuid: () => string;
}

interface CapturedAcquireRequestV1 {
  readonly runId: TaskRunIdV1;
  readonly requestedEffectSequence: TaskRequestedEffectSequenceV1;
}

type CapturedKnownDispatchFailureV1 =
  | Readonly<{
      readonly kind: "rejected";
      readonly reason:
        | "unsupported_compute_profile"
        | "capacity_unavailable"
        | "provider_disabled";
      readonly retryable: boolean;
      readonly computeProfile: TaskComputeDispatchRequestV1["computeProfile"];
    }>
  | Readonly<{
      readonly kind: "transport";
      readonly retryable: boolean;
    }>;

type CapturedKnownCancellationFailureV1 =
  | Readonly<{
      readonly kind: "rejected";
      readonly reason:
        | "provider_disabled"
        | "execution_not_found"
        | "execution_mismatch";
      readonly retryable: boolean;
    }>
  | Readonly<{
      readonly kind: "transport";
      readonly retryable: boolean;
    }>
  | Readonly<{
      readonly kind: "stale";
      readonly identity: TaskComputeDispatchIdentityV1;
      readonly receivedGeneration: TaskCancellationGenerationV1;
      readonly acceptedGeneration: TaskCancellationGenerationV1;
    }>;

interface MutableHandleStateV1 {
  readonly operation: "dispatch" | "cancellation";
  readonly runId: TaskRunIdV1;
  readonly requestedEffectSequence: TaskRequestedEffectSequenceV1;
  readonly claimOwner: string;
  readonly claimFence: bigint;
  readonly deliveryMode: TaskComputeDeliveryModeV1;
  recoveryVerified: boolean;
  phase: "claimed" | "delivering";
  closed: boolean;
  readonly operationGate: Semaphore.Semaphore;
}

interface TransactionClaimedV1 {
  readonly kind: "claimed";
  readonly prepared: CurrentTaskComputePreparedExecutionV1;
  readonly deliveryMode: TaskComputeDeliveryModeV1;
  readonly claimOwner: string;
  readonly claimFence: bigint;
  readonly claimExpiresAt: Date;
}

type TransactionAcquireResultV1 =
  | TransactionClaimedV1
  | Exclude<TaskComputeDispatchAcquireResultV1, { readonly kind: "claimed" }>;

interface TransactionCancellationClaimedV1 {
  readonly kind: "claimed";
  readonly request: TaskComputeCancellationRequestV1;
  readonly deliveryMode: TaskComputeDeliveryModeV1;
  readonly claimOwner: string;
  readonly claimFence: bigint;
  readonly claimExpiresAt: Date;
  readonly requestedEffectSequence: TaskRequestedEffectSequenceV1;
}

type TransactionCancellationAcquireResultV1 =
  | TransactionCancellationClaimedV1
  | Exclude<
      TaskComputeCancellationAcquireResultV1,
      { readonly kind: "claimed" }
    >;

export function createLocatedTaskComputeDeliveryTargetV1(
  db: FlarexMetadataDatabase,
  physicalLocator: ScopePhysicalLocator,
  runReadCommitted: RunLocatedReadCommittedTransactionV1 =
    createDefaultLocatedReadCommittedTransactionRunnerV1(db),
): LocatedTaskComputeDeliveryTargetV1 {
  return Object.freeze({
    physicalLocator: captureScopePhysicalLocator(physicalLocator),
    getCurrentClock: (scopeId: ScopeId) => getScopeClock(db, scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: runReadCommitted,
    [TARGET_DB]: db,
  });
}

export function makeTaskComputeDeliveryRepositoryV1(
  located: LocatedTrustedScopeAuthority<LocatedTaskComputeDeliveryTargetV1>,
  options: TaskComputeDeliveryRepositoryOptionsV1,
): Result.Result<
  TaskComputeDeliveryRepositoryV1,
  TaskComputeDeliveryRepositoryConfigurationV1Error
> {
  return captureConfiguration(options).pipe(
    Result.flatMap((configuration) =>
      decodeReplacementScopeIdResult(located.authority.scopeId).pipe(
        Result.mapError(() => configurationFailure("invalid_scope")),
        Result.map((scopeId) => makeRepository(
          captureTaskSystemTrustedScopeAuthorityV1(located.authority),
          scopeId,
          located.target,
          configuration,
        )),
      )
    ),
  );
}

/**
 * Reconstructs the exact immutable prepared execution for an already-issued
 * provider request without claiming, consuming, or mutating delivery state.
 */
export const readTaskComputePreparedExecutionV1 = Effect.fn(
  "TaskComputeDeliveryRepository.readPreparedExecution",
)(function* (
  located: LocatedTrustedScopeAuthority<LocatedTaskComputeDeliveryTargetV1>,
  suppliedRequest: unknown,
): Effect.fn.Return<
  CurrentTaskComputePreparedExecutionV1,
  TaskComputePreparedExecutionReadV1Error
> {
  const request = yield* Effect.fromResult(
    validateCurrentTaskComputeDispatchRequestV1(suppliedRequest).pipe(
      Result.mapError(cause => new TaskComputePreparedExecutionReadV1Error({
        reason: "invalid_request",
        cause,
      })),
    ),
  );
  const authority = captureTaskSystemTrustedScopeAuthorityV1(located.authority);
  const scopeId = yield* Effect.fromResult(
    decodeReplacementScopeIdResult(authority.scopeId).pipe(
      Result.mapError(cause => new TaskComputePreparedExecutionReadV1Error({
        reason: "stale_authority",
        cause,
      })),
    ),
  );
  if (request.identity.scopeId !== scopeId) {
    return yield* new TaskComputePreparedExecutionReadV1Error({
      reason: "invalid_request",
    });
  }
  const selected = yield* Effect.fromResult(
    captureAcquireRequest({
      runId: request.identity.runId,
      requestedEffectSequence: request.identity.requestedEffectSequence,
    }, "acquire_dispatch").pipe(
      Result.mapError(cause => new TaskComputePreparedExecutionReadV1Error({
        reason: "invalid_request",
        cause,
      })),
    ),
  );
  for (let execution = 1; execution <= 2; execution += 1) {
    const transaction = located.target[RUN_LOCATED_READ_COMMITTED_V1](tx =>
      readPreparedExecutionTransaction(
        tx,
        authority,
        scopeId,
        located.target,
        selected,
      )
    );
    const settled = yield* Effect.exit(awaitSettlement(transaction));
    if (Exit.isSuccess(settled)) {
      if (!taskSystemPersistedValueEqualV1(
        settled.value.dispatchRequest,
        request,
      )) {
        return yield* new TaskComputePreparedExecutionReadV1Error({
          reason: "invalid_request",
        });
      }
      return settled.value;
    }
    const failure = yield* Result.match(Cause.findError(settled.cause), {
      onFailure: Effect.failCause,
      onSuccess: Effect.succeed,
    });
    const classified = classifyTransactionFailure(
      "acquire_dispatch",
      failure,
      execution,
    );
    if (classified.kind === "retry") continue;
    if (classified.kind === "defect") return yield* Effect.die(classified.cause);
    return yield* classified.error.pipe(
      Effect.mapError(mapPreparedExecutionReadFailure),
    );
  }
  return yield* new TaskComputePreparedExecutionReadV1Error({
    reason: "resource_failure",
  });
});

async function readPreparedExecutionTransaction(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  replacementScopeId: ReplacementScopeIdV1,
  target: LocatedTaskComputeDeliveryTargetV1,
  selected: CapturedAcquireRequestV1,
): Promise<CurrentTaskComputePreparedExecutionV1> {
  const operation = "acquire_dispatch" as const;
  await statement(operation, () => requireLockedTaskSystemScopeAuthorityV1(
    tx,
    authority,
    target,
    mismatch => rollback(
      new TaskComputeDeliveryRepositoryStaleScopeAuthorityV1Error({
        operation,
        runId: selected.runId,
        authority: mismatch,
      }),
    ),
  ));
  const runRows = await statement(operation, () => tx.select().from(
    fxSystemDurableTaskRunsV1,
  ).where(and(
    eq(fxSystemDurableTaskRunsV1.scopeId, authority.scopeId),
    eq(fxSystemDurableTaskRunsV1.runId, selected.runId),
  )).limit(1).for("share"));
  const storedRun = runRows[0];
  if (storedRun === undefined) {
    throw rollback(new TaskComputeDeliveryRepositoryUnavailableV1Error({
      operation,
      runId: selected.runId,
      reason: "run_unavailable",
    }));
  }
  const aggregate = decodeRun(storedRun, operation, selected.runId);
  const effectRow = await findRequestedEffect(
    tx,
    authority.scopeId,
    selected,
    operation,
  );
  if (effectRow === undefined) {
    throw rollback(new TaskComputeDeliveryRepositoryUnavailableV1Error({
      operation,
      runId: selected.runId,
      reason: "effect_unavailable",
    }));
  }
  const persistedEffect = decodeDispatchEffect(
    effectRow,
    aggregate.generation,
    selected,
    operation,
  );
  requireSelectedDispatchDefinitionIdentity(storedRun, persistedEffect, operation);
  await correlateRunLedger(
    tx,
    authority.scopeId,
    selected.runId,
    aggregate,
    operation,
  );
  const immutable = await loadImmutablePreparation(
    tx,
    authority.scopeId,
    storedRun,
    persistedEffect,
    operation,
  );
  const currentRequest = buildDispatchRequest(
    replacementScopeId,
    aggregate.aggregate,
    persistedEffect,
    operation,
  );
  const checkpoint = await loadDispatchCheckpoint(
    tx,
    authority.scopeId,
    selected,
    operation,
  );
  if (checkpoint === null) {
    throw rollback(new TaskComputeDeliveryRepositoryUnavailableV1Error({
      operation,
      runId: selected.runId,
      reason: "effect_unavailable",
    }));
  }
  const storedRequest = await decodeAndCorrelateDispatchCheckpoint(
    checkpoint,
    currentRequest,
    persistedEffect.effect.acceptedRunVersion,
    operation,
    selected.runId,
  );
  return capturePreparedExecution(storedRequest, immutable);
}

function mapPreparedExecutionReadFailure(
  cause: TaskComputeDeliveryRepositoryErrorV1<"acquire_dispatch">,
): TaskComputePreparedExecutionReadV1Error {
  if (cause instanceof TaskComputeDeliveryRepositoryUnavailableV1Error) {
    return new TaskComputePreparedExecutionReadV1Error({
      reason: "not_found",
      cause,
    });
  }
  if (cause instanceof TaskComputeDeliveryRepositoryStaleScopeAuthorityV1Error) {
    return new TaskComputePreparedExecutionReadV1Error({
      reason: "stale_authority",
      cause,
    });
  }
  if (
    cause instanceof TaskComputeDeliveryRepositoryCorruptionV1Error
    || cause instanceof TaskComputeDeliveryEvidenceV1Error
  ) {
    return new TaskComputePreparedExecutionReadV1Error({
      reason: "corrupt",
      cause,
    });
  }
  return new TaskComputePreparedExecutionReadV1Error({
    reason: "resource_failure",
    cause,
  });
}

function makeRepository(
  authority: TrustedScopeAuthority,
  replacementScopeId: ReplacementScopeIdV1,
  target: LocatedTaskComputeDeliveryTargetV1,
  configuration: CapturedConfigurationV1,
): TaskComputeDeliveryRepositoryV1 {
  const handles = new WeakMap<object, MutableHandleStateV1>();
  const cancellationHandles = new WeakMap<object, MutableHandleStateV1>();

  const acquireDispatch: TaskComputeDeliveryRepositoryV1["acquireDispatch"] =
    Effect.fn("TaskComputeDeliveryRepository.acquireDispatch")(
      function* (request) {
        const captured = yield* Effect.fromResult(captureAcquireRequest(
          request,
          "acquire_dispatch",
        ));
        const claimOwner = yield* allocateClaimOwner(
          "acquire_dispatch",
          configuration.randomUuid,
        );
        for (let execution = 1; execution <= 2; execution += 1) {
          const transaction = target[RUN_LOCATED_READ_COMMITTED_V1]((tx) =>
            acquireDispatchTransaction(
              tx,
              authority,
              replacementScopeId,
              target,
              configuration,
              captured,
              claimOwner,
            )
          );
          const settled = yield* Effect.exit(awaitSettlement(transaction));
          if (Exit.isSuccess(settled)) {
            return settled.value.kind === "claimed"
              ? mintClaim(handles, settled.value)
              : captureAcquireOutcome(settled.value);
          }
          const failure = Cause.findError(settled.cause);
          if (Result.isFailure(failure)) {
            return yield* Effect.failCause(failure.failure);
          }
          const classified = classifyTransactionFailure(
            "acquire_dispatch",
            failure.success,
            execution,
          );
          if (classified.kind === "retry") continue;
          if (classified.kind === "failure") return yield* classified.error;
          return yield* Effect.die(classified.cause);
        }
        return yield* new TaskComputeDeliveryRepositoryConfirmedRollbackV1Error({
          operation: "acquire_dispatch",
          cause: new LocatedReadCommittedTransactionFailureV1(Object.freeze({
            kind: "callbackRolledBack",
            callbackCause: "retry_exhausted",
          })),
        });
      },
    );

  const verifyDispatchRecovery: TaskComputeDeliveryRepositoryV1[
    "verifyDispatchRecovery"
  ] = Effect.fn("TaskComputeDeliveryRepository.verifyDispatchRecovery")(
    (handle) => withHandleOperation(
      handles,
      handle,
      "verify_dispatch_recovery",
      (state) => state.phase !== "claimed"
          || state.deliveryMode !== "uncertain_replay"
        ? Effect.fail(staleClaim(
            "verify_dispatch_recovery",
            state.runId,
            "state_mismatch",
          ))
        : runClaimOperation(
            state,
            "verify_dispatch_recovery",
            () => target[RUN_LOCATED_READ_COMMITTED_V1]((tx) =>
              verifyDispatchRecoveryTransaction(
                tx,
                authority,
                replacementScopeId,
                target,
                configuration,
                state,
              )
            ),
          ).pipe(
            Effect.catchTags({
              TaskComputeDeliveryRepositoryConfirmedRollbackV1Error: (cause) =>
                Effect.succeed(Object.freeze({
                  kind: "probe_uncertain" as const,
                  cause,
                })),
              TaskComputeDeliveryRepositoryDecisionUncertainV1Error: (cause) =>
                Effect.succeed(Object.freeze({
                  kind: "probe_uncertain" as const,
                  cause,
                })),
              TaskComputeDeliveryRepositorySqlV1Error: (cause) =>
                Effect.succeed(Object.freeze({
                  kind: "probe_uncertain" as const,
                  cause,
                })),
            }),
            Effect.tap((observation) => Effect.sync(() => {
              if (observation.kind === "state_moved") closeHandle(state);
              else if (observation.kind === "state_unchanged") {
                state.recoveryVerified = true;
              }
            })),
          ),
    ),
  );

  const markDispatchDeliveryStarted: TaskComputeDeliveryRepositoryV1[
    "markDispatchDeliveryStarted"
  ] = Effect.fn("TaskComputeDeliveryRepository.markDispatchDeliveryStarted")(
    (handle) => withHandleOperation(
      handles,
      handle,
      "mark_dispatch_delivery_started",
      (state) => state.phase === "delivering" || !state.recoveryVerified
        ? Effect.fail(staleClaim(
            "mark_dispatch_delivery_started",
            state.runId,
            "state_mismatch",
          ))
        : runClaimOperation(
            state,
            "mark_dispatch_delivery_started",
            () => target[RUN_LOCATED_READ_COMMITTED_V1]((tx) =>
              markDispatchDeliveryStartedTransaction(
                tx,
                authority,
                replacementScopeId,
                target,
                configuration,
                state,
              )
            ),
          ).pipe(
            Effect.tap(() => Effect.sync(() => {
              state.phase = "delivering";
            })),
          ),
    ),
  );

  const renewDispatchClaim: TaskComputeDeliveryRepositoryV1[
    "renewDispatchClaim"
  ] = Effect.fn("TaskComputeDeliveryRepository.renewDispatchClaim")(
    (handle) => withHandleOperation(
      handles,
      handle,
      "renew_dispatch_claim",
      (state) => runClaimOperation(
        state,
        "renew_dispatch_claim",
        () => target[RUN_LOCATED_READ_COMMITTED_V1]((tx) =>
          renewDispatchClaimTransaction(
            tx,
            authority,
            replacementScopeId,
            target,
            configuration,
            state,
          )
        ),
      ),
    ),
  );

  const releaseDispatchBeforeDelivery: TaskComputeDeliveryRepositoryV1[
    "releaseDispatchBeforeDelivery"
  ] = Effect.fn("TaskComputeDeliveryRepository.releaseDispatchBeforeDelivery")(
    (handle) => withHandleOperation(
      handles,
      handle,
      "release_dispatch_before_delivery",
      (state) => state.phase === "delivering"
        ? Effect.fail(new TaskComputeDeliveryRepositoryStaleClaimV1Error({
            operation: "release_dispatch_before_delivery",
            runId: state.runId,
            reason: "state_mismatch",
          }))
        : runClaimOperation(
            state,
            "release_dispatch_before_delivery",
            () => target[RUN_LOCATED_READ_COMMITTED_V1]((tx) =>
              releaseDispatchBeforeDeliveryTransaction(
                tx,
                authority,
                replacementScopeId,
                target,
                configuration,
                state,
              )
            ),
          ).pipe(
            Effect.tap(() => Effect.sync(() => closeHandle(state))),
          ),
    ),
  );

  const recordDispatchAcceptance: TaskComputeDeliveryRepositoryV1[
    "recordDispatchAcceptance"
  ] = Effect.fn("TaskComputeDeliveryRepository.recordDispatchAcceptance")(
    function* (handle, acceptance) {
      const captured = yield* Effect.fromResult(
        captureDispatchAcceptance(acceptance),
      );
      return yield* withHandleOperation(
        handles,
        handle,
        "record_dispatch_acceptance",
        (state) => state.phase !== "delivering"
          ? Effect.fail(staleClaim(
              "record_dispatch_acceptance",
              state.runId,
              "state_mismatch",
            ))
          : runClaimOperation(
              state,
              "record_dispatch_acceptance",
              () => target[RUN_LOCATED_READ_COMMITTED_V1]((tx) =>
                recordDispatchAcceptanceTransaction(
                  tx,
                  authority,
                  replacementScopeId,
                  target,
                  configuration,
                  state,
                  captured,
                )
              ),
            ).pipe(
              Effect.tap(() => Effect.sync(() => closeHandle(state))),
            ),
      );
    },
  );

  const recordDispatchKnownFailure: TaskComputeDeliveryRepositoryV1[
    "recordDispatchKnownFailure"
  ] = Effect.fn("TaskComputeDeliveryRepository.recordDispatchKnownFailure")(
    function* (handle, failure) {
      const captured = yield* Effect.fromResult(
        captureKnownDispatchFailure(failure),
      );
      return yield* withHandleOperation(
        handles,
        handle,
        "record_dispatch_known_failure",
        (state) => state.phase !== "delivering"
          ? Effect.fail(staleClaim(
              "record_dispatch_known_failure",
              state.runId,
              "state_mismatch",
            ))
          : runClaimOperation(
              state,
              "record_dispatch_known_failure",
              () => target[RUN_LOCATED_READ_COMMITTED_V1]((tx) =>
                recordDispatchKnownFailureTransaction(
                  tx,
                  authority,
                  replacementScopeId,
                  target,
                  configuration,
                  state,
                  captured,
                )
              ),
            ).pipe(
              Effect.tap(() => Effect.sync(() => closeHandle(state))),
            ),
      );
    },
  );

  const acquireCancellation: TaskComputeDeliveryRepositoryV1[
    "acquireCancellation"
  ] = Effect.fn("TaskComputeDeliveryRepository.acquireCancellation")(
    function* (request) {
      const captured = yield* Effect.fromResult(captureAcquireRequest(
        request,
        "acquire_cancellation",
      ));
      const claimOwner = yield* allocateClaimOwner(
        "acquire_cancellation",
        configuration.randomUuid,
      );
      for (let execution = 1; execution <= 2; execution += 1) {
        const transaction = target[RUN_LOCATED_READ_COMMITTED_V1]((tx) =>
          acquireCancellationTransaction(
            tx,
            authority,
            replacementScopeId,
            target,
            configuration,
            captured,
            claimOwner,
          )
        );
        const settled = yield* Effect.exit(awaitSettlement(transaction));
        if (Exit.isSuccess(settled)) {
          return settled.value.kind === "claimed"
            ? mintCancellationClaim(cancellationHandles, settled.value)
            : captureCancellationAcquireOutcome(settled.value);
        }
        const failure = Cause.findError(settled.cause);
        if (Result.isFailure(failure)) {
          return yield* Effect.failCause(failure.failure);
        }
        const classified = classifyTransactionFailure(
          "acquire_cancellation",
          failure.success,
          execution,
        );
        if (classified.kind === "retry") continue;
        if (classified.kind === "failure") return yield* classified.error;
        return yield* Effect.die(classified.cause);
      }
      return yield* new TaskComputeDeliveryRepositoryConfirmedRollbackV1Error({
        operation: "acquire_cancellation",
        cause: new LocatedReadCommittedTransactionFailureV1(Object.freeze({
          kind: "callbackRolledBack",
          callbackCause: "retry_exhausted",
        })),
      });
    },
  );

  const verifyCancellationRecovery: TaskComputeDeliveryRepositoryV1[
    "verifyCancellationRecovery"
  ] = Effect.fn("TaskComputeDeliveryRepository.verifyCancellationRecovery")(
    (handle) => withHandleOperation(
      cancellationHandles,
      handle,
      "verify_cancellation_recovery",
      (state) => state.phase !== "claimed"
          || state.deliveryMode !== "uncertain_replay"
        ? Effect.fail(staleClaim(
            "verify_cancellation_recovery",
            state.runId,
            "state_mismatch",
          ))
        : runClaimOperation(
            state,
            "verify_cancellation_recovery",
            () => target[RUN_LOCATED_READ_COMMITTED_V1]((tx) =>
              verifyCancellationRecoveryTransaction(
                tx,
                authority,
                replacementScopeId,
                target,
                configuration,
                state,
              )
            ),
          ).pipe(
            Effect.catchTags({
              TaskComputeDeliveryRepositoryConfirmedRollbackV1Error: (cause) =>
                Effect.succeed(Object.freeze({
                  kind: "probe_uncertain" as const,
                  cause,
                })),
              TaskComputeDeliveryRepositoryDecisionUncertainV1Error: (cause) =>
                Effect.succeed(Object.freeze({
                  kind: "probe_uncertain" as const,
                  cause,
                })),
              TaskComputeDeliveryRepositorySqlV1Error: (cause) =>
                Effect.succeed(Object.freeze({
                  kind: "probe_uncertain" as const,
                  cause,
                })),
            }),
            Effect.tap((observation) => Effect.sync(() => {
              if (observation.kind === "state_moved") closeHandle(state);
              else if (observation.kind === "state_unchanged") {
                state.recoveryVerified = true;
              }
            })),
          ),
    ),
  );

  const markCancellationDeliveryStarted: TaskComputeDeliveryRepositoryV1[
    "markCancellationDeliveryStarted"
  ] = Effect.fn("TaskComputeDeliveryRepository.markCancellationDeliveryStarted")(
    (handle) => withHandleOperation(
      cancellationHandles,
      handle,
      "mark_cancellation_delivery_started",
      (state) => state.phase === "delivering" || !state.recoveryVerified
        ? Effect.fail(staleClaim(
            "mark_cancellation_delivery_started",
            state.runId,
            "state_mismatch",
          ))
        : runClaimOperation(
            state,
            "mark_cancellation_delivery_started",
            () => target[RUN_LOCATED_READ_COMMITTED_V1]((tx) =>
              markCancellationDeliveryStartedTransaction(
                tx,
                authority,
                replacementScopeId,
                target,
                configuration,
                state,
              )
            ),
          ).pipe(
            Effect.tap(() => Effect.sync(() => {
              state.phase = "delivering";
            })),
          ),
    ),
  );

  const renewCancellationClaim: TaskComputeDeliveryRepositoryV1[
    "renewCancellationClaim"
  ] = Effect.fn("TaskComputeDeliveryRepository.renewCancellationClaim")(
    (handle) => withHandleOperation(
      cancellationHandles,
      handle,
      "renew_cancellation_claim",
      (state) => runClaimOperation(
        state,
        "renew_cancellation_claim",
        () => target[RUN_LOCATED_READ_COMMITTED_V1]((tx) =>
          renewCancellationClaimTransaction(
            tx,
            authority,
            replacementScopeId,
            target,
            configuration,
            state,
          )
        ),
      ),
    ),
  );

  const releaseCancellationBeforeDelivery: TaskComputeDeliveryRepositoryV1[
    "releaseCancellationBeforeDelivery"
  ] = Effect.fn("TaskComputeDeliveryRepository.releaseCancellationBeforeDelivery")(
    (handle) => withHandleOperation(
      cancellationHandles,
      handle,
      "release_cancellation_before_delivery",
      (state) => state.phase === "delivering"
        ? Effect.fail(staleClaim(
            "release_cancellation_before_delivery",
            state.runId,
            "state_mismatch",
          ))
        : runClaimOperation(
            state,
            "release_cancellation_before_delivery",
            () => target[RUN_LOCATED_READ_COMMITTED_V1]((tx) =>
              releaseCancellationBeforeDeliveryTransaction(
                tx,
                authority,
                replacementScopeId,
                target,
                configuration,
                state,
              )
            ),
          ).pipe(
            Effect.tap(() => Effect.sync(() => closeHandle(state))),
          ),
    ),
  );

  const recordCancellationReceipt: TaskComputeDeliveryRepositoryV1[
    "recordCancellationReceipt"
  ] = Effect.fn("TaskComputeDeliveryRepository.recordCancellationReceipt")(
    function* (handle, receipt) {
      const captured = yield* Effect.fromResult(
        captureCancellationReceipt(receipt),
      );
      return yield* withHandleOperation(
        cancellationHandles,
        handle,
        "record_cancellation_receipt",
        (state) => state.phase !== "delivering"
          ? Effect.fail(staleClaim(
              "record_cancellation_receipt",
              state.runId,
              "state_mismatch",
            ))
          : runClaimOperation(
              state,
              "record_cancellation_receipt",
              () => target[RUN_LOCATED_READ_COMMITTED_V1]((tx) =>
                recordCancellationReceiptTransaction(
                  tx,
                  authority,
                  replacementScopeId,
                  target,
                  configuration,
                  state,
                  captured,
                )
              ),
            ).pipe(
              Effect.tap(() => Effect.sync(() => closeHandle(state))),
            ),
      );
    },
  );

  const recordCancellationKnownFailure: TaskComputeDeliveryRepositoryV1[
    "recordCancellationKnownFailure"
  ] = Effect.fn("TaskComputeDeliveryRepository.recordCancellationKnownFailure")(
    function* (handle, failure) {
      const captured = yield* Effect.fromResult(
        captureKnownCancellationFailure(failure),
      );
      return yield* withHandleOperation(
        cancellationHandles,
        handle,
        "record_cancellation_known_failure",
        (state) => state.phase !== "delivering"
          ? Effect.fail(staleClaim(
              "record_cancellation_known_failure",
              state.runId,
              "state_mismatch",
            ))
          : runClaimOperation(
              state,
              "record_cancellation_known_failure",
              () => target[RUN_LOCATED_READ_COMMITTED_V1]((tx) =>
                recordCancellationKnownFailureTransaction(
                  tx,
                  authority,
                  replacementScopeId,
                  target,
                  configuration,
                  state,
                  captured,
                )
              ),
            ).pipe(
              Effect.tap(() => Effect.sync(() => closeHandle(state))),
            ),
      );
    },
  );

  return Object.freeze({
    acquireDispatch,
    verifyDispatchRecovery,
    markDispatchDeliveryStarted,
    renewDispatchClaim,
    releaseDispatchBeforeDelivery,
    recordDispatchAcceptance,
    recordDispatchKnownFailure,
    acquireCancellation,
    verifyCancellationRecovery,
    markCancellationDeliveryStarted,
    renewCancellationClaim,
    releaseCancellationBeforeDelivery,
    recordCancellationReceipt,
    recordCancellationKnownFailure,
  });
}

async function acquireDispatchTransaction(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  replacementScopeId: ReplacementScopeIdV1,
  target: LocatedTaskComputeDeliveryTargetV1,
  configuration: CapturedConfigurationV1,
  request: CapturedAcquireRequestV1,
  claimOwner: string,
): Promise<TransactionAcquireResultV1> {
  const operation = "acquire_dispatch" as const;
  await statement(operation, () => requireLockedTaskSystemScopeAuthorityV1(
    tx,
    authority,
    target,
    (mismatch) => rollback(new TaskComputeDeliveryRepositoryStaleScopeAuthorityV1Error({
      operation,
      runId: request.runId,
      authority: mismatch,
    })),
  ));
  const runRow = await statement(operation, () => tx.select().from(
    fxSystemDurableTaskRunsV1,
  ).where(and(
    eq(fxSystemDurableTaskRunsV1.scopeId, authority.scopeId),
    eq(fxSystemDurableTaskRunsV1.runId, request.runId),
  )).limit(1).for("update"));
  const storedRun = runRow[0];
  if (storedRun === undefined) {
    throw rollback(new TaskComputeDeliveryRepositoryUnavailableV1Error({
      operation,
      runId: request.runId,
      reason: "run_unavailable",
    }));
  }
  const aggregate = decodeRun(storedRun, operation, request.runId);
  const effectRow = await findRequestedEffect(
    tx,
    authority.scopeId,
    request,
    operation,
  );
  if (effectRow === undefined) {
    await correlateRunLedger(tx, authority.scopeId, request.runId, aggregate,
      operation);
    throw rollback(new TaskComputeDeliveryRepositoryUnavailableV1Error({
      operation,
      runId: request.runId,
      reason: "effect_unavailable",
    }));
  }
  const persistedEffect = decodeDispatchEffect(
    effectRow,
    aggregate.generation,
    request,
    operation,
  );
  requireSelectedDispatchDefinitionIdentity(
    storedRun,
    persistedEffect,
    operation,
  );
  await correlateRunLedger(tx, authority.scopeId, request.runId, aggregate,
    operation);
  await consumePendingComputeDelivery(
    tx,
    authority.scopeId,
    request,
    "dispatch_attempt",
    operation,
  );
  const immutable = await loadImmutablePreparation(
    tx,
    authority.scopeId,
    storedRun,
    persistedEffect,
    operation,
  );
  const currentRequest = buildDispatchRequest(
    replacementScopeId,
    aggregate.aggregate,
    persistedEffect,
    operation,
  );
  const currentPrepared = capturePreparedExecution(currentRequest, immutable);
  const databaseTime = await readDatabaseTime(
    tx,
    authority.scopeId,
    configuration.claimDurationMilliseconds,
    operation,
    request.runId,
  );
  let checkpoint = await loadDispatchCheckpoint(
    tx,
    authority.scopeId,
    request,
    operation,
  );
  const lifecycleCurrent = dispatchLifecycleIsCurrent(
    aggregate.aggregate,
    persistedEffect,
  );
  if (checkpoint === null) {
    const canonicalBytes = Result.getOrThrowWith(
      encodeCurrentTaskComputeDispatchRequestCanonicalBytesV1(currentRequest),
      (error) => rollback(error),
    );
    const observedSha256 = await sha256(
      canonicalBytes,
      operation,
      request.runId,
    );
    const evidence = Result.getOrThrowWith(
      encodeCurrentTaskComputeDispatchRequestEvidenceWithObservedSha256V1(
        currentRequest,
        observedSha256,
      ),
      (error) => rollback(error),
    );
    const computeProfileBytes = Result.getOrThrowWith(
      encodeTaskComputeProfileStorageBytesV1(currentRequest.computeProfile),
      () => rollback(corruption(operation, request.runId, "checkpoint_invalid")),
    );
    const inserted = await statement(operation, () => tx.insert(
      fxSystemDurableTaskComputeDispatchesV1,
    ).values({
      scopeId: authority.scopeId,
      runId: request.runId,
      requestedEffectSequence: request.requestedEffectSequence,
      acceptedRunVersion: persistedEffect.effect.acceptedRunVersion,
      definitionGeneration: aggregate.generation,
      taskDefinitionRevisionId: "taskDefinitionRevisionId" in currentRequest
        ? currentRequest.taskDefinitionRevisionId
        : null,
      applicationTaskRuntimeTargetSha256:
        "applicationTaskRuntimeTargetSha256" in currentRequest
          ? currentRequest.applicationTaskRuntimeTargetSha256
          : null,
      attemptId: currentRequest.identity.attemptId,
      attemptNumber: currentRequest.attemptNumber,
      executionFence: currentRequest.identity.executionFence,
      leaseVersion: currentRequest.leaseVersion,
      computeProfileCodecVersion: TASK_COMPUTE_PROFILE_STORAGE_CODEC_V1,
      computeProfileByteLength: computeProfileBytes.byteLength,
      computeProfileBytes,
      cancellationKind: currentRequest.cancellation.kind,
      cancellationGeneration: currentRequest.cancellation.generation,
      maximumDurationMs: currentRequest.maximumDurationMs,
      requestCodecVersion: evidence.codecVersion,
      requestByteLength: BigInt(evidence.byteLength),
      requestSha256: evidence.sha256,
      requestBytes: evidence.canonicalBytes,
      deliveryState: lifecycleCurrent ? "prepared" : "obsolete",
      claimOwner: lifecycleCurrent ? claimOwner : null,
      claimFence: lifecycleCurrent ? 1n : 0n,
      claimedAt: lifecycleCurrent ? databaseTime.now : null,
      claimExpiresAt: lifecycleCurrent ? databaseTime.claimExpiresAt : null,
      deliveryAttemptCount: 0n,
      reasonCode: lifecycleCurrent ? null : "lifecycle_obsolete",
      settledAt: lifecycleCurrent ? null : databaseTime.now,
      updatedAt: databaseTime.now,
    }).returning());
    checkpoint = inserted[0] ?? null;
    if (checkpoint === null) {
      throw rollback(corruption(operation, request.runId, "checkpoint_invalid"));
    }
    return lifecycleCurrent
      ? claimedTransactionResult(
          checkpoint,
          currentPrepared,
          "initial",
          claimOwner,
          databaseTime.claimExpiresAt,
          operation,
        )
      : closedResult(checkpoint, operation, request.runId);
  }

  const stored = await decodeAndCorrelateDispatchCheckpoint(
    checkpoint,
    currentRequest,
    persistedEffect.effect.acceptedRunVersion,
    operation,
    request.runId,
  );
  if (checkpoint.deliveryState === "accepted") {
    const acceptance = await decodeStoredAcceptance(
      checkpoint,
      operation,
      request.runId,
    );
    if (!taskSystemPersistedValueEqualV1(
      acceptance.identity,
      stored.identity,
    )) {
      throw rollback(corruption(operation, request.runId, "checkpoint_invalid"));
    }
    return Object.freeze({
      kind: "accepted" as const,
      acceptance,
      disposition: lifecycleCurrent ? "current" as const : "cleanup_only" as const,
    });
  }
  if (
    checkpoint.deliveryState === "rejected"
    || checkpoint.deliveryState === "obsolete"
    || checkpoint.deliveryState === "quarantined"
  ) {
    return closedResult(checkpoint, operation, request.runId);
  }
  if (
    checkpoint.claimOwner !== null
    && checkpoint.claimExpiresAt !== null
    && checkpoint.claimExpiresAt.getTime() > databaseTime.now.getTime()
  ) {
    return Object.freeze({
      kind: "busy" as const,
      claimExpiresAt: ownedDate(checkpoint.claimExpiresAt, operation, request.runId),
    });
  }
  if (
    checkpoint.deliveryState === "retry_wait"
    && checkpoint.nextAttemptAt !== null
    && checkpoint.nextAttemptAt.getTime() > databaseTime.now.getTime()
  ) {
    return Object.freeze({
      kind: "not_due" as const,
      nextAttemptAt: ownedDate(checkpoint.nextAttemptAt, operation, request.runId),
    });
  }
  if (
    checkpoint.deliveryState !== "delivering"
    && !lifecycleCurrent
  ) {
    const obsolete = await statement(operation, () => tx.update(
      fxSystemDurableTaskComputeDispatchesV1,
    ).set({
      deliveryState: "obsolete",
      claimOwner: null,
      claimedAt: null,
      claimExpiresAt: null,
      nextAttemptAt: null,
      reasonCode: "lifecycle_obsolete",
      settledAt: databaseTime.now,
      updatedAt: databaseTime.now,
    }).where(dispatchPrimaryKey(authority.scopeId, request)).returning());
    const row = obsolete[0];
    if (row === undefined) {
      throw rollback(corruption(operation, request.runId, "checkpoint_invalid"));
    }
    return closedResult(row, operation, request.runId);
  }
  if (
    checkpoint.deliveryState !== "delivering"
    && !taskSystemPersistedValueEqualV1(stored, currentRequest)
  ) {
    throw rollback(corruption(operation, request.runId, "checkpoint_invalid"));
  }
  if (checkpoint.claimFence >= POSTGRES_SIGNED_BIGINT_MAX) {
    throw rollback(new TaskComputeDeliveryRepositoryResourceExhaustedV1Error({
      operation,
      runId: request.runId,
      dimension: "claim_fence",
      observed: checkpoint.claimFence,
      maximum: POSTGRES_SIGNED_BIGINT_MAX,
    }));
  }
  const deliveryMode: TaskComputeDeliveryModeV1 =
    checkpoint.deliveryState === "delivering"
      ? "uncertain_replay"
      : checkpoint.deliveryState === "retry_wait"
      ? "retry"
      : "initial";
  const updated = await statement(operation, () => tx.update(
    fxSystemDurableTaskComputeDispatchesV1,
  ).set({
    claimOwner,
    claimFence: checkpoint.claimFence + 1n,
    claimedAt: databaseTime.now,
    claimExpiresAt: databaseTime.claimExpiresAt,
    updatedAt: databaseTime.now,
  }).where(dispatchPrimaryKey(authority.scopeId, request)).returning());
  const claimed = updated[0];
  if (claimed === undefined) {
    throw rollback(corruption(operation, request.runId, "checkpoint_invalid"));
  }
  return claimedTransactionResult(
    claimed,
    capturePreparedExecution(stored, immutable),
    deliveryMode,
    claimOwner,
    databaseTime.claimExpiresAt,
    operation,
  );
}

function requireSelectedDispatchDefinitionIdentity(
  run: RunRow,
  persistedEffect: ReturnType<typeof decodeDispatchEffect>,
  operation: TaskComputeDeliveryRepositoryOperationV1,
): void {
  if (run.definitionGeneration === "application_v1") {
    if (run.applicationTaskRuntimeTargetSha256 === null
      || !("applicationTaskRuntimeTargetSha256" in persistedEffect.effect)
      || !bytesEqualFullScan(
        run.applicationTaskRuntimeTargetSha256,
        persistedEffect.effect.applicationTaskRuntimeTargetSha256,
      )) throw rollback(corruption(operation, run.runId, "definition_invalid"));
    return;
  }
  if (run.definitionGeneration !== "legacy_definition_v1"
    || run.taskDefinitionRevisionId === null
    || !("taskDefinitionRevisionId" in persistedEffect.effect)
    || run.taskDefinitionRevisionId
      !== persistedEffect.effect.taskDefinitionRevisionId) {
    throw rollback(corruption(operation, run.runId, "definition_invalid"));
  }
}

interface CorrelatedHandleContextV1 {
  readonly checkpoint: DispatchRow;
  readonly storedRequest: CurrentTaskComputeDispatchRequestV1;
  readonly databaseTime: Readonly<{
    readonly now: Date;
    readonly claimExpiresAt: Date;
  }>;
  readonly lifecycleCurrent: boolean;
}

async function verifyDispatchRecoveryTransaction(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  replacementScopeId: ReplacementScopeIdV1,
  target: LocatedTaskComputeDeliveryTargetV1,
  configuration: CapturedConfigurationV1,
  state: MutableHandleStateV1,
): Promise<
  TaskComputeDeliveryRecoveryObservationV1<"verify_dispatch_recovery">
> {
  const operation = "verify_dispatch_recovery" as const;
  const context = await loadCorrelatedHandleContext(
    tx,
    authority,
    replacementScopeId,
    target,
    configuration,
    state,
    operation,
  );
  requireCurrentClaim(context, state, operation);
  if (
    context.checkpoint.deliveryState !== "delivering"
    || context.checkpoint.deliveryAttemptCount < 1n
  ) {
    throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
  }
  if (context.lifecycleCurrent) {
    return Object.freeze({ kind: "state_unchanged" });
  }
  const updated = await statement(operation, () => tx.update(
    fxSystemDurableTaskComputeDispatchesV1,
  ).set({
    deliveryState: "rejected",
    claimOwner: null,
    claimedAt: null,
    claimExpiresAt: null,
    nextAttemptAt: null,
    reasonCode: "lifecycle_obsolete",
    settledAt: context.databaseTime.now,
    updatedAt: context.databaseTime.now,
  }).where(dispatchClaimKey(authority.scopeId, state)).returning());
  const row = updated[0];
  if (
    row?.deliveryState !== "rejected"
    || row.claimOwner !== null
    || row.reasonCode !== "lifecycle_obsolete"
    || row.settledAt === null
  ) {
    throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
  }
  return Object.freeze({ kind: "state_moved" });
}

async function markDispatchDeliveryStartedTransaction(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  replacementScopeId: ReplacementScopeIdV1,
  target: LocatedTaskComputeDeliveryTargetV1,
  configuration: CapturedConfigurationV1,
  state: MutableHandleStateV1,
): Promise<TaskComputeDispatchDeliveryStartedV1> {
  const operation = "mark_dispatch_delivery_started" as const;
  const context = await loadCorrelatedHandleContext(
    tx,
    authority,
    replacementScopeId,
    target,
    configuration,
    state,
    operation,
  );
  requireCurrentClaim(context, state, operation);
  if (
    context.checkpoint.deliveryState !== "prepared"
    && context.checkpoint.deliveryState !== "retry_wait"
    && context.checkpoint.deliveryState !== "delivering"
  ) {
    throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
  }
  if (
    context.checkpoint.deliveryState !== "delivering"
    && !context.lifecycleCurrent
  ) {
    throw rollback(staleClaim(operation, state.runId, "lifecycle_obsolete"));
  }
  const deliveryAttemptCountBeforeStart =
    context.checkpoint.deliveryAttemptCount;
  const deliveryAttemptMaximum = context.checkpoint.deliveryState === "delivering"
    ? POSTGRES_SIGNED_BIGINT_MAX
    : BigInt(configuration.maximumDeliveryAttempts);
  if (deliveryAttemptCountBeforeStart >= deliveryAttemptMaximum) {
    throw rollback(
      new TaskComputeDeliveryRepositoryResourceExhaustedV1Error({
        operation,
        runId: state.runId,
        dimension: "delivery_attempt_count",
        observed: deliveryAttemptCountBeforeStart,
        maximum: deliveryAttemptMaximum,
      }),
    );
  }
  const deliveryAttemptCount = deliveryAttemptCountBeforeStart + 1n;
  const updated = await statement(operation, () => tx.update(
    fxSystemDurableTaskComputeDispatchesV1,
  ).set({
    deliveryState: "delivering",
    deliveryAttemptCount,
    deliveryStartedAt: context.databaseTime.now,
    nextAttemptAt: null,
    reasonCode: null,
    updatedAt: context.databaseTime.now,
  }).where(dispatchClaimKey(authority.scopeId, state)).returning());
  const row = updated[0];
  if (
    row === undefined
    || row.deliveryState !== "delivering"
    || row.deliveryAttemptCount !== deliveryAttemptCount
    || row.deliveryStartedAt === null
  ) {
    throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
  }
  return Object.freeze({
    kind: "delivery_started",
    deliveryAttemptCount,
    deliveryStartedAt: ownedDate(row.deliveryStartedAt, operation, state.runId),
  });
}

async function renewDispatchClaimTransaction(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  replacementScopeId: ReplacementScopeIdV1,
  target: LocatedTaskComputeDeliveryTargetV1,
  configuration: CapturedConfigurationV1,
  state: MutableHandleStateV1,
): Promise<TaskComputeDispatchClaimRenewedV1> {
  const operation = "renew_dispatch_claim" as const;
  const context = await loadCorrelatedHandleContext(
    tx,
    authority,
    replacementScopeId,
    target,
    configuration,
    state,
    operation,
  );
  requireCurrentClaim(context, state, operation);
  if (
    context.checkpoint.deliveryState !== "prepared"
    && context.checkpoint.deliveryState !== "retry_wait"
    && context.checkpoint.deliveryState !== "delivering"
  ) {
    throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
  }
  if (
    context.checkpoint.deliveryState !== "delivering"
    && !context.lifecycleCurrent
  ) {
    throw rollback(staleClaim(operation, state.runId, "lifecycle_obsolete"));
  }
  const updated = await statement(operation, () => tx.update(
    fxSystemDurableTaskComputeDispatchesV1,
  ).set({
    claimedAt: context.databaseTime.now,
    claimExpiresAt: context.databaseTime.claimExpiresAt,
    updatedAt: context.databaseTime.now,
  }).where(dispatchClaimKey(authority.scopeId, state)).returning());
  const row = updated[0];
  if (row?.claimExpiresAt === null || row?.claimExpiresAt === undefined) {
    throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
  }
  return Object.freeze({
    kind: "claim_renewed",
    claimExpiresAt: ownedDate(row.claimExpiresAt, operation, state.runId),
  });
}

async function releaseDispatchBeforeDeliveryTransaction(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  replacementScopeId: ReplacementScopeIdV1,
  target: LocatedTaskComputeDeliveryTargetV1,
  configuration: CapturedConfigurationV1,
  state: MutableHandleStateV1,
): Promise<TaskComputeDispatchClaimReleasedV1> {
  const operation = "release_dispatch_before_delivery" as const;
  const context = await loadCorrelatedHandleContext(
    tx,
    authority,
    replacementScopeId,
    target,
    configuration,
    state,
    operation,
  );
  requireCurrentClaim(context, state, operation);
  if (
    context.checkpoint.deliveryState !== "prepared"
    && context.checkpoint.deliveryState !== "retry_wait"
    && context.checkpoint.deliveryState !== "delivering"
  ) {
    throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
  }
  if (
    context.checkpoint.deliveryState !== "delivering"
    && !context.lifecycleCurrent
  ) {
    throw rollback(staleClaim(operation, state.runId, "lifecycle_obsolete"));
  }
  const updated = await statement(operation, () => tx.update(
    fxSystemDurableTaskComputeDispatchesV1,
  ).set({
    claimOwner: null,
    claimedAt: null,
    claimExpiresAt: null,
    updatedAt: context.databaseTime.now,
  }).where(dispatchClaimKey(authority.scopeId, state)).returning({
    claimOwner: fxSystemDurableTaskComputeDispatchesV1.claimOwner,
  }));
  if (updated[0]?.claimOwner !== null) {
    throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
  }
  return Object.freeze({ kind: "claim_released" });
}

async function recordDispatchAcceptanceTransaction(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  replacementScopeId: ReplacementScopeIdV1,
  target: LocatedTaskComputeDeliveryTargetV1,
  configuration: CapturedConfigurationV1,
  state: MutableHandleStateV1,
  acceptance: TaskComputeDispatchAcceptanceV1,
): Promise<TaskComputeDispatchAcceptanceRecordedV1> {
  const operation = "record_dispatch_acceptance" as const;
  const context = await loadCorrelatedHandleContext(
    tx,
    authority,
    replacementScopeId,
    target,
    configuration,
    state,
    operation,
  );
  requireCurrentClaim(context, state, operation);
  if (context.checkpoint.deliveryState !== "delivering") {
    throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
  }
  if (!taskSystemPersistedValueEqualV1(
    acceptance.identity,
    context.storedRequest.identity,
  )) {
    throw rollback(repositoryInputFailure(
      operation,
      "acceptance_correlation_mismatch",
    ));
  }
  const canonicalBytes = Result.getOrThrowWith(
    encodeTaskComputeDispatchAcceptanceCanonicalBytesV1(acceptance),
    (error) => rollback(error),
  );
  const observedSha256 = await sha256(canonicalBytes, operation, state.runId);
  const evidence = Result.getOrThrowWith(
    encodeTaskComputeDispatchAcceptanceEvidenceWithObservedSha256V1(
      acceptance,
      observedSha256,
    ),
    (error) => rollback(error),
  );
  const updated = await statement(operation, () => tx.update(
    fxSystemDurableTaskComputeDispatchesV1,
  ).set({
    deliveryState: "accepted",
    claimOwner: null,
    claimedAt: null,
    claimExpiresAt: null,
    nextAttemptAt: null,
    reasonCode: null,
    acceptanceCodecVersion: evidence.codecVersion,
    acceptanceByteLength: BigInt(evidence.byteLength),
    acceptanceSha256: evidence.sha256,
    acceptanceBytes: evidence.canonicalBytes,
    settledAt: context.databaseTime.now,
    updatedAt: context.databaseTime.now,
  }).where(dispatchClaimKey(authority.scopeId, state)).returning());
  const row = updated[0];
  if (row === undefined || row.deliveryState !== "accepted") {
    throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
  }
  const storedAcceptance = await decodeStoredAcceptance(
    row,
    operation,
    state.runId,
  );
  if (!taskSystemPersistedValueEqualV1(storedAcceptance, acceptance)) {
    throw rollback(corruption(operation, state.runId, "checkpoint_invalid"));
  }
  return Object.freeze({
    kind: "dispatch_accepted",
    acceptance: storedAcceptance,
    disposition: context.lifecycleCurrent ? "current" : "cleanup_only",
  });
}

async function recordDispatchKnownFailureTransaction(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  replacementScopeId: ReplacementScopeIdV1,
  target: LocatedTaskComputeDeliveryTargetV1,
  configuration: CapturedConfigurationV1,
  state: MutableHandleStateV1,
  failure: CapturedKnownDispatchFailureV1,
): Promise<TaskComputeDispatchKnownFailureRecordedV1> {
  const operation = "record_dispatch_known_failure" as const;
  const context = await loadCorrelatedHandleContext(
    tx,
    authority,
    replacementScopeId,
    target,
    configuration,
    state,
    operation,
  );
  requireCurrentClaim(context, state, operation);
  if (context.checkpoint.deliveryState !== "delivering") {
    throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
  }
  if (
    failure.kind === "rejected"
    && failure.computeProfile !== context.storedRequest.computeProfile
  ) {
    throw rollback(repositoryInputFailure(
      operation,
      "known_failure_correlation_mismatch",
    ));
  }
  const providerReason = dispatchFailureReason(failure);
  const attemptCount = context.checkpoint.deliveryAttemptCount;
  if (attemptCount < 1n) {
    throw rollback(corruption(operation, state.runId, "checkpoint_invalid"));
  }
  const shouldRetry = failure.retryable
    && attemptCount < BigInt(configuration.maximumDeliveryAttempts);
  if (shouldRetry) {
    const delayIndex = Number(attemptCount - 1n);
    const delayMilliseconds = configuration.retryDelayMilliseconds[delayIndex];
    const deliveryStartedAt = context.checkpoint.deliveryStartedAt;
    if (delayMilliseconds === undefined || deliveryStartedAt === null) {
      throw rollback(corruption(operation, state.runId, "checkpoint_invalid"));
    }
    const retryBaseMilliseconds = Math.max(
      context.databaseTime.now.getTime(),
      deliveryStartedAt.getTime(),
    );
    const nextAttemptMilliseconds = retryBaseMilliseconds + delayMilliseconds;
    const nextAttemptAt = Number.isSafeInteger(nextAttemptMilliseconds)
      ? copyFiniteDate(new Date(nextAttemptMilliseconds))
      : undefined;
    if (
      nextAttemptAt === undefined
      || nextAttemptAt.getTime() <= deliveryStartedAt.getTime()
    ) {
      throw rollback(corruption(operation, state.runId, "database_clock_invalid"));
    }
    const updated = await statement(operation, () => tx.update(
      fxSystemDurableTaskComputeDispatchesV1,
    ).set({
      deliveryState: "retry_wait",
      claimOwner: null,
      claimedAt: null,
      claimExpiresAt: null,
      nextAttemptAt,
      reasonCode: providerReason,
      settledAt: null,
      updatedAt: context.databaseTime.now,
    }).where(dispatchClaimKey(authority.scopeId, state)).returning({
      deliveryState: fxSystemDurableTaskComputeDispatchesV1.deliveryState,
      nextAttemptAt: fxSystemDurableTaskComputeDispatchesV1.nextAttemptAt,
      reasonCode: fxSystemDurableTaskComputeDispatchesV1.reasonCode,
      claimOwner: fxSystemDurableTaskComputeDispatchesV1.claimOwner,
    }));
    const row = updated[0];
    if (
      row?.deliveryState !== "retry_wait"
      || row.claimOwner !== null
      || row.reasonCode !== providerReason
      || row.nextAttemptAt === null
      || row.nextAttemptAt.getTime() !== nextAttemptAt.getTime()
    ) {
      throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
    }
    return Object.freeze({
      kind: "retry_scheduled",
      reason: providerReason,
      nextAttemptAt: ownedDate(row.nextAttemptAt, operation, state.runId),
    });
  }
  const terminalReason = failure.retryable
    ? "delivery_attempts_exhausted" as const
    : providerReason;
  const updated = await statement(operation, () => tx.update(
    fxSystemDurableTaskComputeDispatchesV1,
  ).set({
    deliveryState: "rejected",
    claimOwner: null,
    claimedAt: null,
    claimExpiresAt: null,
    nextAttemptAt: null,
    reasonCode: terminalReason,
    settledAt: context.databaseTime.now,
    updatedAt: context.databaseTime.now,
  }).where(dispatchClaimKey(authority.scopeId, state)).returning({
    deliveryState: fxSystemDurableTaskComputeDispatchesV1.deliveryState,
    reasonCode: fxSystemDurableTaskComputeDispatchesV1.reasonCode,
    claimOwner: fxSystemDurableTaskComputeDispatchesV1.claimOwner,
    settledAt: fxSystemDurableTaskComputeDispatchesV1.settledAt,
  }));
  const row = updated[0];
  if (
    row?.deliveryState !== "rejected"
    || row.claimOwner !== null
    || row.reasonCode !== terminalReason
    || row.settledAt === null
  ) {
    throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
  }
  return Object.freeze({ kind: "dispatch_rejected", reason: terminalReason });
}

async function acquireCancellationTransaction(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  replacementScopeId: ReplacementScopeIdV1,
  target: LocatedTaskComputeDeliveryTargetV1,
  configuration: CapturedConfigurationV1,
  request: CapturedAcquireRequestV1,
  claimOwner: string,
): Promise<TransactionCancellationAcquireResultV1> {
  const operation = "acquire_cancellation" as const;
  await statement(operation, () => requireLockedTaskSystemScopeAuthorityV1(
    tx,
    authority,
    target,
    (mismatch) => rollback(new TaskComputeDeliveryRepositoryStaleScopeAuthorityV1Error({
      operation,
      runId: request.runId,
      authority: mismatch,
    })),
  ));
  const runRows = await statement(operation, () => tx.select().from(
    fxSystemDurableTaskRunsV1,
  ).where(and(
    eq(fxSystemDurableTaskRunsV1.scopeId, authority.scopeId),
    eq(fxSystemDurableTaskRunsV1.runId, request.runId),
  )).limit(1).for("update"));
  const runRow = runRows[0];
  if (runRow === undefined) {
    throw rollback(new TaskComputeDeliveryRepositoryUnavailableV1Error({
      operation,
      runId: request.runId,
      reason: "run_unavailable",
    }));
  }
  const aggregate = decodeRun(runRow, operation, request.runId);
  await correlateRunLedger(tx, authority.scopeId, request.runId, aggregate,
    operation);
  const cancellationEffect = decodeCancellationEffect(
    await loadRequestedEffect(
      tx,
      authority.scopeId,
      request,
      operation,
    ),
    aggregate.generation,
    request,
    operation,
  );
  const dispatchEffect = await loadLinkedDispatchEffect(
    tx,
    authority.scopeId,
    aggregate.generation,
    cancellationEffect,
    operation,
  );
  await loadImmutablePreparation(
    tx,
    authority.scopeId,
    runRow,
    dispatchEffect,
    operation,
  );
  const expectedDispatchRequest = buildDispatchRequest(
    replacementScopeId,
    aggregate.aggregate,
    dispatchEffect,
    operation,
  );
  const lifecycleCurrent = cancellationLifecycleIsCurrent(
    aggregate.aggregate,
    cancellationEffect,
  );
  const dispatchCheckpoint = await loadDispatchCheckpoint(
    tx,
    authority.scopeId,
    Object.freeze({
      runId: request.runId,
      requestedEffectSequence: dispatchEffect.sequence,
    }),
    operation,
  );
  if (dispatchCheckpoint === null) {
    if (lifecycleCurrent) return Object.freeze({ kind: "waiting_dispatch" });
    await consumePendingComputeDelivery(
      tx,
      authority.scopeId,
      request,
      "request_execution_cancellation",
      operation,
    );
    return lifecycleObsoleteCancellationResult();
  }
  await consumePendingComputeDelivery(
    tx,
    authority.scopeId,
    request,
    "request_execution_cancellation",
    operation,
  );
  const storedDispatchRequest = await decodeAndCorrelateDispatchCheckpoint(
    dispatchCheckpoint,
    expectedDispatchRequest,
    dispatchEffect.effect.acceptedRunVersion,
    operation,
    request.runId,
  );
  const acceptance = dispatchCheckpoint.deliveryState === "accepted"
    ? await decodeStoredAcceptance(dispatchCheckpoint, operation, request.runId)
    : null;
  if (
    acceptance !== null
    && !taskSystemPersistedValueEqualV1(
      acceptance.identity,
      storedDispatchRequest.identity,
    )
  ) throw rollback(corruption(operation, request.runId, "checkpoint_invalid"));
  const expectedCancellationRequest = acceptance === null
    ? null
    : buildCancellationRequest(
        cancellationEffect,
        acceptance,
        operation,
      );
  const databaseTime = await readDatabaseTime(
    tx,
    authority.scopeId,
    configuration.claimDurationMilliseconds,
    operation,
    request.runId,
  );
  let checkpoint = await loadCancellationCheckpoint(
    tx,
    authority.scopeId,
    request,
    operation,
  );
  if (checkpoint === null) {
    if (acceptance === null) {
      const inserted = await statement(operation, () => tx.insert(
        fxSystemDurableTaskComputeCancellationsV1,
      ).values({
        scopeId: authority.scopeId,
        runId: request.runId,
        requestedEffectSequence: request.requestedEffectSequence,
        acceptedRunVersion: cancellationEffect.effect.acceptedRunVersion,
        dispatchRequestedEffectSequence: dispatchEffect.sequence,
        attemptId: cancellationEffect.effect.attemptId,
        executionFence: cancellationEffect.effect.executionFence,
        cancellationGeneration:
          cancellationEffect.effect.cancellationGeneration,
        deliveryState: lifecycleCurrent ? "waiting_dispatch" : "obsolete",
        claimFence: 0n,
        deliveryAttemptCount: 0n,
        reasonCode: lifecycleCurrent ? null : "lifecycle_obsolete",
        settledAt: lifecycleCurrent ? null : databaseTime.now,
        createdAt: databaseTime.now,
        updatedAt: databaseTime.now,
      }).returning());
      if (inserted[0] === undefined) {
        throw rollback(corruption(operation, request.runId, "checkpoint_invalid"));
      }
      return lifecycleCurrent
        ? Object.freeze({ kind: "waiting_dispatch" })
        : cancellationClosedResult(inserted[0], operation, request.runId);
    }
    if (expectedCancellationRequest === null) {
      throw rollback(corruption(operation, request.runId, "checkpoint_invalid"));
    }
    const evidence = await encodeCancellationRequestEvidence(
      expectedCancellationRequest,
      operation,
      request.runId,
    );
    const inserted = await statement(operation, () => tx.insert(
      fxSystemDurableTaskComputeCancellationsV1,
    ).values({
      scopeId: authority.scopeId,
      runId: request.runId,
      requestedEffectSequence: request.requestedEffectSequence,
      acceptedRunVersion: cancellationEffect.effect.acceptedRunVersion,
      dispatchRequestedEffectSequence: dispatchEffect.sequence,
      attemptId: cancellationEffect.effect.attemptId,
      executionFence: cancellationEffect.effect.executionFence,
      cancellationGeneration: cancellationEffect.effect.cancellationGeneration,
      requestCodecVersion: evidence.codecVersion,
      requestByteLength: BigInt(evidence.byteLength),
      requestSha256: evidence.sha256,
      requestBytes: evidence.canonicalBytes,
      deliveryState: lifecycleCurrent ? "prepared" : "obsolete",
      claimOwner: lifecycleCurrent ? claimOwner : null,
      claimFence: lifecycleCurrent ? 1n : 0n,
      claimedAt: lifecycleCurrent ? databaseTime.now : null,
      claimExpiresAt: lifecycleCurrent ? databaseTime.claimExpiresAt : null,
      deliveryAttemptCount: 0n,
      reasonCode: lifecycleCurrent ? null : "lifecycle_obsolete",
      settledAt: lifecycleCurrent ? null : databaseTime.now,
      createdAt: databaseTime.now,
      updatedAt: databaseTime.now,
    }).returning());
    checkpoint = inserted[0] ?? null;
    if (checkpoint === null) {
      throw rollback(corruption(operation, request.runId, "checkpoint_invalid"));
    }
    return lifecycleCurrent
      ? claimedCancellationTransactionResult(
          checkpoint,
          expectedCancellationRequest,
          "initial",
          claimOwner,
          databaseTime.claimExpiresAt,
          operation,
        )
      : cancellationClosedResult(checkpoint, operation, request.runId);
  }
  const storedCancellationRequest = await decodeAndCorrelateCancellationCheckpoint(
    checkpoint,
    cancellationEffect,
    dispatchEffect.sequence,
    expectedCancellationRequest,
    operation,
    request.runId,
  );
  if (checkpoint.deliveryState === "delivered") {
    if (storedCancellationRequest === null) {
      throw rollback(corruption(operation, request.runId, "checkpoint_invalid"));
    }
    const receipt = await decodeStoredCancellationReceipt(
      checkpoint,
      operation,
      request.runId,
    );
    if (!cancellationReceiptMatchesRequest(receipt, storedCancellationRequest)) {
      throw rollback(corruption(operation, request.runId, "checkpoint_invalid"));
    }
    return Object.freeze({
      kind: "delivered",
      receipt,
      disposition: lifecycleCurrent ? "current" : "cleanup_only",
    });
  }
  if (
    checkpoint.deliveryState === "rejected"
    || checkpoint.deliveryState === "obsolete"
    || checkpoint.deliveryState === "quarantined"
  ) return cancellationClosedResult(checkpoint, operation, request.runId);
  if (!lifecycleCurrent && checkpoint.deliveryState !== "delivering") {
    return settleLifecycleObsoleteCancellationCheckpoint(
      tx,
      authority.scopeId,
      request,
      checkpoint,
      databaseTime.now,
      operation,
    );
  }
  if (
    checkpoint.claimOwner !== null
    && checkpoint.claimExpiresAt !== null
    && checkpoint.claimExpiresAt.getTime() > databaseTime.now.getTime()
  ) {
    return Object.freeze({
      kind: "busy",
      claimExpiresAt: ownedDate(
        checkpoint.claimExpiresAt,
        operation,
        request.runId,
      ),
    });
  }
  if (checkpoint.deliveryState === "waiting_dispatch") {
    if (expectedCancellationRequest === null) {
      return Object.freeze({ kind: "waiting_dispatch" });
    }
    const evidence = await encodeCancellationRequestEvidence(
      expectedCancellationRequest,
      operation,
      request.runId,
    );
    const prepared = await statement(operation, () => tx.update(
      fxSystemDurableTaskComputeCancellationsV1,
    ).set({
      requestCodecVersion: evidence.codecVersion,
      requestByteLength: BigInt(evidence.byteLength),
      requestSha256: evidence.sha256,
      requestBytes: evidence.canonicalBytes,
      deliveryState: "prepared",
      claimOwner,
      claimFence: 1n,
      claimedAt: databaseTime.now,
      claimExpiresAt: databaseTime.claimExpiresAt,
      updatedAt: databaseTime.now,
    }).where(cancellationPrimaryKey(authority.scopeId, request)).returning());
    if (prepared[0] === undefined) {
      throw rollback(corruption(operation, request.runId, "checkpoint_invalid"));
    }
    return claimedCancellationTransactionResult(
      prepared[0],
      expectedCancellationRequest,
      "initial",
      claimOwner,
      databaseTime.claimExpiresAt,
      operation,
    );
  }
  if (storedCancellationRequest === null) {
    throw rollback(corruption(operation, request.runId, "checkpoint_invalid"));
  }
  if (
    checkpoint.deliveryState === "retry_wait"
    && checkpoint.nextAttemptAt !== null
    && checkpoint.nextAttemptAt.getTime() > databaseTime.now.getTime()
  ) {
    return Object.freeze({
      kind: "not_due",
      nextAttemptAt: ownedDate(
        checkpoint.nextAttemptAt,
        operation,
        request.runId,
      ),
    });
  }
  if (checkpoint.claimFence >= POSTGRES_SIGNED_BIGINT_MAX) {
    throw rollback(new TaskComputeDeliveryRepositoryResourceExhaustedV1Error({
      operation,
      runId: request.runId,
      dimension: "claim_fence",
      observed: checkpoint.claimFence,
      maximum: POSTGRES_SIGNED_BIGINT_MAX,
    }));
  }
  const deliveryMode: TaskComputeDeliveryModeV1 =
    checkpoint.deliveryState === "delivering"
      ? "uncertain_replay"
      : checkpoint.deliveryState === "retry_wait"
      ? "retry"
      : "initial";
  const claimed = await statement(operation, () => tx.update(
    fxSystemDurableTaskComputeCancellationsV1,
  ).set({
    claimOwner,
    claimFence: checkpoint.claimFence + 1n,
    claimedAt: databaseTime.now,
    claimExpiresAt: databaseTime.claimExpiresAt,
    updatedAt: databaseTime.now,
  }).where(cancellationPrimaryKey(authority.scopeId, request)).returning());
  if (claimed[0] === undefined) {
    throw rollback(corruption(operation, request.runId, "checkpoint_invalid"));
  }
  return claimedCancellationTransactionResult(
    claimed[0],
    storedCancellationRequest,
    deliveryMode,
    claimOwner,
    databaseTime.claimExpiresAt,
    operation,
  );
}

interface CorrelatedCancellationHandleContextV1 {
  readonly checkpoint: CancellationRow;
  readonly request: TaskComputeCancellationRequestV1;
  readonly databaseTime: Readonly<{
    readonly now: Date;
    readonly claimExpiresAt: Date;
  }>;
  readonly lifecycleCurrent: boolean;
}

async function verifyCancellationRecoveryTransaction(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  replacementScopeId: ReplacementScopeIdV1,
  target: LocatedTaskComputeDeliveryTargetV1,
  configuration: CapturedConfigurationV1,
  state: MutableHandleStateV1,
): Promise<
  TaskComputeDeliveryRecoveryObservationV1<"verify_cancellation_recovery">
> {
  const operation = "verify_cancellation_recovery" as const;
  const context = await loadCorrelatedCancellationHandleContext(
    tx,
    authority,
    replacementScopeId,
    target,
    configuration,
    state,
    operation,
  );
  requireCurrentCancellationClaim(context, state, operation);
  if (
    context.checkpoint.deliveryState !== "delivering"
    || context.checkpoint.deliveryAttemptCount < 1n
  ) {
    throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
  }
  if (context.lifecycleCurrent) {
    return Object.freeze({ kind: "state_unchanged" });
  }
  const updated = await statement(operation, () => tx.update(
    fxSystemDurableTaskComputeCancellationsV1,
  ).set({
    deliveryState: "rejected",
    claimOwner: null,
    claimedAt: null,
    claimExpiresAt: null,
    nextAttemptAt: null,
    reasonCode: "lifecycle_obsolete",
    settledAt: context.databaseTime.now,
    updatedAt: context.databaseTime.now,
  }).where(cancellationClaimKey(authority.scopeId, state)).returning());
  const row = updated[0];
  if (
    row?.deliveryState !== "rejected"
    || row.claimOwner !== null
    || row.reasonCode !== "lifecycle_obsolete"
    || row.settledAt === null
  ) {
    throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
  }
  return Object.freeze({ kind: "state_moved" });
}

async function markCancellationDeliveryStartedTransaction(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  replacementScopeId: ReplacementScopeIdV1,
  target: LocatedTaskComputeDeliveryTargetV1,
  configuration: CapturedConfigurationV1,
  state: MutableHandleStateV1,
): Promise<TaskComputeCancellationDeliveryStartedV1> {
  const operation = "mark_cancellation_delivery_started" as const;
  const context = await loadCorrelatedCancellationHandleContext(
    tx,
    authority,
    replacementScopeId,
    target,
    configuration,
    state,
    operation,
  );
  requireCurrentCancellationClaim(context, state, operation);
  if (
    context.checkpoint.deliveryState !== "prepared"
    && context.checkpoint.deliveryState !== "retry_wait"
    && context.checkpoint.deliveryState !== "delivering"
  ) throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
  if (
    context.checkpoint.deliveryState !== "delivering"
    && !context.lifecycleCurrent
  ) throw rollback(staleClaim(operation, state.runId, "lifecycle_obsolete"));
  const countBefore = context.checkpoint.deliveryAttemptCount;
  const maximum = context.checkpoint.deliveryState === "delivering"
    ? POSTGRES_SIGNED_BIGINT_MAX
    : BigInt(configuration.maximumDeliveryAttempts);
  if (countBefore >= maximum) {
    throw rollback(new TaskComputeDeliveryRepositoryResourceExhaustedV1Error({
      operation,
      runId: state.runId,
      dimension: "delivery_attempt_count",
      observed: countBefore,
      maximum,
    }));
  }
  const deliveryAttemptCount = countBefore + 1n;
  const updated = await statement(operation, () => tx.update(
    fxSystemDurableTaskComputeCancellationsV1,
  ).set({
    deliveryState: "delivering",
    deliveryAttemptCount,
    deliveryStartedAt: context.databaseTime.now,
    nextAttemptAt: null,
    reasonCode: null,
    updatedAt: context.databaseTime.now,
  }).where(cancellationClaimKey(authority.scopeId, state)).returning());
  const row = updated[0];
  if (
    row === undefined
    || row.deliveryState !== "delivering"
    || row.deliveryAttemptCount !== deliveryAttemptCount
    || row.deliveryStartedAt === null
  ) throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
  return Object.freeze({
    kind: "delivery_started",
    deliveryAttemptCount,
    deliveryStartedAt: ownedDate(row.deliveryStartedAt, operation, state.runId),
  });
}

async function renewCancellationClaimTransaction(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  replacementScopeId: ReplacementScopeIdV1,
  target: LocatedTaskComputeDeliveryTargetV1,
  configuration: CapturedConfigurationV1,
  state: MutableHandleStateV1,
): Promise<TaskComputeCancellationClaimRenewedV1> {
  const operation = "renew_cancellation_claim" as const;
  const context = await loadCorrelatedCancellationHandleContext(
    tx,
    authority,
    replacementScopeId,
    target,
    configuration,
    state,
    operation,
  );
  requireCurrentCancellationClaim(context, state, operation);
  if (
    context.checkpoint.deliveryState !== "prepared"
    && context.checkpoint.deliveryState !== "retry_wait"
    && context.checkpoint.deliveryState !== "delivering"
  ) throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
  if (
    context.checkpoint.deliveryState !== "delivering"
    && !context.lifecycleCurrent
  ) throw rollback(staleClaim(operation, state.runId, "lifecycle_obsolete"));
  const updated = await statement(operation, () => tx.update(
    fxSystemDurableTaskComputeCancellationsV1,
  ).set({
    claimedAt: context.databaseTime.now,
    claimExpiresAt: context.databaseTime.claimExpiresAt,
    updatedAt: context.databaseTime.now,
  }).where(cancellationClaimKey(authority.scopeId, state)).returning({
    claimExpiresAt: fxSystemDurableTaskComputeCancellationsV1.claimExpiresAt,
  }));
  const claimExpiresAt = updated[0]?.claimExpiresAt;
  if (claimExpiresAt === null || claimExpiresAt === undefined) {
    throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
  }
  return Object.freeze({
    kind: "claim_renewed",
    claimExpiresAt: ownedDate(claimExpiresAt, operation, state.runId),
  });
}

async function releaseCancellationBeforeDeliveryTransaction(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  replacementScopeId: ReplacementScopeIdV1,
  target: LocatedTaskComputeDeliveryTargetV1,
  configuration: CapturedConfigurationV1,
  state: MutableHandleStateV1,
): Promise<TaskComputeCancellationClaimReleasedV1> {
  const operation = "release_cancellation_before_delivery" as const;
  const context = await loadCorrelatedCancellationHandleContext(
    tx,
    authority,
    replacementScopeId,
    target,
    configuration,
    state,
    operation,
  );
  requireCurrentCancellationClaim(context, state, operation);
  if (
    context.checkpoint.deliveryState !== "prepared"
    && context.checkpoint.deliveryState !== "retry_wait"
  ) throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
  if (!context.lifecycleCurrent) {
    throw rollback(staleClaim(operation, state.runId, "lifecycle_obsolete"));
  }
  const updated = await statement(operation, () => tx.update(
    fxSystemDurableTaskComputeCancellationsV1,
  ).set({
    claimOwner: null,
    claimedAt: null,
    claimExpiresAt: null,
    updatedAt: context.databaseTime.now,
  }).where(cancellationClaimKey(authority.scopeId, state)).returning({
    claimOwner: fxSystemDurableTaskComputeCancellationsV1.claimOwner,
  }));
  if (updated[0]?.claimOwner !== null) {
    throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
  }
  return Object.freeze({ kind: "claim_released" });
}

async function recordCancellationReceiptTransaction(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  replacementScopeId: ReplacementScopeIdV1,
  target: LocatedTaskComputeDeliveryTargetV1,
  configuration: CapturedConfigurationV1,
  state: MutableHandleStateV1,
  receipt: TaskComputeCancellationReceiptV1,
): Promise<TaskComputeCancellationReceiptRecordedV1> {
  const operation = "record_cancellation_receipt" as const;
  const context = await loadCorrelatedCancellationHandleContext(
    tx,
    authority,
    replacementScopeId,
    target,
    configuration,
    state,
    operation,
  );
  requireCurrentCancellationClaim(context, state, operation);
  if (context.checkpoint.deliveryState !== "delivering") {
    throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
  }
  if (!cancellationReceiptMatchesRequest(receipt, context.request)) {
    throw rollback(repositoryInputFailure(
      operation,
      "receipt_correlation_mismatch",
    ));
  }
  const evidence = await encodeCancellationReceiptEvidence(
    receipt,
    operation,
    state.runId,
  );
  const updated = await statement(operation, () => tx.update(
    fxSystemDurableTaskComputeCancellationsV1,
  ).set({
    deliveryState: "delivered",
    claimOwner: null,
    claimedAt: null,
    claimExpiresAt: null,
    nextAttemptAt: null,
    reasonCode: null,
    receiptCodecVersion: evidence.codecVersion,
    receiptByteLength: BigInt(evidence.byteLength),
    receiptSha256: evidence.sha256,
    receiptBytes: evidence.canonicalBytes,
    settledAt: context.databaseTime.now,
    updatedAt: context.databaseTime.now,
  }).where(cancellationClaimKey(authority.scopeId, state)).returning());
  const row = updated[0];
  if (row === undefined || row.deliveryState !== "delivered") {
    throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
  }
  const storedReceipt = await decodeStoredCancellationReceipt(
    row,
    operation,
    state.runId,
  );
  if (!taskSystemPersistedValueEqualV1(storedReceipt, receipt)) {
    throw rollback(corruption(operation, state.runId, "checkpoint_invalid"));
  }
  return Object.freeze({
    kind: "cancellation_delivered",
    receipt: storedReceipt,
    disposition: context.lifecycleCurrent ? "current" : "cleanup_only",
  });
}

async function recordCancellationKnownFailureTransaction(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  replacementScopeId: ReplacementScopeIdV1,
  target: LocatedTaskComputeDeliveryTargetV1,
  configuration: CapturedConfigurationV1,
  state: MutableHandleStateV1,
  failure: CapturedKnownCancellationFailureV1,
): Promise<TaskComputeCancellationKnownFailureRecordedV1> {
  const operation = "record_cancellation_known_failure" as const;
  const context = await loadCorrelatedCancellationHandleContext(
    tx,
    authority,
    replacementScopeId,
    target,
    configuration,
    state,
    operation,
  );
  requireCurrentCancellationClaim(context, state, operation);
  if (context.checkpoint.deliveryState !== "delivering") {
    throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
  }
  if (
    failure.kind === "stale"
    && (
      !taskSystemPersistedValueEqualV1(failure.identity, context.request.identity)
      || failure.receivedGeneration !== context.request.cancellationGeneration
      || failure.acceptedGeneration <= failure.receivedGeneration
    )
  ) throw rollback(repositoryInputFailure(
    operation,
    "known_failure_correlation_mismatch",
  ));
  const attemptCount = context.checkpoint.deliveryAttemptCount;
  if (attemptCount < 1n) {
    throw rollback(corruption(operation, state.runId, "checkpoint_invalid"));
  }
  if (
    failure.kind !== "stale"
    && failure.retryable
    && attemptCount < BigInt(configuration.maximumDeliveryAttempts)
  ) {
    const retryReason = cancellationRetryFailureReason(failure);
    const delay = configuration.retryDelayMilliseconds[Number(attemptCount - 1n)];
    const startedAt = context.checkpoint.deliveryStartedAt;
    if (delay === undefined || startedAt === null) {
      throw rollback(corruption(operation, state.runId, "checkpoint_invalid"));
    }
    const nextMilliseconds = Math.max(
      context.databaseTime.now.getTime(),
      startedAt.getTime(),
    ) + delay;
    const nextAttemptAt = Number.isSafeInteger(nextMilliseconds)
      ? copyFiniteDate(new Date(nextMilliseconds))
      : undefined;
    if (
      nextAttemptAt === undefined
      || nextAttemptAt.getTime() <= startedAt.getTime()
    ) throw rollback(corruption(operation, state.runId, "database_clock_invalid"));
    const updated = await statement(operation, () => tx.update(
      fxSystemDurableTaskComputeCancellationsV1,
    ).set({
      deliveryState: "retry_wait",
      claimOwner: null,
      claimedAt: null,
      claimExpiresAt: null,
      nextAttemptAt,
      reasonCode: retryReason,
      settledAt: null,
      updatedAt: context.databaseTime.now,
    }).where(cancellationClaimKey(authority.scopeId, state)).returning());
    const row = updated[0];
    if (
      row?.deliveryState !== "retry_wait"
      || row.claimOwner !== null
      || row.reasonCode !== retryReason
      || row.nextAttemptAt === null
      || row.nextAttemptAt.getTime() !== nextAttemptAt.getTime()
    ) throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
    return Object.freeze({
      kind: "retry_scheduled",
      reason: retryReason,
      nextAttemptAt: ownedDate(row.nextAttemptAt, operation, state.runId),
    });
  }
  const providerReason = cancellationFailureReason(failure);
  const terminalReason = failure.kind !== "stale" && failure.retryable
    ? "delivery_attempts_exhausted" as const
    : providerReason;
  const updated = await statement(operation, () => tx.update(
    fxSystemDurableTaskComputeCancellationsV1,
  ).set({
    deliveryState: "rejected",
    claimOwner: null,
    claimedAt: null,
    claimExpiresAt: null,
    nextAttemptAt: null,
    reasonCode: terminalReason,
    settledAt: context.databaseTime.now,
    updatedAt: context.databaseTime.now,
  }).where(cancellationClaimKey(authority.scopeId, state)).returning());
  const row = updated[0];
  if (
    row?.deliveryState !== "rejected"
    || row.claimOwner !== null
    || row.reasonCode !== terminalReason
    || row.settledAt === null
  ) throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
  return Object.freeze({ kind: "cancellation_rejected", reason: terminalReason });
}

async function loadCorrelatedCancellationHandleContext(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  replacementScopeId: ReplacementScopeIdV1,
  target: LocatedTaskComputeDeliveryTargetV1,
  configuration: CapturedConfigurationV1,
  state: MutableHandleStateV1,
  operation: Exclude<
    TaskComputeDeliveryRepositoryOperationV1,
    "acquire_dispatch" | "acquire_cancellation"
  >,
): Promise<CorrelatedCancellationHandleContextV1> {
  await statement(operation, () => requireLockedTaskSystemScopeAuthorityV1(
    tx,
    authority,
    target,
    (mismatch) => rollback(new TaskComputeDeliveryRepositoryStaleScopeAuthorityV1Error({
      operation,
      runId: state.runId,
      authority: mismatch,
    })),
  ));
  const runRows = await statement(operation, () => tx.select().from(
    fxSystemDurableTaskRunsV1,
  ).where(and(
    eq(fxSystemDurableTaskRunsV1.scopeId, authority.scopeId),
    eq(fxSystemDurableTaskRunsV1.runId, state.runId),
  )).limit(1).for("update"));
  const runRow = runRows[0];
  if (runRow === undefined) {
    throw rollback(new TaskComputeDeliveryRepositoryUnavailableV1Error({
      operation,
      runId: state.runId,
      reason: "run_unavailable",
    }));
  }
  const aggregate = decodeRun(runRow, operation, state.runId);
  await correlateRunLedger(tx, authority.scopeId, state.runId, aggregate,
    operation);
  const acquisition = Object.freeze({
    runId: state.runId,
    requestedEffectSequence: state.requestedEffectSequence,
  });
  const cancellationEffect = decodeCancellationEffect(
    await loadRequestedEffect(
      tx,
      authority.scopeId,
      acquisition,
      operation,
    ),
    aggregate.generation,
    acquisition,
    operation,
  );
  const dispatchEffect = await loadLinkedDispatchEffect(
    tx,
    authority.scopeId,
    aggregate.generation,
    cancellationEffect,
    operation,
  );
  await loadImmutablePreparation(
    tx,
    authority.scopeId,
    runRow,
    dispatchEffect,
    operation,
  );
  const expectedDispatchRequest = buildDispatchRequest(
    replacementScopeId,
    aggregate.aggregate,
    dispatchEffect,
    operation,
  );
  const dispatchCheckpoint = await loadDispatchCheckpoint(
    tx,
    authority.scopeId,
    Object.freeze({
      runId: state.runId,
      requestedEffectSequence: dispatchEffect.sequence,
    }),
    operation,
  );
  if (dispatchCheckpoint === null || dispatchCheckpoint.deliveryState !== "accepted") {
    throw rollback(corruption(operation, state.runId, "checkpoint_invalid"));
  }
  const storedDispatchRequest = await decodeAndCorrelateDispatchCheckpoint(
    dispatchCheckpoint,
    expectedDispatchRequest,
    dispatchEffect.effect.acceptedRunVersion,
    operation,
    state.runId,
  );
  const acceptance = await decodeStoredAcceptance(
    dispatchCheckpoint,
    operation,
    state.runId,
  );
  if (!taskSystemPersistedValueEqualV1(
    acceptance.identity,
    storedDispatchRequest.identity,
  )) throw rollback(corruption(operation, state.runId, "checkpoint_invalid"));
  const expectedRequest = buildCancellationRequest(
    cancellationEffect,
    acceptance,
    operation,
  );
  const checkpoint = await loadCancellationCheckpoint(
    tx,
    authority.scopeId,
    acquisition,
    operation,
  );
  if (checkpoint === null) {
    throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
  }
  const storedRequest = await decodeAndCorrelateCancellationCheckpoint(
    checkpoint,
    cancellationEffect,
    dispatchEffect.sequence,
    expectedRequest,
    operation,
    state.runId,
  );
  if (storedRequest === null) {
    throw rollback(corruption(operation, state.runId, "checkpoint_invalid"));
  }
  const databaseTime = await readDatabaseTime(
    tx,
    authority.scopeId,
    configuration.claimDurationMilliseconds,
    operation,
    state.runId,
  );
  return Object.freeze({
    checkpoint,
    request: storedRequest,
    databaseTime,
    lifecycleCurrent: cancellationLifecycleIsCurrent(
      aggregate.aggregate,
      cancellationEffect,
    ),
  });
}

function requireCurrentCancellationClaim(
  context: CorrelatedCancellationHandleContextV1,
  state: MutableHandleStateV1,
  operation: Exclude<
    TaskComputeDeliveryRepositoryOperationV1,
    "acquire_dispatch" | "acquire_cancellation"
  >,
): void {
  const row = context.checkpoint;
  if (row.claimOwner !== state.claimOwner) {
    throw rollback(staleClaim(operation, state.runId, "owner_mismatch"));
  }
  if (row.claimFence !== state.claimFence) {
    throw rollback(staleClaim(operation, state.runId, "fence_mismatch"));
  }
  if (
    row.claimExpiresAt === null
    || row.claimExpiresAt.getTime() <= context.databaseTime.now.getTime()
  ) throw rollback(staleClaim(operation, state.runId, "claim_expired"));
}

async function loadCorrelatedHandleContext(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  replacementScopeId: ReplacementScopeIdV1,
  target: LocatedTaskComputeDeliveryTargetV1,
  configuration: CapturedConfigurationV1,
  state: MutableHandleStateV1,
  operation: Exclude<
    TaskComputeDeliveryRepositoryOperationV1,
    "acquire_dispatch" | "acquire_cancellation"
  >,
): Promise<CorrelatedHandleContextV1> {
  await statement(operation, () => requireLockedTaskSystemScopeAuthorityV1(
    tx,
    authority,
    target,
    (mismatch) => rollback(new TaskComputeDeliveryRepositoryStaleScopeAuthorityV1Error({
      operation,
      runId: state.runId,
      authority: mismatch,
    })),
  ));
  const rows = await statement(operation, () => tx.select().from(
    fxSystemDurableTaskRunsV1,
  ).where(and(
    eq(fxSystemDurableTaskRunsV1.scopeId, authority.scopeId),
    eq(fxSystemDurableTaskRunsV1.runId, state.runId),
  )).limit(1).for("update"));
  const runRow = rows[0];
  if (runRow === undefined) {
    throw rollback(new TaskComputeDeliveryRepositoryUnavailableV1Error({
      operation,
      runId: state.runId,
      reason: "run_unavailable",
    }));
  }
  const aggregate = decodeRun(runRow, operation, state.runId);
  await correlateRunLedger(tx, authority.scopeId, state.runId, aggregate,
    operation);
  const request = Object.freeze({
    runId: state.runId,
    requestedEffectSequence: state.requestedEffectSequence,
  });
  const effectRow = await loadRequestedEffect(
    tx,
    authority.scopeId,
    request,
    operation,
  );
  const persistedEffect = decodeDispatchEffect(
    effectRow,
    aggregate.generation,
    request,
    operation,
  );
  await loadImmutablePreparation(
    tx,
    authority.scopeId,
    runRow,
    persistedEffect,
    operation,
  );
  const expectedRequest = buildDispatchRequest(
    replacementScopeId,
    aggregate.aggregate,
    persistedEffect,
    operation,
  );
  const checkpoint = await loadDispatchCheckpoint(
    tx,
    authority.scopeId,
    request,
    operation,
  );
  if (checkpoint === null) {
    throw rollback(staleClaim(operation, state.runId, "state_mismatch"));
  }
  const storedRequest = await decodeAndCorrelateDispatchCheckpoint(
    checkpoint,
    expectedRequest,
    persistedEffect.effect.acceptedRunVersion,
    operation,
    state.runId,
  );
  const databaseTime = await readDatabaseTime(
    tx,
    authority.scopeId,
    configuration.claimDurationMilliseconds,
    operation,
    state.runId,
  );
  return Object.freeze({
    checkpoint,
    storedRequest,
    databaseTime,
    lifecycleCurrent: dispatchLifecycleIsCurrent(
      aggregate.aggregate,
      persistedEffect,
    ),
  });
}

function requireCurrentClaim(
  context: CorrelatedHandleContextV1,
  state: MutableHandleStateV1,
  operation: Exclude<
    TaskComputeDeliveryRepositoryOperationV1,
    "acquire_dispatch" | "acquire_cancellation"
  >,
): void {
  const row = context.checkpoint;
  if (row.claimOwner !== state.claimOwner) {
    throw rollback(staleClaim(operation, state.runId, "owner_mismatch"));
  }
  if (row.claimFence !== state.claimFence) {
    throw rollback(staleClaim(operation, state.runId, "fence_mismatch"));
  }
  if (
    row.claimExpiresAt === null
    || row.claimExpiresAt.getTime() <= context.databaseTime.now.getTime()
  ) {
    throw rollback(staleClaim(operation, state.runId, "claim_expired"));
  }
}

function captureConfiguration(
  input: TaskComputeDeliveryRepositoryOptionsV1,
): Result.Result<
  CapturedConfigurationV1,
  TaskComputeDeliveryRepositoryConfigurationV1Error
> {
  const record = captureDataRecord(input, [
    "claimDurationMilliseconds",
    "retryDelayMilliseconds",
    "maximumDeliveryAttempts",
    "randomUuid",
  ]);
  if (record === undefined) {
    return Result.fail(configurationFailure("invalid_options"));
  }
  const claimDurationMilliseconds = record.claimDurationMilliseconds;
  if (!isPositiveSafeInteger(claimDurationMilliseconds)) {
    return Result.fail(configurationFailure("invalid_claim_duration"));
  }
  const maximumDeliveryAttempts = record.maximumDeliveryAttempts;
  if (
    !isPositiveSafeInteger(maximumDeliveryAttempts)
    || maximumDeliveryAttempts < 2
    || maximumDeliveryAttempts > MAXIMUM_DELIVERY_ATTEMPTS_V1
  ) {
    return Result.fail(configurationFailure(
      "invalid_maximum_delivery_attempts",
    ));
  }
  const retryDelayMilliseconds = capturePositiveSafeIntegerArray(
    record.retryDelayMilliseconds,
  );
  if (
    retryDelayMilliseconds === undefined
    || retryDelayMilliseconds.length !== maximumDeliveryAttempts - 1
  ) {
    return Result.fail(configurationFailure("invalid_retry_delays"));
  }
  if (typeof record.randomUuid !== "function") {
    return Result.fail(configurationFailure("invalid_random_uuid"));
  }
  return Result.succeed(Object.freeze({
    claimDurationMilliseconds,
    retryDelayMilliseconds: Object.freeze(retryDelayMilliseconds),
    maximumDeliveryAttempts,
    randomUuid: record.randomUuid as () => string,
  }));
}

function captureAcquireRequest<
  Operation extends "acquire_dispatch" | "acquire_cancellation",
>(
  input: TaskComputeDispatchAcquireRequestV1,
  operation: Operation = "acquire_dispatch" as Operation,
): Result.Result<
  CapturedAcquireRequestV1,
  TaskComputeDeliveryRepositoryInputV1Error<Operation>
> {
  const record = captureDataRecord(input, [
    "runId",
    "requestedEffectSequence",
  ]);
  if (record === undefined) return Result.fail(repositoryInputFailure(
    operation,
    "invalid_request",
  ));
  return Result.gen(function* () {
    const runId = yield* decodeTaskRunIdV1(record.runId).pipe(
      Result.mapError(() => repositoryInputFailure(
        operation,
        "invalid_request",
      )),
    );
    const rawSequence = typeof record.requestedEffectSequence === "bigint"
      ? record.requestedEffectSequence.toString()
      : record.requestedEffectSequence;
    const requestedEffectSequence = yield*
      decodeTaskRequestedEffectSequenceV1(rawSequence).pipe(
        Result.mapError(() => repositoryInputFailure(
          operation,
          "invalid_request",
        )),
      );
    return Object.freeze({ runId, requestedEffectSequence });
  });
}

function captureDispatchAcceptance(
  input: unknown,
): Result.Result<
  TaskComputeDispatchAcceptanceV1,
  TaskComputeDeliveryRepositoryInputV1Error<"record_dispatch_acceptance">
> {
  return validateTaskComputeDispatchAcceptanceV1(input).pipe(
    Result.mapError(() => repositoryInputFailure(
      "record_dispatch_acceptance",
      "invalid_acceptance",
    )),
  );
}

function captureKnownDispatchFailure(
  input: unknown,
): Result.Result<
  CapturedKnownDispatchFailureV1,
  TaskComputeDeliveryRepositoryInputV1Error<"record_dispatch_known_failure">
> {
  try {
    if (input instanceof TaskComputeDispatchRejectedError) {
      const captured = captureOwnDataProperties(input, [
        "operation",
        "reason",
        "retryable",
        "computeProfile",
      ]);
      if (
        captured === undefined
        || captured.operation !== "dispatch"
        || (
          captured.reason !== "unsupported_compute_profile"
          && captured.reason !== "capacity_unavailable"
          && captured.reason !== "provider_disabled"
        )
        || typeof captured.retryable !== "boolean"
      ) return Result.fail(repositoryInputFailure(
        "record_dispatch_known_failure",
        "invalid_known_failure",
      ));
      const reason = captured.reason;
      const retryable = captured.retryable;
      return encodeTaskComputeProfileStorageBytesV1(
        captured.computeProfile,
      ).pipe(
        Result.flatMap(decodeTaskComputeProfileStorageBytesV1),
        Result.mapError(() => repositoryInputFailure(
          "record_dispatch_known_failure",
          "invalid_known_failure",
        )),
        Result.map((computeProfile) => Object.freeze({
          kind: "rejected" as const,
          reason,
          retryable,
          computeProfile,
        })),
      );
    }
    if (input instanceof TaskComputeDispatchTransportError) {
      const captured = captureOwnDataProperties(input, [
        "operation",
        "retryable",
      ]);
      if (
        captured === undefined
        || captured.operation !== "dispatch"
        || typeof captured.retryable !== "boolean"
      ) return Result.fail(repositoryInputFailure(
        "record_dispatch_known_failure",
        "invalid_known_failure",
      ));
      return Result.succeed(Object.freeze({
        kind: "transport" as const,
        retryable: captured.retryable,
      }));
    }
  } catch {
    // Hostile proxies and revoked provider values are ordinary invalid input.
  }
  return Result.fail(repositoryInputFailure(
    "record_dispatch_known_failure",
    "invalid_known_failure",
  ));
}

function dispatchFailureReason(
  failure: CapturedKnownDispatchFailureV1,
): Exclude<
  TaskComputeDispatchClosedReasonV1,
  "lifecycle_obsolete" | "checkpoint_corrupt" | "delivery_attempts_exhausted"
> {
  if (failure.kind === "transport") return "provider_transport";
  switch (failure.reason) {
    case "unsupported_compute_profile":
      return "provider_unsupported_compute_profile";
    case "capacity_unavailable":
      return "provider_capacity_unavailable";
    case "provider_disabled":
      return "provider_disabled";
  }
}

function captureCancellationReceipt(
  input: unknown,
): Result.Result<
  TaskComputeCancellationReceiptV1,
  TaskComputeDeliveryRepositoryInputV1Error<"record_cancellation_receipt">
> {
  return validateTaskComputeCancellationReceiptV1(input).pipe(
    Result.mapError(() => repositoryInputFailure(
      "record_cancellation_receipt",
      "invalid_receipt",
    )),
  );
}

function captureKnownCancellationFailure(
  input: unknown,
): Result.Result<
  CapturedKnownCancellationFailureV1,
  TaskComputeDeliveryRepositoryInputV1Error<
    "record_cancellation_known_failure"
  >
> {
  try {
    if (input instanceof TaskComputeCancellationRejectedError) {
      const captured = captureOwnDataProperties(input, [
        "operation",
        "reason",
        "retryable",
      ]);
      if (
        captured === undefined
        || captured.operation !== "request_cancellation"
        || (
          captured.reason !== "provider_disabled"
          && captured.reason !== "execution_not_found"
          && captured.reason !== "execution_mismatch"
        )
        || typeof captured.retryable !== "boolean"
      ) return Result.fail(repositoryInputFailure(
        "record_cancellation_known_failure",
        "invalid_known_failure",
      ));
      return Result.succeed(Object.freeze({
        kind: "rejected" as const,
        reason: captured.reason,
        retryable: captured.retryable,
      }));
    }
    if (input instanceof TaskComputeCancellationTransportError) {
      const captured = captureOwnDataProperties(input, [
        "operation",
        "retryable",
      ]);
      if (
        captured === undefined
        || captured.operation !== "request_cancellation"
        || typeof captured.retryable !== "boolean"
      ) return Result.fail(repositoryInputFailure(
        "record_cancellation_known_failure",
        "invalid_known_failure",
      ));
      return Result.succeed(Object.freeze({
        kind: "transport" as const,
        retryable: captured.retryable,
      }));
    }
    if (input instanceof TaskComputeCancellationStaleError) {
      const captured = captureOwnDataProperties(input, [
        "identity",
        "receivedGeneration",
        "acceptedGeneration",
      ]);
      if (captured === undefined) return Result.fail(repositoryInputFailure(
        "record_cancellation_known_failure",
        "invalid_known_failure",
      ));
      return captureStaleCancellationFailure(captured);
    }
  } catch {
    // Hostile proxies and revoked provider values are ordinary invalid input.
  }
  return Result.fail(repositoryInputFailure(
    "record_cancellation_known_failure",
    "invalid_known_failure",
  ));
}

function captureStaleCancellationFailure(
  captured: Readonly<Record<string, unknown>>,
): Result.Result<
  CapturedKnownCancellationFailureV1,
  TaskComputeDeliveryRepositoryInputV1Error<
    "record_cancellation_known_failure"
  >
> {
  const invalid = (): TaskComputeDeliveryRepositoryInputV1Error<
    "record_cancellation_known_failure"
  > => repositoryInputFailure(
    "record_cancellation_known_failure",
    "invalid_known_failure",
  );
  const identity = captureDataRecord(captured.identity, [
    "version",
    "scopeId",
    "runId",
    "requestedEffectSequence",
    "attemptId",
    "executionFence",
  ]);
  const rawRequestedEffectSequence = identity?.requestedEffectSequence;
  const rawExecutionFence = identity?.executionFence;
  const rawReceivedGeneration = captured.receivedGeneration;
  const rawAcceptedGeneration = captured.acceptedGeneration;
  if (
    identity === undefined
    || identity.version !== TASK_COMPUTE_DISPATCH_IDENTITY_VERSION_V1
    || typeof rawReceivedGeneration !== "bigint"
    || typeof rawAcceptedGeneration !== "bigint"
    || rawAcceptedGeneration <= rawReceivedGeneration
    || typeof rawRequestedEffectSequence !== "bigint"
    || typeof rawExecutionFence !== "bigint"
  ) return Result.fail(invalid());
  return Result.gen(function* () {
    const scopeId = yield* decodeReplacementScopeIdResult(identity.scopeId).pipe(
      Result.mapError(invalid),
    );
    const runId = yield* decodeTaskRunIdV1(identity.runId).pipe(
      Result.mapError(invalid),
    );
    const requestedEffectSequence = yield* decodeTaskRequestedEffectSequenceV1(
      rawRequestedEffectSequence.toString(),
    ).pipe(Result.mapError(invalid));
    const attemptId = yield* decodeTaskAttemptIdV1(identity.attemptId).pipe(
      Result.mapError(invalid),
    );
    const executionFence = yield* decodeTaskExecutionFenceV1(
      rawExecutionFence.toString(),
    ).pipe(Result.mapError(invalid));
    const receivedGeneration = yield* decodeTaskCancellationGenerationV1(
      rawReceivedGeneration.toString(),
    ).pipe(Result.mapError(invalid));
    const acceptedGeneration = yield* decodeTaskCancellationGenerationV1(
      rawAcceptedGeneration.toString(),
    ).pipe(Result.mapError(invalid));
    return Object.freeze({
      kind: "stale" as const,
      identity: Object.freeze({
        version: TASK_COMPUTE_DISPATCH_IDENTITY_VERSION_V1,
        scopeId,
        runId,
        requestedEffectSequence,
        attemptId,
        executionFence,
      }),
      receivedGeneration,
      acceptedGeneration,
    });
  });
}

function cancellationFailureReason(
  failure: CapturedKnownCancellationFailureV1,
): Exclude<
  TaskComputeCancellationClosedReasonV1,
  "lifecycle_obsolete" | "checkpoint_corrupt" | "delivery_attempts_exhausted"
> {
  if (failure.kind === "stale") return "provider_stale_generation";
  return cancellationRetryFailureReason(failure);
}

function cancellationRetryFailureReason(
  failure: Exclude<
    CapturedKnownCancellationFailureV1,
    { readonly kind: "stale" }
  >,
): Exclude<
  TaskComputeCancellationClosedReasonV1,
  | "lifecycle_obsolete"
  | "checkpoint_corrupt"
  | "provider_stale_generation"
  | "delivery_attempts_exhausted"
> {
  if (failure.kind === "transport") return "provider_transport";
  switch (failure.reason) {
    case "provider_disabled":
      return "provider_disabled";
    case "execution_not_found":
      return "provider_execution_not_found";
    case "execution_mismatch":
      return "provider_execution_mismatch";
  }
}

const allocateClaimOwner = Effect.fn(
  "TaskComputeDeliveryRepository.allocateClaimOwner",
)(function* <
  Operation extends "acquire_dispatch" | "acquire_cancellation",
>(
  operation: Operation,
  randomUuid: () => string,
): Effect.fn.Return<
  string,
  TaskComputeDeliveryRepositoryInputV1Error<Operation>
> {
  let owner: unknown;
  try {
    owner = randomUuid();
  } catch {
    return yield* repositoryInputFailure(operation, "claim_owner_invalid");
  }
  if (
    typeof owner !== "string"
    || !isLowercaseUuidText(owner)
    || !UUID_V4_PATTERN.test(owner)
  ) {
    return yield* repositoryInputFailure(operation, "claim_owner_invalid");
  }
  return owner;
});

function decodeRun(
  row: RunRow,
  operation: TaskComputeDeliveryRepositoryOperationV1,
  runId: TaskRunIdV1,
): Readonly<{
  readonly generation: "legacy_definition_v1";
  readonly aggregate: TaskRunAttemptAggregateV1;
}> | Readonly<{
  readonly generation: "application_v1";
  readonly aggregate: ApplicationTaskRunAttemptAggregateV1;
}> {
  if (row.runId !== runId) throw rollback(corruption(
    operation,
    runId,
    "aggregate_invalid",
  ));
  const decoded = Result.getOrThrowWith(
    decodeAndCorrelateTaskSystemRunRowV1(row),
    () => rollback(corruption(operation, runId, "aggregate_invalid")),
  );
  return decoded;
}

async function correlateRunLedger(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  runId: TaskRunIdV1,
  decoded: ReturnType<typeof decodeRun>,
  operation: TaskComputeDeliveryRepositoryOperationV1,
): Promise<void> {
  const onCorruption = (reason: "effect_sequence_invalid" | "acceptance_invalid") =>
    rollback(corruption(operation, runId, reason));
  await statement(operation, () => decoded.generation === "legacy_definition_v1"
    ? correlateTaskSystemLifecycleLedgerV1(
      tx,
      scopeId,
      runId,
      decoded.aggregate,
      onCorruption,
    )
    : correlateApplicationTaskSystemLifecycleLedgerV1(
      tx,
      scopeId,
      runId,
      decoded.aggregate,
      onCorruption,
    ));
}

async function loadRequestedEffect(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  request: CapturedAcquireRequestV1,
  operation: TaskComputeDeliveryRepositoryOperationV1,
): Promise<RequestedEffectRow> {
  const rows = await statement(operation, () => tx.select().from(
    fxSystemDurableTaskRequestedEffectsV1,
  ).where(and(
    eq(fxSystemDurableTaskRequestedEffectsV1.scopeId, scopeId),
    eq(fxSystemDurableTaskRequestedEffectsV1.runId, request.runId),
    eq(
      fxSystemDurableTaskRequestedEffectsV1.sequence,
      request.requestedEffectSequence,
    ),
  )).limit(1));
  const row = rows[0];
  if (row === undefined) {
    throw rollback(new TaskComputeDeliveryRepositoryUnavailableV1Error({
      operation,
      runId: request.runId,
      reason: "effect_unavailable",
    }));
  }
  return row;
}

async function findRequestedEffect(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  request: CapturedAcquireRequestV1,
  operation: TaskComputeDeliveryRepositoryOperationV1,
): Promise<RequestedEffectRow | undefined> {
  const rows = await statement(operation, () => tx.select().from(
    fxSystemDurableTaskRequestedEffectsV1,
  ).where(and(
    eq(fxSystemDurableTaskRequestedEffectsV1.scopeId, scopeId),
    eq(fxSystemDurableTaskRequestedEffectsV1.runId, request.runId),
    eq(
      fxSystemDurableTaskRequestedEffectsV1.sequence,
      request.requestedEffectSequence,
    ),
  )).limit(1));
  return rows[0];
}

async function consumePendingComputeDelivery(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  request: CapturedAcquireRequestV1,
  expectedKind: typeof fxSystemDurableTaskComputePendingV1.$inferSelect["kind"],
  operation: "acquire_dispatch" | "acquire_cancellation",
): Promise<void> {
  const deleted = await statement(operation, () => tx.delete(
    fxSystemDurableTaskComputePendingV1,
  ).where(and(
    eq(fxSystemDurableTaskComputePendingV1.scopeId, scopeId),
    eq(fxSystemDurableTaskComputePendingV1.runId, request.runId),
    eq(
      fxSystemDurableTaskComputePendingV1.requestedEffectSequence,
      request.requestedEffectSequence,
    ),
  )).returning({ kind: fxSystemDurableTaskComputePendingV1.kind }));
  if (
    deleted.length > 1 ||
    (deleted[0] !== undefined && deleted[0].kind !== expectedKind)
  ) {
    throw rollback(corruption(
      operation,
      request.runId,
      "pending_membership_invalid",
    ));
  }
}

function decodeDispatchEffect(
  row: RequestedEffectRow,
  generation: "legacy_definition_v1" | "application_v1",
  request: CapturedAcquireRequestV1,
  operation: TaskComputeDeliveryRepositoryOperationV1,
): DispatchEffectForDelivery {
  if (generation === "legacy_definition_v1") {
    const decoded = Result.getOrThrowWith(
      decodeAndCorrelateTaskSystemRequestedEffectRowV1(row),
      () => rollback(corruption(operation, request.runId, "effect_invalid")),
    );
    if (decoded.sequence !== request.requestedEffectSequence
      || decoded.effect.kind !== "dispatch_attempt") {
      throw rollback(corruption(operation, request.runId, "effect_invalid"));
    }
    return Object.freeze({ sequence: decoded.sequence, effect: decoded.effect });
  }
  const decoded = Result.getOrThrowWith(
    decodeAndCorrelateApplicationTaskSystemRequestedEffectRowV1(row),
    () => rollback(corruption(operation, request.runId, "effect_invalid")),
  );
  if (
    decoded.sequence !== request.requestedEffectSequence
    || decoded.effect.kind !== "dispatch_attempt"
  ) {
    throw rollback(corruption(
      operation,
      request.runId,
      "effect_invalid",
    ));
  }
  return Object.freeze({
    sequence: decoded.sequence,
    effect: decoded.effect,
  });
}

function decodeCancellationEffect(
  row: RequestedEffectRow,
  generation: "legacy_definition_v1" | "application_v1",
  request: CapturedAcquireRequestV1,
  operation: TaskComputeDeliveryRepositoryOperationV1,
): CancellationEffectForDelivery {
  if (generation === "legacy_definition_v1") {
    const decoded = Result.getOrThrowWith(
      decodeAndCorrelateTaskSystemRequestedEffectRowV1(row),
      () => rollback(corruption(operation, request.runId, "effect_invalid")),
    );
    if (decoded.sequence !== request.requestedEffectSequence
      || decoded.effect.kind !== "request_execution_cancellation") {
      throw rollback(corruption(operation, request.runId, "effect_invalid"));
    }
    return Object.freeze({ sequence: decoded.sequence, effect: decoded.effect });
  }
  const decoded = Result.getOrThrowWith(
    decodeAndCorrelateApplicationTaskSystemRequestedEffectRowV1(row),
    () => rollback(corruption(operation, request.runId, "effect_invalid")),
  );
  if (
    decoded.sequence !== request.requestedEffectSequence
    || decoded.effect.kind !== "request_execution_cancellation"
  ) throw rollback(corruption(operation, request.runId, "effect_invalid"));
  return Object.freeze({
    sequence: decoded.sequence,
    effect: decoded.effect,
  });
}

async function loadLinkedDispatchEffect(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  generation: "legacy_definition_v1" | "application_v1",
  cancellation: ReturnType<typeof decodeCancellationEffect>,
  operation: TaskComputeDeliveryRepositoryOperationV1,
): Promise<ReturnType<typeof decodeDispatchEffect>> {
  const rows = await statement(operation, () => tx.select().from(
    fxSystemDurableTaskRequestedEffectsV1,
  ).where(and(
    eq(fxSystemDurableTaskRequestedEffectsV1.scopeId, scopeId),
    eq(fxSystemDurableTaskRequestedEffectsV1.runId, cancellation.effect.runId),
    eq(fxSystemDurableTaskRequestedEffectsV1.kind, "dispatch_attempt"),
  )).orderBy(fxSystemDurableTaskRequestedEffectsV1.sequence));
  let matched: ReturnType<typeof decodeDispatchEffect> | null = null;
  for (const row of rows) {
    const request = Object.freeze({
      runId: cancellation.effect.runId,
      requestedEffectSequence: row.sequence,
    });
    const decoded = decodeDispatchEffect(
      row,
      generation,
      request,
      operation,
    );
    if (
      decoded.effect.attempt.attemptId === cancellation.effect.attemptId
      && decoded.effect.attempt.executionFence
        === cancellation.effect.executionFence
    ) {
      if (matched !== null || decoded.sequence >= cancellation.sequence) {
        throw rollback(corruption(
          operation,
          cancellation.effect.runId,
          "effect_invalid",
        ));
      }
      matched = decoded;
    }
  }
  if (matched === null) {
    throw rollback(corruption(
      operation,
      cancellation.effect.runId,
      "effect_invalid",
    ));
  }
  return matched;
}

async function loadImmutablePreparation(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  run: RunRow,
  persistedEffect: ReturnType<typeof decodeDispatchEffect>,
  operation: TaskComputeDeliveryRepositoryOperationV1,
): Promise<ImmutablePreparation> {
  if (run.definitionGeneration === "application_v1") {
    return loadApplicationImmutablePreparation(
      tx,
      scopeId,
      run,
      persistedEffect,
      operation,
    );
  }
  if (
    run.definitionGeneration !== "legacy_definition_v1"
    || run.taskDefinitionRevisionId === null
    || !("taskDefinitionRevisionId" in persistedEffect.effect)
    || run.taskDefinitionRevisionId
      !== persistedEffect.effect.taskDefinitionRevisionId
  ) {
    throw rollback(corruption(
      operation,
      run.runId,
      "definition_invalid",
    ));
  }
  const taskDefinitionRevisionId = run.taskDefinitionRevisionId;
  const definitionRows = await statement(operation, () => tx.select().from(
    fxSystemDurableTaskDefinitionRevisionsV1,
  ).where(and(
    eq(fxSystemDurableTaskDefinitionRevisionsV1.scopeId, scopeId),
    eq(
      fxSystemDurableTaskDefinitionRevisionsV1.taskDefinitionRevisionId,
      taskDefinitionRevisionId,
    ),
  )).limit(1));
  const definition = definitionRows[0];
  if (definition === undefined) {
    throw rollback(corruption(operation, run.runId, "definition_invalid"));
  }
  const bindingObservedSha256 = await sha256(
    definition.bindingBytes,
    operation,
    run.runId,
  );
  const commitment = Result.getOrThrowWith(
    decodeTaskDefinitionRuntimeBindingCommitmentPreimageV1(
      definition.bindingBytes,
    ),
    () => rollback(corruption(operation, run.runId, "definition_invalid")),
  );
  if (
    definition.bindingCodecVersion !== 1
    || definition.bindingByteLength !== BigInt(definition.bindingBytes.byteLength)
    || !bytesEqual(definition.bindingSha256, bindingObservedSha256)
    || !definitionMatchesCommitment(definition, commitment)
  ) {
    throw rollback(corruption(operation, run.runId, "definition_invalid"));
  }
  const authorityObservedSha256 = await sha256(
    run.creationAuthorityBytes,
    operation,
    run.runId,
  );
  const creationAuthority = Result.getOrThrowWith(
    decodeTaskRunCreationAuthorityReceiptPreimageV1(
      run.creationAuthorityBytes,
    ),
    () => rollback(corruption(
      operation,
      run.runId,
      "creation_authority_invalid",
    )),
  );
  if (
    run.creationAuthorityCodecVersion !== 1
    || run.creationAuthorityByteLength
      !== BigInt(run.creationAuthorityBytes.byteLength)
    || !bytesEqual(run.creationAuthoritySha256, authorityObservedSha256)
    || creationAuthority.taskDefinitionRevisionId
      !== run.taskDefinitionRevisionId
    || creationAuthority.applicationRevisionId
      !== definition.applicationRevisionId
    || !bytesEqual(creationAuthority.candidateSha256, definition.candidateSha256)
    || !bytesEqual(
      creationAuthority.applicationRevisionTaskBindingSha256,
      definition.applicationRevisionTaskBindingSha256,
    )
  ) {
    throw rollback(corruption(
      operation,
      run.runId,
      "creation_authority_invalid",
    ));
  }
  const inputByteLength = Number(run.inputByteLength);
  if (!Number.isSafeInteger(inputByteLength)) {
    throw rollback(corruption(operation, run.runId, "input_invalid"));
  }
  const inputReference = Result.getOrThrowWith(
    decodeTaskInputReferenceV1({
      codec: run.inputCodec,
      store: run.inputStore,
      valueCodec: run.inputValueCodec,
      objectKey: run.inputObjectKey,
      byteLength: inputByteLength,
      sha256: new Uint8Array(run.inputSha256),
      retention: { kind: run.inputRetention },
    }),
    () => rollback(corruption(operation, run.runId, "input_invalid")),
  );
  return Object.freeze({
    generation: "legacy_definition_v1" as const,
    runtimeBindingCommitment: commitment,
    inputReference,
  });
}

type ImmutablePreparation =
  | Readonly<{
      readonly generation: "legacy_definition_v1";
      readonly runtimeBindingCommitment:
        TaskDefinitionRuntimeBindingCommitmentV1;
      readonly inputReference: TaskInputReferenceV1;
    }>
  | Readonly<{
      readonly generation: "application_v1";
      readonly runtimeTarget: ApplicationTaskRuntimeTargetV1;
      readonly manifest: CanonicalTaskManifestV1;
      readonly creationAuthority: ApplicationTaskRunCreationAuthorityV1;
      readonly inputReference: TaskInputReferenceV1;
      readonly principalReference: TaskExecutionPrincipalReferenceV1;
    }>;

async function loadApplicationImmutablePreparation(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  run: RunRow,
  persistedEffect: ReturnType<typeof decodeDispatchEffect>,
  operation: TaskComputeDeliveryRepositoryOperationV1,
): Promise<Extract<ImmutablePreparation, { readonly generation: "application_v1" }>> {
  if (run.taskDefinitionRevisionId !== null
    || run.applicationTaskRuntimeTargetSha256 === null
    || !("applicationTaskRuntimeTargetSha256" in persistedEffect.effect)
    || !bytesEqualFullScan(
      run.applicationTaskRuntimeTargetSha256,
      persistedEffect.effect.applicationTaskRuntimeTargetSha256,
    )) throw rollback(corruption(operation, run.runId, "definition_invalid"));
  const authorityObservedSha256 = await sha256(
    run.creationAuthorityBytes,
    operation,
    run.runId,
  );
  const creationAuthority = Result.getOrThrowWith(
    decodeApplicationTaskRunCreationAuthorityPreimageV1(
      run.creationAuthorityBytes,
    ),
    () => rollback(corruption(
      operation,
      run.runId,
      "creation_authority_invalid",
    )),
  );
  const targetBytes = Result.getOrThrowWith(
    encodeApplicationTaskRuntimeTargetPreimageV1(
      creationAuthority.runtimeTarget,
    ),
    () => rollback(corruption(operation, run.runId, "definition_invalid")),
  );
  const targetObservedSha256 = await sha256(targetBytes, operation, run.runId);
  if (run.creationAuthorityCodecVersion !== 1
    || run.creationAuthorityByteLength
      !== BigInt(run.creationAuthorityBytes.byteLength)
    || !bytesEqualFullScan(run.creationAuthoritySha256, authorityObservedSha256)
    || creationAuthority.scopeId !== scopeId
    || creationAuthority.runtimeTarget.scopeId !== scopeId
    || !bytesEqualFullScan(
      creationAuthority.applicationTaskRuntimeTargetSha256,
      targetObservedSha256,
    )
    || !bytesEqualFullScan(
      run.applicationTaskRuntimeTargetSha256,
      targetObservedSha256,
    )) throw rollback(corruption(
      operation,
      run.runId,
      "creation_authority_invalid",
    ));
  const target = creationAuthority.runtimeTarget;
  const sizes = await statement(operation, () => tx.select({
    catalogBindingByteLength: sql<string>`octet_length(${fxSystemApplicationTaskCatalogsV1.bindingBytes})::bigint::text`,
    manifestByteLength: sql<string>`octet_length(${fxSystemApplicationTaskDefinitionsV1.manifestBytes})::bigint::text`,
    definitionBindingByteLength: sql<string>`octet_length(${fxSystemApplicationTaskDefinitionsV1.bindingBytes})::bigint::text`,
  }).from(fxSystemApplicationTaskDefinitionsV1).innerJoin(
    fxSystemApplicationTaskCatalogsV1,
    and(
      eq(
        fxSystemApplicationTaskCatalogsV1.scopeId,
        fxSystemApplicationTaskDefinitionsV1.scopeId,
      ),
      eq(
        fxSystemApplicationTaskCatalogsV1.revisionId,
        fxSystemApplicationTaskDefinitionsV1.revisionId,
      ),
      eq(
        fxSystemApplicationTaskCatalogsV1.taskCatalogBindingSha256,
        fxSystemApplicationTaskDefinitionsV1.taskCatalogBindingSha256,
      ),
    ),
  ).where(and(
    eq(fxSystemApplicationTaskDefinitionsV1.scopeId, scopeId),
    eq(fxSystemApplicationTaskDefinitionsV1.revisionId, target.revisionId),
    eq(fxSystemApplicationTaskDefinitionsV1.taskId, target.taskId),
  )).limit(2));
  const size = sizes[0];
  if (sizes.length !== 1 || size === undefined
    || !isAdmittedApplicationPayloadSizes(size)) {
    throw rollback(corruption(operation, run.runId, "definition_invalid"));
  }
  const rows = await statement(operation, () => tx.select({
    catalog: fxSystemApplicationTaskCatalogsV1,
    definition: fxSystemApplicationTaskDefinitionsV1,
  }).from(fxSystemApplicationTaskDefinitionsV1).innerJoin(
    fxSystemApplicationTaskCatalogsV1,
    and(
      eq(
        fxSystemApplicationTaskCatalogsV1.scopeId,
        fxSystemApplicationTaskDefinitionsV1.scopeId,
      ),
      eq(
        fxSystemApplicationTaskCatalogsV1.revisionId,
        fxSystemApplicationTaskDefinitionsV1.revisionId,
      ),
      eq(
        fxSystemApplicationTaskCatalogsV1.taskCatalogBindingSha256,
        fxSystemApplicationTaskDefinitionsV1.taskCatalogBindingSha256,
      ),
    ),
  ).where(and(
    eq(fxSystemApplicationTaskDefinitionsV1.scopeId, scopeId),
    eq(fxSystemApplicationTaskDefinitionsV1.revisionId, target.revisionId),
    eq(fxSystemApplicationTaskDefinitionsV1.taskId, target.taskId),
  )).limit(2));
  const row = rows[0];
  if (rows.length !== 1 || row === undefined) {
    throw rollback(corruption(operation, run.runId, "definition_invalid"));
  }
  if (!applicationPayloadMatchesAdmittedSizes(size, row)) {
    throw rollback(corruption(operation, run.runId, "definition_invalid"));
  }
  const catalogBinding = Result.getOrThrowWith(
    decodeApplicationTaskCatalogBindingV1({
      version: 1,
      scopeId: row.catalog.scopeId,
      revisionId: row.catalog.revisionId,
      candidateId: row.catalog.candidateId,
      analysisId: row.catalog.analysisId,
      sourceArtifactRootSha256: encodeBytesToLowercaseHex(
        row.catalog.sourceArtifactRootSha256,
      ),
      publicationSha256: encodeBytesToLowercaseHex(
        row.catalog.publicationSha256,
      ),
      taskCatalogSha256: copyBytes(row.catalog.taskCatalogSha256),
      taskCount: row.catalog.taskCount,
      runtimeHostIdentity: row.catalog.runtimeHostIdentity,
      compatibilityDate: row.catalog.compatibilityDate,
    }),
    () => rollback(corruption(operation, run.runId, "definition_invalid")),
  );
  const catalogBindingBytes = Result.getOrThrowWith(
    encodeApplicationTaskCatalogBindingPreimageV1(catalogBinding),
    () => rollback(corruption(operation, run.runId, "definition_invalid")),
  );
  const catalogBindingSha256 = await sha256(
    catalogBindingBytes,
    operation,
    run.runId,
  );
  const binding = Result.getOrThrowWith(
    decodeApplicationTaskDefinitionBindingV1({
      version: 1,
      applicationTaskCatalogBindingSha256:
        copyBytes(row.definition.taskCatalogBindingSha256),
      taskId: row.definition.taskId,
      canonicalTaskManifestSha256:
        copyBytes(row.definition.canonicalTaskManifestSha256),
      handler: {
        logicalModulePath: row.definition.logicalModulePath,
        sourceModulePath: row.definition.sourceModulePath,
        exportName: row.definition.exportName,
      },
    }),
    () => rollback(corruption(operation, run.runId, "definition_invalid")),
  );
  const bindingBytes = Result.getOrThrowWith(
    encodeApplicationTaskDefinitionBindingPreimageV1(binding),
    () => rollback(corruption(operation, run.runId, "definition_invalid")),
  );
  const bindingSha256 = await sha256(bindingBytes, operation, run.runId);
  const manifest = Result.getOrThrowWith(
    decodeCanonicalTaskManifestPreimageV1(row.definition.manifestBytes),
    () => rollback(corruption(operation, run.runId, "definition_invalid")),
  );
  const manifestBytes = Result.getOrThrowWith(
    encodeCanonicalTaskManifestPreimageV1(manifest),
    () => rollback(corruption(operation, run.runId, "definition_invalid")),
  );
  const manifestSha256 = await sha256(manifestBytes, operation, run.runId);
  if (!applicationRowsMatchTarget(
    row.catalog,
    row.definition,
    target,
    catalogBinding,
    binding,
  )
    || !bytesEqualFullScan(catalogBindingBytes, row.catalog.bindingBytes)
    || !bytesEqualFullScan(
      catalogBindingSha256,
      row.catalog.taskCatalogBindingSha256,
    )
    || !bytesEqualFullScan(bindingBytes, row.definition.bindingBytes)
    || !bytesEqualFullScan(bindingSha256, row.definition.taskDefinitionBindingSha256)
    || !bytesEqualFullScan(manifestBytes, row.definition.manifestBytes)
    || !bytesEqualFullScan(manifestSha256, row.definition.canonicalTaskManifestSha256)
    || manifest.taskId !== target.taskId) {
    throw rollback(corruption(operation, run.runId, "definition_invalid"));
  }
  return Object.freeze({
    generation: "application_v1" as const,
    runtimeTarget: target,
    manifest,
    creationAuthority,
    inputReference: decodeInputReference(run, operation),
    principalReference: decodePrincipalReference(run, operation),
  });
}

function isAdmittedApplicationPayloadSizes(input: Readonly<{
  readonly catalogBindingByteLength: string;
  readonly definitionBindingByteLength: string;
  readonly manifestByteLength: string;
}>): boolean {
  const catalog = admittedApplicationPayloadSize(
    input.catalogBindingByteLength,
    MAX_APPLICATION_TASK_BINDING_CANONICAL_BYTES_V1,
  );
  const definition = admittedApplicationPayloadSize(
    input.definitionBindingByteLength,
    MAX_APPLICATION_TASK_BINDING_CANONICAL_BYTES_V1,
  );
  const manifest = admittedApplicationPayloadSize(
    input.manifestByteLength,
    MAX_TASK_DEFINITION_CANONICAL_BYTES_V1,
  );
  return catalog !== undefined
    && definition !== undefined
    && manifest !== undefined
    && catalog <= MAX_APPLICATION_TASK_BINDING_EVIDENCE_BYTES_V1 - definition
    && catalog + definition
      <= MAX_APPLICATION_TASK_BINDING_EVIDENCE_BYTES_V1 - manifest;
}

function admittedApplicationPayloadSize(
  input: string,
  maximum: number,
): number | undefined {
  if (!/^[1-9][0-9]*$/.test(input)) return undefined;
  const size = Number(input);
  return Number.isSafeInteger(size) && size <= maximum ? size : undefined;
}

function applicationPayloadMatchesAdmittedSizes(
  admitted: Readonly<{
    readonly catalogBindingByteLength: string;
    readonly definitionBindingByteLength: string;
    readonly manifestByteLength: string;
  }>,
  row: Readonly<{
    readonly catalog: ApplicationCatalogRow;
    readonly definition: ApplicationDefinitionRow;
  }>,
): boolean {
  const catalog = uint8ArrayByteLength(row.catalog.bindingBytes);
  const definition = uint8ArrayByteLength(row.definition.bindingBytes);
  const manifest = uint8ArrayByteLength(row.definition.manifestBytes);
  return catalog !== undefined
    && definition !== undefined
    && manifest !== undefined
    && BigInt(catalog) === BigInt(admitted.catalogBindingByteLength)
    && BigInt(definition) === BigInt(admitted.definitionBindingByteLength)
    && BigInt(manifest) === BigInt(admitted.manifestByteLength);
}

function applicationRowsMatchTarget(
  catalog: ApplicationCatalogRow,
  definition: ApplicationDefinitionRow,
  target: ApplicationTaskRuntimeTargetV1,
  catalogBinding: ApplicationTaskCatalogBindingV1,
  binding: ApplicationTaskDefinitionBindingV1,
): boolean {
  return catalog.scopeId === target.scopeId
    && catalog.revisionId === target.revisionId
    && catalog.candidateId === target.candidateId
    && catalog.analysisId === target.analysisId
    && encodeBytesToLowercaseHex(catalog.sourceArtifactRootSha256)
      === target.sourceArtifactRootSha256
    && encodeBytesToLowercaseHex(catalog.publicationSha256)
      === target.publicationSha256
    && bytesEqualFullScan(catalog.taskCatalogSha256, target.taskCatalogSha256)
    && bytesEqualFullScan(
      catalog.taskCatalogBindingSha256,
      target.applicationTaskCatalogBindingSha256,
    )
    && catalog.runtimeHostIdentity === target.runtimeHostIdentity
    && catalog.compatibilityDate === target.compatibilityDate
    && catalogBinding.scopeId === target.scopeId
    && catalogBinding.revisionId === target.revisionId
    && catalogBinding.taskCount === catalog.taskCount
    && definition.taskId === target.taskId
    && bytesEqualFullScan(
      definition.taskDefinitionBindingSha256,
      target.applicationTaskDefinitionBindingSha256,
    )
    && bytesEqualFullScan(
      definition.canonicalTaskManifestSha256,
      target.canonicalTaskManifestSha256,
    )
    && binding.handler.logicalModulePath === target.handler.logicalModulePath
    && binding.handler.sourceModulePath === target.handler.sourceModulePath
    && binding.handler.exportName === target.handler.exportName;
}

function decodeInputReference(
  run: RunRow,
  operation: TaskComputeDeliveryRepositoryOperationV1,
): TaskInputReferenceV1 {
  const inputByteLength = Number(run.inputByteLength);
  if (!Number.isSafeInteger(inputByteLength)) {
    throw rollback(corruption(operation, run.runId, "input_invalid"));
  }
  return Result.getOrThrowWith(decodeTaskInputReferenceV1({
    codec: run.inputCodec,
    store: run.inputStore,
    valueCodec: run.inputValueCodec,
    objectKey: run.inputObjectKey,
    byteLength: inputByteLength,
    sha256: new Uint8Array(run.inputSha256),
    retention: { kind: run.inputRetention },
  }), () => rollback(corruption(operation, run.runId, "input_invalid")));
}

function decodePrincipalReference(
  run: RunRow,
  operation: TaskComputeDeliveryRepositoryOperationV1,
): TaskExecutionPrincipalReferenceV1 {
  const byteLength = run.executionPrincipalByteLength === null
    ? Number.NaN
    : Number(run.executionPrincipalByteLength);
  if (
    run.executionPrincipalGeneration !== "present_v1"
    || run.executionPrincipalKind === null
    || run.executionPrincipalCodec === null
    || run.executionPrincipalStore === null
    || run.executionPrincipalValueCodec === null
    || run.executionPrincipalObjectKey === null
    || run.executionPrincipalSha256 === null
    || run.executionPrincipalRetention === null
    || !Number.isSafeInteger(byteLength)
  ) {
    throw rollback(corruption(operation, run.runId, "principal_invalid"));
  }
  return Result.getOrThrowWith(decodeTaskExecutionPrincipalReferenceV1({
    principalKind: run.executionPrincipalKind,
    codec: run.executionPrincipalCodec,
    store: run.executionPrincipalStore,
    valueCodec: run.executionPrincipalValueCodec,
    objectKey: run.executionPrincipalObjectKey,
    byteLength,
    sha256: new Uint8Array(run.executionPrincipalSha256),
    retention: { kind: run.executionPrincipalRetention },
  }), () => rollback(corruption(operation, run.runId, "principal_invalid")));
}

function definitionMatchesCommitment(
  row: DefinitionRow,
  commitment: TaskDefinitionRuntimeBindingCommitmentV1,
): boolean {
  return row.taskId === commitment.taskId
    && row.applicationRevisionId === commitment.applicationRevisionId
    && bytesEqual(row.candidateSha256, commitment.candidateSha256)
    && bytesEqual(
      row.applicationRevisionTaskBindingSha256,
      commitment.applicationRevisionTaskBindingSha256,
    )
    && bytesEqual(
      row.canonicalTaskManifestSha256,
      commitment.canonicalTaskManifestSha256,
    )
    && bytesEqual(
      row.taskRuntimeEntrySha256,
      commitment.taskRuntimeEntrySha256,
    )
    && bytesEqual(row.taskCatalogSha256, commitment.taskCatalogSha256)
    && bytesEqual(row.taskEntryRootSha256, commitment.taskEntryRootSha256)
    && bytesEqual(
      row.taskRuntimeProjectionSha256,
      commitment.taskRuntimeProjectionSha256,
    )
    && bytesEqual(
      row.taskRuntimeGroupManifestSha256,
      commitment.taskRuntimeGroupManifestSha256,
    )
    && bytesEqual(
      row.taskRuntimeMaterializationSpecSha256,
      commitment.taskRuntimeMaterializationSpecSha256,
    )
    && bytesEqual(row.packageSha256, commitment.packageSha256)
    && bytesEqual(row.artifactSha256, commitment.artifactSha256)
    && bytesEqual(row.sourceRootSha256, commitment.sourceRootSha256)
    && bytesEqual(row.semanticRootSha256, commitment.semanticRootSha256);
}

function buildDispatchRequest(
  scopeId: ReplacementScopeIdV1,
  aggregate: AggregateForDelivery,
  persistedEffect: ReturnType<typeof decodeDispatchEffect>,
  operation: TaskComputeDeliveryRepositoryOperationV1,
): CurrentTaskComputeDispatchRequestV1 {
  const effect = persistedEffect.effect;
  const common = {
    version: TASK_COMPUTE_DISPATCH_REQUEST_VERSION_V1,
    identity: {
      version: TASK_COMPUTE_DISPATCH_IDENTITY_VERSION_V1,
      scopeId,
      runId: effect.runId,
      requestedEffectSequence: persistedEffect.sequence,
      attemptId: effect.attempt.attemptId,
      executionFence: effect.attempt.executionFence,
    },
    attemptNumber: effect.attempt.attemptNumber,
    leaseVersion: effect.leaseVersion,
    computeProfile: effect.computeProfile,
    cancellation: aggregate.cancellation.kind === "not_requested"
      ? { kind: "not_requested" as const, generation: aggregate.cancellation.generation }
      : { kind: "requested" as const, generation: aggregate.cancellation.generation },
    maximumDurationMs: aggregate.boundPolicy.maximumDurationMs,
  };
  return "taskDefinitionRevisionId" in effect
    ? Result.getOrThrowWith(validateTaskComputeDispatchRequestV1({
        ...common,
        taskDefinitionRevisionId: effect.taskDefinitionRevisionId,
      }), () => rollback(corruption(
        operation,
        aggregate.runId,
        "effect_invalid",
      )))
    : Result.getOrThrowWith(validateApplicationTaskComputeDispatchRequestV1({
        ...common,
        applicationTaskRuntimeTargetSha256:
          effect.applicationTaskRuntimeTargetSha256,
      }), () => rollback(corruption(
        operation,
        aggregate.runId,
        "effect_invalid",
      )));
}

function buildCancellationRequest(
  cancellation: ReturnType<typeof decodeCancellationEffect>,
  acceptance: TaskComputeDispatchAcceptanceV1,
  operation: TaskComputeDeliveryRepositoryOperationV1,
): TaskComputeCancellationRequestV1 {
  return Result.getOrThrowWith(
    validateTaskComputeCancellationRequestV1({
      version: TASK_COMPUTE_CANCELLATION_REQUEST_VERSION_V1,
      identity: acceptance.identity,
      execution: acceptance.execution,
      cancellationGeneration: cancellation.effect.cancellationGeneration,
    }),
    () => rollback(corruption(
      operation,
      cancellation.effect.runId,
      "effect_invalid",
    )),
  );
}

function capturePreparedExecution(
  dispatchRequest: CurrentTaskComputeDispatchRequestV1,
  immutable: ImmutablePreparation,
): CurrentTaskComputePreparedExecutionV1 {
  if (immutable.generation === "legacy_definition_v1"
    && dispatchRequest.taskDefinitionRevisionId !== undefined) {
    return Object.freeze({
      version: TASK_COMPUTE_PREPARED_EXECUTION_VERSION_V1,
      dispatchRequest,
      runtimeBindingCommitment: immutable.runtimeBindingCommitment,
      inputReference: immutable.inputReference,
    });
  }
  if (immutable.generation === "application_v1"
    && dispatchRequest.applicationTaskRuntimeTargetSha256 !== undefined) {
    return Object.freeze({
      version: TASK_COMPUTE_PREPARED_EXECUTION_VERSION_V1,
      generation: "application_v1" as const,
      dispatchRequest,
      runtimeTarget: immutable.runtimeTarget,
      manifest: immutable.manifest,
      creationAuthority: immutable.creationAuthority,
      inputReference: immutable.inputReference,
      principalReference: immutable.principalReference,
    });
  }
  throw new TypeError("Task compute preparation generation mismatch.");
}

function dispatchLifecycleIsCurrent(
  aggregate: AggregateForDelivery,
  persistedEffect: ReturnType<typeof decodeDispatchEffect>,
): boolean {
  if (
    aggregate.phase !== "attempt_granted"
    && aggregate.phase !== "executing"
  ) return false;
  const effect = persistedEffect.effect;
  return aggregate.currentAttempt.attemptId === effect.attempt.attemptId
    && aggregate.currentAttempt.attemptNumber === effect.attempt.attemptNumber
    && aggregate.currentAttempt.executionFence === effect.attempt.executionFence
    && aggregate.currentAttempt.lease.version === effect.leaseVersion;
}

function cancellationLifecycleIsCurrent(
  aggregate: AggregateForDelivery,
  cancellation: ReturnType<typeof decodeCancellationEffect>,
): boolean {
  if (
    aggregate.phase !== "attempt_granted"
    && aggregate.phase !== "executing"
  ) return false;
  return aggregate.currentAttempt.attemptId === cancellation.effect.attemptId
    && aggregate.currentAttempt.executionFence
      === cancellation.effect.executionFence
    && aggregate.cancellation.kind === "requested"
    && aggregate.cancellation.generation
      === cancellation.effect.cancellationGeneration;
}

async function loadDispatchCheckpoint(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  request: CapturedAcquireRequestV1,
  operation: TaskComputeDeliveryRepositoryOperationV1,
): Promise<DispatchRow | null> {
  const rows = await statement(operation, () => tx.select().from(
    fxSystemDurableTaskComputeDispatchesV1,
  ).where(dispatchPrimaryKey(scopeId, request)).limit(1).for("update"));
  return rows[0] ?? null;
}

async function loadCancellationCheckpoint(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  request: CapturedAcquireRequestV1,
  operation: TaskComputeDeliveryRepositoryOperationV1,
): Promise<CancellationRow | null> {
  const rows = await statement(operation, () => tx.select().from(
    fxSystemDurableTaskComputeCancellationsV1,
  ).where(cancellationPrimaryKey(scopeId, request)).limit(1).for("update"));
  return rows[0] ?? null;
}

async function decodeAndCorrelateCancellationCheckpoint(
  row: CancellationRow,
  cancellation: ReturnType<typeof decodeCancellationEffect>,
  dispatchRequestedEffectSequence: TaskRequestedEffectSequenceV1,
  expectedRequest: TaskComputeCancellationRequestV1 | null,
  operation: TaskComputeDeliveryRepositoryOperationV1,
  runId: TaskRunIdV1,
): Promise<TaskComputeCancellationRequestV1 | null> {
  if (
    row.scopeId !== expectedRequest?.identity.scopeId
      && expectedRequest !== null
    || row.runId !== cancellation.effect.runId
    || row.requestedEffectSequence !== cancellation.sequence
    || row.acceptedRunVersion !== cancellation.effect.acceptedRunVersion
    || row.dispatchRequestedEffectSequence !== dispatchRequestedEffectSequence
    || row.attemptId !== cancellation.effect.attemptId
    || row.executionFence !== cancellation.effect.executionFence
    || row.cancellationGeneration
      !== cancellation.effect.cancellationGeneration
  ) throw rollback(corruption(operation, runId, "checkpoint_invalid"));
  validateCancellationCheckpointState(row, operation, runId);
  const hasNoRequest = row.requestCodecVersion === null
    && row.requestByteLength === null
    && row.requestSha256 === null
    && row.requestBytes === null;
  if (hasNoRequest) {
    if (
      row.deliveryState !== "waiting_dispatch"
      && row.deliveryState !== "obsolete"
      && row.deliveryState !== "quarantined"
    ) throw rollback(corruption(operation, runId, "checkpoint_invalid"));
    return null;
  }
  if (
    row.requestCodecVersion !== TASK_COMPUTE_DELIVERY_EVIDENCE_CODEC_V1
    || row.requestByteLength === null
    || row.requestSha256 === null
    || row.requestBytes === null
    || row.requestByteLength !== BigInt(row.requestBytes.byteLength)
  ) throw rollback(corruption(operation, runId, "checkpoint_invalid"));
  const observed = await sha256(row.requestBytes, operation, runId);
  const decoded = Result.getOrThrowWith(
    decodeTaskComputeCancellationRequestEvidenceWithObservedSha256V1({
      codecVersion: row.requestCodecVersion,
      byteLength: Number(row.requestByteLength),
      canonicalBytes: row.requestBytes,
      sha256: row.requestSha256,
    }, observed),
    (error) => rollback(error),
  );
  if (
    expectedRequest === null
    || !taskSystemPersistedValueEqualV1(decoded, expectedRequest)
    || decoded.cancellationGeneration !== row.cancellationGeneration
  ) throw rollback(corruption(operation, runId, "checkpoint_invalid"));
  return decoded;
}

function validateCancellationCheckpointState(
  row: CancellationRow,
  operation: TaskComputeDeliveryRepositoryOperationV1,
  runId: TaskRunIdV1,
): void {
  const claimedAt = nullableOwnedDate(row.claimedAt, operation, runId);
  const claimExpiresAt = nullableOwnedDate(row.claimExpiresAt, operation, runId);
  if (
    row.claimFence < 0n
    || row.deliveryAttemptCount < 0n
    || (
      row.claimOwner === null
        ? claimedAt !== null || claimExpiresAt !== null
        : !isCanonicalUuidV4(row.claimOwner)
          || claimedAt === null
          || claimExpiresAt === null
          || claimExpiresAt.getTime() <= claimedAt.getTime()
    )
  ) throw rollback(corruption(operation, runId, "checkpoint_invalid"));
}

async function decodeAndCorrelateDispatchCheckpoint(
  row: DispatchRow,
  expected: CurrentTaskComputeDispatchRequestV1,
  expectedAcceptedRunVersion: bigint,
  operation: TaskComputeDeliveryRepositoryOperationV1,
  runId: TaskRunIdV1,
): Promise<CurrentTaskComputeDispatchRequestV1> {
  if (
    !(
      (row.definitionGeneration === "legacy_definition_v1"
        && row.taskDefinitionRevisionId !== null
        && row.applicationTaskRuntimeTargetSha256 === null
        && "taskDefinitionRevisionId" in expected)
      || (row.definitionGeneration === "application_v1"
        && row.taskDefinitionRevisionId === null
        && row.applicationTaskRuntimeTargetSha256 !== null
        && "applicationTaskRuntimeTargetSha256" in expected)
    )
    || row.requestCodecVersion !== TASK_COMPUTE_DELIVERY_EVIDENCE_CODEC_V1
    || row.requestByteLength !== BigInt(row.requestBytes.byteLength)
    || row.requestSha256.byteLength !== 32
    || row.computeProfileCodecVersion !== TASK_COMPUTE_PROFILE_STORAGE_CODEC_V1
    || row.computeProfileByteLength !== row.computeProfileBytes.byteLength
  ) {
    throw rollback(corruption(operation, runId, "checkpoint_invalid"));
  }
  const observedSha256 = await sha256(row.requestBytes, operation, runId);
  const decoded = Result.getOrThrowWith(
    decodeCurrentTaskComputeDispatchRequestEvidenceWithObservedSha256V1({
      codecVersion: row.requestCodecVersion,
      byteLength: Number(row.requestByteLength),
      canonicalBytes: row.requestBytes,
      sha256: row.requestSha256,
    }, observedSha256, row.definitionGeneration),
    (error) => rollback(error),
  );
  const computeProfile = Result.getOrThrowWith(
    decodeTaskComputeProfileStorageBytesV1(row.computeProfileBytes),
    () => rollback(corruption(operation, runId, "checkpoint_invalid")),
  );
  if (
    row.scopeId !== decoded.identity.scopeId
    || row.runId !== decoded.identity.runId
    || row.requestedEffectSequence
      !== decoded.identity.requestedEffectSequence
    || row.acceptedRunVersion !== expectedAcceptedRunVersion
    || !("taskDefinitionRevisionId" in decoded
      ? row.taskDefinitionRevisionId === decoded.taskDefinitionRevisionId
      : row.applicationTaskRuntimeTargetSha256 !== null
        && bytesEqualFullScan(
          row.applicationTaskRuntimeTargetSha256,
          decoded.applicationTaskRuntimeTargetSha256,
        ))
    || row.attemptId !== decoded.identity.attemptId
    || row.attemptNumber !== decoded.attemptNumber
    || row.executionFence !== decoded.identity.executionFence
    || row.leaseVersion !== decoded.leaseVersion
    || computeProfile !== decoded.computeProfile
    || row.cancellationKind !== decoded.cancellation.kind
    || row.cancellationGeneration !== decoded.cancellation.generation
    || row.maximumDurationMs !== decoded.maximumDurationMs
    || decoded.identity.scopeId !== expected.identity.scopeId
    || decoded.identity.runId !== expected.identity.runId
    || decoded.identity.requestedEffectSequence
      !== expected.identity.requestedEffectSequence
    || decoded.identity.attemptId !== expected.identity.attemptId
    || decoded.identity.executionFence !== expected.identity.executionFence
    || !("taskDefinitionRevisionId" in decoded
      && "taskDefinitionRevisionId" in expected
      ? decoded.taskDefinitionRevisionId === expected.taskDefinitionRevisionId
      : "applicationTaskRuntimeTargetSha256" in decoded
        && "applicationTaskRuntimeTargetSha256" in expected
        && bytesEqualFullScan(
          decoded.applicationTaskRuntimeTargetSha256,
          expected.applicationTaskRuntimeTargetSha256,
        ))
    || decoded.attemptNumber !== expected.attemptNumber
    || decoded.leaseVersion !== expected.leaseVersion
    || decoded.computeProfile !== expected.computeProfile
    || decoded.maximumDurationMs !== expected.maximumDurationMs
    || (
      decoded.cancellation.kind === "requested"
      && (
        expected.cancellation.kind === "not_requested"
        || decoded.cancellation.generation > expected.cancellation.generation
      )
    )
  ) {
    throw rollback(corruption(operation, runId, "checkpoint_invalid"));
  }
  validateCheckpointState(row, operation, runId);
  return decoded;
}

function validateCheckpointState(
  row: DispatchRow,
  operation: TaskComputeDeliveryRepositoryOperationV1,
  runId: TaskRunIdV1,
): void {
  const claimedAt = nullableOwnedDate(row.claimedAt, operation, runId);
  const claimExpiresAt = nullableOwnedDate(row.claimExpiresAt, operation, runId);
  if (
    row.claimFence < 0n
    || row.deliveryAttemptCount < 0n
    || (
      row.claimOwner === null
        ? claimedAt !== null || claimExpiresAt !== null
        : !isCanonicalUuidV4(row.claimOwner)
          || claimedAt === null
          || claimExpiresAt === null
          || claimExpiresAt.getTime() <= claimedAt.getTime()
    )
  ) {
    throw rollback(corruption(operation, runId, "checkpoint_invalid"));
  }
}

async function decodeStoredAcceptance(
  row: DispatchRow,
  operation: TaskComputeDeliveryRepositoryOperationV1,
  runId: TaskRunIdV1,
): Promise<TaskComputeDispatchAcceptanceV1> {
  if (
    row.acceptanceCodecVersion !== TASK_COMPUTE_DELIVERY_EVIDENCE_CODEC_V1
    || row.acceptanceByteLength === null
    || row.acceptanceSha256 === null
    || row.acceptanceBytes === null
    || row.acceptanceByteLength !== BigInt(row.acceptanceBytes.byteLength)
  ) {
    throw rollback(corruption(operation, runId, "checkpoint_invalid"));
  }
  const observed = await sha256(row.acceptanceBytes, operation, runId);
  return Result.getOrThrowWith(
    decodeTaskComputeDispatchAcceptanceEvidenceWithObservedSha256V1({
      codecVersion: row.acceptanceCodecVersion,
      byteLength: Number(row.acceptanceByteLength),
      canonicalBytes: row.acceptanceBytes,
      sha256: row.acceptanceSha256,
    }, observed),
    (error) => rollback(error),
  );
}

async function encodeCancellationRequestEvidence(
  request: TaskComputeCancellationRequestV1,
  operation: "acquire_cancellation",
  runId: TaskRunIdV1,
): Promise<TaskComputeDeliveryEvidenceV1> {
  const canonicalBytes = Result.getOrThrowWith(
    encodeTaskComputeCancellationRequestCanonicalBytesV1(request),
    (error) => rollback(error),
  );
  const observed = await sha256(canonicalBytes, operation, runId);
  return Result.getOrThrowWith(
    encodeTaskComputeCancellationRequestEvidenceWithObservedSha256V1(
      request,
      observed,
    ),
    (error) => rollback(error),
  );
}

async function encodeCancellationReceiptEvidence(
  receipt: TaskComputeCancellationReceiptV1,
  operation: "record_cancellation_receipt",
  runId: TaskRunIdV1,
): Promise<TaskComputeDeliveryEvidenceV1> {
  const canonicalBytes = Result.getOrThrowWith(
    encodeTaskComputeCancellationReceiptCanonicalBytesV1(receipt),
    (error) => rollback(error),
  );
  const observed = await sha256(canonicalBytes, operation, runId);
  return Result.getOrThrowWith(
    encodeTaskComputeCancellationReceiptEvidenceWithObservedSha256V1(
      receipt,
      observed,
    ),
    (error) => rollback(error),
  );
}

async function decodeStoredCancellationReceipt(
  row: CancellationRow,
  operation: TaskComputeDeliveryRepositoryOperationV1,
  runId: TaskRunIdV1,
): Promise<TaskComputeCancellationReceiptV1> {
  if (
    row.receiptCodecVersion !== TASK_COMPUTE_DELIVERY_EVIDENCE_CODEC_V1
    || row.receiptByteLength === null
    || row.receiptSha256 === null
    || row.receiptBytes === null
    || row.receiptByteLength !== BigInt(row.receiptBytes.byteLength)
  ) throw rollback(corruption(operation, runId, "checkpoint_invalid"));
  const observed = await sha256(row.receiptBytes, operation, runId);
  return Result.getOrThrowWith(
    decodeTaskComputeCancellationReceiptEvidenceWithObservedSha256V1({
      codecVersion: row.receiptCodecVersion,
      byteLength: Number(row.receiptByteLength),
      canonicalBytes: row.receiptBytes,
      sha256: row.receiptSha256,
    }, observed),
    (error) => rollback(error),
  );
}

function cancellationReceiptMatchesRequest(
  receipt: TaskComputeCancellationReceiptV1,
  request: TaskComputeCancellationRequestV1,
): boolean {
  return taskSystemPersistedValueEqualV1(receipt.identity, request.identity)
    && taskSystemPersistedValueEqualV1(receipt.execution, request.execution)
    && receipt.cancellationGeneration === request.cancellationGeneration;
}

async function readDatabaseTime(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  claimDurationMilliseconds: number,
  operation: TaskComputeDeliveryRepositoryOperationV1,
  runId: TaskRunIdV1,
): Promise<Readonly<{ readonly now: Date; readonly claimExpiresAt: Date }>> {
  const rows = await statement(operation, () => tx.select({
    milliseconds: sql<string>`
      floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
    `,
  }).from(fxSystemScopeClocks).where(
    eq(fxSystemScopeClocks.scopeId, scopeId),
  ).limit(1));
  const row = rows[0];
  if (
    row === undefined
    || !/^(0|[1-9][0-9]*)$/.test(row.milliseconds)
  ) {
    throw rollback(corruption(operation, runId, "database_clock_invalid"));
  }
  const nowMilliseconds = Number(row.milliseconds);
  const claimExpiresAtMilliseconds =
    nowMilliseconds + claimDurationMilliseconds;
  const now = Number.isSafeInteger(nowMilliseconds)
    ? copyFiniteDate(new Date(nowMilliseconds))
    : undefined;
  const claimExpiresAt = Number.isSafeInteger(claimExpiresAtMilliseconds)
    ? copyFiniteDate(new Date(claimExpiresAtMilliseconds))
    : undefined;
  if (
    now === undefined
    || claimExpiresAt === undefined
    || claimExpiresAt.getTime() <= now.getTime()
  ) {
    throw rollback(corruption(operation, runId, "database_clock_invalid"));
  }
  return Object.freeze({ now, claimExpiresAt });
}

function claimedTransactionResult(
  row: DispatchRow,
  prepared: CurrentTaskComputePreparedExecutionV1,
  deliveryMode: TaskComputeDeliveryModeV1,
  claimOwner: string,
  claimExpiresAt: Date,
  operation: "acquire_dispatch",
): TransactionClaimedV1 {
  if (
    row.claimOwner !== claimOwner
    || row.claimFence < 1n
    || row.claimExpiresAt === null
    || row.claimExpiresAt.getTime() !== claimExpiresAt.getTime()
  ) {
    throw rollback(corruption(operation, row.runId, "checkpoint_invalid"));
  }
  return Object.freeze({
    kind: "claimed",
    prepared,
    deliveryMode,
    claimOwner,
    claimFence: row.claimFence,
    claimExpiresAt: ownedDate(claimExpiresAt, operation, row.runId),
  });
}

function claimedCancellationTransactionResult(
  row: CancellationRow,
  request: TaskComputeCancellationRequestV1,
  deliveryMode: TaskComputeDeliveryModeV1,
  claimOwner: string,
  claimExpiresAt: Date,
  operation: "acquire_cancellation",
): TransactionCancellationClaimedV1 {
  if (
    row.claimOwner !== claimOwner
    || row.claimFence < 1n
    || row.claimExpiresAt === null
    || row.claimExpiresAt.getTime() !== claimExpiresAt.getTime()
  ) throw rollback(corruption(operation, row.runId, "checkpoint_invalid"));
  return Object.freeze({
    kind: "claimed",
    request,
    deliveryMode,
    claimOwner,
    claimFence: row.claimFence,
    claimExpiresAt: ownedDate(claimExpiresAt, operation, row.runId),
    requestedEffectSequence: row.requestedEffectSequence,
  });
}

function mintClaim(
  handles: WeakMap<object, MutableHandleStateV1>,
  transaction: TransactionClaimedV1,
): Extract<TaskComputeDispatchAcquireResultV1, { readonly kind: "claimed" }> {
  const handle = Object.freeze({
    [TASK_COMPUTE_DISPATCH_CLAIM_HANDLE_V1]: true as const,
  });
  handles.set(handle, {
    operation: "dispatch",
    runId: transaction.prepared.dispatchRequest.identity.runId,
    requestedEffectSequence:
      transaction.prepared.dispatchRequest.identity.requestedEffectSequence,
    claimOwner: transaction.claimOwner,
    claimFence: transaction.claimFence,
    deliveryMode: transaction.deliveryMode,
    recoveryVerified: transaction.deliveryMode !== "uncertain_replay",
    phase: "claimed",
    closed: false,
    operationGate: Semaphore.makeUnsafe(1),
  });
  return Object.freeze({
    kind: "claimed",
    prepared: transaction.prepared,
    handle,
    deliveryMode: transaction.deliveryMode,
    claimExpiresAt: new Date(transaction.claimExpiresAt),
  });
}

function mintCancellationClaim(
  handles: WeakMap<object, MutableHandleStateV1>,
  transaction: TransactionCancellationClaimedV1,
): Extract<TaskComputeCancellationAcquireResultV1, { readonly kind: "claimed" }> {
  const handle = Object.freeze({
    [TASK_COMPUTE_CANCELLATION_CLAIM_HANDLE_V1]: true as const,
  });
  handles.set(handle, {
    operation: "cancellation",
    runId: transaction.request.identity.runId,
    requestedEffectSequence: transaction.requestedEffectSequence,
    claimOwner: transaction.claimOwner,
    claimFence: transaction.claimFence,
    deliveryMode: transaction.deliveryMode,
    recoveryVerified: transaction.deliveryMode !== "uncertain_replay",
    phase: "claimed",
    closed: false,
    operationGate: Semaphore.makeUnsafe(1),
  });
  return Object.freeze({
    kind: "claimed",
    request: transaction.request,
    handle,
    deliveryMode: transaction.deliveryMode,
    claimExpiresAt: new Date(transaction.claimExpiresAt),
  });
}

function captureAcquireOutcome(
  result: Exclude<TransactionAcquireResultV1, TransactionClaimedV1>,
): Exclude<TaskComputeDispatchAcquireResultV1, { readonly kind: "claimed" }> {
  switch (result.kind) {
    case "busy":
      return Object.freeze({
        kind: "busy",
        claimExpiresAt: new Date(result.claimExpiresAt),
      });
    case "not_due":
      return Object.freeze({
        kind: "not_due",
        nextAttemptAt: new Date(result.nextAttemptAt),
      });
    case "accepted":
      return Object.freeze({
        kind: "accepted",
        acceptance: result.acceptance,
        disposition: result.disposition,
      });
    case "closed":
      return Object.freeze({ ...result });
  }
}

function captureCancellationAcquireOutcome(
  result: Exclude<
    TransactionCancellationAcquireResultV1,
    TransactionCancellationClaimedV1
  >,
): Exclude<TaskComputeCancellationAcquireResultV1, { readonly kind: "claimed" }> {
  switch (result.kind) {
    case "waiting_dispatch":
      return Object.freeze({ kind: "waiting_dispatch" });
    case "busy":
      return Object.freeze({
        kind: "busy",
        claimExpiresAt: new Date(result.claimExpiresAt),
      });
    case "not_due":
      return Object.freeze({
        kind: "not_due",
        nextAttemptAt: new Date(result.nextAttemptAt),
      });
    case "delivered":
      return Object.freeze({
        kind: "delivered",
        receipt: result.receipt,
        disposition: result.disposition,
      });
    case "closed":
      return Object.freeze({ ...result });
  }
}

async function settleLifecycleObsoleteCancellationCheckpoint(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  request: CapturedAcquireRequestV1,
  checkpoint: CancellationRow,
  settledAt: Date,
  operation: "acquire_cancellation",
): Promise<Extract<
  TaskComputeCancellationAcquireResultV1,
  { readonly kind: "closed" }
>> {
  const deliveryState = checkpoint.deliveryAttemptCount === 0n
    ? "obsolete" as const
    : "rejected" as const;
  const settled = await statement(operation, () => tx.update(
    fxSystemDurableTaskComputeCancellationsV1,
  ).set({
    deliveryState,
    claimOwner: null,
    claimedAt: null,
    claimExpiresAt: null,
    nextAttemptAt: null,
    reasonCode: "lifecycle_obsolete",
    settledAt,
    updatedAt: settledAt,
  }).where(cancellationPrimaryKey(scopeId, request)).returning());
  const row = settled[0];
  if (row === undefined) {
    throw rollback(corruption(operation, request.runId, "checkpoint_invalid"));
  }
  return cancellationClosedResult(row, operation, request.runId);
}

function lifecycleObsoleteCancellationResult(): Extract<
  TaskComputeCancellationAcquireResultV1,
  { readonly kind: "closed" }
> {
  return Object.freeze({
    kind: "closed",
    state: "obsolete",
    reason: "lifecycle_obsolete",
  });
}

function closedResult(
  row: DispatchRow,
  operation: "acquire_dispatch",
  runId: TaskRunIdV1,
): Extract<TaskComputeDispatchAcquireResultV1, { readonly kind: "closed" }> {
  const state = row.deliveryState;
  const reason = row.reasonCode;
  if (
    (state !== "rejected" && state !== "obsolete" && state !== "quarantined")
    || !isDispatchClosedReason(reason)
  ) {
    throw rollback(corruption(operation, runId, "checkpoint_invalid"));
  }
  return Object.freeze({ kind: "closed", state, reason });
}

function cancellationClosedResult(
  row: CancellationRow,
  operation: "acquire_cancellation",
  runId: TaskRunIdV1,
): Extract<TaskComputeCancellationAcquireResultV1, { readonly kind: "closed" }> {
  const state = row.deliveryState;
  const reason = row.reasonCode;
  if (
    (state !== "rejected" && state !== "obsolete" && state !== "quarantined")
    || !isCancellationClosedReason(reason)
  ) throw rollback(corruption(operation, runId, "checkpoint_invalid"));
  return Object.freeze({ kind: "closed", state, reason });
}

function isDispatchClosedReason(
  value: unknown,
): value is TaskComputeDispatchClosedReasonV1 {
  return value === "lifecycle_obsolete"
    || value === "checkpoint_corrupt"
    || value === "provider_unsupported_compute_profile"
    || value === "provider_capacity_unavailable"
    || value === "provider_disabled"
    || value === "provider_transport"
    || value === "delivery_attempts_exhausted";
}

function isCancellationClosedReason(
  value: unknown,
): value is TaskComputeCancellationClosedReasonV1 {
  return value === "lifecycle_obsolete"
    || value === "checkpoint_corrupt"
    || value === "provider_disabled"
    || value === "provider_execution_not_found"
    || value === "provider_execution_mismatch"
    || value === "provider_stale_generation"
    || value === "provider_transport"
    || value === "delivery_attempts_exhausted";
}

function dispatchPrimaryKey(
  scopeId: ScopeId,
  request: CapturedAcquireRequestV1,
) {
  return and(
    eq(fxSystemDurableTaskComputeDispatchesV1.scopeId, scopeId),
    eq(fxSystemDurableTaskComputeDispatchesV1.runId, request.runId),
    eq(
      fxSystemDurableTaskComputeDispatchesV1.requestedEffectSequence,
      request.requestedEffectSequence,
    ),
  );
}

function dispatchClaimKey(
  scopeId: ScopeId,
  state: MutableHandleStateV1,
) {
  return and(
    eq(fxSystemDurableTaskComputeDispatchesV1.scopeId, scopeId),
    eq(fxSystemDurableTaskComputeDispatchesV1.runId, state.runId),
    eq(
      fxSystemDurableTaskComputeDispatchesV1.requestedEffectSequence,
      state.requestedEffectSequence,
    ),
    eq(fxSystemDurableTaskComputeDispatchesV1.claimOwner, state.claimOwner),
    eq(fxSystemDurableTaskComputeDispatchesV1.claimFence, state.claimFence),
  );
}

function cancellationPrimaryKey(
  scopeId: ScopeId,
  request: CapturedAcquireRequestV1,
) {
  return and(
    eq(fxSystemDurableTaskComputeCancellationsV1.scopeId, scopeId),
    eq(fxSystemDurableTaskComputeCancellationsV1.runId, request.runId),
    eq(
      fxSystemDurableTaskComputeCancellationsV1.requestedEffectSequence,
      request.requestedEffectSequence,
    ),
  );
}

function cancellationClaimKey(
  scopeId: ScopeId,
  state: MutableHandleStateV1,
) {
  return and(
    eq(fxSystemDurableTaskComputeCancellationsV1.scopeId, scopeId),
    eq(fxSystemDurableTaskComputeCancellationsV1.runId, state.runId),
    eq(
      fxSystemDurableTaskComputeCancellationsV1.requestedEffectSequence,
      state.requestedEffectSequence,
    ),
    eq(fxSystemDurableTaskComputeCancellationsV1.claimOwner, state.claimOwner),
    eq(fxSystemDurableTaskComputeCancellationsV1.claimFence, state.claimFence),
  );
}

const withHandleOperation = Effect.fn(function* <
  Value,
  Failure,
  Requirements,
  Operation extends TaskComputeDeliveryRepositoryHandleOperationV1,
>(
  handles: WeakMap<object, MutableHandleStateV1>,
  handle:
    | TaskComputeDispatchClaimHandleV1
    | TaskComputeCancellationClaimHandleV1,
  operation: Operation,
  use: (
    state: MutableHandleStateV1,
  ) => Effect.Effect<Value, Failure, Requirements>,
) {
  const preliminaryState = yield* lookupHandleState(
    handles,
    handle,
    operation,
  );
  return yield* preliminaryState.operationGate.withPermit(
    Effect.gen(function* () {
      const currentState = yield* lookupHandleState(
        handles,
        handle,
        operation,
      );
      return yield* use(currentState);
    }),
  );
});

function lookupHandleState<
  Operation extends TaskComputeDeliveryRepositoryHandleOperationV1,
>(
  handles: WeakMap<object, MutableHandleStateV1>,
  handle:
    | TaskComputeDispatchClaimHandleV1
    | TaskComputeCancellationClaimHandleV1,
  operation: Operation,
): Effect.Effect<
  MutableHandleStateV1,
  TaskComputeDeliveryRepositoryInputV1Error<Operation>
> {
  const state = typeof handle === "object" && handle !== null
    ? handles.get(handle)
    : undefined;
  if (state === undefined) {
    return Effect.fail(new TaskComputeDeliveryRepositoryInputV1Error({
      operation,
      reason: "invalid_handle",
    }));
  }
  if (state.closed) {
    return Effect.fail(new TaskComputeDeliveryRepositoryInputV1Error({
      operation,
      reason: "closed_handle",
    }));
  }
  return Effect.succeed(state);
}

const runClaimOperation = Effect.fn(function* <
  Value,
  Operation extends TaskComputeDeliveryRepositoryHandleOperationV1,
>(
  state: MutableHandleStateV1,
  operation: Operation,
  transactionFactory: () => Promise<Value>,
) {
  let transactionDispatched = false;
  return yield* Effect.gen(function* () {
    for (let execution = 1; execution <= 2; execution += 1) {
      transactionDispatched = true;
      const settled = yield* Effect.exit(
        awaitSettlement(transactionFactory()),
      );
      if (Exit.isSuccess(settled)) return settled.value;
      const failure = Cause.findError(settled.cause);
      if (Result.isFailure(failure)) {
        return yield* Effect.failCause(failure.failure);
      }
      const classified = classifyTransactionFailure(
        operation,
        failure.success,
        execution,
      );
      if (classified.kind === "retry") continue;
      if (classified.kind === "failure") return yield* classified.error;
      return yield* Effect.die(classified.cause);
    }
    return yield* new TaskComputeDeliveryRepositoryConfirmedRollbackV1Error({
      operation,
      cause: new LocatedReadCommittedTransactionFailureV1(Object.freeze({
        kind: "callbackRolledBack",
        callbackCause: "retry_exhausted",
      })),
    });
  }).pipe(
    Effect.onExit((exit) =>
      Exit.isFailure(exit) && transactionDispatched
        ? Effect.sync(() => closeHandle(state))
        : Effect.void
    ),
  );
});

function closeHandle(state: MutableHandleStateV1): void {
  state.closed = true;
}

function staleClaim<
  Operation extends TaskComputeDeliveryRepositoryHandleOperationV1,
>(
  operation: Operation,
  runId: TaskRunIdV1,
  reason: TaskComputeDeliveryRepositoryStaleClaimV1Error<Operation>["reason"],
): TaskComputeDeliveryRepositoryStaleClaimV1Error<Operation> {
  return new TaskComputeDeliveryRepositoryStaleClaimV1Error<Operation>({
    operation,
    runId,
    reason,
  });
}

class RepositoryRollbackV1 {
  constructor(readonly error: TaskComputeDeliveryRepositoryBroadErrorV1) {}
}

class RepositoryStatementFailureV1 {
  constructor(readonly cause: unknown) {}
}

function rollback(
  error: TaskComputeDeliveryRepositoryBroadErrorV1,
): RepositoryRollbackV1 {
  return new RepositoryRollbackV1(error);
}

async function statement<Value>(
  _operation: TaskComputeDeliveryRepositoryOperationV1,
  run: () => Promise<Value>,
): Promise<Value> {
  try {
    return await run();
  } catch (cause) {
    if (cause instanceof RepositoryRollbackV1) throw cause;
    throw new RepositoryStatementFailureV1(cause);
  }
}

function awaitSettlement<Value>(
  transaction: Promise<Value>,
): Effect.Effect<Value, unknown> {
  return Effect.uninterruptibleMask((restore) =>
    restore(Effect.tryPromise({
      try: () => transaction,
      catch: (cause) => cause,
    })).pipe(
      Effect.onInterrupt(() =>
        // oxlint-disable-next-line flarex/no-unreviewed-effect-promise -- REVIEW: lifecycle - interrupt drain maps fulfillment and rejection to void so the waiter cannot reject
        Effect.promise(() =>
        transaction.then(() => undefined, () => undefined)
      )),
    )
  );
}

type ClassifiedFailureV1<
  Operation extends TaskComputeDeliveryRepositoryOperationV1,
> =
  | Readonly<{ readonly kind: "retry" }>
  | Readonly<{
      readonly kind: "failure";
      readonly error: Effect.Effect<
        never,
        TaskComputeDeliveryRepositoryErrorV1<Operation>
      >;
    }>
  | Readonly<{ readonly kind: "defect"; readonly cause: unknown }>;

function classifyTransactionFailure<
  Operation extends TaskComputeDeliveryRepositoryOperationV1,
>(
  operation: Operation,
  cause: unknown,
  execution: number,
): ClassifiedFailureV1<Operation> {
  if (!(cause instanceof LocatedReadCommittedTransactionFailureV1)) {
    return Object.freeze({ kind: "defect", cause });
  }
  switch (cause.issue.kind) {
    case "callbackRolledBack": {
      const callback = cause.issue.callbackCause;
      if (callback instanceof RepositoryRollbackV1) {
        if (!isRepositoryErrorForOperation(callback.error, operation)) {
          return Object.freeze({ kind: "defect", cause: callback.error });
        }
        return Object.freeze({
          kind: "failure",
          error: Effect.fail(callback.error),
        });
      }
      if (callback instanceof RepositoryStatementFailureV1) {
        if (isRetryableSqlConflict(callback.cause) && execution === 1) {
          return Object.freeze({ kind: "retry" });
        }
        return Object.freeze({
          kind: "failure",
          error: Effect.fail(
            new TaskComputeDeliveryRepositoryConfirmedRollbackV1Error({
              operation,
              cause,
            }),
          ),
        });
      }
      return Object.freeze({ kind: "defect", cause: callback });
    }
    case "decisionUncertain":
      return Object.freeze({
        kind: "failure",
        error: Effect.fail(
          new TaskComputeDeliveryRepositoryDecisionUncertainV1Error({
            operation,
            cause,
          }),
        ),
      });
    case "callbackCleanupFailed":
      return Object.freeze({
        kind: "failure",
        error: Effect.fail(new TaskComputeDeliveryRepositorySqlV1Error({
          operation,
          phase: "cleanup",
          cause,
        })),
      });
    case "infrastructureFailure":
      return Object.freeze({
        kind: "failure",
        error: Effect.fail(new TaskComputeDeliveryRepositorySqlV1Error({
          operation,
          phase: "infrastructure",
          cause,
        })),
      });
  }
}

async function sha256(
  bytes: Uint8Array,
  operation: TaskComputeDeliveryRepositoryOperationV1,
  _runId: TaskRunIdV1,
): Promise<Uint8Array> {
  try {
    return new Uint8Array(await globalThis.crypto.subtle.digest(
      "SHA-256",
      new Uint8Array(bytes),
    ));
  } catch (cause) {
    throw rollback(new TaskComputeDeliveryRepositoryCryptoV1Error({
      operation,
      cause,
    }));
  }
}

function isRetryableSqlConflict(cause: unknown): boolean {
  const code = sqlState(cause);
  return code === "40001" || code === "40P01";
}

function sqlState(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null) return undefined;
  try {
    const code = Reflect.get(cause, "code");
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}

function configurationFailure(
  reason: TaskComputeDeliveryRepositoryConfigurationV1Error["reason"],
): TaskComputeDeliveryRepositoryConfigurationV1Error {
  return new TaskComputeDeliveryRepositoryConfigurationV1Error({ reason });
}

function repositoryInputFailure<
  Operation extends TaskComputeDeliveryRepositoryOperationV1,
>(
  operation: Operation,
  reason: TaskComputeDeliveryRepositoryInputReasonByOperationV1[Operation],
): TaskComputeDeliveryRepositoryInputV1Error<Operation> {
  return new TaskComputeDeliveryRepositoryInputV1Error<Operation>({
    operation,
    reason,
  });
}

function corruption<
  Operation extends TaskComputeDeliveryRepositoryOperationV1,
>(
  operation: Operation,
  runId: TaskRunIdV1,
  reason: TaskComputeDeliveryRepositoryCorruptionReasonV1,
): TaskComputeDeliveryRepositoryCorruptionV1Error<Operation> {
  return new TaskComputeDeliveryRepositoryCorruptionV1Error<Operation>({
    operation,
    runId,
    reason,
  });
}

function isRepositoryErrorForOperation<
  Operation extends TaskComputeDeliveryRepositoryOperationV1,
>(
  error: TaskComputeDeliveryRepositoryBroadErrorV1,
  operation: Operation,
): error is TaskComputeDeliveryRepositoryErrorV1<Operation> {
  if (error instanceof TaskComputeDeliveryEvidenceV1Error) {
    const cancellationOperation = operation === "acquire_cancellation"
      || operation === "verify_cancellation_recovery"
      || operation === "mark_cancellation_delivery_started"
      || operation === "renew_cancellation_claim"
      || operation === "release_cancellation_before_delivery"
      || operation === "record_cancellation_receipt"
      || operation === "record_cancellation_known_failure";
    return error.operation === "decode_dispatch_request"
      || operation === "acquire_dispatch" && (
        error.operation === "encode_dispatch_request"
        || error.operation === "decode_dispatch_acceptance"
      )
      || operation === "record_dispatch_acceptance" && (
        error.operation === "encode_dispatch_acceptance"
        || error.operation === "decode_dispatch_acceptance"
      )
      || cancellationOperation && (
        error.operation === "decode_dispatch_acceptance"
        || error.operation === "decode_cancellation_request"
      )
      || operation === "acquire_cancellation" && (
        error.operation === "encode_cancellation_request"
        || error.operation === "decode_cancellation_receipt"
      )
      || operation === "record_cancellation_receipt" && (
        error.operation === "encode_cancellation_receipt"
        || error.operation === "decode_cancellation_receipt"
      );
  }
  return error.operation === operation;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0;
}

function capturePositiveSafeIntegerArray(
  value: unknown,
): number[] | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      lengthDescriptor === undefined
      || !("value" in lengthDescriptor)
      || !Number.isSafeInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 1
    ) return undefined;
    const captured: number[] = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (
        descriptor === undefined
        || !("value" in descriptor)
        || !isPositiveSafeInteger(descriptor.value)
      ) return undefined;
      captured.push(descriptor.value);
    }
    return captured;
  } catch {
    return undefined;
  }
}

function captureDataRecord(
  input: unknown,
  expectedKeys: ReadonlyArray<string>,
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return undefined;
    }
    const keys = Reflect.ownKeys(input);
    if (keys.length !== expectedKeys.length) return undefined;
    const expected = new Set(expectedKeys);
    const captured: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key !== "string" || !expected.has(key)) return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined
        || descriptor.enumerable !== true
        || !("value" in descriptor)
      ) return undefined;
      captured[key] = descriptor.value;
    }
    return Object.freeze(captured);
  } catch {
    return undefined;
  }
}

function captureOwnDataProperties(
  input: object,
  keys: ReadonlyArray<string>,
): Readonly<Record<string, unknown>> | undefined {
  try {
    const captured: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        return undefined;
      }
      captured[key] = descriptor.value;
    }
    return Object.freeze(captured);
  } catch {
    return undefined;
  }
}

function isCanonicalUuidV4(value: string): boolean {
  return isLowercaseUuidText(value) && UUID_V4_PATTERN.test(value);
}

function ownedDate(
  value: Date,
  operation: TaskComputeDeliveryRepositoryOperationV1,
  runId: TaskRunIdV1,
): Date {
  const owned = copyFiniteDate(value);
  if (owned === undefined) {
    throw rollback(corruption(operation, runId, "checkpoint_invalid"));
  }
  return owned;
}

function nullableOwnedDate(
  value: Date | null,
  operation: TaskComputeDeliveryRepositoryOperationV1,
  runId: TaskRunIdV1,
): Date | null {
  return value === null ? null : ownedDate(value, operation, runId);
}
