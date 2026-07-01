import { Effect } from "effect";
import {
  errorResponse,
  HttpError,
  json,
} from "../http";
import {
  deliveryPendingDrainStateErrorToHttpError,
  DeliveryPendingDrainStateError,
} from "./PendingDrainState";
import {
  DeliveryRouteOperationError,
  deliveryRouteOperationErrorToHttpError,
} from "./RouteOperationError";
import {
  deliveryWakeRouteErrorToHttpError,
  type DeliveryWakeRouteError,
} from "./RouteBoundary";

type DeliveryDrainFailureLike = {
  readonly _tag: "DeliveryDrainFailureError";
  readonly result: object;
};

export type DeliveryInternalRouteError =
  | DeliveryWakeRouteError
  | DeliveryRouteOperationError
  | DeliveryPendingDrainStateError
  | DeliveryDrainFailureLike;

export function deliveryInternalRouteErrorToResponse(
  error: DeliveryInternalRouteError,
): Response {
  if (isDeliveryDrainFailure(error)) {
    return json(error.result, { status: 500 });
  }
  return errorResponse(deliveryInternalRouteErrorToHttpError(error));
}

export const deliveryInternalRouteErrorToResponseEffect = Effect.fn(
  "DeliveryInternalRouteBoundary.errorToResponse",
)(function* (
  error: DeliveryInternalRouteError,
): Effect.fn.Return<Response> {
  return yield* Effect.succeed(deliveryInternalRouteErrorToResponse(error));
});

export function deliveryInternalRouteErrorToHttpError(
  error: Exclude<DeliveryInternalRouteError, DeliveryDrainFailureLike>,
): HttpError {
  if (error instanceof DeliveryRouteOperationError) {
    return deliveryRouteOperationErrorToHttpError(error);
  }
  if (error instanceof DeliveryPendingDrainStateError) {
    return deliveryPendingDrainStateErrorToHttpError(error);
  }
  return deliveryWakeRouteErrorToHttpError(error);
}

export const deliveryInternalRouteErrorToHttpErrorEffect = Effect.fn(
  "DeliveryInternalRouteBoundary.errorToHttpError",
)(function* (
  error: Exclude<DeliveryInternalRouteError, DeliveryDrainFailureLike>,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(deliveryInternalRouteErrorToHttpError(error));
});

function isDeliveryDrainFailure(
  error: DeliveryInternalRouteError,
): error is DeliveryDrainFailureLike {
  return error._tag === "DeliveryDrainFailureError";
}
