import { Effect } from "effect";
import {
  parsePartitionSchemaCacheRequest,
  parsePartitionSchemaCacheRequestEffect,
  partitionRouteErrorToHttpError,
  type PartitionRouteError,
  type PartitionSchemaCacheRequest,
} from "./RouteBoundary";
import {
  HttpError,
  readJsonEffect,
} from "../http";
import type { DeploymentSchema } from "../types";

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
    Effect.flatMap(value => parsePublicPartitionSchemaCacheRequestEffect(value, partitionKey)),
  );
}

export function parsePublicPartitionSchemaCacheRequest(
  value: unknown,
  partitionKey: string,
): PartitionSchemaCacheRequest {
  parsePartitionSchemaCacheRequest(value);
  return { partitionKey, schema: value as Partial<DeploymentSchema> };
}

export function parsePublicPartitionSchemaCacheRequestEffect(
  value: unknown,
  partitionKey: string,
): Effect.Effect<PartitionSchemaCacheRequest, PartitionRouteError> {
  return parsePartitionSchemaCacheRequestEffect(value).pipe(
    Effect.as({ partitionKey, schema: value as Partial<DeploymentSchema> }),
  );
}

export function publicPartitionSchemaCacheRouteErrorToHttpError(
  error: PartitionRouteError,
): HttpError {
  return partitionRouteErrorToHttpError(error);
}
