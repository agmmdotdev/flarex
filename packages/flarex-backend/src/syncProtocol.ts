import type { Json } from "./types";

export type QuerySetVersion = number;
export type IdentityVersion = number;
export type SyncTimestamp = number;
export type QueryId = number;
export type RequestId = number;

export type StateVersion = {
  querySet: QuerySetVersion;
  ts: SyncTimestamp;
  identity: IdentityVersion;
};

export type Connect = {
  type: "Connect";
  sessionId?: string;
  connectionCount?: number;
  lastCloseReason?: string | null;
  maxObservedTimestamp?: SyncTimestamp;
  clientTs?: number;
};

export type AddQuery = {
  type: "Add";
  queryId: QueryId;
  udfPath: string;
  args: Json[];
  journal?: string | null;
  partitionKey?: string;
};

export type RemoveQuery = {
  type: "Remove";
  queryId: QueryId;
};

export type QuerySetModification = AddQuery | RemoveQuery;

export type ModifyQuerySet = {
  type: "ModifyQuerySet";
  baseVersion: QuerySetVersion;
  newVersion: QuerySetVersion;
  modifications: QuerySetModification[];
};

export type MutationRequest = {
  type: "Mutation";
  requestId: RequestId;
  udfPath: string;
  args: Json[];
};

export type ActionRequest = {
  type: "Action";
  requestId: RequestId;
  udfPath: string;
  args: Json[];
};

export type Authenticate =
  | { type: "Authenticate"; tokenType: "User"; value: string; baseVersion: IdentityVersion }
  | { type: "Authenticate"; tokenType: "None"; baseVersion: IdentityVersion }
  | { type: "Authenticate"; tokenType: "Admin"; value: string; baseVersion: IdentityVersion };

export type EventMessage = {
  type: "Event";
  eventType: string;
  event: unknown;
};

export type ClientMessage =
  | Connect
  | Authenticate
  | ModifyQuerySet
  | MutationRequest
  | ActionRequest
  | EventMessage;

export type QueryUpdated = {
  type: "QueryUpdated";
  queryId: QueryId;
  value: Json;
  logLines: string[];
  journal: string | null;
};

export type QueryFailed = {
  type: "QueryFailed";
  queryId: QueryId;
  errorMessage: string;
  logLines: string[];
  errorData: Json;
  journal: string | null;
};

export type QueryRemoved = {
  type: "QueryRemoved";
  queryId: QueryId;
};

export type StateModification = QueryUpdated | QueryFailed | QueryRemoved;

export type Transition = {
  type: "Transition";
  startVersion: StateVersion;
  endVersion: StateVersion;
  modifications: StateModification[];
  serverTs?: number;
};

export type MutationResponse =
  | {
      type: "MutationResponse";
      requestId: RequestId;
      success: true;
      result: Json;
      ts?: SyncTimestamp;
      logLines: string[];
    }
  | {
      type: "MutationResponse";
      requestId: RequestId;
      success: false;
      result: string;
      logLines: string[];
      errorData?: Json;
    };

export type ActionResponse =
  | {
      type: "ActionResponse";
      requestId: RequestId;
      success: true;
      result: Json;
      logLines: string[];
    }
  | {
      type: "ActionResponse";
      requestId: RequestId;
      success: false;
      result: string;
      logLines: string[];
      errorData?: Json;
    };

export type FatalError = {
  type: "FatalError";
  error: string;
};

export type AuthError = {
  type: "AuthError";
  error: string;
  baseVersion: IdentityVersion;
  authUpdateAttempted: boolean;
};

export type Ping = {
  type: "Ping";
};

export type ServerMessage =
  | Transition
  | MutationResponse
  | ActionResponse
  | FatalError
  | AuthError
  | Ping;

export function parseClientMessage(value: unknown): ClientMessage {
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
      return parseRequestMessage(value, "Mutation");
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

function parseModifyQuerySet(value: Record<string, unknown>): ModifyQuerySet {
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

function parseQuerySetModification(value: unknown): QuerySetModification {
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

function parseAuthenticate(value: Record<string, unknown>): Authenticate {
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

function parseRequestMessage<T extends "Mutation" | "Action">(
  value: Record<string, unknown>,
  type: T,
): T extends "Mutation" ? MutationRequest : ActionRequest {
  const args = value.args;
  if (!Array.isArray(args)) throw new Error(`${type}.args must be an array.`);
  return {
    type,
    requestId: requiredInteger(value.requestId, "requestId"),
    udfPath: requiredString(value.udfPath, "udfPath"),
    args: args.map(assertJson),
  } as T extends "Mutation" ? MutationRequest : ActionRequest;
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

function isJson(value: unknown): value is Json {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJson);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJson);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
