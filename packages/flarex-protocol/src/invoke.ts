import { Schema } from "effect";
import type { Json } from "./json";

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

const PublicInvokeJson = Schema.declare<Json>(isJson, {
  title: "PublicInvokeJson",
  description:
    "A JSON value for public invoke arguments: null, boolean, finite number, string, array, or plain record.",
});

export const PublicInvokeRequestBodySchema = Schema.Struct({
  deploymentId: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  args: Schema.optional(PublicInvokeJson),
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

function isJson(value: unknown): value is Json {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJson);
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      return false;
    }
    return Object.values(value as Record<string, unknown>).every(isJson);
  }
  return false;
}
