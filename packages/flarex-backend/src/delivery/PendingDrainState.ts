import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonEmptyString } from "@flarex/utils/strings";
import { Data, Effect, Result } from "effect";
import { normalizeDateString } from "../dateStringNormalization";
import { HttpError } from "../http";
import type { LiveQueryDeliveryCursor } from "../liveQueryDeliveryResponses";

export type PendingDeliveryDrain = {
  deploymentId: string;
  limit: number;
  maxBatches: number;
  leaseDurationMs: number;
  claimOwner: string;
  retryAttempt: number;
  cursor?: LiveQueryDeliveryCursor;
};

export class DeliveryPendingDrainStateError extends Data.TaggedError(
  "DeliveryPendingDrainStateError",
)<{
  readonly message: string;
}> {}

export const decodePendingDeliveryDrainFromStorage = Effect.fn(
  "DeliveryPendingDrainState.decodePendingDeliveryDrainFromStorage",
)(
  (value: unknown): Effect.Effect<PendingDeliveryDrain, DeliveryPendingDrainStateError> =>
    Effect.fromResult(normalizePendingDeliveryDrainFromStorage(value)),
);

function normalizePendingDeliveryDrainFromStorage(
  value: unknown,
): DeliveryPendingDrainStateResult<PendingDeliveryDrain> {
  if (!isNonArrayRecord(value)) {
    return deliveryPendingDrainStateFailure("Pending delivery drain state must be an object.");
  }
  const record = value;
  return Result.gen(function* () {
    const deploymentId = yield* storageString(
      record.deploymentId,
      "pending delivery drain deploymentId",
    );
    const limit = yield* storagePositiveInteger(record.limit, "pending delivery drain limit");
    const maxBatches = yield* storagePositiveInteger(
      record.maxBatches,
      "pending delivery drain maxBatches",
    );
    const leaseDurationMs = yield* storagePositiveInteger(
      record.leaseDurationMs,
      "pending delivery drain leaseDurationMs",
    );
    const claimOwner = yield* storageString(
      record.claimOwner,
      "pending delivery drain claimOwner",
    );
    const retryAttempt = yield* storageNonNegativeInteger(
      record.retryAttempt,
      "pending delivery drain retryAttempt",
    );
    const cursor = yield* (record.cursor === undefined
      ? Result.succeed(undefined)
      : storageCursor(record.cursor, "pending delivery drain cursor"));
    return {
      deploymentId,
      limit,
      maxBatches,
      leaseDurationMs,
      claimOwner,
      retryAttempt,
      ...(cursor === undefined ? {} : { cursor }),
    };
  });
}

type DeliveryPendingDrainStateResult<A> = Result.Result<A, DeliveryPendingDrainStateError>;

function deliveryPendingDrainStateFailure<A = never>(
  message: string,
): DeliveryPendingDrainStateResult<A> {
  return Result.fail(new DeliveryPendingDrainStateError({ message }));
}

export function deliveryPendingDrainStateErrorToHttpError(
  error: DeliveryPendingDrainStateError,
): HttpError {
  return new HttpError(500, error.message);
}

function storageCursor(
  value: unknown,
  field: string,
): DeliveryPendingDrainStateResult<LiveQueryDeliveryCursor> {
  if (!isNonArrayRecord(value)) {
    return deliveryPendingDrainStateFailure(`${field} must be an object.`);
  }
  const record = value;
  return Result.gen(function* () {
    const createdAt = yield* dateStringFromStorage(record.createdAt, `${field}.createdAt`);
    const deliveryId = yield* storageString(record.deliveryId, `${field}.deliveryId`);
    return { createdAt, deliveryId };
  });
}

function storageString(value: unknown, field: string): DeliveryPendingDrainStateResult<string> {
  if (isNonEmptyString(value)) {
    return Result.succeed(value);
  }
  return deliveryPendingDrainStateFailure(`${field} must be a non-empty string.`);
}

function storagePositiveInteger(value: unknown, field: string): DeliveryPendingDrainStateResult<number> {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return Result.succeed(value);
  }
  return deliveryPendingDrainStateFailure(`${field} must be a positive integer.`);
}

function storageNonNegativeInteger(value: unknown, field: string): DeliveryPendingDrainStateResult<number> {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return Result.succeed(value);
  }
  return deliveryPendingDrainStateFailure(`${field} must be a non-negative integer.`);
}

function dateStringFromStorage(value: unknown, field: string): DeliveryPendingDrainStateResult<string> {
  return storageString(value, field).pipe(
    Result.flatMap(text => {
      const normalized = normalizeDateString(text);
      return normalized !== undefined
        ? Result.succeed(normalized)
        : deliveryPendingDrainStateFailure(`${field} must be an ISO date string.`);
    }),
  );
}
