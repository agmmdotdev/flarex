import {
  parseSchedulerConnectionReconcileRequest,
  parseSchedulerDeadLetterDeliveriesRequest,
  parseSchedulerDeliveryReconcileRequest,
  readSchedulerConnectionReconcileRequest,
  readSchedulerDeadLetterDeliveriesRequest,
  readSchedulerDeliveryReconcileRequest,
  type SchedulerConnectionReconcileRequest,
  type SchedulerDeadLetterDeliveriesRequest,
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

export async function readPublicSchedulerDeadLetterDeliveriesRequest(
  request: Request,
): Promise<SchedulerDeadLetterDeliveriesRequest> {
  return readSchedulerDeadLetterDeliveriesRequest(request);
}

export function parsePublicSchedulerDeadLetterDeliveriesRequest(
  value: unknown,
): SchedulerDeadLetterDeliveriesRequest {
  return parseSchedulerDeadLetterDeliveriesRequest(value);
}
