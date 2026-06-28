import {
  parseSchedulerCleanupConnectionsRequest,
  parseSchedulerConnectionReconcileRequest,
  parseSchedulerDeadLetterDeliveriesRequest,
  parseSchedulerDeliveryReconcileRequest,
  readSchedulerCleanupConnectionsRequest,
  readSchedulerConnectionReconcileRequest,
  readSchedulerDeadLetterDeliveriesRequest,
  readSchedulerDeliveryReconcileRequest,
  type SchedulerCleanupConnectionsRequest,
  type SchedulerConnectionReconcileRequest,
  type SchedulerDeadLetterDeliveriesRequest,
  type SchedulerDeliveryReconcileRequest,
} from "./RouteBoundary";
import type { Env } from "../types";

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

export async function readPublicSchedulerCleanupConnectionsRequest(
  request: Request,
  env: Env,
): Promise<SchedulerCleanupConnectionsRequest> {
  return readSchedulerCleanupConnectionsRequest(request, env);
}

export function parsePublicSchedulerCleanupConnectionsRequest(
  value: unknown,
  env: Env,
): SchedulerCleanupConnectionsRequest {
  return parseSchedulerCleanupConnectionsRequest(value, env);
}
