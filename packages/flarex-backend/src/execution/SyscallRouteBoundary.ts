import { Effect } from "effect";
import { ExecutionProtocolValidationError } from "flarex-protocol/execution";
import {
  HttpError,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "../http";
import type { ExecutionSyscallRequest } from "../types";
import {
  decodeExecutionSyscallPayload,
  parseExecutionSyscallPayload,
} from "./Requests";

export type ExecutionSyscallRouteError = RequestJsonError | ExecutionProtocolValidationError;

export async function readExecutionSyscallRequest(
  request: Request,
): Promise<ExecutionSyscallRequest> {
  return await Effect.runPromise(
    decodeExecutionSyscallRouteRequest(request).pipe(
      Effect.mapError(executionSyscallRouteErrorToHttpError),
    ),
  );
}

export function decodeExecutionSyscallRouteRequest(
  request: Request,
): Effect.Effect<ExecutionSyscallRequest, ExecutionSyscallRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(parseExecutionSyscallRouteRequestEffect),
  );
}

export function parseExecutionSyscallRouteRequest(
  value: unknown,
): ExecutionSyscallRequest {
  try {
    return parseExecutionSyscallPayload(value);
  } catch (error) {
    if (error instanceof ExecutionProtocolValidationError) {
      throw new HttpError(400, error.message);
    }
    throw error;
  }
}

export function parseExecutionSyscallRouteRequestEffect(
  value: unknown,
): Effect.Effect<ExecutionSyscallRequest, ExecutionProtocolValidationError> {
  return decodeExecutionSyscallPayload(value);
}

export function executionSyscallRouteErrorToHttpError(
  error: ExecutionSyscallRouteError,
): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return new HttpError(400, error.message);
}
