import {
  liveQueryDeliveryChangePayloadErrorToHttpError,
  type LiveQueryDeliveryChange,
  type LiveQueryDeliveryChangePayloadError,
} from "../liveQueryDelivery";
import { Effect } from "effect";
import {
  HttpError,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "../http";
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

export function decodeConnectionInvalidationRequest(
  request: Request,
): Effect.Effect<QueryId, ConnectionRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodeConnectionInvalidationRoutePayload),
  );
}

export function decodeConnectionInvalidationRoutePayload(
  value: unknown,
): Effect.Effect<QueryId, ConnectionRouteValidationError> {
  return decodeConnectionInvalidationPayload(value);
}

export function decodeConnectionLiveQueryDeliveryRequest(
  request: Request,
): Effect.Effect<LiveQueryDeliveryChange[], ConnectionRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodeConnectionLiveQueryDeliveryRoutePayload),
  );
}

export function decodeConnectionLiveQueryDeliveryRoutePayload(
  value: unknown,
): Effect.Effect<LiveQueryDeliveryChange[], LiveQueryDeliveryChangePayloadError> {
  return decodeConnectionLiveQueryDeliveryPayload(value);
}

export function connectionRouteErrorToHttpError(error: ConnectionRouteError): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  if (error instanceof ConnectionRouteValidationError) {
    return new HttpError(400, error.message);
  }
  return liveQueryDeliveryChangePayloadErrorToHttpError(error);
}

export const connectionRouteErrorToHttpErrorEffect = Effect.fn(
  "ConnectionRouteBoundary.connectionRouteErrorToHttpError",
)(function* (
  error: ConnectionRouteError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(connectionRouteErrorToHttpError(error));
});
