import { Schema } from "effect";
import { JsonValue, type Json } from "./json";

export class InvokeProtocolValidationError extends Schema.TaggedErrorClass<InvokeProtocolValidationError>()(
  "InvokeProtocolValidationError",
  {
    schema: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export interface PublicInvokeRequestBody {
  readonly deploymentId?: string;
  readonly path?: string;
  readonly args?: Json;
  readonly partitionKey?: string;
  readonly kind?: "query" | "mutation";
  readonly idempotencyKey?: string;
}

export const PublicInvokeRequestBodySchema = Schema.Struct({
  deploymentId: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  args: Schema.optional(JsonValue),
  partitionKey: Schema.optional(Schema.String),
  kind: Schema.optional(Schema.Union([
    Schema.Literal("query"),
    Schema.Literal("mutation"),
  ])),
  idempotencyKey: Schema.optional(Schema.String),
});

const decodePublicInvokeRequestBody = Schema.decodeUnknownSync(
  PublicInvokeRequestBodySchema,
);

export function parsePublicInvokeRequestBody(value: unknown): PublicInvokeRequestBody {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvokeProtocolValidationError({
      schema: "PublicInvokeRequestBody",
      message: "Invoke request body must be an object.",
      cause: value,
    });
  }
  try {
    const body = decodePublicInvokeRequestBody(value);
    return {
      ...(body.deploymentId === undefined
        ? {}
        : { deploymentId: body.deploymentId }),
      ...(body.path === undefined ? {} : { path: body.path }),
      ...(body.args === undefined ? {} : { args: body.args }),
      ...(body.partitionKey === undefined
        ? {}
        : { partitionKey: body.partitionKey }),
      ...(body.kind === undefined ? {} : { kind: body.kind }),
      ...(body.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: body.idempotencyKey }),
    };
  } catch (cause) {
    if (cause instanceof InvokeProtocolValidationError) throw cause;
    throw new InvokeProtocolValidationError({
      schema: "PublicInvokeRequestBody",
      message:
        "Invoke request body may include string deploymentId, path, partitionKey, idempotencyKey, query or mutation kind, and JSON args.",
      cause,
    });
  }
}
