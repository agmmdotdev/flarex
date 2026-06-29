import {
  ExecutionProtocolValidationError,
  parseExecutionStartRequest,
  type ExecutionStartRequest as ProtocolExecutionStartRequest,
} from "flarex-protocol/execution";
import { Effect } from "effect";
import {
  HttpError,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "../http";
import type { ExecutionStartRequest } from "../types";
import { backendJson } from "./JsonRouteBoundary";

export type ExecutionStartRouteError = RequestJsonError | ExecutionProtocolValidationError;

export async function readExecutionStartRequest(
  request: Request,
): Promise<ExecutionStartRequest> {
  return await Effect.runPromise(
    decodeExecutionStartRouteRequest(request).pipe(
      Effect.mapError(executionStartRouteErrorToHttpError),
    ),
  );
}

export function decodeExecutionStartRouteRequest(
  request: Request,
): Effect.Effect<ExecutionStartRequest, ExecutionStartRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(parseExecutionStartRouteRequestEffect),
  );
}

export async function readPublicExecutionStartRequest(
  request: Request,
  deploymentId: string,
): Promise<ExecutionStartRequest> {
  return await Effect.runPromise(
    decodePublicExecutionStartRouteRequest(request, deploymentId).pipe(
      Effect.mapError(executionStartRouteErrorToHttpError),
    ),
  );
}

export function decodePublicExecutionStartRouteRequest(
  request: Request,
  deploymentId: string,
): Effect.Effect<ExecutionStartRequest, ExecutionStartRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(value => parsePublicExecutionStartRouteRequestEffect(value, deploymentId)),
  );
}

export function parsePublicExecutionStartRouteRequest(
  value: unknown,
  deploymentId: string,
): ExecutionStartRequest {
  const record = isRecord(value) ? value : {};
  return parseExecutionStartRouteRequest({ ...record, deploymentId });
}

export function parsePublicExecutionStartRouteRequestEffect(
  value: unknown,
  deploymentId: string,
): Effect.Effect<ExecutionStartRequest, ExecutionProtocolValidationError> {
  const record = isRecord(value) ? value : {};
  return parseExecutionStartRouteRequestEffect({ ...record, deploymentId });
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

export function parseExecutionStartRouteRequestEffect(
  value: unknown,
): Effect.Effect<ExecutionStartRequest, ExecutionProtocolValidationError> {
  return Effect.suspend(() => {
    try {
      return Effect.succeed(backendExecutionStartRequest(parseExecutionStartRequest(value)));
    } catch (error) {
      if (error instanceof ExecutionProtocolValidationError) {
        return Effect.fail(error);
      }
      return Effect.die(error);
    }
  });
}

export function executionStartRouteErrorToHttpError(error: ExecutionStartRouteError): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return new HttpError(400, error.message);
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
