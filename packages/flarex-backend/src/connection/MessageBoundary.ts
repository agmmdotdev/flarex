import { Data, Effect, Schema } from "effect";
import { JsonValue } from "flarex-protocol/json";
import {
  parseClientMessage,
  type ClientMessage,
} from "../syncProtocol";

const SyncInteger = Schema.declare<number>(
  (value): value is number => typeof value === "number" && Number.isInteger(value),
  { title: "SyncInteger" },
);

const NonEmptyString = Schema.declare<string>(
  (value): value is string => typeof value === "string" && value.length > 0,
  { title: "NonEmptyString" },
);

const AddQueryMessageSchema = Schema.Struct({
  type: Schema.Literal("Add"),
  queryId: SyncInteger,
  udfPath: NonEmptyString,
  args: Schema.Array(JsonValue),
  journal: Schema.optional(Schema.Union([Schema.String, Schema.Null])),
  partitionKey: Schema.optional(NonEmptyString),
});

const RemoveQueryMessageSchema = Schema.Struct({
  type: Schema.Literal("Remove"),
  queryId: SyncInteger,
});

const ClientMessageSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("Connect"),
  }),
  Schema.Struct({
    type: Schema.Literal("Authenticate"),
    tokenType: Schema.Literal("None"),
    baseVersion: SyncInteger,
  }),
  Schema.Struct({
    type: Schema.Literal("Authenticate"),
    tokenType: Schema.Union([Schema.Literal("User"), Schema.Literal("Admin")]),
    value: NonEmptyString,
    baseVersion: SyncInteger,
  }),
  Schema.Struct({
    type: Schema.Literal("ModifyQuerySet"),
    baseVersion: SyncInteger,
    newVersion: SyncInteger,
    modifications: Schema.Array(Schema.Union([AddQueryMessageSchema, RemoveQueryMessageSchema])),
  }),
  Schema.Struct({
    type: Schema.Literal("Mutation"),
    requestId: SyncInteger,
    udfPath: NonEmptyString,
    args: Schema.Array(JsonValue),
    partitionKey: Schema.optional(NonEmptyString),
  }),
  Schema.Struct({
    type: Schema.Literal("Action"),
    requestId: SyncInteger,
    udfPath: NonEmptyString,
    args: Schema.Array(JsonValue),
  }),
  Schema.Struct({
    type: Schema.Literal("Event"),
    eventType: NonEmptyString,
    event: Schema.Unknown,
  }),
]);

const decodeUnknownClientMessage = Schema.decodeUnknownEffect(ClientMessageSchema);

export class ConnectionClientMessageError extends Data.TaggedError("ConnectionClientMessageError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const decodeConnectionClientMessage = Effect.fn(
  "ConnectionMessageBoundary.decodeClientMessage",
)(function* (
  message: string | ArrayBuffer,
): Effect.fn.Return<ClientMessage, ConnectionClientMessageError> {
  const value = yield* decodeConnectionSocketMessage(message);
  return yield* decodeConnectionClientMessagePayload(value);
});

export const decodeConnectionClientMessagePayload = Effect.fn(
  "ConnectionMessageBoundary.decodeClientMessagePayload",
)(function* (
  value: unknown,
): Effect.fn.Return<ClientMessage, ConnectionClientMessageError> {
  return yield* decodeUnknownClientMessage(value).pipe(
    Effect.map(decoded => decoded as ClientMessage),
    Effect.mapError(cause => connectionClientMessageError(schemaMessageCause(value, cause))),
  );
});

const decodeConnectionSocketMessage = Effect.fn(
  "ConnectionMessageBoundary.decodeSocketMessage",
)(function* (
  message: string | ArrayBuffer,
): Effect.fn.Return<unknown, ConnectionClientMessageError> {
  if (typeof message !== "string") {
    return yield* Effect.fail(new ConnectionClientMessageError({
      message: "Binary sync messages are not supported.",
    }));
  }
  return yield* Effect.try({
    try: () => JSON.parse(message) as unknown,
    catch: cause => connectionClientMessageError(cause),
  });
});

function connectionClientMessageError(cause: unknown): ConnectionClientMessageError {
  return new ConnectionClientMessageError({
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

function schemaMessageCause(value: unknown, cause: unknown): unknown {
  try {
    parseClientMessage(value);
  } catch (error) {
    return error;
  }
  return cause;
}
