import { isNonArrayRecord as isRecord } from "@flarex/utils/records";
import { isNonEmptyString } from "@flarex/utils/strings";
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
  sessionId?: string;
  connectionCount?: number;
  lastCloseReason?: string | null;
  maxObservedTimestamp?: number;
  clientTs?: number;
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
      tokenType: "User";
      value: string;
      baseVersion: ConnectionIdentityVersion;
    }
  | {
      type: "Authenticate";
      tokenType: "Admin";
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

export type ConnectionSyncTimestamp = number;

export type ConnectionStateVersion = {
  querySet: ConnectionQuerySetVersion;
  ts: ConnectionSyncTimestamp;
  identity: ConnectionIdentityVersion;
};

export type ConnectionQueryUpdatedMessage = {
  type: "QueryUpdated";
  queryId: ConnectionQueryId;
  value: Json;
  logLines: ReadonlyArray<string>;
  journal: string | null;
};

export type ConnectionQueryFailedMessage = {
  type: "QueryFailed";
  queryId: ConnectionQueryId;
  errorMessage: string;
  logLines: ReadonlyArray<string>;
  errorData: Json;
  journal: string | null;
};

export type ConnectionQueryRemovedMessage = {
  type: "QueryRemoved";
  queryId: ConnectionQueryId;
};

export type ConnectionStateModification =
  | ConnectionQueryUpdatedMessage
  | ConnectionQueryFailedMessage
  | ConnectionQueryRemovedMessage;

export type ConnectionTransitionMessage = {
  type: "Transition";
  startVersion: ConnectionStateVersion;
  endVersion: ConnectionStateVersion;
  modifications: ReadonlyArray<ConnectionStateModification>;
  serverTs?: number | undefined;
};

export type ConnectionMutationResponseMessage =
  | {
      type: "MutationResponse";
      requestId: ConnectionRequestId;
      success: true;
      result: Json;
      ts?: ConnectionSyncTimestamp | undefined;
      logLines: ReadonlyArray<string>;
    }
  | {
      type: "MutationResponse";
      requestId: ConnectionRequestId;
      success: false;
      result: string;
      logLines: ReadonlyArray<string>;
      errorData?: Json | undefined;
    };

export type ConnectionActionResponseMessage =
  | {
      type: "ActionResponse";
      requestId: ConnectionRequestId;
      success: true;
      result: Json;
      logLines: ReadonlyArray<string>;
    }
  | {
      type: "ActionResponse";
      requestId: ConnectionRequestId;
      success: false;
      result: string;
      logLines: ReadonlyArray<string>;
      errorData?: Json | undefined;
    };

export type ConnectionFatalErrorMessage = {
  type: "FatalError";
  error: string;
};

export type ConnectionAuthErrorMessage = {
  type: "AuthError";
  error: string;
  baseVersion: ConnectionIdentityVersion;
  authUpdateAttempted: boolean;
};

export type ConnectionPingMessage = {
  type: "Ping";
};

export type ConnectionServerMessage =
  | ConnectionTransitionMessage
  | ConnectionMutationResponseMessage
  | ConnectionActionResponseMessage
  | ConnectionFatalErrorMessage
  | ConnectionAuthErrorMessage
  | ConnectionPingMessage;

export type ConnectionInvalidationRequest = {
  queryId: ConnectionQueryId;
};

export class ConnectionClientMessageError extends Data.TaggedError(
  "ConnectionClientMessageError",
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ConnectionServerMessageError extends Data.TaggedError(
  "ConnectionServerMessageError",
)<{
  readonly message: string;
  readonly cause: Schema.SchemaError;
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
  isNonEmptyString,
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

const ConnectionStateVersionSchema = Schema.Struct({
  querySet: ConnectionInteger,
  ts: Schema.Number,
  identity: ConnectionInteger,
});

const ConnectionQueryUpdatedMessageSchema = Schema.Struct({
  type: Schema.Literal("QueryUpdated"),
  queryId: ConnectionInteger,
  value: JsonValue,
  logLines: Schema.Array(Schema.String),
  journal: Schema.Union([Schema.String, Schema.Null]),
});

const ConnectionQueryFailedMessageSchema = Schema.Struct({
  type: Schema.Literal("QueryFailed"),
  queryId: ConnectionInteger,
  errorMessage: Schema.String,
  logLines: Schema.Array(Schema.String),
  errorData: JsonValue,
  journal: Schema.Union([Schema.String, Schema.Null]),
});

const ConnectionQueryRemovedMessageSchema = Schema.Struct({
  type: Schema.Literal("QueryRemoved"),
  queryId: ConnectionInteger,
});

const ConnectionStateModificationSchema = Schema.Union([
  ConnectionQueryUpdatedMessageSchema,
  ConnectionQueryFailedMessageSchema,
  ConnectionQueryRemovedMessageSchema,
]);

const ConnectionMutationResponseMessageSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("MutationResponse"),
    requestId: ConnectionInteger,
    success: Schema.Literal(true),
    result: JsonValue,
    ts: Schema.optional(Schema.Number),
    logLines: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("MutationResponse"),
    requestId: ConnectionInteger,
    success: Schema.Literal(false),
    result: Schema.String,
    logLines: Schema.Array(Schema.String),
    errorData: Schema.optional(JsonValue),
  }),
]);

const ConnectionActionResponseMessageSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("ActionResponse"),
    requestId: ConnectionInteger,
    success: Schema.Literal(true),
    result: JsonValue,
    logLines: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("ActionResponse"),
    requestId: ConnectionInteger,
    success: Schema.Literal(false),
    result: Schema.String,
    logLines: Schema.Array(Schema.String),
    errorData: Schema.optional(JsonValue),
  }),
]);

export const ConnectionServerMessageSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("Transition"),
    startVersion: ConnectionStateVersionSchema,
    endVersion: ConnectionStateVersionSchema,
    modifications: Schema.Array(ConnectionStateModificationSchema),
    serverTs: Schema.optional(Schema.Number),
  }),
  ConnectionMutationResponseMessageSchema,
  ConnectionActionResponseMessageSchema,
  Schema.Struct({
    type: Schema.Literal("FatalError"),
    error: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("AuthError"),
    error: Schema.String,
    baseVersion: ConnectionInteger,
    authUpdateAttempted: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("Ping"),
  }),
]);

export const ConnectionInvalidationRequestSchema = Schema.Struct({
  queryId: ConnectionInteger,
});

const decodeUnknownConnectionClientMessage = Schema.decodeUnknownEffect(
  ConnectionClientMessageSchema,
);
const decodeUnknownConnectionServerMessage = Schema.decodeUnknownEffect(
  ConnectionServerMessageSchema,
);
const decodeUnknownConnectionServerMessageSync = Schema.decodeUnknownSync(
  ConnectionServerMessageSchema,
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

export const decodeConnectionServerMessagePayloadEffect = Effect.fn(
  "ConnectionProtocol.decodeServerMessagePayload",
)((
  value: unknown,
): Effect.Effect<ConnectionServerMessage, ConnectionServerMessageError> =>
  decodeUnknownConnectionServerMessage(value).pipe(
    Effect.mapError(cause => connectionServerMessageError(value, cause)),
  ));

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

export function parseConnectionClientMessage(value: unknown): ConnectionClientMessage {
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

export function parseConnectionServerMessage(value: unknown): ConnectionServerMessage {
  try {
    return decodeUnknownConnectionServerMessageSync(value);
  } catch (cause) {
    if (!Schema.isSchemaError(cause)) throw cause;
    throw connectionServerMessageError(value, cause);
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
  if (isNonEmptyString(value)) return value;
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

function connectionServerMessageError(
  value: unknown,
  cause: Schema.SchemaError,
): ConnectionServerMessageError {
  if (!isRecord(value) || typeof value.type !== "string") {
    return new ConnectionServerMessageError({
      message: "Sync server message must be an object with a type.",
      cause,
    });
  }
  if (!CONNECTION_SERVER_MESSAGE_TYPES.some(type => type === value.type)) {
    return new ConnectionServerMessageError({
      message: `Unknown sync server message type: ${value.type}.`,
      cause,
    });
  }
  return new ConnectionServerMessageError({
    message: `Invalid sync server message payload for ${value.type}.`,
    cause,
  });
}

const CONNECTION_SERVER_MESSAGE_TYPES = [
  "Transition",
  "MutationResponse",
  "ActionResponse",
  "FatalError",
  "AuthError",
  "Ping",
] as const;
