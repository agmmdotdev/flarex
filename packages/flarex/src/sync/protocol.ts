export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json | undefined };

export type QuerySetVersion = number;
export type IdentityVersion = number;
export type SyncTimestamp = number;
export type QueryId = number;
export type RequestId = number;
export type QueryToken = string;

export type StateVersion = {
  querySet: QuerySetVersion;
  ts: SyncTimestamp;
  identity: IdentityVersion;
};

export type AddQuery = {
  type: "Add";
  queryId: QueryId;
  udfPath: string;
  args: Json[];
  journal?: string | null;
  partitionKey: string;
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
  partitionKey?: string;
};

export type Authenticate =
  | { type: "Authenticate"; tokenType: "User"; value: string; baseVersion: IdentityVersion }
  | { type: "Authenticate"; tokenType: "None"; baseVersion: IdentityVersion };

export type ClientMessage = Authenticate | ModifyQuerySet | MutationRequest;

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

export type ServerMessage = Transition | MutationResponse | FatalError | AuthError | Ping;

export function assertJson(value: unknown, path = "$"): Json {
  if (value === null) return null;
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => assertJson(item, `${path}[${index}]`));
  if (typeof value === "object") {
    const result: Record<string, Json> = {};
    for (const [key, field] of Object.entries(value)) {
      if (field === undefined) continue;
      result[key] = assertJson(field, `${path}.${key}`);
    }
    return result;
  }
  throw new Error(`Expected ${path} to be a JSON value.`);
}

export function parseServerMessage(value: unknown): ServerMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    throw new Error("Sync server message must be an object with a type.");
  }
  const message = value as { type: unknown };
  if (
    message.type === "Transition" ||
    message.type === "MutationResponse" ||
    message.type === "FatalError" ||
    message.type === "AuthError" ||
    message.type === "Ping"
  ) {
    return value as ServerMessage;
  }
  throw new Error(`Unknown sync server message type: ${String(message.type)}.`);
}
