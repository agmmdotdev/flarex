import {
  type DeliveryWakeRequest,
  type DeliveryWakeRouteError,
} from "./RouteBoundary";
import { Effect } from "effect";
import { readJsonEffect } from "../http";
import {
  decodePublicDeliveryWakePayload,
  type DeliveryWakePayloadError,
} from "./WakeRequest";

export const decodePublicDeliveryWakeRequest = Effect.fn(
  "PublicWakeRouteBoundary.decodeWakeRequest",
)(function* (
  request: Request,
  deploymentId: string,
): Effect.fn.Return<DeliveryWakeRequest, DeliveryWakeRouteError> {
  return yield* readJsonEffect(request).pipe(
    Effect.flatMap(value => decodePublicDeliveryWakeRoutePayload(value, deploymentId)),
  );
});

export const decodePublicDeliveryWakeRoutePayload = Effect.fn(
  "PublicWakeRouteBoundary.decodeWakePayload",
)(function* (
  value: unknown,
  deploymentId: string,
): Effect.fn.Return<DeliveryWakeRequest, DeliveryWakePayloadError> {
  return yield* decodePublicDeliveryWakePayload(value, deploymentId);
});
