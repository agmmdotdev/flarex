import { Data, Result, Schema } from "effect";
import {
  decodeStandardApplicationTaskRunRequestKey,
  type StandardApplicationTaskRunRequestV1,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-system";
import {
  TransactionRequestKeyV1Schema,
  type TransactionRequestKeyV1,
} from "flarex-protocol/transaction-session";

export type ApplicationRequestKeyOperation =
  | "runMutation"
  | "runAction"
  | "startTask";

class ApplicationRequestKeyFailure<
  Operation extends ApplicationRequestKeyOperation,
> extends Data.TaggedError(
  "ApplicationRequestKeyError",
)<{
  readonly operation: Operation;
  readonly field: "requestKey";
  readonly reason: "invalidRequestKey";
}> {}

export type ApplicationRequestKeyError<
  Operation extends ApplicationRequestKeyOperation =
    ApplicationRequestKeyOperation,
> = ApplicationRequestKeyFailure<Operation>;

const decodeRequestKey = Schema.decodeUnknownResult(
  TransactionRequestKeyV1Schema,
);

/** Validates one clean caller string at the internal request-key boundary. */
export function normalizeApplicationRequestKey<
  const Operation extends Exclude<ApplicationRequestKeyOperation, "startTask">,
>(
  operation: Operation,
  value: string,
): Result.Result<
  TransactionRequestKeyV1,
  ApplicationRequestKeyError<Operation>
> {
  return decodeRequestKey(value).pipe(
    Result.mapError(() => new ApplicationRequestKeyFailure({
      operation,
      field: "requestKey",
      reason: "invalidRequestKey",
    })),
  );
}

export function normalizeTaskRequestKey(
  value: string,
): Result.Result<
  StandardApplicationTaskRunRequestV1<never>["requestKey"],
  ApplicationRequestKeyError<"startTask">
> {
  return decodeStandardApplicationTaskRunRequestKey(value).pipe(
    Result.mapError(() => new ApplicationRequestKeyFailure({
      operation: "startTask",
      field: "requestKey",
      reason: "invalidRequestKey",
    })),
  );
}
