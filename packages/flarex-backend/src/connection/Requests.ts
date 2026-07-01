import {
  ConnectionRouteValidationError,
  decodeConnectionInvalidationPayloadEffect,
  decodeConnectionLiveQueryDeliveryPayloadEffect,
} from "flarex-protocol/connection";
import type {
  LiveQueryDeliveryChange,
  LiveQueryDeliveryChangePayloadError,
} from "flarex-protocol/live-query";
import { Effect } from "effect";
import type { QueryId } from "../syncProtocol";

export { ConnectionRouteValidationError } from "flarex-protocol/connection";

export const decodeConnectionInvalidationPayload = Effect.fn(
  "ConnectionRequests.decodeInvalidationPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<QueryId, ConnectionRouteValidationError> {
  return yield* decodeConnectionInvalidationPayloadEffect(value).pipe(
    Effect.map(queryId => queryId as QueryId),
  );
});

export const decodeConnectionLiveQueryDeliveryPayload = Effect.fn(
  "ConnectionRequests.decodeLiveQueryDeliveryPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<LiveQueryDeliveryChange[], LiveQueryDeliveryChangePayloadError> {
  return yield* decodeConnectionLiveQueryDeliveryPayloadEffect(value);
});
