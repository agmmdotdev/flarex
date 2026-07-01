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

export function decodeDeliveryWakeRequest(
  request: Request,
): Effect.Effect<DeliveryWakeRequest, DeliveryWakeRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodeDeliveryWakeRoutePayload),
  );
}

export function decodeDeliveryWakeRoutePayload(
  value: unknown,
): Effect.Effect<DeliveryWakeRequest, DeliveryWakePayloadError> {
  return decodeDeliveryWakePayload(value);
}

export function deliveryWakeRouteErrorToHttpError(error: DeliveryWakeRouteError): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return new HttpError(400, error.message);
}

export const deliveryWakeRouteErrorToHttpErrorEffect = Effect.fn(
  "DeliveryRouteBoundary.deliveryWakeRouteErrorToHttpError",
)(function* (
  error: DeliveryWakeRouteError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(deliveryWakeRouteErrorToHttpError(error));
});
