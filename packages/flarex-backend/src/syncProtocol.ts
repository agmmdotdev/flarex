import type {
  ConnectionIdentityVersion,
  ConnectionQueryId,
  ConnectionQuerySetVersion,
  ConnectionRequestId,
  ConnectionSyncTimestamp,
} from "flarex-protocol/connection";

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
export type SyncTimestamp = ConnectionSyncTimestamp;

/** @deprecated Import server wire contracts from `flarex-protocol/connection`. */
export type {
  ConnectionActionResponseMessage as ActionResponse,
  ConnectionAuthErrorMessage as AuthError,
  ConnectionFatalErrorMessage as FatalError,
  ConnectionMutationResponseMessage as MutationResponse,
  ConnectionPingMessage as Ping,
  ConnectionQueryFailedMessage as QueryFailed,
  ConnectionQueryRemovedMessage as QueryRemoved,
  ConnectionQueryUpdatedMessage as QueryUpdated,
  ConnectionServerMessage as ServerMessage,
  ConnectionStateModification as StateModification,
  ConnectionStateVersion as StateVersion,
  ConnectionTransitionMessage as Transition,
} from "flarex-protocol/connection";
