import { Data } from "effect";

export type TaskSystemRunReadDecodeOperationV1 =
  | "decode_due_discovery_request"
  | "decode_requested_effect_page_request";

export class InvalidTaskSystemRunReadRequestError<
  Operation extends TaskSystemRunReadDecodeOperationV1 =
    TaskSystemRunReadDecodeOperationV1,
> extends Data.TaggedError(
  "InvalidTaskSystemRunReadRequestError",
)<{
  readonly operation: Operation;
  readonly issue:
    | "invalid_shape"
    | "invalid_identifier"
    | "invalid_number"
    | "invalid_cursor";
}> {}
