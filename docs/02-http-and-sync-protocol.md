# HTTP And Sync Protocol

The public protocol is part of the compatibility contract. The Cloudflare
backend should preserve Convex's endpoint shapes and message semantics even if
the implementation behind them is rewritten.

## Gateway Responsibility

The Worker gateway owns HTTP routing and WebSocket upgrade handling:

```txt
Browser or CLI
  -> Cloudflare Worker gateway
  -> route to function API, sync session, storage, or HTTP action
```

The gateway should stay thin:

- parse URL and method
- extract client version
- extract auth token
- assign request ID
- route WebSocket upgrades to a Connection Durable Object
- route function HTTP calls to the Cloudflare Application API implementation
- route HTTP actions to the HTTP action runtime path

The gateway should not:

- hold mutation state
- perform OCC validation
- access raw Postgres directly
- run user code inline
- cache transactional query results

## Required Public Routes

Minimum application routes:

```txt
GET  /sync
GET  /{client_version}/sync
POST /query
GET  /query
POST /query_batch
POST /query_at_ts
GET  /query_ts
POST /mutation
POST /action
POST /function
POST /function/{path...}/{functionName}
ANY  /http/{rest...}
```

Additional routes can be added later for deployment, dashboard, logs, storage,
and import/export. They should not block the first compatibility slice.

## Function HTTP Requests

The public function request shape should remain:

```ts
type UdfPostRequest = {
  path: string;
  args: unknown;
  format?: string;
};
```

The route maps to the same application-level operations:

```txt
/query    -> execute_public_query
/mutation -> execute_public_mutation
/action   -> execute_public_action
```

The response shape should remain:

```ts
type UdfResponse =
  | {
      status: "success";
      value: unknown;
      logLines?: string[];
    }
  | {
      status: "error";
      errorMessage: string;
      errorData?: unknown;
      logLines?: string[];
    };
```

## Sync WebSocket Ownership

The WebSocket should be accepted by a Connection Durable Object. That Durable
Object represents one client connection or a manageable shard of connections.

```txt
Worker gateway
  -> Connection Durable Object
       owns browser WebSocket
       decodes ClientMessage
       queues operations
       emits ServerMessage
       talks to Subscription Router shards
```

This replaces the current process-local sync socket tasks with Durable Object
state. The protocol should still behave like the existing sync worker.

## Sync Session State

Each session needs:

```ts
type SyncSessionState = {
  sessionId: string | null;
  authToken: AuthenticationToken;
  identityVersion: number;
  currentStateVersion: StateVersion;
  receivedClientVersion: QuerySetVersion;
  queries: Map<QueryId, SyncedQuery>;
  pendingQueryUpdates: QuerySetModification[];
  pendingMutations: Map<RequestId, PendingMutation>;
};
```

Each synced query needs:

```ts
type SyncedQuery = {
  queryId: QueryId;
  query: {
    path: string;
    args: unknown;
    componentPath?: string;
    journal?: SerializedQueryJournal;
  };
  resultHash: string | null;
  subscriptionToken: SubscriptionToken | null;
  inFlight: boolean;
};
```

## Query Set Updates

When the client modifies the query set:

```txt
1. Validate base query set version.
2. Apply inserts/removes to session state.
3. For new queries, execute query at latest repeatable timestamp.
4. Store returned result hash and subscription token.
5. Register token with Subscription Router.
6. Send transition to client.
```

The important part is step 4. A query execution returns both the value and the
read dependencies. The WebSocket layer should not infer dependencies from
documents in the value.

## Mutations Over Sync

Mutations sent through `/sync` need the same semantics as HTTP mutations plus
sync-specific response ordering:

```txt
1. Client sends Mutation message with request/session identifier.
2. Connection DO queues it to preserve client mutation ordering.
3. Application API runs execute_public_mutation.
4. Transaction engine performs deterministic retry on OCC conflict.
5. MutationResponse is sent to client.
6. Commit notification eventually invalidates affected subscribed queries.
```

The session request identifier is important for idempotence across reconnects.
If the client reconnects and resends a mutation, the backend should return the
same completed result when possible.

## Actions Over Sync

Actions can run through the same Connection DO, but actions are not
transactional:

```txt
1. Client sends Action message.
2. Application API runs execute_public_action.
3. Dynamic Worker action runtime is allowed side effects.
4. ActionResponse is sent to client.
```

Actions may call queries and mutations through authenticated syscalls. They
should not directly access Postgres.

## Transitions

A transition is sent when the server has a new state version for the query set.
The Cloudflare implementation must preserve this model:

- query values have stable IDs
- unchanged query results can be omitted or marked unchanged
- changed results are sent with the new state version
- failed queries are represented as query failures
- mutation and action responses are separate from query transitions

Do not replace this with a generic "broadcast every changed document" protocol.
That would not preserve Convex's query dependency model.

## Reconnect Behavior

On reconnect:

```txt
1. Client reconnects with auth/session metadata.
2. Connection DO reconstructs or creates session state.
3. Client resends current query set if required.
4. Server reruns or refreshes subscriptions.
5. Server sends transition to align state.
```

Durable Objects can retain some session state, but correctness must not depend
on indefinite in-memory retention. The client must be able to recover by
resending its query set.

## Protocol Compatibility Tests

Required tests:

- HTTP query success and error response compatibility
- HTTP mutation success and error response compatibility
- HTTP action success and error response compatibility
- `/sync` WebSocket connection
- add query through sync and receive transition
- mutation through sync sends mutation response
- mutation invalidates subscribed query
- reconnect and resubscribe
- duplicate mutation request identifier returns idempotent result
- auth token change reruns affected queries
