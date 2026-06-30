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
    Effect.flatMap(parseConnectionInvalidationRequestEffect),
  );
}

export function parseConnectionInvalidationRequest(value: unknown): QueryId {
  try {
    return parseConnectionInvalidationPayload(value);
  } catch (error) {
    if (error instanceof ConnectionRouteValidationError) {
      throw connectionRouteErrorToHttpError(error);
    }
    throw error;
  }
}

export function parseConnectionInvalidationRequestEffect(
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
    Effect.flatMap(parseConnectionLiveQueryDeliveryRequestEffect),
  );
}

export function parseConnectionLiveQueryDeliveryRequest(
  value: unknown,
): LiveQueryDeliveryChange[] {
  return Effect.runSync(parseConnectionLiveQueryDeliveryRequestEffect(value).pipe(
    Effect.mapError(connectionRouteErrorToHttpError),
  ));
}

export function parseConnectionLiveQueryDeliveryRequestEffect(
  value: unknown,
): Effect.Effect<LiveQueryDeliveryChange[], LiveQueryDeliveryChangePayloadError> {
  return decodeConnectionLiveQueryDeliveryPayload(value);
}

function runConnectionRouteEffect<A>(effect: Effect.Effect<A, ConnectionRouteError>): Promise<A> {
  return Effect.runPromise(effect.pipe(
    Effect.mapError(connectionRouteErrorToHttpError),
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
