import { Data, Effect } from "effect";
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
  function* (value: unknown): Effect.fn.Return<PendingDeliveryDrain, DeliveryPendingDrainStateError> {
    return yield* deliveryPendingDrainStateResultToEffect(normalizePendingDeliveryDrainFromStorage(value));
  },
);

export function pendingDeliveryDrainFromStorage(value: unknown): PendingDeliveryDrain {
  return unwrapDeliveryPendingDrainState(normalizePendingDeliveryDrainFromStorage(value));
}

function normalizePendingDeliveryDrainFromStorage(
  value: unknown,
): DeliveryPendingDrainStateResult<PendingDeliveryDrain> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return deliveryPendingDrainStateFailure("Pending delivery drain state must be an object.");
  }
  const record = value as Record<string, unknown>;
  const deploymentId = storageString(record.deploymentId, "pending delivery drain deploymentId");
  if (!deploymentId.success) return deploymentId;
  const limit = storagePositiveInteger(record.limit, "pending delivery drain limit");
  if (!limit.success) return limit;
  const maxBatches = storagePositiveInteger(record.maxBatches, "pending delivery drain maxBatches");
  if (!maxBatches.success) return maxBatches;
  const leaseDurationMs = storagePositiveInteger(
    record.leaseDurationMs,
    "pending delivery drain leaseDurationMs",
  );
  if (!leaseDurationMs.success) return leaseDurationMs;
  const claimOwner = storageString(record.claimOwner, "pending delivery drain claimOwner");
  if (!claimOwner.success) return claimOwner;
  const retryAttempt = storageNonNegativeInteger(
    record.retryAttempt,
    "pending delivery drain retryAttempt",
  );
  if (!retryAttempt.success) return retryAttempt;
  const cursor = record.cursor === undefined
    ? deliveryPendingDrainStateSuccess(undefined)
    : storageCursor(record.cursor, "pending delivery drain cursor");
  if (!cursor.success) return cursor;
  return deliveryPendingDrainStateSuccess({
    deploymentId: deploymentId.value,
    limit: limit.value,
    maxBatches: maxBatches.value,
    leaseDurationMs: leaseDurationMs.value,
    claimOwner: claimOwner.value,
    retryAttempt: retryAttempt.value,
    ...(cursor.value === undefined ? {} : { cursor: cursor.value }),
  });
}

type DeliveryPendingDrainStateResult<A> =
  | {
      readonly success: true;
      readonly value: A;
    }
  | {
      readonly success: false;
      readonly error: DeliveryPendingDrainStateError;
    };

function deliveryPendingDrainStateSuccess<A>(value: A): DeliveryPendingDrainStateResult<A> {
  return {
    success: true,
    value,
  };
}

function deliveryPendingDrainStateFailure<A = never>(
  message: string,
): DeliveryPendingDrainStateResult<A> {
  return {
    success: false,
    error: new DeliveryPendingDrainStateError({ message }),
  };
}

function deliveryPendingDrainStateResultToEffect<A>(
  result: DeliveryPendingDrainStateResult<A>,
): Effect.Effect<A, DeliveryPendingDrainStateError> {
  return result.success ? Effect.succeed(result.value) : Effect.fail(result.error);
}

function unwrapDeliveryPendingDrainState<A>(result: DeliveryPendingDrainStateResult<A>): A {
  if (result.success) return result.value;
  throw result.error;
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
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return deliveryPendingDrainStateFailure(`${field} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const createdAt = dateStringFromStorage(record.createdAt, `${field}.createdAt`);
  if (!createdAt.success) return createdAt;
  const deliveryId = storageString(record.deliveryId, `${field}.deliveryId`);
  if (!deliveryId.success) return deliveryId;
  return deliveryPendingDrainStateSuccess({
    createdAt: createdAt.value,
    deliveryId: deliveryId.value,
  });
}

function storageString(value: unknown, field: string): DeliveryPendingDrainStateResult<string> {
  if (typeof value === "string" && value.length > 0) {
    return deliveryPendingDrainStateSuccess(value);
  }
  return deliveryPendingDrainStateFailure(`${field} must be a non-empty string.`);
}

function storagePositiveInteger(value: unknown, field: string): DeliveryPendingDrainStateResult<number> {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return deliveryPendingDrainStateSuccess(value);
  }
  return deliveryPendingDrainStateFailure(`${field} must be a positive integer.`);
}

function storageNonNegativeInteger(value: unknown, field: string): DeliveryPendingDrainStateResult<number> {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return deliveryPendingDrainStateSuccess(value);
  }
  return deliveryPendingDrainStateFailure(`${field} must be a non-negative integer.`);
}

function dateStringFromStorage(value: unknown, field: string): DeliveryPendingDrainStateResult<string> {
  const text = storageString(value, field);
  if (!text.success) return text;
  const date = new Date(text.value);
  if (!Number.isNaN(date.getTime())) return deliveryPendingDrainStateSuccess(date.toISOString());
  return deliveryPendingDrainStateFailure(`${field} must be an ISO date string.`);
}
