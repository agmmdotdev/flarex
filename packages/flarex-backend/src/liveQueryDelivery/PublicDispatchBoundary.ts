import { Effect } from "effect";
import {
  deliverLiveQueryChangesToConnectionsEffect,
  liveQueryDeliveryFanoutErrorToHttpError,
  LiveQueryDeliveryTargetError,
  type ConnectionLiveQueryDeliveryResult,
  type LiveQueryDeliveryChange,
} from "../liveQueryDelivery";
import type { Env } from "../types";
import {
  publicWorkerDispatchError,
  type PublicWorkerDispatchError,
} from "../worker/PublicRouteDispatchError";

export type PublicLiveQueryDeliveryDispatchError =
  | LiveQueryDeliveryTargetError
  | PublicWorkerDispatchError;

export const dispatchPublicLiveQueryDeliveryEffect = Effect.fn(
  "Worker.dispatchPublicLiveQueryDelivery",
)(function* (
  env: Env,
  deploymentId: string,
  deliveries: LiveQueryDeliveryChange[],
): Effect.fn.Return<
  ConnectionLiveQueryDeliveryResult,
  PublicLiveQueryDeliveryDispatchError
> {
  return yield* deliverLiveQueryChangesToConnectionsEffect(
    env,
    deploymentId,
    deliveries,
  ).pipe(
    Effect.mapError(error =>
      error instanceof LiveQueryDeliveryTargetError
        ? error
        : publicWorkerDispatchError(
          "live-query-delivery",
          liveQueryDeliveryFanoutErrorToHttpError(error),
        )
    ),
  );
});
