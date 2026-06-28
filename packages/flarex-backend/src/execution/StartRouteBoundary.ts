import {
  ExecutionProtocolValidationError,
  parseExecutionStartRequest,
  type ExecutionStartRequest as ProtocolExecutionStartRequest,
} from "flarex-protocol/execution";
import { HttpError, readJson } from "../http";
import type { ExecutionStartRequest } from "../types";
import { backendJson } from "./JsonRouteBoundary";

export async function readExecutionStartRequest(
  request: Request,
): Promise<ExecutionStartRequest> {
  return parseExecutionStartRouteRequest(await readJson(request));
}

export async function readPublicExecutionStartRequest(
  request: Request,
  deploymentId: string,
): Promise<ExecutionStartRequest> {
  return parsePublicExecutionStartRouteRequest(await readJson(request), deploymentId);
}

export function parsePublicExecutionStartRouteRequest(
  value: unknown,
  deploymentId: string,
): ExecutionStartRequest {
  const record = isRecord(value) ? value : {};
  return parseExecutionStartRouteRequest({ ...record, deploymentId });
}

export function parseExecutionStartRouteRequest(
  value: unknown,
): ExecutionStartRequest {
  try {
    return backendExecutionStartRequest(parseExecutionStartRequest(value));
  } catch (error) {
    if (error instanceof ExecutionProtocolValidationError) {
      throw new HttpError(400, error.message);
    }
    throw error;
  }
}

function backendExecutionStartRequest(
  request: ProtocolExecutionStartRequest,
): ExecutionStartRequest {
  return {
    deploymentId: request.deploymentId,
    path: request.path,
    args: backendJson(request.args),
    ...(request.partitionKey === undefined
      ? {}
      : { partitionKey: request.partitionKey }),
    ...(request.projectId === undefined ? {} : { projectId: request.projectId }),
    ...(request.kind === undefined ? {} : { kind: request.kind }),
    ...(request.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: request.idempotencyKey }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
