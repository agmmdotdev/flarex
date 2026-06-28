import { Effect } from "effect";
import {
  ExecutionProtocolValidationError,
  parseExecutionFinishRequest,
  type ExecutionFinishRequest as ProtocolExecutionFinishRequest,
} from "flarex-protocol/execution";
import {
  HttpError,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "../http";
import type { ExecutionFinishRequest } from "../types";
import { backendJson } from "./JsonRouteBoundary";

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
): Effect.Effect<ExecutionFinishRequest, RequestJsonError | ExecutionProtocolValidationError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(parseExecutionFinishRouteRequestEffect),
  );
}

export function parseExecutionFinishRouteRequest(
  value: unknown,
): ExecutionFinishRequest {
  try {
    return backendExecutionFinishRequest(parseExecutionFinishRequest(value));
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
  return Effect.suspend(() => {
    try {
      return Effect.succeed(backendExecutionFinishRequest(parseExecutionFinishRequest(value)));
    } catch (error) {
      if (error instanceof ExecutionProtocolValidationError) {
        return Effect.fail(error);
      }
      return Effect.die(error);
    }
  });
}

function executionFinishRouteErrorToHttpError(
  error: RequestJsonError | ExecutionProtocolValidationError,
): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return new HttpError(400, error.message);
}

function backendExecutionFinishRequest(
  request: ProtocolExecutionFinishRequest,
): ExecutionFinishRequest {
  return {
    value: backendJson(request.value),
  };
}
