import { Data, Effect } from "effect";
import {
  HttpError,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "../http";

export type DeliveryWakeRequest = {
  deploymentId: string;
  limit?: number;
  maxBatches?: number;
  leaseDurationMs?: number;
};

export class DeliveryWakeRouteValidationError extends Data.TaggedError("DeliveryWakeRouteValidationError")<{
  readonly message: string;
}> {}

export type DeliveryWakeRouteError = RequestJsonError | DeliveryWakeRouteValidationError;

export async function readDeliveryWakeRequest(
  request: Request,
): Promise<DeliveryWakeRequest> {
  return runDeliveryWakeRouteEffect(decodeDeliveryWakeRequest(request));
}

export function decodeDeliveryWakeRequest(
  request: Request,
): Effect.Effect<DeliveryWakeRequest, DeliveryWakeRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(parseDeliveryWakeRequestEffect),
  );
}

export function parseDeliveryWakeRequest(value: unknown): DeliveryWakeRequest {
  return unwrapDeliveryWakeRouteValidation(normalizeDeliveryWakeRequest(value));
}

export function parseDeliveryWakeRequestEffect(
  value: unknown,
): Effect.Effect<DeliveryWakeRequest, DeliveryWakeRouteValidationError> {
  return deliveryWakeRouteValidationResultToEffect(normalizeDeliveryWakeRequest(value));
}

function normalizeDeliveryWakeRequest(value: unknown): DeliveryWakeRouteValidationResult<DeliveryWakeRequest> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return deliveryWakeRouteValidationFailure("Delivery wake request body must be an object.");
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
  return deliveryWakeRouteValidationSuccess({
    deploymentId: deploymentId.value,
    ...(limit.value === undefined ? {} : { limit: limit.value }),
    ...(maxBatches.value === undefined ? {} : { maxBatches: maxBatches.value }),
    ...(leaseDurationMs.value === undefined ? {} : { leaseDurationMs: leaseDurationMs.value }),
  });
}

function requiredWakeString(value: unknown, field: string): DeliveryWakeRouteValidationResult<string> {
  if (typeof value === "string" && value.length > 0) {
    return deliveryWakeRouteValidationSuccess(value);
  }
  return deliveryWakeRouteValidationFailure(`${field} must be a non-empty string.`);
}

function optionalPositiveInteger(
  value: unknown,
  field: string,
): DeliveryWakeRouteValidationResult<number | undefined> {
  return value === undefined
    ? deliveryWakeRouteValidationSuccess(undefined)
    : positiveInteger(value, field);
}

function positiveInteger(value: unknown, field: string): DeliveryWakeRouteValidationResult<number> {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return deliveryWakeRouteValidationSuccess(value);
  }
  return deliveryWakeRouteValidationFailure(`${field} must be a positive integer.`);
}

type DeliveryWakeRouteValidationResult<A> =
  | {
      readonly success: true;
      readonly value: A;
    }
  | {
      readonly success: false;
      readonly error: DeliveryWakeRouteValidationError;
    };

function deliveryWakeRouteValidationSuccess<A>(value: A): DeliveryWakeRouteValidationResult<A> {
  return {
    success: true,
    value,
  };
}

function deliveryWakeRouteValidationFailure<A = never>(
  message: string,
): DeliveryWakeRouteValidationResult<A> {
  return {
    success: false,
    error: new DeliveryWakeRouteValidationError({ message }),
  };
}

function deliveryWakeRouteValidationResultToEffect<A>(
  result: DeliveryWakeRouteValidationResult<A>,
): Effect.Effect<A, DeliveryWakeRouteValidationError> {
  return result.success ? Effect.succeed(result.value) : Effect.fail(result.error);
}

function unwrapDeliveryWakeRouteValidation<A>(result: DeliveryWakeRouteValidationResult<A>): A {
  if (result.success) return result.value;
  throw deliveryWakeRouteErrorToHttpError(result.error);
}

function runDeliveryWakeRouteEffect<A>(
  effect: Effect.Effect<A, DeliveryWakeRouteError>,
): Promise<A> {
  return Effect.runPromise(effect.pipe(
    Effect.mapError(deliveryWakeRouteErrorToHttpError),
  ));
}

export function deliveryWakeRouteErrorToHttpError(error: DeliveryWakeRouteError): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return new HttpError(400, error.message);
}
