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
  parseExecutionFinishPayload,
} from "./Requests";

export type ExecutionFinishRouteError = RequestJsonError | ExecutionProtocolValidationError;

export async function readExecutionFinishRequest(
  request: Request,
): Promise<ExecutionFinishRequest> {
  return await Effect.runPromise(
    decodeExecutionFinishRouteRequest(request).pipe(
      Effect.mapError(executionFinishRouteErrorToHttpError),
    ),
  );
}

export function decodeExecutionFinishRouteRequest(
  request: Request,
): Effect.Effect<ExecutionFinishRequest, ExecutionFinishRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(parseExecutionFinishRouteRequestEffect),
  );
}

export function parseExecutionFinishRouteRequest(
  value: unknown,
): ExecutionFinishRequest {
  try {
    return parseExecutionFinishPayload(value);
  } catch (error) {
    if (error instanceof ExecutionProtocolValidationError) {
      throw new HttpError(400, error.message);
    }
    throw error;
  }
}

export function parseExecutionFinishRouteRequestEffect(
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
