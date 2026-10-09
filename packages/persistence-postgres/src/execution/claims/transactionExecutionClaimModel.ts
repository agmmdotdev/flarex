import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { isLowercaseUuidText } from "@flarex/utils/strings";
import { Result, Schema } from "effect";

import { MAX_PERSISTED_SIGNED_INT64_V1 } from
  "flarex-protocol/storage-authority";

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const TransactionExecutionClaimOwnerV1Schema = Schema.String.check(
  Schema.makeFilter((value) =>
    isLowercaseUuidText(value) && UUID_V4_PATTERN.test(value)
      ? undefined
      : "Expected one canonical lowercase UUIDv4 execution-claim owner",
  ),
).pipe(Schema.brand("FlarexDB/TransactionExecutionClaimOwnerV1"));
export type TransactionExecutionClaimOwnerV1 =
  typeof TransactionExecutionClaimOwnerV1Schema.Type;

export const TransactionExecutionClaimFenceV1Schema = Schema.BigInt.check(
  Schema.makeFilter((value) =>
    value >= 1n && value <= MAX_PERSISTED_SIGNED_INT64_V1
      ? undefined
      : `Expected a positive execution-claim fence no greater than ${MAX_PERSISTED_SIGNED_INT64_V1}`,
  ),
).pipe(Schema.brand("FlarexDB/TransactionExecutionClaimFenceV1"));
export type TransactionExecutionClaimFenceV1 =
  typeof TransactionExecutionClaimFenceV1Schema.Type;

const decodeOwnerResult = Schema.decodeUnknownResult(
  TransactionExecutionClaimOwnerV1Schema,
);
const decodeFenceResult = Schema.decodeUnknownResult(
  TransactionExecutionClaimFenceV1Schema,
);

export interface TransactionExecutionClaimPinV1 {
  readonly claimOwner: TransactionExecutionClaimOwnerV1;
  readonly claimFence: TransactionExecutionClaimFenceV1;
}

export interface TransactionExecutionClaimTimingV1 {
  readonly claimedAt: string;
  readonly claimExpiresAt: string;
}

export interface TransactionExecutionClaimObservationV1
  extends TransactionExecutionClaimPinV1,
    TransactionExecutionClaimTimingV1 {}

export function decodeTransactionExecutionClaimOwnerV1(
  input: unknown,
): Result.Result<TransactionExecutionClaimOwnerV1, "invalidClaimOwner"> {
  return decodeOwnerResult(input).pipe(
    Result.mapError(() => "invalidClaimOwner" as const),
  );
}

export function decodeTransactionExecutionClaimFenceV1(
  input: unknown,
): Result.Result<TransactionExecutionClaimFenceV1, "invalidClaimFence"> {
  return decodeFenceResult(input).pipe(
    Result.mapError(() => "invalidClaimFence" as const),
  );
}

export function requireTransactionExecutionClaimDurationMillisecondsV1(
  input: unknown,
): number {
  if (!isPositiveSafeInteger(input)) {
    throw new Error(
      "Execution-claim duration must be a positive safe integer.",
    );
  }
  return input;
}
