# Sync Protocol Implementation Details

## Goal

Implement Flarex live sync as a Convex-style query-set protocol over a single
WebSocket connection, while preserving Flarex's Cloudflare Durable Object
partition boundary.

The first implementation should make `/sync` feel like Convex from the client
side:

- clients subscribe by function reference/path plus args,
- active subscriptions are represented as a versioned query set,
- the backend sends ordered query result transitions,
- mutations and actions can later share the same socket,
- query reruns are driven by read-set invalidation instead of polling.

The first implementation is intentionally partition-local. Cross-shard live
queries and global query invalidation remain later work.

## Convex Source References

Primary files to inspect before each implementation slice:

- `npm-packages/convex/src/browser/sync/protocol.ts`
  Defines the wire message model: `Connect`, `ModifyQuerySet`, `Mutation`,
  `Action`, `Authenticate`, `Transition`, `MutationResponse`,
  `ActionResponse`, `AuthError`, `FatalError`, and `Ping`.
- `npm-packages/convex/src/browser/sync/local_state.ts`
  Maintains client query-set versions and produces `ModifyQuerySet` messages
  for subscribe, unsubscribe, pause, and reconnect.
- `npm-packages/convex/src/browser/sync/client.ts`
  Provides `BaseConvexClient.subscribe`, mutation/action request queueing,
  optimistic updates, and the WebSocket URL shape.
- `npm-packages/convex/src/react/client.ts`
  Maps public React APIs such as `watchQuery`, `mutation`, and `action` onto
  the sync client.
- `crates/local_backend/src/subs/mod.rs`
  Owns the WebSocket upgrade and splits socket receive, socket send, and sync
  worker loops.
- `crates/sync/src/worker.rs`
  Runs the authoritative sync worker, processes `ModifyQuerySet`, queues
  mutations, executes queries, and emits `Transition`.
- `crates/sync/src/state.rs`
  Documents the core state model: query-set version plus timestamp, one
  subscription per active query, and invalidation futures.
- `crates/application/src/api.rs`
  Shows the compatibility boundary: sync calls `execute_public_query`,
  `execute_public_mutation`, `execute_public_action`, and obtains a
  `subscription_client`.
- `crates/database/src/subscription.rs`
  Tracks read-set subscriptions and invalidates them by comparing committed
  writes against read sets.
- `crates/database/src/write_log.rs`
  Implements stale-read and overlap checks used by tokens/subscriptions.

## Protocol Shape

Flarex should keep Convex message names where practical:

```ts
type ClientMessage =
  | Connect
  | Authenticate
  | ModifyQuerySet
  | MutationRequest
  | ActionRequest
  | Event;

type ServerMessage =
  | Transition
  | MutationResponse
  | ActionResponse
  | FatalError
  | AuthError
  | Ping;
```

The first supported client message should be `ModifyQuerySet`:

```ts
type ModifyQuerySet = {
  type: "ModifyQuerySet";
  baseVersion: number;
  newVersion: number;
  modifications: Array<AddQuery | RemoveQuery>;
};

type AddQuery = {
  type: "Add";
  queryId: number;
  udfPath: string;
  args: unknown[];
  journal?: string | null;
  partitionKey?: string;
};

type RemoveQuery = {
  type: "Remove";
  queryId: number;
};
```

The first server response should be a Convex-style `Transition`:

```ts
type Transition = {
  type: "Transition";
  startVersion: StateVersion;
  endVersion: StateVersion;
  modifications: Array<QueryUpdated | QueryFailed | QueryRemoved>;
  serverTs?: number;
};

type StateVersion = {
  querySet: number;
  ts: number;
  identity: number;
};
```

`partitionKey` is a Flarex-only temporary addition. Convex does not need it
because Convex owns a global deployment database and routing model. Flarex
currently executes against one `PartitionDO`, so the first live query protocol
must either receive a partition key explicitly or infer one from future
schema/codegen metadata.

## Backend Shape

### Worker Route

Current route:

```txt
GET /deployments/:deploymentId/sync
  -> ConnectionDO connection:{deploymentId}:{sessionId}
```

This route should remain the public backend sync boundary. The generated app
worker and Vite plugin can proxy to it later, but backend behavior should live
in `packages/flarex-backend`.

### ConnectionDO

`ConnectionDO` owns one WebSocket session.

Responsibilities:

- accept WebSocket upgrade,
- parse `ClientMessage`,
- enforce monotonic query-set versions,
- store active query subscriptions in memory,
- execute added queries through the active deployment invoke path,
- return ordered `Transition` messages,
- remove queries on `Remove`,
- close with clear protocol errors for malformed messages.

Initial in-memory state:

```ts
type ConnectionState = {
  querySetVersion: number;
  identityVersion: number;
  ts: number;
  queries: Map<number, ActiveQuery>;
};

type ActiveQuery = {
  queryId: number;
  udfPath: string;
  args: unknown[];
  partitionKey: string;
  journal?: string | null;
  readSet?: ReadSet;
  resultHash?: string;
};
```

For the first slice, `ConnectionDO` may rerun only when a query is added.
Invalidation registration is the next slice.

### Query Execution

On `AddQuery`, `ConnectionDO` should call the existing hosted invoke path:

```txt
ConnectionDO
  -> load active deployment
  -> execution artifact runtime invoke
  -> generated internal invoke route
  -> backend execution session/syscalls
  -> PartitionDO read at beginTs
```

The query response already returns enough backend envelope data to start sync:

- function result value,
- read set,
- begin/commit timestamp equivalent for query snapshot,
- log lines once available.

`ConnectionDO` stores the read set with the query so later invalidation can
compare committed writes against it.

### PartitionDO

`PartitionDO` remains the source of truth for one `{deploymentId,
partitionKey}`. It already owns documents, indexes, write log, idempotency, and
OCC validation.

Future sync responsibilities:

- store or receive active subscription registrations,
- compare commit writes and index writes against registered read sets,
- notify affected `ConnectionDO`s after commit,
- avoid notifying subscriptions when writes do not overlap.

The first implementation should not move subscription truth into `DeploymentDO`
or the generated execution artifact. Live invalidation belongs at the boundary
where committed writes are known.

## Implementation Slices

### Slice 1: Protocol Types And Initial Query Transitions

Add a shared protocol module, preferably in `packages/flarex-backend` first and
then re-export or mirror it in `packages/flarex` when the client package starts
consuming it.

Implement:

- `ModifyQuerySet` parsing,
- `Add` query execution,
- `Remove` query deletion,
- query-set version checks,
- `Transition` response with `QueryUpdated`, `QueryFailed`, and
  `QueryRemoved`,
- tests for malformed base versions and successful query subscription.

This slice proves the `/sync` state machine without pretending invalidation is
complete.

### Slice 2: Partition-Local Invalidation

Add subscription registration tied to one `PartitionDO`.

Options to evaluate during implementation:

- `ConnectionDO` registers read sets with `PartitionDO` after query execution,
- `PartitionDO` stores registered read sets and connection object names,
- after commit, `PartitionDO` compares writes against registered reads,
- on overlap, `PartitionDO` sends an internal invalidation request to
  `ConnectionDO`,
- `ConnectionDO` reruns the affected query and emits a new `Transition`.

This is the closest Cloudflare equivalent to Convex's
`SubscriptionClient.subscribe(token)` plus invalidation future.

### Slice 3: Mutation And Action Over Sync

Add Convex-style `Mutation` and `Action` messages to the WebSocket after
query transitions are working.

Mutation ordering matters. Convex's sync worker queues mutations with
single-client ordering and avoids advancing query results past pending
mutations in a way that would break optimistic updates. Flarex should copy that
behavior before adding optimistic client APIs.

### Slice 4: Client Package Compatibility

Once the backend protocol works, port/adapt Convex client code:

- `BaseConvexClient.subscribe`,
- `RemoteQuerySet`,
- `LocalSyncState`,
- `RequestManager`,
- React `watchQuery`, `useQuery`, `useMutation`, and `useAction`.

Keep names and mental model close to Convex. Only add Flarex-specific options
where needed for partition routing.

### Slice 5: Cross-Shard And Projection Sync

Cross-shard live queries are not part of the first protocol.

Later options:

- require a declared shard key for live queries,
- subscribe to projection tables for fan-out views,
- split one logical query into multiple partition subscriptions,
- reject unsupported cross-shard live queries at analysis/runtime with a clear
  error.

## Flarex Differences From Convex

- Convex has a coordinated backend database and timestamp model. Flarex starts
  with partition-local timestamps inside `PartitionDO`.
- Convex query subscriptions are backed by backend read tokens. Flarex already
  records read sets and must promote them into subscription tokens.
- Convex can hide routing from app developers. Flarex may temporarily require
  `partitionKey` until schema placement and generated routing can infer it.
- Convex's sync worker runs close to the database subscription manager. Flarex
  splits socket ownership (`ConnectionDO`) from data ownership (`PartitionDO`).
- Convex can eventually rerun all invalidated queries in one sync worker.
  Flarex must notify the correct connection object from the committed partition.

## Correctness Rules

- Do not implement live sync as polling.
- Do not send query updates without recording the read set that produced them.
- Do not claim global Convex-style live query semantics for cross-shard reads.
- Do not expose Durable Object or internal artifact concepts to application
  developers.
- Do not bypass the existing backend invoke/session/syscall path for query
  execution.
- Do not put authoritative subscription invalidation in the generated app
  worker.
- Keep protocol errors explicit and deterministic.

## Testing Strategy

Backend tests should cover:

- WebSocket upgrade route reaches `ConnectionDO`,
- `ModifyQuerySet/Add` runs a query and returns `Transition`,
- `ModifyQuerySet/Remove` returns `QueryRemoved`,
- base-version mismatch rejects the client message,
- missing `partitionKey` fails clearly until routing inference exists,
- query execution errors become `QueryFailed`,
- later: mutation commit invalidates only overlapping read sets.

Client tests should come after backend protocol stabilization and should reuse
Convex client behavior where possible.

## Implementation Record Template

Each sync implementation turn should append a checkpoint here or in
`05-sync-and-subscriptions.md` with:

```md
### `<previous commit>` Previous checkpoint title

Changed:
- ...

Convex references:
- ...

Flarex differences:
- ...

Validation:
- ...

Known limitations:
- ...
```

Record the new commit ID in the final response and carry it into the next sync
checkpoint.

## Implementation Checkpoints

### `f0af86b` Document sync protocol implementation plan

Changed:

- Added `packages/flarex-backend/src/syncProtocol.ts` with Convex-style client
  and server message types plus runtime parsing for initial sync messages.
- Replaced the `ConnectionDO` connected-message stub with a stateful WebSocket
  session that handles `ModifyQuerySet`, `Add`, and `Remove`.
- Routed added queries through the existing active deployment invoke path, using
  the hosted artifact runtime when configured.
- Added `readTs` to query `InvokeResponse` so sync transitions can advance with
  the query snapshot timestamp when available.
- Added Miniflare WebSocket tests for query add, query remove, query failure,
  and stale base-version handling.

Convex references:

- `npm-packages/convex/src/browser/sync/protocol.ts`
  for message names and `Transition`/query modification shape.
- `npm-packages/convex/src/browser/sync/local_state.ts`
  for query-set version behavior.
- `crates/sync/src/state.rs`
  for the state model of query-set version plus timestamp.
- `crates/sync/src/worker.rs`
  for handling `ModifyQuerySet` and emitting transitions.
- `crates/application/src/api.rs`
  for keeping sync query execution behind the same application function
  boundary as invoke.

Flarex differences:

- `AddQuery.partitionKey` is currently required because Flarex routes queries
  to one `PartitionDO`; Convex does not expose this.
- `ConnectionDO` owns the socket and query-set state, while `PartitionDO` owns
  authoritative data. Convex keeps the sync worker closer to the database
  subscription manager.
- Mutation/action messages are recognized but return `FatalError` until their
  ordering semantics are implemented.
- Query read sets are stored on the connection but are not yet registered for
  partition invalidation.

Validation:

- `corepack pnpm --filter flarex-backend typecheck`
- `corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts`
- `corepack pnpm --filter flarex-backend test`
- `corepack pnpm --filter flarex-backend build`
- `corepack pnpm --filter @flarex/backend typecheck`
- `corepack pnpm --filter @flarex/backend build`

Known limitations:

- No `PartitionDO` invalidation registration yet.
- Mutation-over-sync is handled in the next checkpoint. No action-over-sync
  queue yet.
- No client SDK integration yet.
- No cross-shard live query support yet.

### `d07e2fe` Implement initial sync query transitions

Changed:

- Added partition-local subscription registration routes to `PartitionDO`.
- Added a `sync_subscriptions` table keyed by `connectionName` and `queryId`.
- Reused `findReadSetConflict` to compare committed document/index writes
  against registered subscription read sets.
- Passed deterministic connection object names from the backend `/sync` route
  into `ConnectionDO`.
- Registered successful query read sets from `ConnectionDO` after `AddQuery`
  execution and after invalidation reruns.
- Unregistered subscriptions on `Remove`, query failure, and WebSocket close.
- Added internal `ConnectionDO` invalidation handling that reruns the affected
  query and emits a new `Transition` to the active socket.
- Added a Miniflare WebSocket test proving a direct partition commit reruns an
  overlapping live query.

Convex references:

- `crates/database/src/subscription.rs`
  for the read-set subscription and invalidation model.
- `crates/sync/src/state.rs`
  for keeping one active subscription per query.
- `crates/sync/src/worker.rs`
  for rerunning invalidated queries and sending transitions.
- `crates/database/src/write_log.rs`
  for the same write-log/read-set overlap concept used by OCC.

Flarex differences:

- Convex's subscription manager runs close to the database write log. Flarex
  stores subscription registrations in the owning `PartitionDO` and notifies
  `ConnectionDO` by Durable Object fetch.
- This implementation is partition-local and still requires `partitionKey` on
  `AddQuery`.
- `ConnectionDO` keeps active query definitions in memory. Durable WebSocket
  hibernation/recovery is still future work.
- Result de-duplication and invalidation coalescing are handled in the next
  checkpoint.

Validation:

- `corepack pnpm --filter flarex-backend typecheck`
- `corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts`
- `corepack pnpm --filter flarex-backend test`
- `corepack pnpm --filter flarex-backend build`
- `corepack pnpm --filter @flarex/backend typecheck`
- `corepack pnpm --filter @flarex/backend build`

Known limitations:

- No mutation/action-over-sync queue yet.
- No client SDK integration yet.
- No cross-shard live query aggregation yet.
- No durable subscription recovery across hibernation/restart yet.

### `e15c749` Add partition-local sync invalidation

Changed:

- Added stable JSON result fingerprints to active `ConnectionDO` queries.
- Updated invalidation reruns to refresh read-set registration while suppressing
  `QueryUpdated` when the result fingerprint is unchanged.
- Added per-query invalidation coalescing so a second invalidation arriving
  during an active rerun is queued instead of starting a parallel rerun.
- Added focused sync tests for unchanged-result invalidations and coalesced
  concurrent invalidations.

Convex references:

- `crates/sync/src/state.rs`
  `complete_fetch` computes `hash_result`, stores `result_hash`, and returns
  `None` when a rerun produces the same result.
- `crates/sync/src/worker.rs`
  processes invalidations through the sync worker loop instead of running
  parallel reruns for the same query.

Flarex differences:

- Convex hashes packed JSON plus log lines. Flarex currently fingerprints a
  stable JSON representation of the result value because log lines are not yet
  part of the execution envelope.
- Convex tracks invalidation futures in the sync state machine. Flarex keeps
  lightweight `rerunInFlight` and `rerunQueued` flags on the active
  `ConnectionDO` query.
- Unchanged Flarex reruns still emit an empty `Transition` to advance the
  server-side timestamp; they do not include `QueryUpdated`.

Validation:

- `corepack pnpm --filter flarex-backend typecheck`
- `corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts`
- `corepack pnpm --filter flarex-backend test`
- `corepack pnpm --filter flarex-backend build`
- `corepack pnpm --filter @flarex/backend typecheck`
- `corepack pnpm --filter @flarex/backend build`

Known limitations:

- Result fingerprints do not include log lines yet.
- No action-over-sync queue yet.
- No client SDK integration yet.
- No cross-shard live query aggregation yet.
- No durable subscription recovery across hibernation/restart yet.

### `e881c54` Deduplicate sync invalidation reruns

Changed:

- Extended Flarex `Mutation` sync messages with temporary `partitionKey`.
- Added per-connection mutation queueing in `ConnectionDO`.
- Executed sync mutations through the same active deployment artifact-runtime
  path as invoke and query sync.
- Emitted Convex-style `MutationResponse` messages for success and failure.
- Reran active same-partition queries after successful mutations.
- Added tests for mutation success plus query refresh, missing partition key
  failure, and sequential mutation execution.

Convex references:

- `crates/sync/src/worker.rs`
  queues mutations through `mutation_sender` and executes only one mutation at
  a time for a sync worker.
- `crates/sync/src/worker.rs`
  emits `ServerMessage::MutationResponse` and schedules query updates after
  mutation completion.
- `npm-packages/convex/src/browser/sync/client.ts`
  sends `Mutation` messages with `requestId`, `udfPath`, and encoded args, and
  resolves client-side mutation promises from mutation responses.

Flarex differences:

- Flarex temporarily requires `partitionKey` on `Mutation` messages because the
  backend routes writes to one `PartitionDO`.
- Flarex currently reruns all active queries on the same partition after a
  successful mutation. Convex uses its subscription invalidation machinery and
  stronger timestamp coordination.
- Flarex mutation responses include `committedTs` as `ts` when available, but
  log lines are not wired through yet.

Validation:

- `corepack pnpm --filter flarex-backend typecheck`
- `corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts`
- `corepack pnpm --filter flarex-backend test`
- `corepack pnpm --filter flarex-backend build`
- `corepack pnpm --filter @flarex/backend typecheck`
- `corepack pnpm --filter @flarex/backend build`

Known limitations:

- No action-over-sync queue yet.
- Mutation-triggered query refresh is partition-local.
- Mutation/query refresh ordering can still be improved around backend
  invalidation notifications from real commits.
- No client SDK integration yet.
- No cross-shard live query aggregation yet.
- No durable subscription recovery across hibernation/restart yet.

### Create-Root Mutations Over Sync

Previous completed checkpoint: `b5c9780` Enable create-root generated
execution.

Changed:

- `ConnectionDO` now accepts `Mutation` messages without `partitionKey` only
  when active function metadata says the mutation is `partitionCreateRoot`.
- Existing-root sync mutations without `partitionKey` still fail before
  execution.
- After a create-root mutation succeeds, `ConnectionDO` derives the committed
  partition key from the root table write and reruns active queries on that new
  partition.
- The browser sync client can send mutation messages without `partitionKey`.
- `FlarexClient.mutation(...)` now defaults create-root references back to the
  sync transport.

Convex references:

- `crates/sync/src/worker.rs`
  queues mutations and resolves client mutation promises from
  `MutationResponse`.
- `crates/sync/src/state.rs`
  coordinates query-set updates after mutation-side invalidation.
- `npm-packages/convex/src/browser/sync/client.ts`
  sends mutations over the sync protocol by default rather than forcing a
  separate HTTP path.

Flarex differences:

- Convex can schedule all affected queries through a global subscription model.
  Flarex only reruns active queries in the resolved `PartitionDO` partition.
- Create-root sync mutation refresh requires the backend to inspect committed
  writes and find the newly created root id. If a future handler somehow
  returns success without a root write, there is no partition-local refresh.
- Live queries still require explicit/generated partition keys.

Validation:

- `corepack pnpm --filter flarex typecheck`
- `corepack pnpm --filter flarex exec vitest run test/client.test.ts --maxWorkers=1`
- `corepack pnpm --filter flarex-backend typecheck`
- `corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts --maxWorkers=1`
