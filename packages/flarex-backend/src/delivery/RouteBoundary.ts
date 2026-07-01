import { Effect } from "effect";
import { readJsonEffect, RequestJsonError } from "../http";
import {
  decodeDeliveryWakePayload,
  DeliveryWakePayloadError,
  type DeliveryWakeRequest,
} from "./WakeRequest";

export { DeliveryWakePayloadError, type DeliveryWakeRequest } from "./WakeRequest";

export type DeliveryWakeRouteError = RequestJsonError | DeliveryWakePayloadError;

export const decodeDeliveryWakeRequest = Effect.fn(
  "DeliveryRouteBoundary.decodeWakeRequest",
)(function* (
  request: Request,
): Effect.fn.Return<DeliveryWakeRequest, DeliveryWakeRouteError> {
  return yield* readJsonEffect(request).pipe(
    Effect.flatMap(decodeDeliveryWakeRoutePayload),
  );
});

export const decodeDeliveryWakeRoutePayload = Effect.fn(
  "DeliveryRouteBoundary.decodeWakePayload",
)(function* (
  value: unknown,
): Effect.fn.Return<DeliveryWakeRequest, DeliveryWakePayloadError> {
  return yield* decodeDeliveryWakePayload(value);
});
