import {
  parseSchedulerConnectionReconcileRequest,
  parseSchedulerDeliveryReconcileRequest,
  readSchedulerConnectionReconcileRequest,
  readSchedulerDeliveryReconcileRequest,
  type SchedulerConnectionReconcileRequest,
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

export async function readPublicSchedulerConnectionReconcileRequest(
  request: Request,
): Promise<SchedulerConnectionReconcileRequest> {
  return readSchedulerConnectionReconcileRequest(request);
}

export function parsePublicSchedulerConnectionReconcileRequest(
  value: unknown,
): SchedulerConnectionReconcileRequest {
  return parseSchedulerConnectionReconcileRequest(value);
}
