import { Effect } from "effect";
import {
  HttpError,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "../http";
import {
  decodeLiveQueryDeliveryChangesFromBody,
  liveQueryDeliveryChangePayloadErrorToHttpError,
  type LiveQueryDeliveryChangePayloadError,
  type LiveQueryDeliveryChange,
} from "../liveQueryDelivery";

export type LiveQueryDeliveryRouteError = RequestJsonError | LiveQueryDeliveryChangePayloadError;

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
  return Effect.runSync(parsePublicLiveQueryDeliveryRequestEffect(value).pipe(
    Effect.mapError(publicLiveQueryDeliveryRouteErrorToHttpError),
  ));
}

export function parsePublicLiveQueryDeliveryRequestEffect(
  value: unknown,
): Effect.Effect<LiveQueryDeliveryChange[], LiveQueryDeliveryChangePayloadError> {
  return decodeLiveQueryDeliveryChangesFromBody(value);
}

export function publicLiveQueryDeliveryRouteErrorToHttpError(
  error: LiveQueryDeliveryRouteError,
): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return liveQueryDeliveryChangePayloadErrorToHttpError(error);
}
