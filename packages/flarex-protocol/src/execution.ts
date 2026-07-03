import { Effect, Schema } from "effect";
import { isJson, JsonValue, type Json } from "./json";

export class ExecutionProtocolValidationError extends Schema.TaggedErrorClass<ExecutionProtocolValidationError>()(
  "ExecutionProtocolValidationError",
  {
    schema: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export interface ExecutionStartRequest {
  readonly deploymentId: string;
  readonly path: string;
  readonly args: Json;
  readonly partitionKey?: string;
  readonly projectId?: string;
  readonly kind?: "query" | "mutation";
  readonly idempotencyKey?: string;
}

export type ExecutionIndexRangeExpression = {
  readonly op: "eq" | "gt" | "gte" | "lt" | "lte";
  readonly field: string;
  readonly value: Json;
};

export type ExecutionSyscallRequest =
  | { readonly op: "get"; readonly id: string }
  | {
      readonly op: "query";
      readonly request: {
        readonly table: string;
        readonly index?: string;
        readonly range?: {
          readonly expressions: ReadonlyArray<ExecutionIndexRangeExpression>;
        };
        readonly limit?: number;
        readonly cursor?: string;
        readonly order?: "asc" | "desc";
      };
    }
  | {
      readonly op: "insert";
      readonly table: string;
      readonly value: Json;
      readonly id?: string;
    }
  | {
      readonly op: "patch";
      readonly id: string;
      readonly value: { readonly [key: string]: Json };
    }
  | { readonly op: "replace"; readonly id: string; readonly value: Json }
  | { readonly op: "delete"; readonly id: string };

export interface ExecutionFinishRequest {
  readonly value: Json;
}

export const ExecutionStartRequestSchema = Schema.Struct({
  deploymentId: Schema.String,
  path: Schema.String,
  args: JsonValue,
  partitionKey: Schema.optional(Schema.String),
  projectId: Schema.optional(Schema.String),
  kind: Schema.optional(Schema.Union([
    Schema.Literal("query"),
    Schema.Literal("mutation"),
  ])),
  idempotencyKey: Schema.optional(Schema.String),
});

export const ExecutionIndexRangeExpressionSchema = Schema.Struct({
  op: Schema.Union([
    Schema.Literal("eq"),
    Schema.Literal("gt"),
    Schema.Literal("gte"),
    Schema.Literal("lt"),
    Schema.Literal("lte"),
  ]),
  field: Schema.String,
  value: JsonValue,
});

const JsonRecordValue = Schema.declare<{ readonly [key: string]: Json }>(
  (value): value is { readonly [key: string]: Json } => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    if (Object.getOwnPropertySymbols(value).length > 0) return false;
    return Object.values(value as Record<string, unknown>).every(isJson);
  },
  {
    title: "JsonRecordValue",
    description: "A JSON object with string keys and JSON values.",
  },
);

export const ExecutionSyscallRequestSchema = Schema.Union([
  Schema.Struct({
    op: Schema.Literal("get"),
    id: Schema.String,
  }),
  Schema.Struct({
    op: Schema.Literal("query"),
    request: Schema.Struct({
      table: Schema.String,
      index: Schema.optional(Schema.String),
      range: Schema.optional(Schema.Struct({
        expressions: Schema.Array(ExecutionIndexRangeExpressionSchema),
      })),
      limit: Schema.optional(Schema.Number),
      cursor: Schema.optional(Schema.String),
      order: Schema.optional(Schema.Union([
        Schema.Literal("asc"),
        Schema.Literal("desc"),
      ])),
    }),
  }),
  Schema.Struct({
    op: Schema.Literal("insert"),
    table: Schema.String,
    value: JsonValue,
    id: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    op: Schema.Literal("patch"),
    id: Schema.String,
    value: JsonRecordValue,
  }),
  Schema.Struct({
    op: Schema.Literal("replace"),
    id: Schema.String,
    value: JsonValue,
  }),
  Schema.Struct({
    op: Schema.Literal("delete"),
    id: Schema.String,
  }),
]);

export const ExecutionFinishRequestSchema = Schema.Struct({
  value: JsonValue,
});

const decodeUnknownExecutionStartRequest = Schema.decodeUnknownEffect(
  ExecutionStartRequestSchema,
);

const decodeUnknownExecutionSyscallRequest = Schema.decodeUnknownEffect(
  ExecutionSyscallRequestSchema,
);

const decodeUnknownExecutionFinishRequest = Schema.decodeUnknownEffect(
  ExecutionFinishRequestSchema,
);

export const decodeExecutionStartRequestEffect = Effect.fn(
  "ExecutionProtocol.decodeStartRequest",
)(function* (
  value: unknown,
): Effect.fn.Return<ExecutionStartRequest, ExecutionProtocolValidationError> {
  if (!isRecordValue(value)) {
    return yield* executionProtocolValidationFailure(
      "ExecutionStartRequest",
      "Execution start request must be an object.",
      value,
    );
  }
  const body = yield* decodeUnknownExecutionStartRequest(value).pipe(
    Effect.mapError(cause =>
      new ExecutionProtocolValidationError({
        schema: "ExecutionStartRequest",
        message:
          "Execution start request must include string deploymentId, string path, JSON args, and optional string partitionKey, projectId, idempotencyKey, and query or mutation kind.",
        cause,
      })
    ),
  );
  return {
    deploymentId: body.deploymentId,
    path: body.path,
    args: body.args,
    ...(body.partitionKey === undefined
      ? {}
      : { partitionKey: body.partitionKey }),
    ...(body.projectId === undefined ? {} : { projectId: body.projectId }),
    ...(body.kind === undefined ? {} : { kind: body.kind }),
    ...(body.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: body.idempotencyKey }),
  };
});

export const decodeExecutionSyscallRequestEffect = Effect.fn(
  "ExecutionProtocol.decodeSyscallRequest",
)(function* (
  value: unknown,
): Effect.fn.Return<ExecutionSyscallRequest, ExecutionProtocolValidationError> {
  if (!isRecordValue(value)) {
    return yield* executionProtocolValidationFailure(
      "ExecutionSyscallRequest",
      "Execution syscall request must be an object.",
      value,
    );
  }
  const body = yield* decodeUnknownExecutionSyscallRequest(value).pipe(
    Effect.mapError(cause =>
      new ExecutionProtocolValidationError({
        schema: "ExecutionSyscallRequest",
        message:
          "Execution syscall request must be a valid get, query, insert, patch, replace, or delete operation.",
        cause,
      })
    ),
  );
  switch (body.op) {
    case "get":
    case "replace":
    case "delete":
      return body;
    case "query":
      return {
        op: "query",
        request: {
          table: body.request.table,
          ...(body.request.index === undefined
            ? {}
            : { index: body.request.index }),
          ...(body.request.range === undefined
            ? {}
            : { range: body.request.range }),
          ...(body.request.limit === undefined
            ? {}
            : { limit: body.request.limit }),
          ...(body.request.cursor === undefined
            ? {}
            : { cursor: body.request.cursor }),
          ...(body.request.order === undefined
            ? {}
            : { order: body.request.order }),
        },
      };
    case "insert":
      return {
        op: "insert",
        table: body.table,
        value: body.value,
        ...(body.id === undefined ? {} : { id: body.id }),
      };
    case "patch":
      return {
        op: "patch",
        id: body.id,
        value: body.value,
      };
  }
});

export const decodeExecutionFinishRequestEffect = Effect.fn(
  "ExecutionProtocol.decodeFinishRequest",
)(function* (
  value: unknown,
): Effect.fn.Return<ExecutionFinishRequest, ExecutionProtocolValidationError> {
  if (!isRecordValue(value)) {
    return yield* executionProtocolValidationFailure(
      "ExecutionFinishRequest",
      "Execution finish request must be an object.",
      value,
    );
  }
  const body = yield* decodeUnknownExecutionFinishRequest(value).pipe(
    Effect.mapError(cause =>
      new ExecutionProtocolValidationError({
        schema: "ExecutionFinishRequest",
        message: "Execution finish request must include JSON value.",
        cause,
      })
    ),
  );
  return {
    value: body.value,
  };
});

function executionProtocolValidationFailure(
  schema: string,
  message: string,
  cause: unknown,
): Effect.Effect<never, ExecutionProtocolValidationError> {
  return Effect.fail(new ExecutionProtocolValidationError({
    schema,
    message,
    cause,
  }));
}

function isRecordValue(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
