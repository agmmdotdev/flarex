import {
  decodeSchedulerCleanupConnectionsRequest,
  decodeSchedulerConnectionReconcileRequest,
  decodeSchedulerDeadLetterDeliveriesRequest,
  decodeSchedulerDeliveryReconcileRequest,
  decodeSchedulerRerunSubscriptionsRequest,
  parseSchedulerCleanupConnectionsRequest,
  parseSchedulerConnectionReconcileRequest,
  parseSchedulerDeadLetterDeliveriesRequest,
  parseSchedulerDeliveryReconcileRequest,
  parseSchedulerRerunSubscriptionsRequest,
  readSchedulerCleanupConnectionsRequest,
  readSchedulerConnectionReconcileRequest,
  readSchedulerDeadLetterDeliveriesRequest,
  readSchedulerDeliveryReconcileRequest,
  readSchedulerRerunSubscriptionsRequest,
  type SchedulerCleanupConnectionsRequest,
  type SchedulerConnectionReconcileRequest,
  type SchedulerDeadLetterDeliveriesRequest,
  type SchedulerDeliveryReconcileRequest,
  type SchedulerRouteError,
  type SchedulerRerunSubscriptionsRequest,
  schedulerRouteErrorToHttpError,
} from "./RouteBoundary";
import type { Effect } from "effect";
import type { HttpError } from "../http";
import type { Env } from "../types";

export async function readPublicSchedulerDeliveryReconcileRequest(
  request: Request,
): Promise<SchedulerDeliveryReconcileRequest> {
  return readSchedulerDeliveryReconcileRequest(request);
}

export function decodePublicSchedulerDeliveryReconcileRequest(
  request: Request,
): Effect.Effect<SchedulerDeliveryReconcileRequest, SchedulerRouteError> {
  return decodeSchedulerDeliveryReconcileRequest(request);
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

export function decodePublicSchedulerConnectionReconcileRequest(
  request: Request,
): Effect.Effect<SchedulerConnectionReconcileRequest, SchedulerRouteError> {
  return decodeSchedulerConnectionReconcileRequest(request);
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

export function decodePublicSchedulerDeadLetterDeliveriesRequest(
  request: Request,
): Effect.Effect<SchedulerDeadLetterDeliveriesRequest, SchedulerRouteError> {
  return decodeSchedulerDeadLetterDeliveriesRequest(request);
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

export function decodePublicSchedulerCleanupConnectionsRequest(
  request: Request,
  env: Env,
): Effect.Effect<SchedulerCleanupConnectionsRequest, SchedulerRouteError> {
  return decodeSchedulerCleanupConnectionsRequest(request, env);
}

export function parsePublicSchedulerCleanupConnectionsRequest(
  value: unknown,
  env: Env,
): SchedulerCleanupConnectionsRequest {
  return parseSchedulerCleanupConnectionsRequest(value, env);
}

export async function readPublicSchedulerRerunSubscriptionsRequest(
  request: Request,
): Promise<SchedulerRerunSubscriptionsRequest> {
  return readSchedulerRerunSubscriptionsRequest(request);
}

export function decodePublicSchedulerRerunSubscriptionsRequest(
  request: Request,
): Effect.Effect<SchedulerRerunSubscriptionsRequest, SchedulerRouteError> {
  return decodeSchedulerRerunSubscriptionsRequest(request);
}

export function parsePublicSchedulerRerunSubscriptionsRequest(
  value: unknown,
): SchedulerRerunSubscriptionsRequest {
  return parseSchedulerRerunSubscriptionsRequest(value);
}

export async function readPublicSchedulerTriggerSubscriptionsRequest(
  request: Request,
): Promise<SchedulerRerunSubscriptionsRequest> {
  return readSchedulerRerunSubscriptionsRequest(request);
}

export function decodePublicSchedulerTriggerSubscriptionsRequest(
  request: Request,
): Effect.Effect<SchedulerRerunSubscriptionsRequest, SchedulerRouteError> {
  return decodeSchedulerRerunSubscriptionsRequest(request);
}

export function parsePublicSchedulerTriggerSubscriptionsRequest(
  value: unknown,
): SchedulerRerunSubscriptionsRequest {
  return parseSchedulerRerunSubscriptionsRequest(value);
}

export function publicSchedulerRouteErrorToHttpError(error: SchedulerRouteError): HttpError {
  return schedulerRouteErrorToHttpError(error);
}
