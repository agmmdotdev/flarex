import type {
  LiveQueryDeliveryChange,
  LiveQueryDeliveryChangePayloadError,
} from "../liveQueryDelivery";
import type { ConnectionQueryId } from "flarex-protocol/connection";
import { Effect } from "effect";
import { readJsonEffect, RequestJsonError } from "../http";
import {
  ConnectionRouteValidationError,
  decodeConnectionInvalidationPayload,
  decodeConnectionLiveQueryDeliveryPayload,
} from "./Requests";

export {
  ConnectionRouteValidationError,
  decodeConnectionInvalidationPayload,
  decodeConnectionLiveQueryDeliveryPayload,
} from "./Requests";

export type ConnectionRouteError =
  | RequestJsonError
  | ConnectionRouteValidationError
  | LiveQueryDeliveryChangePayloadError;

export const decodeConnectionInvalidationRequest = Effect.fn(
  "ConnectionRouteBoundary.decodeInvalidationRequest",
)((
  request: Request,
): Effect.Effect<ConnectionQueryId, ConnectionRouteError> =>
  readJsonEffect(request).pipe(
    Effect.flatMap(decodeConnectionInvalidationRoutePayload),
  ));

export const decodeConnectionInvalidationRoutePayload = Effect.fn(
  "ConnectionRouteBoundary.decodeInvalidationPayload",
)((
  value: unknown,
): Effect.Effect<ConnectionQueryId, ConnectionRouteValidationError> =>
  decodeConnectionInvalidationPayload(value));

export const decodeConnectionLiveQueryDeliveryRequest = Effect.fn(
  "ConnectionRouteBoundary.decodeLiveQueryDeliveryRequest",
)((
  request: Request,
): Effect.Effect<LiveQueryDeliveryChange[], ConnectionRouteError> =>
  readJsonEffect(request).pipe(
    Effect.flatMap(decodeConnectionLiveQueryDeliveryRoutePayload),
  ));

export const decodeConnectionLiveQueryDeliveryRoutePayload = Effect.fn(
  "ConnectionRouteBoundary.decodeLiveQueryDeliveryPayload",
)((
  value: unknown,
): Effect.Effect<LiveQueryDeliveryChange[], LiveQueryDeliveryChangePayloadError> =>
  decodeConnectionLiveQueryDeliveryPayload(value));
