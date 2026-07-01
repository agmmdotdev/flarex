import { Effect } from "effect";
import {
  HttpError,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "../http";
import {
  decodePartitionCommitPayload,
  decodePartitionConnectionUnregisterPayload,
  decodePartitionSchemaCachePayload,
  decodePartitionSubscriptionRegistrationPayload,
  decodePartitionSubscriptionTargetPayload,
  PartitionRoutePayloadError,
  type PartitionCommitRequest,
  type PartitionConnectionUnregisterRequest,
  type PartitionSchemaCacheRequest,
  type PartitionSubscriptionRegistrationRequest,
  type PartitionSubscriptionTargetRequest,
} from "./Requests";

export {
  PartitionRoutePayloadError,
  type PartitionCommitRequest,
  type PartitionConnectionUnregisterRequest,
  type PartitionSchemaCacheRequest,
  type PartitionSubscriptionRegistrationRequest,
  type PartitionSubscriptionTargetRequest,
} from "./Requests";

export type PartitionRouteError = RequestJsonError | PartitionRoutePayloadError;

export function decodePartitionSchemaCacheRequest(
  request: Request,
): Effect.Effect<PartitionSchemaCacheRequest, PartitionRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodePartitionSchemaCacheRoutePayload),
  );
}

export function decodePartitionSchemaCacheRoutePayload(
  value: unknown,
): Effect.Effect<PartitionSchemaCacheRequest, PartitionRoutePayloadError> {
  return decodePartitionSchemaCachePayload(value);
}

export function decodePartitionCommitRequest(
  request: Request,
): Effect.Effect<PartitionCommitRequest, PartitionRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodePartitionCommitRoutePayload),
  );
}

export function decodePartitionCommitRoutePayload(
  value: unknown,
): Effect.Effect<PartitionCommitRequest, PartitionRoutePayloadError> {
  return decodePartitionCommitPayload(value);
}

export function decodePartitionSubscriptionRegistrationRequest(
  request: Request,
): Effect.Effect<PartitionSubscriptionRegistrationRequest, PartitionRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodePartitionSubscriptionRegistrationRoutePayload),
  );
}

export function decodePartitionSubscriptionRegistrationRoutePayload(
  value: unknown,
): Effect.Effect<PartitionSubscriptionRegistrationRequest, PartitionRoutePayloadError> {
  return decodePartitionSubscriptionRegistrationPayload(value);
}

export function decodePartitionSubscriptionTargetRequest(
  request: Request,
): Effect.Effect<PartitionSubscriptionTargetRequest, PartitionRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodePartitionSubscriptionTargetRoutePayload),
  );
}

export function decodePartitionSubscriptionTargetRoutePayload(
  value: unknown,
): Effect.Effect<PartitionSubscriptionTargetRequest, PartitionRoutePayloadError> {
  return decodePartitionSubscriptionTargetPayload(value);
}

export function decodePartitionConnectionUnregisterRequest(
  request: Request,
): Effect.Effect<PartitionConnectionUnregisterRequest, PartitionRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodePartitionConnectionUnregisterRoutePayload),
  );
}

export function decodePartitionConnectionUnregisterRoutePayload(
  value: unknown,
): Effect.Effect<PartitionConnectionUnregisterRequest, PartitionRoutePayloadError> {
  return decodePartitionConnectionUnregisterPayload(value);
}

export function partitionRouteErrorToHttpError(error: PartitionRouteError): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return new HttpError(400, error.message);
}

export const partitionRouteErrorToHttpErrorEffect = Effect.fn(
  "PartitionRouteBoundary.partitionRouteErrorToHttpError",
)(function* (
  error: PartitionRouteError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(partitionRouteErrorToHttpError(error));
});
