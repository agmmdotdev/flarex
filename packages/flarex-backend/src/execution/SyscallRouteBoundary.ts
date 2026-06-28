import {
  ExecutionProtocolValidationError,
  parseExecutionSyscallRequest,
  type ExecutionIndexRangeExpression as ProtocolExecutionIndexRangeExpression,
  type ExecutionSyscallRequest as ProtocolExecutionSyscallRequest,
} from "flarex-protocol/execution";
import { HttpError, readJson } from "../http";
import type { ExecutionSyscallRequest, Json } from "../types";
import { backendJson, backendJsonRecord } from "./JsonRouteBoundary";

export async function readExecutionSyscallRequest(
  request: Request,
): Promise<ExecutionSyscallRequest> {
  return parseExecutionSyscallRouteRequest(await readJson(request));
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
