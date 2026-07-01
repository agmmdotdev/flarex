import type {
  LiveQueryDeliveryChange,
  LiveQueryDeliveryChangePayloadError,
} from "../liveQueryDelivery";
import { Effect } from "effect";
import { readJsonEffect, RequestJsonError } from "../http";
import type { QueryId } from "../syncProtocol";
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
)(function* (
  request: Request,
): Effect.fn.Return<QueryId, ConnectionRouteError> {
  return yield* readJsonEffect(request).pipe(
    Effect.flatMap(decodeConnectionInvalidationRoutePayload),
  );
});

export const decodeConnectionInvalidationRoutePayload = Effect.fn(
  "ConnectionRouteBoundary.decodeInvalidationPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<QueryId, ConnectionRouteValidationError> {
  return yield* decodeConnectionInvalidationPayload(value);
});

export const decodeConnectionLiveQueryDeliveryRequest = Effect.fn(
  "ConnectionRouteBoundary.decodeLiveQueryDeliveryRequest",
)(function* (
  request: Request,
): Effect.fn.Return<LiveQueryDeliveryChange[], ConnectionRouteError> {
  return yield* readJsonEffect(request).pipe(
    Effect.flatMap(decodeConnectionLiveQueryDeliveryRoutePayload),
  );
});

export const decodeConnectionLiveQueryDeliveryRoutePayload = Effect.fn(
  "ConnectionRouteBoundary.decodeLiveQueryDeliveryPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<LiveQueryDeliveryChange[], LiveQueryDeliveryChangePayloadError> {
  return yield* decodeConnectionLiveQueryDeliveryPayload(value);
});
