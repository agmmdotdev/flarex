import { Effect } from "effect";
import {
  type PartitionRouteError,
  type PartitionSchemaCacheRequest,
  type PartitionRoutePayloadError,
} from "./RouteBoundary";
import { readJsonEffect } from "../http";
import { decodePublicPartitionSchemaCachePayload } from "./Requests";

export const decodePublicPartitionSchemaCacheRequest = Effect.fn(
  "PublicSchemaCacheRouteBoundary.decodeRequest",
)(function* (
  request: Request,
  partitionKey: string,
): Effect.fn.Return<PartitionSchemaCacheRequest, PartitionRouteError> {
  return yield* readJsonEffect(request).pipe(
    Effect.flatMap(value => decodePublicPartitionSchemaCacheRoutePayload(value, partitionKey)),
  );
});

export const decodePublicPartitionSchemaCacheRoutePayload = Effect.fn(
  "PublicSchemaCacheRouteBoundary.decodePayload",
)(function* (
  value: unknown,
  partitionKey: string,
): Effect.fn.Return<PartitionSchemaCacheRequest, PartitionRoutePayloadError> {
  return yield* decodePublicPartitionSchemaCachePayload(value, partitionKey);
});
