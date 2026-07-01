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

export async function readDeliveryWakeRequest(
  request: Request,
): Promise<DeliveryWakeRequest> {
  return runDeliveryWakeRouteEffect(decodeDeliveryWakeRequest(request));
}

export function decodeDeliveryWakeRequest(
  request: Request,
): Effect.Effect<DeliveryWakeRequest, DeliveryWakeRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodeDeliveryWakeRoutePayload),
  );
}

export function parseDeliveryWakeRequest(value: unknown): DeliveryWakeRequest {
  return Effect.runSync(parseDeliveryWakeRequestEffect(value).pipe(
    Effect.catch(deliveryWakeRouteErrorToHttpErrorEffect),
  ));
}

export function parseDeliveryWakeRequestEffect(
  value: unknown,
): Effect.Effect<DeliveryWakeRequest, DeliveryWakePayloadError> {
  return decodeDeliveryWakeRoutePayload(value);
}

export function decodeDeliveryWakeRoutePayload(
  value: unknown,
): Effect.Effect<DeliveryWakeRequest, DeliveryWakePayloadError> {
  return decodeDeliveryWakePayload(value);
}

function runDeliveryWakeRouteEffect<A>(
  effect: Effect.Effect<A, DeliveryWakeRouteError>,
): Promise<A> {
  return Effect.runPromise(effect.pipe(
    Effect.catch(deliveryWakeRouteErrorToHttpErrorEffect),
  ));
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
