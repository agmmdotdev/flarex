import type {
  ConnectionIdentityVersion,
  ConnectionQueryId,
  ConnectionQuerySetVersion,
  ConnectionRequestId,
} from "flarex-protocol/connection";
import type { Json } from "./types";

/** @deprecated Import inbound client contracts from `flarex-protocol/connection`. */
export {
  parseConnectionClientMessage as parseClientMessage,
} from "flarex-protocol/connection";

/** @deprecated Import inbound client contracts from `flarex-protocol/connection`. */
export type {
  ConnectionActionRequestMessage as ActionRequest,
  ConnectionAddQueryMessage as AddQuery,
  ConnectionAuthenticateMessage as Authenticate,
  ConnectionClientMessage as ClientMessage,
  ConnectionConnectMessage as Connect,
  ConnectionEventMessage as EventMessage,
  ConnectionModifyQuerySetMessage as ModifyQuerySet,
  ConnectionMutationRequestMessage as MutationRequest,
  ConnectionQuerySetModification as QuerySetModification,
  ConnectionRemoveQueryMessage as RemoveQuery,
} from "flarex-protocol/connection";

export type QuerySetVersion = ConnectionQuerySetVersion;
export type IdentityVersion = ConnectionIdentityVersion;
export type QueryId = ConnectionQueryId;
export type RequestId = ConnectionRequestId;

export type SyncTimestamp = number;

export type StateVersion = {
  querySet: QuerySetVersion;
  ts: SyncTimestamp;
  identity: IdentityVersion;
};

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
