import { Effect } from "effect";
import {
  decodeExecutionFinishRequestEffect,
  decodeExecutionStartRequestEffect,
  decodeExecutionSyscallRequestEffect,
  ExecutionProtocolValidationError,
  type ExecutionFinishRequest as ProtocolExecutionFinishRequest,
  type ExecutionIndexRangeExpression as ProtocolExecutionIndexRangeExpression,
  type ExecutionStartRequest as ProtocolExecutionStartRequest,
  type ExecutionSyscallRequest as ProtocolExecutionSyscallRequest,
} from "flarex-protocol/execution";
import type {
  ExecutionFinishRequest,
  ExecutionStartRequest,
  ExecutionSyscallRequest,
  Json,
} from "../types";
import { backendJson, backendJsonRecord } from "./JsonRouteBoundary";

export const decodeExecutionStartPayload = Effect.fn(
  "ExecutionRequests.decodeStartPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<ExecutionStartRequest, ExecutionProtocolValidationError> {
  return yield* decodeExecutionStartRequestEffect(value).pipe(
    Effect.map(backendExecutionStartRequest),
  );
});

export const decodePublicExecutionStartPayload = Effect.fn(
  "ExecutionRequests.decodePublicStartPayload",
)(function* (
  value: unknown,
  deploymentId: string,
): Effect.fn.Return<ExecutionStartRequest, ExecutionProtocolValidationError> {
  const record = isRecord(value) ? value : {};
  return yield* decodeExecutionStartPayload({ ...record, deploymentId });
});

export const decodeExecutionSyscallPayload = Effect.fn(
  "ExecutionRequests.decodeSyscallPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<ExecutionSyscallRequest, ExecutionProtocolValidationError> {
  return yield* decodeExecutionSyscallRequestEffect(value).pipe(
    Effect.map(backendExecutionSyscallRequest),
  );
});

export const decodeExecutionFinishPayload = Effect.fn(
  "ExecutionRequests.decodeFinishPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<ExecutionFinishRequest, ExecutionProtocolValidationError> {
  return yield* decodeExecutionFinishRequestEffect(value).pipe(
    Effect.map(backendExecutionFinishRequest),
  );
});

export const decodePublicExecutionActionPayload = Effect.fn(
  "ExecutionRequests.decodePublicActionPayload",
)(function* (
  value: unknown,
  action: "syscall" | "finish" | "abort",
): Effect.fn.Return<unknown, ExecutionProtocolValidationError> {
  if (action === "syscall") return yield* decodeExecutionSyscallPayload(value);
  if (action === "finish") return yield* decodeExecutionFinishPayload(value);
  return value;
});

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

function backendExecutionFinishRequest(
  request: ProtocolExecutionFinishRequest,
): ExecutionFinishRequest {
  return {
    value: backendJson(request.value),
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
