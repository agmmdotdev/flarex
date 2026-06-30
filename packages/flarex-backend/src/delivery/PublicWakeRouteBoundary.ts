import {
  deliveryWakeRouteErrorToHttpError,
  type DeliveryWakeRequest,
  type DeliveryWakeRouteError,
} from "./RouteBoundary";
import { Effect } from "effect";
import {
  HttpError,
  readJsonEffect,
} from "../http";
import { decodePublicDeliveryWakePayload } from "./WakeRequest";

export async function readPublicDeliveryWakeRequest(
  request: Request,
  deploymentId: string,
): Promise<DeliveryWakeRequest> {
  return Effect.runPromise(decodePublicDeliveryWakeRequest(request, deploymentId).pipe(
    Effect.mapError(publicDeliveryWakeRouteErrorToHttpError),
  ));
}

export function decodePublicDeliveryWakeRequest(
  request: Request,
  deploymentId: string,
): Effect.Effect<DeliveryWakeRequest, DeliveryWakeRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(value => parsePublicDeliveryWakeRequestEffect(value, deploymentId)),
  );
}

export function parsePublicDeliveryWakeRequest(
  value: unknown,
  deploymentId: string,
): DeliveryWakeRequest {
  return Effect.runSync(parsePublicDeliveryWakeRequestEffect(value, deploymentId).pipe(
    Effect.mapError(publicDeliveryWakeRouteErrorToHttpError),
  ));
}

export function parsePublicDeliveryWakeRequestEffect(
  value: unknown,
  deploymentId: string,
): Effect.Effect<DeliveryWakeRequest, DeliveryWakeRouteError> {
  return decodePublicDeliveryWakePayload(value, deploymentId);
}

export function publicDeliveryWakeRouteErrorToHttpError(error: DeliveryWakeRouteError): HttpError {
  return deliveryWakeRouteErrorToHttpError(error);
}
