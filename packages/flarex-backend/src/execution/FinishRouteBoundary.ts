import { Effect } from "effect";
import { ExecutionProtocolValidationError } from "flarex-protocol/execution";
import {
  HttpError,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "../http";
import type { ExecutionFinishRequest } from "../types";
import {
  decodeExecutionFinishPayload,
} from "./Requests";

export type ExecutionFinishRouteError = RequestJsonError | ExecutionProtocolValidationError;

export function decodeExecutionFinishRouteRequest(
  request: Request,
): Effect.Effect<ExecutionFinishRequest, ExecutionFinishRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodeExecutionFinishRoutePayload),
  );
}

export function decodeExecutionFinishRoutePayload(
  value: unknown,
): Effect.Effect<ExecutionFinishRequest, ExecutionProtocolValidationError> {
  return decodeExecutionFinishPayload(value);
}

export function executionFinishRouteErrorToHttpError(
  error: ExecutionFinishRouteError,
): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return new HttpError(400, error.message);
}

export const executionFinishRouteErrorToHttpErrorEffect = Effect.fn(
  "ExecutionFinishRouteBoundary.executionFinishRouteErrorToHttpError",
)(function* (
  error: ExecutionFinishRouteError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(executionFinishRouteErrorToHttpError(error));
});
