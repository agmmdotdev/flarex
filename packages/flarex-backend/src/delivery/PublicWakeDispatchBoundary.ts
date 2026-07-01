import { Effect } from "effect";
import type { DeliveryWakeRequest } from "./RouteBoundary";
import {
  publicWorkerDispatchError,
  type PublicWorkerDispatchError,
} from "../worker/PublicRouteDispatchError";

export interface PublicDeliveryWakeDispatchTarget {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export const dispatchPublicDeliveryWakeEffect = Effect.fn(
  "Worker.dispatchPublicDeliveryWake",
)(function* (
  delivery: PublicDeliveryWakeDispatchTarget,
  body: DeliveryWakeRequest,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* Effect.tryPromise({
    try: () =>
      delivery.fetch("https://flarex.internal/wake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    catch: error => publicWorkerDispatchError("delivery-wake", error),
  });
});
