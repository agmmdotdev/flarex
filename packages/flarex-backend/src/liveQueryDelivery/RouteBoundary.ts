import { Effect } from "effect";
import { readJsonEffect, RequestJsonError } from "../http";
import {
  decodeLiveQueryDeliveryChangesFromBody,
  type LiveQueryDeliveryChangePayloadError,
  type LiveQueryDeliveryChange,
} from "../liveQueryDelivery";

export type LiveQueryDeliveryRouteError = RequestJsonError | LiveQueryDeliveryChangePayloadError;

export const decodePublicLiveQueryDeliveryRequest = Effect.fn(
  "PublicLiveQueryDeliveryRouteBoundary.decodeRequest",
)(function* (
  request: Request,
): Effect.fn.Return<LiveQueryDeliveryChange[], LiveQueryDeliveryRouteError> {
  return yield* readJsonEffect(request).pipe(
    Effect.flatMap(decodePublicLiveQueryDeliveryRoutePayload),
  );
});

export const decodePublicLiveQueryDeliveryRoutePayload = Effect.fn(
  "PublicLiveQueryDeliveryRouteBoundary.decodePayload",
)(function* (
  value: unknown,
): Effect.fn.Return<LiveQueryDeliveryChange[], LiveQueryDeliveryChangePayloadError> {
  return yield* decodeLiveQueryDeliveryChangesFromBody(value);
});
