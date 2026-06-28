import {
  parseSchedulerDeliveryReconcileRequest,
  readSchedulerDeliveryReconcileRequest,
  type SchedulerDeliveryReconcileRequest,
} from "./RouteBoundary";

export async function readPublicSchedulerDeliveryReconcileRequest(
  request: Request,
): Promise<SchedulerDeliveryReconcileRequest> {
  return readSchedulerDeliveryReconcileRequest(request);
}

export function parsePublicSchedulerDeliveryReconcileRequest(
  value: unknown,
): SchedulerDeliveryReconcileRequest {
  return parseSchedulerDeliveryReconcileRequest(value);
}
