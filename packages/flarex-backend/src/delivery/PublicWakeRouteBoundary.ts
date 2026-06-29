import {
  DeliveryWakeRouteValidationError,
  deliveryWakeRouteErrorToHttpError,
  parseDeliveryWakeRequestEffect,
  parseDeliveryWakeRequest,
  type DeliveryWakeRequest,
  type DeliveryWakeRouteError,
} from "./RouteBoundary";
import { Effect } from "effect";
import {
  HttpError,
  readJsonEffect,
} from "../http";

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
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "Delivery wake request body must be an object.");
  }
  return parseDeliveryWakeRequest({
    ...(value as Record<string, unknown>),
    deploymentId,
  });
}

export function parsePublicDeliveryWakeRequestEffect(
  value: unknown,
  deploymentId: string,
): Effect.Effect<DeliveryWakeRequest, DeliveryWakeRouteValidationError> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return Effect.fail(new DeliveryWakeRouteValidationError({
      message: "Delivery wake request body must be an object.",
    }));
  }
  return parseDeliveryWakeRequestEffect({
    ...(value as Record<string, unknown>),
    deploymentId,
  });
}

export function publicDeliveryWakeRouteErrorToHttpError(error: DeliveryWakeRouteError): HttpError {
  return deliveryWakeRouteErrorToHttpError(error);
}
