import { Effect } from "effect";
import {
  HttpError,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "../http";
import {
  decodeDeliveryWakePayload,
  DeliveryWakePayloadError,
  type DeliveryWakeRequest,
} from "./WakeRequest";

export { DeliveryWakePayloadError, type DeliveryWakeRequest } from "./WakeRequest";

export type DeliveryWakeRouteError = RequestJsonError | DeliveryWakePayloadError;

export function deliveryWakeRouteErrorToHttpError(
  error: DeliveryWakeRouteError,
): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  if (error instanceof DeliveryWakePayloadError) {
    return new HttpError(400, error.message);
  }
  return new HttpError(500, "Unexpected delivery wake route error.");
}

export const decodeDeliveryWakeRequest = Effect.fn(
  "DeliveryRouteBoundary.decodeWakeRequest",
)(
  (request: Request): Effect.Effect<DeliveryWakeRequest, DeliveryWakeRouteError> =>
    readJsonEffect(request).pipe(
      Effect.flatMap(decodeDeliveryWakeRoutePayload),
    ),
);

export const decodeDeliveryWakeRoutePayload = Effect.fn(
  "DeliveryRouteBoundary.decodeWakePayload",
)(
  (value: unknown): Effect.Effect<DeliveryWakeRequest, DeliveryWakePayloadError> =>
    decodeDeliveryWakePayload(value),
);
