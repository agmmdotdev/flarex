import {
  deliveryWakeRouteErrorToHttpErrorEffect,
  deliveryWakeRouteErrorToHttpError,
  type DeliveryWakeRequest,
  type DeliveryWakeRouteError,
} from "./RouteBoundary";
import { Effect } from "effect";
import {
  HttpError,
  readJsonEffect,
} from "../http";
import {
  decodePublicDeliveryWakePayload,
  type DeliveryWakePayloadError,
} from "./WakeRequest";

export function decodePublicDeliveryWakeRequest(
  request: Request,
  deploymentId: string,
): Effect.Effect<DeliveryWakeRequest, DeliveryWakeRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(value => decodePublicDeliveryWakeRoutePayload(value, deploymentId)),
  );
}

export function decodePublicDeliveryWakeRoutePayload(
  value: unknown,
  deploymentId: string,
): Effect.Effect<DeliveryWakeRequest, DeliveryWakePayloadError> {
  return decodePublicDeliveryWakePayload(value, deploymentId);
}

export function publicDeliveryWakeRouteErrorToHttpError(error: DeliveryWakeRouteError): HttpError {
  return deliveryWakeRouteErrorToHttpError(error);
}

export const publicDeliveryWakeRouteErrorToHttpErrorEffect = Effect.fn(
  "PublicWakeRouteBoundary.publicDeliveryWakeRouteErrorToHttpError",
)(function* (
  error: DeliveryWakeRouteError,
): Effect.fn.Return<never, HttpError> {
  return yield* deliveryWakeRouteErrorToHttpErrorEffect(error);
});
