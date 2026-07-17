import { isNonArrayRecord } from "@flarex/utils/records";
import { Effect, Schema } from "effect";
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

const ObservedTimestampSchema = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
);

const InvokeDocumentReadSchema = Schema.Struct({
  tableId: Schema.Number,
  id: Schema.String,
  observedTs: Schema.optional(Schema.Union([ObservedTimestampSchema, Schema.Null])),
});

const InvokeTableReadSchema = Schema.Struct({
  tableId: Schema.Number,
  observedTs: Schema.optional(ObservedTimestampSchema),
});

const InvokeIndexReadSchema = Schema.Struct({
  indexId: Schema.Number,
  observedTs: Schema.optional(ObservedTimestampSchema),
  lower: Schema.optional(Schema.String),
  upper: Schema.optional(Schema.String),
});

export const InvokeReadSetSchema = Schema.Struct({
  documents: Schema.optional(Schema.Array(InvokeDocumentReadSchema)),
  tables: Schema.optional(Schema.Array(InvokeTableReadSchema)),
  indexes: Schema.optional(Schema.Array(InvokeIndexReadSchema)),
});

export const InvokeCommittedWriteSchema = Schema.Struct({
  tableId: Schema.Number,
  id: Schema.String,
  prevTs: Schema.Union([Schema.Number, Schema.Null]),
  ts: Schema.Number,
  value: JsonValue,
});

export const InvokeResponseSchema = Schema.Struct({
  value: JsonValue,
  readSet: Schema.optional(InvokeReadSetSchema),
  readTs: Schema.optional(Schema.Number),
  committedTs: Schema.optional(Schema.Number),
  writes: Schema.optional(Schema.Array(InvokeCommittedWriteSchema)),
});
export type InvokeResponse = typeof InvokeResponseSchema.Type;

const decodeUnknownPublicInvokeRequestBody = Schema.decodeUnknownEffect(
  PublicInvokeRequestBodySchema,
);

export const decodePublicInvokeRequestBodyEffect = Effect.fn(
  "InvokeProtocol.decodePublicInvokeRequestBody",
)(function* (
  value: unknown,
): Effect.fn.Return<PublicInvokeRequestBody, InvokeProtocolValidationError> {
  if (!isNonArrayRecord(value)) {
    return yield* invokeProtocolValidationFailure(
      "PublicInvokeRequestBody",
      "Invoke request body must be an object.",
      value,
    );
  }
  const body = yield* decodeUnknownPublicInvokeRequestBody(value).pipe(
    Effect.mapError(cause =>
      new InvokeProtocolValidationError({
        schema: "PublicInvokeRequestBody",
        message:
          "Invoke request body may include string deploymentId, path, partitionKey, idempotencyKey, query or mutation kind, and JSON args.",
        cause,
      })
    ),
  );
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
});

function invokeProtocolValidationFailure(
  schema: string,
  message: string,
  cause: unknown,
): Effect.Effect<never, InvokeProtocolValidationError> {
  return Effect.fail(new InvokeProtocolValidationError({
    schema,
    message,
    cause,
  }));
}
