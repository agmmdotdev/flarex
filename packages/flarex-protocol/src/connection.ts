import { Data, Effect, Schema } from "effect";
import {
  decodeLiveQueryDeliveryChangesBodyEffect,
  LiveQueryDeliveryChangePayloadError,
  type LiveQueryDeliveryChange,
} from "./live-query";
import { isJson, JsonValue, type Json } from "./json";

export type ConnectionQuerySetVersion = number;
export type ConnectionIdentityVersion = number;
export type ConnectionQueryId = number;
export type ConnectionRequestId = number;

export type ConnectionConnectMessage = {
  type: "Connect";
};

export type ConnectionAddQueryMessage = {
  type: "Add";
  queryId: ConnectionQueryId;
  udfPath: string;
  args: Json[];
  journal?: string | null;
  partitionKey?: string;
};

export type ConnectionRemoveQueryMessage = {
  type: "Remove";
  queryId: ConnectionQueryId;
};

export type ConnectionQuerySetModification =
  | ConnectionAddQueryMessage
  | ConnectionRemoveQueryMessage;

export type ConnectionModifyQuerySetMessage = {
  type: "ModifyQuerySet";
  baseVersion: ConnectionQuerySetVersion;
  newVersion: ConnectionQuerySetVersion;
  modifications: ConnectionQuerySetModification[];
};

export type ConnectionAuthenticateMessage =
  | {
      type: "Authenticate";
      tokenType: "None";
      baseVersion: ConnectionIdentityVersion;
    }
  | {
      type: "Authenticate";
      tokenType: "User" | "Admin";
      value: string;
      baseVersion: ConnectionIdentityVersion;
    };

export type ConnectionMutationRequestMessage = {
  type: "Mutation";
  requestId: ConnectionRequestId;
  udfPath: string;
  args: Json[];
  partitionKey?: string;
};

export type ConnectionActionRequestMessage = {
  type: "Action";
  requestId: ConnectionRequestId;
  udfPath: string;
  args: Json[];
};

export type ConnectionEventMessage = {
  type: "Event";
  eventType: string;
  event: unknown;
};

export type ConnectionClientMessage =
  | ConnectionConnectMessage
  | ConnectionAuthenticateMessage
  | ConnectionModifyQuerySetMessage
  | ConnectionMutationRequestMessage
  | ConnectionActionRequestMessage
  | ConnectionEventMessage;

export type ConnectionInvalidationRequest = {
  queryId: ConnectionQueryId;
};

export class ConnectionClientMessageError extends Data.TaggedError(
  "ConnectionClientMessageError",
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ConnectionRouteValidationError extends Data.TaggedError(
  "ConnectionRouteValidationError",
)<{
  readonly message: string;
}> {}

const ConnectionInteger = Schema.declare<number>(
  (value): value is number => typeof value === "number" && Number.isInteger(value),
  { title: "ConnectionInteger" },
);

const ConnectionNonEmptyString = Schema.declare<string>(
  (value): value is string => typeof value === "string" && value.length > 0,
  { title: "ConnectionNonEmptyString" },
);

const ConnectionAddQueryMessageSchema = Schema.Struct({
  type: Schema.Literal("Add"),
  queryId: ConnectionInteger,
  udfPath: ConnectionNonEmptyString,
  args: Schema.Array(JsonValue),
  journal: Schema.optional(Schema.Union([Schema.String, Schema.Null])),
  partitionKey: Schema.optional(ConnectionNonEmptyString),
});

const ConnectionRemoveQueryMessageSchema = Schema.Struct({
  type: Schema.Literal("Remove"),
  queryId: ConnectionInteger,
});

const ConnectionClientMessageSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("Connect"),
  }),
  Schema.Struct({
    type: Schema.Literal("Authenticate"),
    tokenType: Schema.Literal("None"),
    baseVersion: ConnectionInteger,
  }),
  Schema.Struct({
    type: Schema.Literal("Authenticate"),
    tokenType: Schema.Union([Schema.Literal("User"), Schema.Literal("Admin")]),
    value: ConnectionNonEmptyString,
    baseVersion: ConnectionInteger,
  }),
  Schema.Struct({
    type: Schema.Literal("ModifyQuerySet"),
    baseVersion: ConnectionInteger,
    newVersion: ConnectionInteger,
    modifications: Schema.Array(Schema.Union([
      ConnectionAddQueryMessageSchema,
      ConnectionRemoveQueryMessageSchema,
    ])),
  }),
  Schema.Struct({
    type: Schema.Literal("Mutation"),
    requestId: ConnectionInteger,
    udfPath: ConnectionNonEmptyString,
    args: Schema.Array(JsonValue),
    partitionKey: Schema.optional(ConnectionNonEmptyString),
  }),
  Schema.Struct({
    type: Schema.Literal("Action"),
    requestId: ConnectionInteger,
    udfPath: ConnectionNonEmptyString,
    args: Schema.Array(JsonValue),
  }),
  Schema.Struct({
    type: Schema.Literal("Event"),
    eventType: ConnectionNonEmptyString,
    event: Schema.Unknown,
  }),
]);

export const ConnectionInvalidationRequestSchema = Schema.Struct({
  queryId: ConnectionInteger,
});

const decodeUnknownConnectionClientMessage = Schema.decodeUnknownEffect(
  ConnectionClientMessageSchema,
);
const decodeUnknownConnectionInvalidationRequest = Schema.decodeUnknownEffect(
  ConnectionInvalidationRequestSchema,
);

export const decodeConnectionClientMessageEffect = Effect.fn(
  "ConnectionProtocol.decodeClientMessage",
)(function* (
  message: string | ArrayBuffer,
): Effect.fn.Return<ConnectionClientMessage, ConnectionClientMessageError> {
  const value = yield* decodeConnectionSocketMessageEffect(message);
  return yield* decodeConnectionClientMessagePayloadEffect(value);
});

export const decodeConnectionClientMessagePayloadEffect = Effect.fn(
  "ConnectionProtocol.decodeClientMessagePayload",
)(function* (
  value: unknown,
): Effect.fn.Return<ConnectionClientMessage, ConnectionClientMessageError> {
  const parsed = yield* parseConnectionClientMessageEffect(value);
  yield* decodeUnknownConnectionClientMessage(parsed).pipe(
    Effect.mapError(cause => connectionClientMessageError(cause)),
  );
  return parsed;
});

export const decodeConnectionInvalidationPayloadEffect = Effect.fn(
  "ConnectionProtocol.decodeInvalidationPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<ConnectionQueryId, ConnectionRouteValidationError> {
  const decoded = yield* decodeUnknownConnectionInvalidationRequest(value).pipe(
    Effect.mapError(() =>
      new ConnectionRouteValidationError({
        message: "Invalidation queryId must be an integer.",
      })
    ),
  );
  return decoded.queryId;
});

export const decodeConnectionLiveQueryDeliveryPayloadEffect = Effect.fn(
  "ConnectionProtocol.decodeLiveQueryDeliveryPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<LiveQueryDeliveryChange[], LiveQueryDeliveryChangePayloadError> {
  return yield* decodeLiveQueryDeliveryChangesBodyEffect(value);
});

const decodeConnectionSocketMessageEffect = Effect.fn(
  "ConnectionProtocol.decodeSocketMessage",
)(function* (
  message: string | ArrayBuffer,
): Effect.fn.Return<unknown, ConnectionClientMessageError> {
  if (typeof message !== "string") {
    return yield* Effect.fail(new ConnectionClientMessageError({
      message: "Binary sync messages are not supported.",
    }));
  }
  return yield* Effect.try({
    // Deliberate JSON bridge: WebSocket text frames decode to protocol schemas.
    try: () => JSON.parse(message) as unknown,
    catch: cause => connectionClientMessageError(cause),
  });
});

function parseConnectionClientMessageEffect(
  value: unknown,
): Effect.Effect<ConnectionClientMessage, ConnectionClientMessageError> {
  return Effect.try({
    try: () => parseConnectionClientMessage(value),
    catch: cause => connectionClientMessageError(cause),
  });
}

function parseConnectionClientMessage(value: unknown): ConnectionClientMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Sync client message must be an object with a string type.");
  }
  switch (value.type) {
    case "Connect":
      return { type: "Connect" };
    case "ModifyQuerySet":
      return parseModifyQuerySet(value);
    case "Authenticate":
      return parseAuthenticate(value);
    case "Mutation":
      return parseMutationRequest(value);
    case "Action":
      return parseRequestMessage(value, "Action");
    case "Event":
      return {
        type: "Event",
        eventType: requiredString(value.eventType, "eventType"),
        event: value.event,
      };
    default:
      throw new Error(`Unknown sync client message type: ${value.type}.`);
  }
}

function parseModifyQuerySet(
  value: Record<string, unknown>,
): ConnectionModifyQuerySetMessage {
  const modifications = value.modifications;
  if (!Array.isArray(modifications)) {
    throw new Error("ModifyQuerySet.modifications must be an array.");
  }
  return {
    type: "ModifyQuerySet",
    baseVersion: requiredInteger(value.baseVersion, "baseVersion"),
    newVersion: requiredInteger(value.newVersion, "newVersion"),
    modifications: modifications.map(parseQuerySetModification),
  };
}

function parseQuerySetModification(
  value: unknown,
): ConnectionQuerySetModification {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Query set modification must be an object with a string type.");
  }
  if (value.type === "Add") {
    const args = value.args;
    if (!Array.isArray(args)) throw new Error("Add.args must be an array.");
    return {
      type: "Add",
      queryId: requiredInteger(value.queryId, "queryId"),
      udfPath: requiredString(value.udfPath, "udfPath"),
      args: args.map(assertJson),
      ...(value.journal === undefined ? {} : { journal: parseJournal(value.journal) }),
      ...(value.partitionKey === undefined
        ? {}
        : { partitionKey: requiredString(value.partitionKey, "partitionKey") }),
    };
  }
  if (value.type === "Remove") {
    return {
      type: "Remove",
      queryId: requiredInteger(value.queryId, "queryId"),
    };
  }
  throw new Error(`Unknown query set modification type: ${value.type}.`);
}

function parseAuthenticate(
  value: Record<string, unknown>,
): ConnectionAuthenticateMessage {
  const tokenType = requiredString(value.tokenType, "tokenType");
  const baseVersion = requiredInteger(value.baseVersion, "baseVersion");
  if (tokenType === "None") return { type: "Authenticate", tokenType, baseVersion };
  if (tokenType === "User" || tokenType === "Admin") {
    return {
      type: "Authenticate",
      tokenType,
      baseVersion,
      value: requiredString(value.value, "value"),
    };
  }
  throw new Error("Authenticate.tokenType must be User, Admin, or None.");
}

function parseMutationRequest(
  value: Record<string, unknown>,
): ConnectionMutationRequestMessage {
  const args = value.args;
  if (!Array.isArray(args)) throw new Error("Mutation.args must be an array.");
  return {
    type: "Mutation",
    requestId: requiredInteger(value.requestId, "requestId"),
    udfPath: requiredString(value.udfPath, "udfPath"),
    args: args.map(assertJson),
    ...(value.partitionKey === undefined
      ? {}
      : { partitionKey: requiredString(value.partitionKey, "partitionKey") }),
  };
}

function parseRequestMessage<T extends "Action">(
  value: Record<string, unknown>,
  type: T,
): ConnectionActionRequestMessage {
  const args = value.args;
  if (!Array.isArray(args)) throw new Error(`${type}.args must be an array.`);
  return {
    type,
    requestId: requiredInteger(value.requestId, "requestId"),
    udfPath: requiredString(value.udfPath, "udfPath"),
    args: args.map(assertJson),
  };
}

function parseJournal(value: unknown): string | null {
  if (value === null || typeof value === "string") return value;
  throw new Error("journal must be a string or null.");
}

function requiredInteger(value: unknown, field: string): number {
  if (Number.isInteger(value) && typeof value === "number") return value;
  throw new Error(`${field} must be an integer.`);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`${field} must be a non-empty string.`);
}

function assertJson(value: unknown): Json {
  if (isJson(value)) return value;
  throw new Error("Expected a JSON value.");
}

function connectionClientMessageError(cause: unknown): ConnectionClientMessageError {
  return new ConnectionClientMessageError({
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
