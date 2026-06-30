import { Effect } from "effect";
import {
  partitionRouteErrorToHttpError,
  type PartitionRouteError,
  type PartitionSchemaCacheRequest,
  type PartitionRoutePayloadError,
} from "./RouteBoundary";
import {
  HttpError,
  readJsonEffect,
} from "../http";
import { decodePublicPartitionSchemaCachePayload } from "./Requests";

export async function readPublicPartitionSchemaCacheRequest(
  request: Request,
  partitionKey: string,
): Promise<PartitionSchemaCacheRequest> {
  return Effect.runPromise(decodePublicPartitionSchemaCacheRequest(request, partitionKey).pipe(
    Effect.mapError(publicPartitionSchemaCacheRouteErrorToHttpError),
  ));
}

export function decodePublicPartitionSchemaCacheRequest(
  request: Request,
  partitionKey: string,
): Effect.Effect<PartitionSchemaCacheRequest, PartitionRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(value => decodePublicPartitionSchemaCacheRoutePayload(value, partitionKey)),
  );
}

export function parsePublicPartitionSchemaCacheRequest(
  value: unknown,
  partitionKey: string,
): PartitionSchemaCacheRequest {
  return Effect.runSync(parsePublicPartitionSchemaCacheRequestEffect(value, partitionKey).pipe(
    Effect.mapError(publicPartitionSchemaCacheRouteErrorToHttpError),
  ));
}

export function parsePublicPartitionSchemaCacheRequestEffect(
  value: unknown,
  partitionKey: string,
): Effect.Effect<PartitionSchemaCacheRequest, PartitionRoutePayloadError> {
  return decodePublicPartitionSchemaCacheRoutePayload(value, partitionKey);
}

export function decodePublicPartitionSchemaCacheRoutePayload(
  value: unknown,
  partitionKey: string,
): Effect.Effect<PartitionSchemaCacheRequest, PartitionRoutePayloadError> {
  return decodePublicPartitionSchemaCachePayload(value, partitionKey);
}

export function publicPartitionSchemaCacheRouteErrorToHttpError(
  error: PartitionRouteError,
): HttpError {
  return partitionRouteErrorToHttpError(error);
}
