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
} from "./Requests";

export type ExecutionStartRouteError = RequestJsonError | ExecutionProtocolValidationError;

export async function readExecutionStartRequest(
  request: Request,
): Promise<ExecutionStartRequest> {
  return await Effect.runPromise(
    decodeExecutionStartRouteRequest(request).pipe(
      Effect.catch(executionStartRouteErrorToHttpErrorEffect),
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

export function decodePublicExecutionStartRouteRequest(
  request: Request,
  deploymentId: string,
): Effect.Effect<ExecutionStartRequest, ExecutionStartRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(value => decodePublicExecutionStartRoutePayload(value, deploymentId)),
  );
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
  return Effect.runSync(parseExecutionStartRouteRequestEffect(value).pipe(
    Effect.catch(executionStartRouteErrorToHttpErrorEffect),
  ));
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

export const executionStartRouteErrorToHttpErrorEffect = Effect.fn(
  "ExecutionStartRouteBoundary.executionStartRouteErrorToHttpError",
)(function* (
  error: ExecutionStartRouteError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(executionStartRouteErrorToHttpError(error));
});
