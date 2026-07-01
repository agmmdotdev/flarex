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

export function decodePublicLiveQueryDeliveryRequest(
  request: Request,
): Effect.Effect<LiveQueryDeliveryChange[], LiveQueryDeliveryRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodePublicLiveQueryDeliveryRoutePayload),
  );
}

export function decodePublicLiveQueryDeliveryRoutePayload(
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

export const publicLiveQueryDeliveryRouteErrorToHttpErrorEffect = Effect.fn(
  "PublicLiveQueryDeliveryRouteBoundary.publicLiveQueryDeliveryRouteErrorToHttpError",
)(function* (
  error: LiveQueryDeliveryRouteError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(publicLiveQueryDeliveryRouteErrorToHttpError(error));
});
