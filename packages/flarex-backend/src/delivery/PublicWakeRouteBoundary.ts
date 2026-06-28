import {
  parseDeliveryWakeRequest,
  type DeliveryWakeRequest,
} from "./RouteBoundary";
import { HttpError, readJson } from "../http";

export async function readPublicDeliveryWakeRequest(
  request: Request,
  deploymentId: string,
): Promise<DeliveryWakeRequest> {
  return parsePublicDeliveryWakeRequest(await readJson(request), deploymentId);
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
