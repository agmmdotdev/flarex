import { Effect } from "effect";
import {
  badRequestErrorToHttpError,
  errorResponse,
  type HttpError,
  json,
} from "../http";
import {
  SchedulerPendingStateError,
  schedulerPendingStateErrorToHttpError,
} from "./PendingState";
import {
  isSchedulerMaintenanceBoundaryError,
  schedulerMaintenanceBoundaryErrorToHttpError,
  type SchedulerMaintenanceBoundaryError,
} from "./MaintenanceBoundary";
import {
  isSchedulerDeliveryWakeBoundaryError,
  schedulerDeliveryWakeBoundaryErrorToHttpError,
  type SchedulerDeliveryWakeBoundaryError,
} from "./DeliveryWakeBoundary";
import {
  isSchedulerForceReconnectBoundaryError,
  schedulerForceReconnectBoundaryErrorToHttpError,
  type SchedulerForceReconnectBoundaryError,
} from "./ForceReconnectBoundary";
import type { SchedulerRouteError } from "./RouteBoundary";
import {
  SchedulerRouteOperationError,
  schedulerRouteOperationErrorToHttpError,
} from "./RouteOperationError";
import {
  isSchedulerRuntimeError,
  schedulerRuntimeErrorToHttpError,
  type SchedulerRuntimeError,
} from "./RuntimeError";
import {
  SchedulerResponseError,
  SchedulerResponsePayloadError,
  schedulerResponseErrorToHttpError,
  schedulerResponsePayloadErrorToHttpError,
} from "./Responses";

export type SchedulerInternalRouteError =
  | SchedulerRouteError
  | SchedulerPendingStateError
  | SchedulerResponseError
  | SchedulerResponsePayloadError
  | SchedulerRuntimeError
  | SchedulerMaintenanceBoundaryError
  | SchedulerDeliveryWakeBoundaryError
  | SchedulerForceReconnectBoundaryError
  | SchedulerRouteOperationError;

export function routeSchedulerEffectJsonResult<
  A extends object,
  E extends SchedulerInternalRouteError,
>(
  execute: () => Effect.Effect<A, E>,
): Effect.Effect<Response, E> {
  return execute().pipe(
    Effect.map(result => json(result)),
  );
}

export function routeSchedulerContinueConnectionCleanup<
  A extends object,
  E extends SchedulerInternalRouteError,
>(
  continueConnectionCleanup: () => Effect.Effect<A, E>,
): Effect.Effect<Response, E> {
  return routeSchedulerEffectJsonResult(
    continueConnectionCleanup,
  );
}

export function runSchedulerRoute(
  effect: Effect.Effect<Response, SchedulerInternalRouteError>,
): Promise<Response> {
  // Deliberate runtime bridge: Durable Object fetch handlers return Promises.
  return Effect.runPromise(
    effect.pipe(
      Effect.catch(schedulerInternalRouteErrorToResponseEffect),
    ),
  );
}

export const schedulerInternalRouteErrorToResponseEffect = Effect.fn(
  "SchedulerInternalRouteBoundary.errorToResponse",
)(
  (error: SchedulerInternalRouteError): Effect.Effect<Response> =>
    Effect.succeed(errorResponse(schedulerInternalRouteErrorToHttpError(error))),
);

export function schedulerInternalRouteErrorToHttpError(
  error: SchedulerInternalRouteError,
): HttpError {
  if (error instanceof SchedulerRouteOperationError) {
    return schedulerRouteOperationErrorToHttpError(error);
  }
  if (error instanceof SchedulerPendingStateError) {
    return schedulerPendingStateErrorToHttpError(error);
  }
  if (error instanceof SchedulerResponseError) {
    return schedulerResponseErrorToHttpError(error);
  }
  if (error instanceof SchedulerResponsePayloadError) {
    return schedulerResponsePayloadErrorToHttpError(error);
  }
  if (isSchedulerMaintenanceBoundaryError(error)) {
    return schedulerMaintenanceBoundaryErrorToHttpError(error);
  }
  if (isSchedulerDeliveryWakeBoundaryError(error)) {
    return schedulerDeliveryWakeBoundaryErrorToHttpError(error);
  }
  if (isSchedulerForceReconnectBoundaryError(error)) {
    return schedulerForceReconnectBoundaryErrorToHttpError(error);
  }
  if (isSchedulerRuntimeError(error)) {
    return schedulerRuntimeErrorToHttpError(error);
  }
  return schedulerRouteErrorToHttpError(error);
}

function schedulerRouteErrorToHttpError(error: SchedulerRouteError): HttpError {
  return badRequestErrorToHttpError(error);
}

export const schedulerInternalRouteErrorToHttpErrorEffect = Effect.fn(
  "SchedulerInternalRouteBoundary.errorToHttpError",
)(
  (error: SchedulerInternalRouteError): Effect.Effect<never, HttpError> =>
    Effect.fail(schedulerInternalRouteErrorToHttpError(error)),
);
