import {
  parseConnectionServerMessage,
  type ConnectionActionResponseMessage,
  type ConnectionAddQueryMessage,
  type ConnectionAuthenticateMessage,
  type ConnectionIdentityVersion,
  type ConnectionModifyQuerySetMessage,
  type ConnectionMutationRequestMessage,
  type ConnectionQueryFailedMessage,
  type ConnectionQueryId,
  type ConnectionQueryRemovedMessage,
  type ConnectionQuerySetModification,
  type ConnectionQuerySetVersion,
  type ConnectionQueryUpdatedMessage,
  type ConnectionRequestId,
  type ConnectionServerMessage,
  type ConnectionStateModification,
  type ConnectionStateVersion,
  type ConnectionSyncTimestamp,
  type ConnectionTransitionMessage,
} from "flarex-protocol/connection";
import type { Json as ProtocolJson } from "flarex-protocol/json";

export type Json = ProtocolJson;
export type QuerySetVersion = ConnectionQuerySetVersion;
export type IdentityVersion = ConnectionIdentityVersion;
export type SyncTimestamp = ConnectionSyncTimestamp;
export type QueryId = ConnectionQueryId;
export type RequestId = ConnectionRequestId;
export type QueryToken = string;

export type AddQuery = Omit<ConnectionAddQueryMessage, "partitionKey"> & {
  partitionKey: string;
};

export type RemoveQuery = Extract<ConnectionQuerySetModification, { type: "Remove" }>;
export type QuerySetModification = AddQuery | RemoveQuery;
export type ModifyQuerySet = Omit<ConnectionModifyQuerySetMessage, "modifications"> & {
  modifications: QuerySetModification[];
};

export type MutationRequest = ConnectionMutationRequestMessage;
export type Authenticate = Extract<
  ConnectionAuthenticateMessage,
  { tokenType: "User" | "None" }
>;

export type ClientMessage = Authenticate | ModifyQuerySet | MutationRequest;
export type StateVersion = ConnectionStateVersion;
export type QueryUpdated = ConnectionQueryUpdatedMessage;
export type QueryFailed = ConnectionQueryFailedMessage;
export type QueryRemoved = ConnectionQueryRemovedMessage;
export type StateModification = ConnectionStateModification;
export type Transition = ConnectionTransitionMessage;
export type MutationResponse = Extract<ConnectionServerMessage, { type: "MutationResponse" }>;
export type FatalError = Extract<ConnectionServerMessage, { type: "FatalError" }>;
export type AuthError = Extract<ConnectionServerMessage, { type: "AuthError" }>;
export type Ping = Extract<ConnectionServerMessage, { type: "Ping" }>;
export type ServerMessage = Exclude<ConnectionServerMessage, ConnectionActionResponseMessage>;

export function assertJson(value: unknown, path = "$"): Json {
  if (value === null) return null;
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    const result: Json[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        throw new Error(`Expected ${path}[${index}] to be a JSON value.`);
      }
      result.push(assertJson(value[index], `${path}[${index}]`));
    }
    return result;
  }
  if (typeof value === "object") {
    const entries: Array<readonly [string, Json]> = [];
    for (const [key, field] of Object.entries(value)) {
      if (field === undefined) continue;
      entries.push([key, assertJson(field, `${path}.${key}`)]);
    }
    return Object.fromEntries(entries);
  }
  throw new Error(`Expected ${path} to be a JSON value.`);
}

export function parseServerMessage(value: unknown): ServerMessage {
  const message = parseConnectionServerMessage(value);
  if (message.type === "ActionResponse") {
    throw new Error("Unknown sync server message type: ActionResponse.");
  }
  return message;
}
