import { Data, Effect, Schema } from "effect";
import {
  decodeLiveQueryDeliveryChangesFromBody,
  type LiveQueryDeliveryChange,
  type LiveQueryDeliveryChangePayloadError,
} from "../liveQueryDelivery";
import type { QueryId } from "../syncProtocol";

export class ConnectionRouteValidationError extends Data.TaggedError("ConnectionRouteValidationError")<{
  readonly message: string;
}> {}

const ConnectionQueryId = Schema.declare<QueryId>(
  (value): value is QueryId => typeof value === "number" && Number.isInteger(value),
  { title: "ConnectionQueryId" },
);

const ConnectionInvalidationPayload = Schema.Struct({
  queryId: ConnectionQueryId,
});

const decodeUnknownConnectionInvalidationPayload = Schema.decodeUnknownEffect(
  ConnectionInvalidationPayload,
);

export const decodeConnectionInvalidationPayload = Effect.fn(
  "ConnectionRequests.decodeInvalidationPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<QueryId, ConnectionRouteValidationError> {
  const decoded = yield* decodeUnknownConnectionInvalidationPayload(value).pipe(
    Effect.mapError(() =>
      connectionRouteValidationFailure("Invalidation queryId must be an integer."),
    ),
  );
  return decoded.queryId;
});

export const decodeConnectionLiveQueryDeliveryPayload = Effect.fn(
  "ConnectionRequests.decodeLiveQueryDeliveryPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<LiveQueryDeliveryChange[], LiveQueryDeliveryChangePayloadError> {
  return yield* decodeLiveQueryDeliveryChangesFromBody(value);
});

function connectionRouteValidationFailure(
  message: string,
): ConnectionRouteValidationError {
  return new ConnectionRouteValidationError({ message });
}
