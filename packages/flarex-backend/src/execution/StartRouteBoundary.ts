import { Effect } from "effect";
import { ExecutionProtocolValidationError } from "flarex-protocol/execution";
import {
  HttpError,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "../http";
import type { ExecutionStartRequest } from "../types";
import {
  decodeExecutionStartPayload,
  decodePublicExecutionStartPayload,
  parseExecutionStartPayload,
  parsePublicExecutionStartPayload,
} from "./Requests";

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
    Effect.flatMap(decodeExecutionStartRoutePayload),
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
    Effect.flatMap(value => decodePublicExecutionStartRoutePayload(value, deploymentId)),
  );
}

export function parsePublicExecutionStartRouteRequest(
  value: unknown,
  deploymentId: string,
): ExecutionStartRequest {
  try {
    return parsePublicExecutionStartPayload(value, deploymentId);
  } catch (error) {
    if (error instanceof ExecutionProtocolValidationError) {
      throw new HttpError(400, error.message);
    }
    throw error;
  }
}

export function parsePublicExecutionStartRouteRequestEffect(
  value: unknown,
  deploymentId: string,
): Effect.Effect<ExecutionStartRequest, ExecutionProtocolValidationError> {
  return decodePublicExecutionStartRoutePayload(value, deploymentId);
}

export function decodePublicExecutionStartRoutePayload(
  value: unknown,
  deploymentId: string,
): Effect.Effect<ExecutionStartRequest, ExecutionProtocolValidationError> {
  return decodePublicExecutionStartPayload(value, deploymentId);
}

export function parseExecutionStartRouteRequest(
  value: unknown,
): ExecutionStartRequest {
  try {
    return parseExecutionStartPayload(value);
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
  return decodeExecutionStartRoutePayload(value);
}

export function decodeExecutionStartRoutePayload(
  value: unknown,
): Effect.Effect<ExecutionStartRequest, ExecutionProtocolValidationError> {
  return decodeExecutionStartPayload(value);
}

export function executionStartRouteErrorToHttpError(error: ExecutionStartRouteError): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return new HttpError(400, error.message);
}
