import { Data } from "effect";
import type { HttpError } from "../http";
import {
  routeOperationErrorFields,
  routeOperationErrorToHttpError as sharedRouteOperationErrorToHttpError,
  type RouteOperationErrorFields,
} from "../routeOperationError";

export type DeliveryRouteOperation =
  | "wake"
  | "continue";

export class DeliveryRouteOperationError extends Data.TaggedError(
  "DeliveryRouteOperationError",
)<RouteOperationErrorFields<DeliveryRouteOperation>> {}

export function deliveryRouteOperationError(
  operation: DeliveryRouteOperation,
  cause: unknown,
): DeliveryRouteOperationError {
  return new DeliveryRouteOperationError(
    routeOperationErrorFields(operation, cause),
  );
}

export function deliveryRouteOperationErrorToHttpError(
  error: DeliveryRouteOperationError,
): HttpError {
  return sharedRouteOperationErrorToHttpError(error);
}
