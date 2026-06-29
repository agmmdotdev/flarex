import { liveQueryDeliveryChangesFromBody, type LiveQueryDeliveryChange } from "../liveQueryDelivery";
import { Data, Effect } from "effect";
import {
  HttpError,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "../http";
import type { QueryId } from "../syncProtocol";

export class ConnectionRouteValidationError extends Data.TaggedError("ConnectionRouteValidationError")<{
  readonly message: string;
}> {}

export type ConnectionRouteError = RequestJsonError | ConnectionRouteValidationError;

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
  return unwrapConnectionRouteValidation(normalizeConnectionInvalidationRequest(value));
}

export function parseConnectionInvalidationRequestEffect(
  value: unknown,
): Effect.Effect<QueryId, ConnectionRouteValidationError> {
  return connectionRouteValidationResultToEffect(normalizeConnectionInvalidationRequest(value));
}

function normalizeConnectionInvalidationRequest(value: unknown): ConnectionRouteValidationResult<QueryId> {
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
  try {
    return liveQueryDeliveryChangesFromBody(value);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, error instanceof Error ? error.message : String(error));
  }
}

export function parseConnectionLiveQueryDeliveryRequestEffect(
  value: unknown,
): Effect.Effect<LiveQueryDeliveryChange[], ConnectionRouteValidationError> {
  return Effect.try({
    try: () => liveQueryDeliveryChangesFromBody(value),
    catch: error => new ConnectionRouteValidationError({
      message: error instanceof Error ? error.message : String(error),
    }),
  });
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

function connectionRouteValidationFailure<A = never>(message: string): ConnectionRouteValidationResult<A> {
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

function unwrapConnectionRouteValidation<A>(result: ConnectionRouteValidationResult<A>): A {
  if (result.success) return result.value;
  throw connectionRouteErrorToHttpError(result.error);
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
  return new HttpError(400, error.message);
}
