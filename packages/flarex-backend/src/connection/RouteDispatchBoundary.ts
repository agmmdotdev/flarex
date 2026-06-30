import { Effect } from "effect";
import type { LiveQueryDeliveryChange } from "../liveQueryDelivery";
import type { QueryId } from "../syncProtocol";
import {
  connectionRouteOperationError,
  type ConnectionRouteOperationError,
} from "./RouteOperationError";

export type ConnectionInvalidationHandler = (queryId: QueryId) => Promise<Response>;

export type ConnectionLiveQueryDeliveryHandler = (
  deliveries: LiveQueryDeliveryChange[],
) => Promise<Response>;

export const dispatchConnectionInvalidationEffect = Effect.fn(
  "ConnectionDO.dispatchInvalidation",
)(function* (
  invalidate: ConnectionInvalidationHandler,
  queryId: QueryId,
): Effect.fn.Return<Response, ConnectionRouteOperationError> {
  return yield* Effect.tryPromise({
    try: () => invalidate(queryId),
    catch: error => connectionRouteOperationError("invalidate", error),
  });
});

export const dispatchConnectionLiveQueryDeliveryEffect = Effect.fn(
  "ConnectionDO.dispatchLiveQueryDelivery",
)(function* (
  deliver: ConnectionLiveQueryDeliveryHandler,
  deliveries: LiveQueryDeliveryChange[],
): Effect.fn.Return<Response, ConnectionRouteOperationError> {
  return yield* Effect.tryPromise({
    try: () => deliver(deliveries),
    catch: error => connectionRouteOperationError("deliver-live-query", error),
  });
});
