import {
  ConnectionRouteValidationError,
  decodeConnectionInvalidationPayloadEffect,
  decodeConnectionLiveQueryDeliveryPayloadEffect,
  type ConnectionQueryId,
} from "flarex-protocol/connection";
import type {
  LiveQueryDeliveryChange,
  LiveQueryDeliveryChangePayloadError,
} from "flarex-protocol/live-query";
import { Effect } from "effect";

export { ConnectionRouteValidationError } from "flarex-protocol/connection";

export const decodeConnectionInvalidationPayload = Effect.fn(
  "ConnectionRequests.decodeInvalidationPayload",
)((
  value: unknown,
): Effect.Effect<ConnectionQueryId, ConnectionRouteValidationError> =>
  decodeConnectionInvalidationPayloadEffect(value));

export const decodeConnectionLiveQueryDeliveryPayload = Effect.fn(
  "ConnectionRequests.decodeLiveQueryDeliveryPayload",
)((
  value: unknown,
): Effect.Effect<LiveQueryDeliveryChange[], LiveQueryDeliveryChangePayloadError> =>
  decodeConnectionLiveQueryDeliveryPayloadEffect(value));
