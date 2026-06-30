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

export async function readPartitionSchemaCacheRequest(
  request: Request,
): Promise<PartitionSchemaCacheRequest> {
  return runPartitionRouteEffect(decodePartitionSchemaCacheRequest(request));
}

export function decodePartitionSchemaCacheRequest(
  request: Request,
): Effect.Effect<PartitionSchemaCacheRequest, PartitionRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodePartitionSchemaCacheRoutePayload),
  );
}

export function parsePartitionSchemaCacheRequest(
  value: unknown,
): PartitionSchemaCacheRequest {
  return Effect.runSync(parsePartitionSchemaCacheRequestEffect(value).pipe(
    Effect.mapError(partitionRouteErrorToHttpError),
  ));
}

export function parsePartitionSchemaCacheRequestEffect(
  value: unknown,
): Effect.Effect<PartitionSchemaCacheRequest, PartitionRoutePayloadError> {
  return decodePartitionSchemaCacheRoutePayload(value);
}

export function decodePartitionSchemaCacheRoutePayload(
  value: unknown,
): Effect.Effect<PartitionSchemaCacheRequest, PartitionRoutePayloadError> {
  return decodePartitionSchemaCachePayload(value);
}

export async function readPartitionCommitRequest(
  request: Request,
): Promise<PartitionCommitRequest> {
  return runPartitionRouteEffect(decodePartitionCommitRequest(request));
}

export function decodePartitionCommitRequest(
  request: Request,
): Effect.Effect<PartitionCommitRequest, PartitionRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodePartitionCommitRoutePayload),
  );
}

export function parsePartitionCommitRequest(value: unknown): PartitionCommitRequest {
  return Effect.runSync(parsePartitionCommitRequestEffect(value).pipe(
    Effect.mapError(partitionRouteErrorToHttpError),
  ));
}

export function parsePartitionCommitRequestEffect(
  value: unknown,
): Effect.Effect<PartitionCommitRequest, PartitionRoutePayloadError> {
  return decodePartitionCommitRoutePayload(value);
}

export function decodePartitionCommitRoutePayload(
  value: unknown,
): Effect.Effect<PartitionCommitRequest, PartitionRoutePayloadError> {
  return decodePartitionCommitPayload(value);
}

export async function readPartitionSubscriptionRegistrationRequest(
  request: Request,
): Promise<PartitionSubscriptionRegistrationRequest> {
  return runPartitionRouteEffect(decodePartitionSubscriptionRegistrationRequest(request));
}

export function decodePartitionSubscriptionRegistrationRequest(
  request: Request,
): Effect.Effect<PartitionSubscriptionRegistrationRequest, PartitionRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodePartitionSubscriptionRegistrationRoutePayload),
  );
}

export function parsePartitionSubscriptionRegistrationRequest(
  value: unknown,
): PartitionSubscriptionRegistrationRequest {
  return Effect.runSync(parsePartitionSubscriptionRegistrationRequestEffect(value).pipe(
    Effect.mapError(partitionRouteErrorToHttpError),
  ));
}

export function parsePartitionSubscriptionRegistrationRequestEffect(
  value: unknown,
): Effect.Effect<PartitionSubscriptionRegistrationRequest, PartitionRoutePayloadError> {
  return decodePartitionSubscriptionRegistrationRoutePayload(value);
}

export function decodePartitionSubscriptionRegistrationRoutePayload(
  value: unknown,
): Effect.Effect<PartitionSubscriptionRegistrationRequest, PartitionRoutePayloadError> {
  return decodePartitionSubscriptionRegistrationPayload(value);
}

export async function readPartitionSubscriptionTargetRequest(
  request: Request,
): Promise<PartitionSubscriptionTargetRequest> {
  return runPartitionRouteEffect(decodePartitionSubscriptionTargetRequest(request));
}

export function decodePartitionSubscriptionTargetRequest(
  request: Request,
): Effect.Effect<PartitionSubscriptionTargetRequest, PartitionRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodePartitionSubscriptionTargetRoutePayload),
  );
}

export function parsePartitionSubscriptionTargetRequest(
  value: unknown,
): PartitionSubscriptionTargetRequest {
  return Effect.runSync(parsePartitionSubscriptionTargetRequestEffect(value).pipe(
    Effect.mapError(partitionRouteErrorToHttpError),
  ));
}

export function parsePartitionSubscriptionTargetRequestEffect(
  value: unknown,
): Effect.Effect<PartitionSubscriptionTargetRequest, PartitionRoutePayloadError> {
  return decodePartitionSubscriptionTargetRoutePayload(value);
}

export function decodePartitionSubscriptionTargetRoutePayload(
  value: unknown,
): Effect.Effect<PartitionSubscriptionTargetRequest, PartitionRoutePayloadError> {
  return decodePartitionSubscriptionTargetPayload(value);
}

export async function readPartitionConnectionUnregisterRequest(
  request: Request,
): Promise<PartitionConnectionUnregisterRequest> {
  return runPartitionRouteEffect(decodePartitionConnectionUnregisterRequest(request));
}

export function decodePartitionConnectionUnregisterRequest(
  request: Request,
): Effect.Effect<PartitionConnectionUnregisterRequest, PartitionRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodePartitionConnectionUnregisterRoutePayload),
  );
}

export function parsePartitionConnectionUnregisterRequest(
  value: unknown,
): PartitionConnectionUnregisterRequest {
  return Effect.runSync(parsePartitionConnectionUnregisterRequestEffect(value).pipe(
    Effect.mapError(partitionRouteErrorToHttpError),
  ));
}

export function parsePartitionConnectionUnregisterRequestEffect(
  value: unknown,
): Effect.Effect<PartitionConnectionUnregisterRequest, PartitionRoutePayloadError> {
  return decodePartitionConnectionUnregisterRoutePayload(value);
}

export function decodePartitionConnectionUnregisterRoutePayload(
  value: unknown,
): Effect.Effect<PartitionConnectionUnregisterRequest, PartitionRoutePayloadError> {
  return decodePartitionConnectionUnregisterPayload(value);
}

function runPartitionRouteEffect<A>(effect: Effect.Effect<A, PartitionRouteError>): Promise<A> {
  return Effect.runPromise(effect.pipe(
    Effect.mapError(partitionRouteErrorToHttpError),
  ));
}

export function partitionRouteErrorToHttpError(error: PartitionRouteError): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return new HttpError(400, error.message);
}
