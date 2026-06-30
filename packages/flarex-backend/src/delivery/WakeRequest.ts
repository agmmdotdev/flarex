import { Data, Effect } from "effect";

export type DeliveryWakeRequest = {
  deploymentId: string;
  limit?: number;
  maxBatches?: number;
  leaseDurationMs?: number;
};

export class DeliveryWakePayloadError extends Data.TaggedError("DeliveryWakePayloadError")<{
  readonly message: string;
}> {}

export const decodeDeliveryWakePayload = Effect.fn("DeliveryWake.decodePayload")(
  function* (
    value: unknown,
  ): Effect.fn.Return<DeliveryWakeRequest, DeliveryWakePayloadError> {
    return yield* deliveryWakePayloadValidationResultToEffect(normalizeDeliveryWakePayload(value));
  },
);

export const decodePublicDeliveryWakePayload = Effect.fn("DeliveryWake.decodePublicPayload")(
  function* (
    value: unknown,
    deploymentId: string,
  ): Effect.fn.Return<DeliveryWakeRequest, DeliveryWakePayloadError> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return yield* Effect.fail(new DeliveryWakePayloadError({
        message: "Delivery wake request body must be an object.",
      }));
    }
    return yield* decodeDeliveryWakePayload({
      ...(value as Record<string, unknown>),
      deploymentId,
    });
  },
);

function normalizeDeliveryWakePayload(value: unknown): DeliveryWakePayloadValidationResult<DeliveryWakeRequest> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return deliveryWakePayloadValidationFailure("Delivery wake request body must be an object.");
  }
  const record = value as Record<string, unknown>;
  const deploymentId = requiredWakeString(record.deploymentId, "deploymentId");
  if (!deploymentId.success) return deploymentId;
  const limit = optionalPositiveInteger(record.limit, "limit");
  if (!limit.success) return limit;
  const maxBatches = optionalPositiveInteger(record.maxBatches, "maxBatches");
  if (!maxBatches.success) return maxBatches;
  const leaseDurationMs = optionalPositiveInteger(record.leaseDurationMs, "leaseDurationMs");
  if (!leaseDurationMs.success) return leaseDurationMs;
  return deliveryWakePayloadValidationSuccess({
    deploymentId: deploymentId.value,
    ...(limit.value === undefined ? {} : { limit: limit.value }),
    ...(maxBatches.value === undefined ? {} : { maxBatches: maxBatches.value }),
    ...(leaseDurationMs.value === undefined ? {} : { leaseDurationMs: leaseDurationMs.value }),
  });
}

function requiredWakeString(value: unknown, field: string): DeliveryWakePayloadValidationResult<string> {
  if (typeof value === "string" && value.length > 0) {
    return deliveryWakePayloadValidationSuccess(value);
  }
  return deliveryWakePayloadValidationFailure(`${field} must be a non-empty string.`);
}

function optionalPositiveInteger(
  value: unknown,
  field: string,
): DeliveryWakePayloadValidationResult<number | undefined> {
  return value === undefined
    ? deliveryWakePayloadValidationSuccess(undefined)
    : positiveInteger(value, field);
}

function positiveInteger(value: unknown, field: string): DeliveryWakePayloadValidationResult<number> {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return deliveryWakePayloadValidationSuccess(value);
  }
  return deliveryWakePayloadValidationFailure(`${field} must be a positive integer.`);
}

type DeliveryWakePayloadValidationResult<A> =
  | {
      readonly success: true;
      readonly value: A;
    }
  | {
      readonly success: false;
      readonly error: DeliveryWakePayloadError;
    };

function deliveryWakePayloadValidationSuccess<A>(value: A): DeliveryWakePayloadValidationResult<A> {
  return {
    success: true,
    value,
  };
}

function deliveryWakePayloadValidationFailure<A = never>(
  message: string,
): DeliveryWakePayloadValidationResult<A> {
  return {
    success: false,
    error: new DeliveryWakePayloadError({ message }),
  };
}

function deliveryWakePayloadValidationResultToEffect<A>(
  result: DeliveryWakePayloadValidationResult<A>,
): Effect.Effect<A, DeliveryWakePayloadError> {
  return result.success ? Effect.succeed(result.value) : Effect.fail(result.error);
}
