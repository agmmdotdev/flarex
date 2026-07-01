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
} from "./Requests";

export type ExecutionSyscallRouteError = RequestJsonError | ExecutionProtocolValidationError;

export function decodeExecutionSyscallRouteRequest(
  request: Request,
): Effect.Effect<ExecutionSyscallRequest, ExecutionSyscallRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodeExecutionSyscallRoutePayload),
  );
}

export function decodeExecutionSyscallRoutePayload(
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

export const executionSyscallRouteErrorToHttpErrorEffect = Effect.fn(
  "ExecutionSyscallRouteBoundary.executionSyscallRouteErrorToHttpError",
)(function* (
  error: ExecutionSyscallRouteError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(executionSyscallRouteErrorToHttpError(error));
});
