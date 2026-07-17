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
)(
  (
    request: Request,
    partitionKey: string,
  ): Effect.Effect<PartitionSchemaCacheRequest, PartitionRouteError> =>
    readJsonEffect(request).pipe(
      Effect.flatMap(value => decodePublicPartitionSchemaCacheRoutePayload(value, partitionKey)),
    ),
);

export const decodePublicPartitionSchemaCacheRoutePayload = Effect.fn(
  "PublicSchemaCacheRouteBoundary.decodePayload",
)(
  (
    value: unknown,
    partitionKey: string,
  ): Effect.Effect<PartitionSchemaCacheRequest, PartitionRoutePayloadError> =>
    decodePublicPartitionSchemaCachePayload(value, partitionKey),
);
