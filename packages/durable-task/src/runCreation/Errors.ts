import { Data } from "effect";

import type { TaskRunCreationRequestKeyV1 } from "./Model.js";

export type TaskRunCreationValidationOperationV1 =
  | "decode_request_key"
  | "make_input_reference"
  | "decode_input_reference"
  | "decode_request"
  | "decode_application_request"
  | "decode_receipt"
  | "decode_application_receipt"
  | "decode_definition_reference"
  | "encode_request_key_preimage"
  | "encode_request_preimage"
  | "encode_application_request_preimage";

export class InvalidTaskRunCreationRequestError extends Data.TaggedError(
  "InvalidTaskRunCreationRequestError",
)<{
  readonly operation: TaskRunCreationValidationOperationV1;
  readonly reason:
    | "invalid_request_key"
    | "invalid_input_reference"
    | "invalid_definition_revision"
    | "invalid_run_id"
    | "invalid_database_time"
    | "invalid_digest"
    | "invalid_shape";
}> {}

export class TaskRunCreationIdempotencyConflictError extends Data.TaggedError(
  "TaskRunCreationIdempotencyConflictError",
)<{
  readonly requestKey: TaskRunCreationRequestKeyV1;
  readonly reason: "request_digest_mismatch";
}> {}

export class InvalidTaskRunInitialAggregateError extends Data.TaggedError(
  "InvalidTaskRunInitialAggregateError",
)<{
  readonly operation: "make_initial_aggregate";
  readonly reason: "invalid_initial_aggregate";
  readonly cause: unknown;
}> {}

export type TaskRunCreationErrorV1 =
  | InvalidTaskRunCreationRequestError
  | TaskRunCreationIdempotencyConflictError
  | InvalidTaskRunInitialAggregateError;

/** An impossible failure while encoding an already-decoded canonical frame. */
export class TaskRunCreationCanonicalEncodingDefect extends Data.TaggedError(
  "TaskRunCreationCanonicalEncodingDefect",
)<{
  readonly operation:
    | "encode_request_key_preimage"
    | "encode_request_preimage"
    | "encode_application_request_preimage";
  readonly issue: unknown;
}> {}
