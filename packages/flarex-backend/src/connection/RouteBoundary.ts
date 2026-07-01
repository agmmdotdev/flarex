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
  parseConnectionInvalidationPayload,
} from "./Requests";

export {
  ConnectionRouteValidationError,
  decodeConnectionInvalidationPayload,
  decodeConnectionLiveQueryDeliveryPayload,
  parseConnectionInvalidationPayload,
} from "./Requests";

export type ConnectionRouteError =
  | RequestJsonError
  | ConnectionRouteValidationError
  | LiveQueryDeliveryChangePayloadError;

export async function readConnectionInvalidationRequest(
  request: Request,
): Promise<QueryId> {
  return runConnectionRouteEffect(decodeConnectionInvalidationRequest(request));
}

export function decodeConnectionInvalidationRequest(
  request: Request,
): Effect.Effect<QueryId, ConnectionRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodeConnectionInvalidationRoutePayload),
  );
}

export function parseConnectionInvalidationRequest(value: unknown): QueryId {
  return Effect.runSync(parseConnectionInvalidationRequestEffect(value).pipe(
    Effect.catch(connectionRouteErrorToHttpErrorEffect),
  ));
}

export function parseConnectionInvalidationRequestEffect(
  value: unknown,
): Effect.Effect<QueryId, ConnectionRouteValidationError> {
  return decodeConnectionInvalidationRoutePayload(value);
}

export function decodeConnectionInvalidationRoutePayload(
  value: unknown,
): Effect.Effect<QueryId, ConnectionRouteValidationError> {
  return decodeConnectionInvalidationPayload(value);
}

export async function readConnectionLiveQueryDeliveryRequest(
  request: Request,
): Promise<LiveQueryDeliveryChange[]> {
  return runConnectionRouteEffect(decodeConnectionLiveQueryDeliveryRequest(request));
}

export function decodeConnectionLiveQueryDeliveryRequest(
  request: Request,
): Effect.Effect<LiveQueryDeliveryChange[], ConnectionRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodeConnectionLiveQueryDeliveryRoutePayload),
  );
}

export function parseConnectionLiveQueryDeliveryRequest(
  value: unknown,
): LiveQueryDeliveryChange[] {
  return Effect.runSync(parseConnectionLiveQueryDeliveryRequestEffect(value).pipe(
    Effect.catch(connectionRouteErrorToHttpErrorEffect),
  ));
}

export function parseConnectionLiveQueryDeliveryRequestEffect(
  value: unknown,
): Effect.Effect<LiveQueryDeliveryChange[], LiveQueryDeliveryChangePayloadError> {
  return decodeConnectionLiveQueryDeliveryRoutePayload(value);
}

export function decodeConnectionLiveQueryDeliveryRoutePayload(
  value: unknown,
): Effect.Effect<LiveQueryDeliveryChange[], LiveQueryDeliveryChangePayloadError> {
  return decodeConnectionLiveQueryDeliveryPayload(value);
}

function runConnectionRouteEffect<A>(effect: Effect.Effect<A, ConnectionRouteError>): Promise<A> {
  return Effect.runPromise(effect.pipe(
    Effect.catch(connectionRouteErrorToHttpErrorEffect),
  ));
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
