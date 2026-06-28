import { Effect } from "effect";
import {
  ExecutionProtocolValidationError,
  parseExecutionSyscallRequest,
  type ExecutionIndexRangeExpression as ProtocolExecutionIndexRangeExpression,
  type ExecutionSyscallRequest as ProtocolExecutionSyscallRequest,
} from "flarex-protocol/execution";
import {
  HttpError,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "../http";
import type { ExecutionSyscallRequest, Json } from "../types";
import { backendJson, backendJsonRecord } from "./JsonRouteBoundary";

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
): Effect.Effect<ExecutionSyscallRequest, RequestJsonError | ExecutionProtocolValidationError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(parseExecutionSyscallRouteRequestEffect),
  );
}

export function parseExecutionSyscallRouteRequest(
  value: unknown,
): ExecutionSyscallRequest {
  try {
    return backendExecutionSyscallRequest(parseExecutionSyscallRequest(value));
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
  return Effect.suspend(() => {
    try {
      return Effect.succeed(backendExecutionSyscallRequest(parseExecutionSyscallRequest(value)));
    } catch (error) {
      if (error instanceof ExecutionProtocolValidationError) {
        return Effect.fail(error);
      }
      return Effect.die(error);
    }
  });
}

function executionSyscallRouteErrorToHttpError(
  error: RequestJsonError | ExecutionProtocolValidationError,
): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return new HttpError(400, error.message);
}

function backendExecutionSyscallRequest(
  request: ProtocolExecutionSyscallRequest,
): ExecutionSyscallRequest {
  switch (request.op) {
    case "get":
    case "delete":
      return request;
    case "query":
      return {
        op: "query",
        request: {
          table: request.request.table,
          ...(request.request.index === undefined
            ? {}
            : { index: request.request.index }),
          ...(request.request.range === undefined
            ? {}
            : {
                range: {
                  expressions: request.request.range.expressions.map(
                    backendIndexRangeExpression,
                  ),
                },
              }),
          ...(request.request.limit === undefined
            ? {}
            : { limit: request.request.limit }),
          ...(request.request.cursor === undefined
            ? {}
            : { cursor: request.request.cursor }),
          ...(request.request.order === undefined
            ? {}
            : { order: request.request.order }),
        },
      };
    case "insert":
      return {
        op: "insert",
        table: request.table,
        value: backendJson(request.value),
        ...(request.id === undefined ? {} : { id: request.id }),
      };
    case "patch":
      return {
        op: "patch",
        id: request.id,
        value: backendJsonRecord(request.value),
      };
    case "replace":
      return {
        op: "replace",
        id: request.id,
        value: backendJson(request.value),
      };
  }
}

function backendIndexRangeExpression(
  expression: ProtocolExecutionIndexRangeExpression,
): {
  op: "eq" | "gt" | "gte" | "lt" | "lte";
  field: string;
  value: Json;
} {
  return {
    op: expression.op,
    field: expression.field,
    value: backendJson(expression.value),
  };
}
