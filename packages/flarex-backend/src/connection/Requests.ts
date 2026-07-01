import { Data, Effect } from "effect";
import {
  decodeLiveQueryDeliveryChangesFromBody,
  type LiveQueryDeliveryChange,
  type LiveQueryDeliveryChangePayloadError,
} from "../liveQueryDelivery";
import type { QueryId } from "../syncProtocol";

export class ConnectionRouteValidationError extends Data.TaggedError("ConnectionRouteValidationError")<{
  readonly message: string;
}> {}

export const decodeConnectionInvalidationPayload = Effect.fn(
  "ConnectionRequests.decodeInvalidationPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<QueryId, ConnectionRouteValidationError> {
  return yield* connectionRouteValidationResultToEffect(
    normalizeConnectionInvalidationPayload(value),
  );
});

export const decodeConnectionLiveQueryDeliveryPayload = Effect.fn(
  "ConnectionRequests.decodeLiveQueryDeliveryPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<LiveQueryDeliveryChange[], LiveQueryDeliveryChangePayloadError> {
  return yield* decodeLiveQueryDeliveryChangesFromBody(value);
});

function normalizeConnectionInvalidationPayload(
  value: unknown,
): ConnectionRouteValidationResult<QueryId> {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { queryId?: unknown }).queryId === "number" &&
    Number.isInteger((value as { queryId: number }).queryId)
  ) {
    return connectionRouteValidationSuccess((value as { queryId: number }).queryId);
  }
  return connectionRouteValidationFailure("Invalidation queryId must be an integer.");
}

type ConnectionRouteValidationResult<A> =
  | {
      readonly success: true;
      readonly value: A;
    }
  | {
      readonly success: false;
      readonly error: ConnectionRouteValidationError;
    };

function connectionRouteValidationSuccess<A>(value: A): ConnectionRouteValidationResult<A> {
  return {
    success: true,
    value,
  };
}

function connectionRouteValidationFailure<A = never>(
  message: string,
): ConnectionRouteValidationResult<A> {
  return {
    success: false,
    error: new ConnectionRouteValidationError({ message }),
  };
}

function connectionRouteValidationResultToEffect<A>(
  result: ConnectionRouteValidationResult<A>,
): Effect.Effect<A, ConnectionRouteValidationError> {
  return result.success ? Effect.succeed(result.value) : Effect.fail(result.error);
}
