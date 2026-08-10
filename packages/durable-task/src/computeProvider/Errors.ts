import { Data } from "effect";

import type {
  TaskCancellationGenerationV1,
  TaskComputeProfileRefV1,
} from "../runAttempt/Model.js";
import type {
  TaskComputeDispatchIdentityV1,
  TaskComputeExecutionRefV1,
} from "./Model.js";

export type TaskComputeProviderValidationOperationV1 =
  | "decode_provider_descriptor"
  | "decode_dispatch_request"
  | "decode_dispatch_acceptance"
  | "decode_cancellation_request"
  | "decode_cancellation_receipt"
  | "encode_dispatch_request"
  | "encode_dispatch_acceptance"
  | "encode_cancellation_request"
  | "encode_cancellation_receipt";

export class InvalidTaskComputeProviderValueError<
  Operation extends TaskComputeProviderValidationOperationV1 =
    TaskComputeProviderValidationOperationV1,
> extends Data.TaggedError(
  "InvalidTaskComputeProviderValueError",
)<{
  readonly operation: Operation;
  readonly reason:
    | "invalid_shape"
    | "invalid_identifier"
    | "invalid_number"
    | "invalid_cancellation"
    | "invalid_correlation";
}> {}

export class TaskComputeDispatchConflictError extends Data.TaggedError(
  "TaskComputeDispatchConflictError",
)<{
  readonly identity: TaskComputeDispatchIdentityV1;
  readonly reason: "dispatch_request_mismatch";
}> {}

export class TaskComputeCancellationStaleError extends Data.TaggedError(
  "TaskComputeCancellationStaleError",
)<{
  readonly identity: TaskComputeDispatchIdentityV1;
  readonly receivedGeneration: TaskCancellationGenerationV1;
  readonly acceptedGeneration: TaskCancellationGenerationV1;
}> {}

export type TaskComputeDispatchRejectionReasonV1 =
  | "unsupported_compute_profile"
  | "capacity_unavailable"
  | "provider_disabled";

export type TaskComputeCancellationRejectionReasonV1 =
  | "provider_disabled"
  | "execution_not_found"
  | "execution_mismatch";

export class TaskComputeDispatchRejectedError extends Data.TaggedError(
  "TaskComputeDispatchRejectedError",
)<{
  readonly operation: "dispatch";
  readonly reason: TaskComputeDispatchRejectionReasonV1;
  readonly retryable: boolean;
  readonly computeProfile: TaskComputeProfileRefV1;
}> {}

export class TaskComputeCancellationRejectedError extends Data.TaggedError(
  "TaskComputeCancellationRejectedError",
)<{
  readonly operation: "request_cancellation";
  readonly reason: TaskComputeCancellationRejectionReasonV1;
  readonly retryable: boolean;
}> {}

export class TaskComputeDispatchTransportError extends Data.TaggedError(
  "TaskComputeDispatchTransportError",
)<{
  readonly operation: "dispatch";
  readonly retryable: boolean;
  readonly cause: unknown;
}> {}

export class TaskComputeCancellationTransportError extends Data.TaggedError(
  "TaskComputeCancellationTransportError",
)<{
  readonly operation: "request_cancellation";
  readonly retryable: boolean;
  readonly cause: unknown;
}> {}

export class TaskComputeDispatchUncertainError extends Data.TaggedError(
  "TaskComputeDispatchUncertainError",
)<{
  readonly operation: "dispatch";
  readonly identity: TaskComputeDispatchIdentityV1;
  readonly cause: unknown;
}> {}

export class TaskComputeCancellationUncertainError extends Data.TaggedError(
  "TaskComputeCancellationUncertainError",
)<{
  readonly operation: "request_cancellation";
  readonly identity: TaskComputeDispatchIdentityV1;
  readonly cause: unknown;
}> {}

export class TaskComputeDispatchContractError extends Data.TaggedError(
  "TaskComputeDispatchContractError",
)<{
  readonly operation: "dispatch";
  readonly reason: "malformed_receipt" | "receipt_correlation_mismatch";
  readonly execution: TaskComputeExecutionRefV1 | null;
}> {}

export class TaskComputeCancellationContractError extends Data.TaggedError(
  "TaskComputeCancellationContractError",
)<{
  readonly operation: "request_cancellation";
  readonly reason: "malformed_receipt" | "receipt_correlation_mismatch";
  readonly execution: TaskComputeExecutionRefV1 | null;
}> {}

export type TaskComputeDispatchErrorV1 =
  | InvalidTaskComputeProviderValueError<"decode_dispatch_request">
  | TaskComputeDispatchConflictError
  | TaskComputeDispatchRejectedError
  | TaskComputeDispatchTransportError
  | TaskComputeDispatchUncertainError
  | TaskComputeDispatchContractError;

export type TaskComputeCancellationErrorV1 =
  | InvalidTaskComputeProviderValueError<"decode_cancellation_request">
  | TaskComputeCancellationStaleError
  | TaskComputeCancellationRejectedError
  | TaskComputeCancellationTransportError
  | TaskComputeCancellationUncertainError
  | TaskComputeCancellationContractError;

export type TaskComputeProviderErrorV1 =
  | TaskComputeDispatchErrorV1
  | TaskComputeCancellationErrorV1;
