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

export function decodePublicPartitionSchemaCacheRequest(
  request: Request,
  partitionKey: string,
): Effect.Effect<PartitionSchemaCacheRequest, PartitionRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(value => decodePublicPartitionSchemaCacheRoutePayload(value, partitionKey)),
  );
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

export const publicPartitionSchemaCacheRouteErrorToHttpErrorEffect = Effect.fn(
  "PublicSchemaCacheRouteBoundary.publicPartitionSchemaCacheRouteErrorToHttpError",
)(function* (
  error: PartitionRouteError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(publicPartitionSchemaCacheRouteErrorToHttpError(error));
});
