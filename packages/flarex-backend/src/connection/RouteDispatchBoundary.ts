import { Effect } from "effect";
import type { ConnectionQueryId } from "flarex-protocol/connection";
import type { LiveQueryDeliveryChange } from "../liveQueryDelivery";
import {
  connectionRouteOperationError,
  type ConnectionRouteOperationError,
} from "./RouteOperationError";

export type ConnectionInvalidationHandler = (
  queryId: ConnectionQueryId,
) => Promise<Response>;

export type ConnectionLiveQueryDeliveryHandler = (
  deliveries: LiveQueryDeliveryChange[],
) => Promise<Response>;

export const dispatchConnectionInvalidationEffect = Effect.fn(
  "ConnectionDO.dispatchInvalidation",
)((
  invalidate: ConnectionInvalidationHandler,
  queryId: ConnectionQueryId,
): Effect.Effect<Response, ConnectionRouteOperationError> =>
  Effect.tryPromise({
    try: () => invalidate(queryId),
    catch: error => connectionRouteOperationError("invalidate", error),
  }));

export const dispatchConnectionLiveQueryDeliveryEffect = Effect.fn(
  "ConnectionDO.dispatchLiveQueryDelivery",
)((
  deliver: ConnectionLiveQueryDeliveryHandler,
  deliveries: LiveQueryDeliveryChange[],
): Effect.Effect<Response, ConnectionRouteOperationError> =>
  Effect.tryPromise({
    try: () => deliver(deliveries),
    catch: error => connectionRouteOperationError("deliver-live-query", error),
  }));
