import { Data, Effect } from "effect";
import {
  HttpError,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "../http";
import {
  liveQueryDeliveryChangesFromBody,
  type LiveQueryDeliveryChange,
} from "../liveQueryDelivery";

export class LiveQueryDeliveryRouteValidationError extends Data.TaggedError("LiveQueryDeliveryRouteValidationError")<{
  readonly message: string;
}> {}

export type LiveQueryDeliveryRouteError = RequestJsonError | LiveQueryDeliveryRouteValidationError;

export async function readPublicLiveQueryDeliveryRequest(
  request: Request,
): Promise<LiveQueryDeliveryChange[]> {
  return Effect.runPromise(decodePublicLiveQueryDeliveryRequest(request).pipe(
    Effect.mapError(publicLiveQueryDeliveryRouteErrorToHttpError),
  ));
}

export function decodePublicLiveQueryDeliveryRequest(
  request: Request,
): Effect.Effect<LiveQueryDeliveryChange[], LiveQueryDeliveryRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(parsePublicLiveQueryDeliveryRequestEffect),
  );
}

export function parsePublicLiveQueryDeliveryRequest(
  value: unknown,
): LiveQueryDeliveryChange[] {
  try {
    return liveQueryDeliveryChangesFromBody(value);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, error instanceof Error ? error.message : String(error));
  }
}

export function parsePublicLiveQueryDeliveryRequestEffect(
  value: unknown,
): Effect.Effect<LiveQueryDeliveryChange[], LiveQueryDeliveryRouteValidationError> {
  return Effect.try({
    try: () => liveQueryDeliveryChangesFromBody(value),
    catch: error => new LiveQueryDeliveryRouteValidationError({
      message: error instanceof Error ? error.message : String(error),
    }),
  });
}

export function publicLiveQueryDeliveryRouteErrorToHttpError(
  error: LiveQueryDeliveryRouteError,
): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return new HttpError(400, error.message);
}
