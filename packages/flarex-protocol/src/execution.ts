import { Schema } from "effect";
import { JsonValue, type Json } from "./json";

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

const decodeExecutionStartRequest = Schema.decodeUnknownSync(
  ExecutionStartRequestSchema,
);

export function parseExecutionStartRequest(value: unknown): ExecutionStartRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ExecutionProtocolValidationError({
      schema: "ExecutionStartRequest",
      message: "Execution start request must be an object.",
      cause: value,
    });
  }
  try {
    const body = decodeExecutionStartRequest(value);
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
  } catch (cause) {
    if (cause instanceof ExecutionProtocolValidationError) throw cause;
    throw new ExecutionProtocolValidationError({
      schema: "ExecutionStartRequest",
      message:
        "Execution start request must include string deploymentId, string path, JSON args, and optional string partitionKey, projectId, idempotencyKey, and query or mutation kind.",
      cause,
    });
  }
}
