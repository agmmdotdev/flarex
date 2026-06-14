# Subscriptions And Sync Engine

The sync engine preserves the Convex client experience across partition-local
authoritative data and eventually consistent projections.

## Client Contract

Keep:

- `/sync` and `/{client_version}/sync`
- query set modifications
- query set and state versions
- transitions
- mutation responses
- action responses
- auth changes
- reconnect and resubscription

The existing client should not need to understand Durable Objects,
partitions, projections, or Cloudflare Workflows.

## Components

```txt
Browser
  -> Connection Durable Object
       owns WebSocket and query set state
  -> Query Executor
       runs query and records dependency tokens
  -> Partition Durable Objects
       authoritative query dependencies and commit events
  -> Projection Partitions
       derived query dependencies and update events
```

## Connection Durable Object

Responsibilities:

- accept browser WebSocket
- track session and auth identity
- track subscribed query set
- invoke queries
- register dependency tokens
- receive invalidation notifications
- rerun invalidated queries
- send Convex-style transitions
- queue client mutations and workflow mutation requests

State:

```ts
type ConnectionState = {
  deploymentId: string;
  connectionId: string;
  sessionId: string | null;
  authToken: AuthenticationToken;
  identityVersion: number;
  currentStateVersion: StateVersion;
  querySetVersion: QuerySetVersion;
  queries: Map<QueryId, SyncedQuery>;
};
```

## Dependency Token

A query returns its value plus dependencies:

```ts
type QueryDependencyToken = {
  queryId: QueryId;
  dependencies: Array<
    | {
        kind: "partition-index-range";
        partition: PartitionAddress;
        table: string;
        index: string;
        lower: Uint8Array;
        upper: Uint8Array;
      }
    | {
        kind: "projection-index-range";
        projection: string;
        partition: string;
        index: string;
        lower: Uint8Array;
        upper: Uint8Array;
        projectionVersion: string;
      }
  >;
  resultHash: string;
};
```

For authoritative partition-local queries, dependencies are registered with the
partition or a partition subscription router.

For projection queries, dependencies are registered with the projection
partition/router.

## Authoritative Partition Invalidation

After a partition mutation commits:

```txt
Partition DO SQLite transaction commits
  -> compute changed table/index keys
  -> invalidate matching local dependency tokens
  -> notify Connection DOs or subscription router
  -> rerun affected queries
```

The commit and durable invalidation record must be atomic inside the partition.
Notifications can be retried from that durable record.

## Projection Invalidation

```txt
source partition commits
  -> durable projection event
  -> projection partition updates
  -> projection dependency tokens invalidate
  -> subscribed query reruns
```

The client still receives a live update, but projection lag means it may arrive
after the authoritative source mutation response.

## Query Rerun

```txt
1. dependency token invalidates
2. Connection DO or router reruns original query
3. query returns new value, dependency token, and result hash
4. if result hash changed, send transition
5. replace old dependency token even if value did not change
```

Replacing the token is required because the query may now depend on different
rows or ranges.

## Cross-Partition Query Rules

Queries may read multiple partitions, but doing so can create fanout and does
not provide one globally consistent snapshot.

Recommended defaults:

- allow direct reads of a small known set of partitions
- enforce fanout limits
- recommend projections for global lists and repeated joins
- surface development warnings for N+1 partition reads
- do not let cross-partition query results become authoritative mutation input

## Workflow Mutation Updates

A workflow mutation may cause several visible transitions:

```txt
partition A step commits -> affected queries update
partition B step commits -> affected queries update
workflow completes       -> workflow status query updates
```

This accurately reflects workflow semantics. The sync layer must not hold all
updates until workflow completion and pretend the operation was globally
atomic.

## Recovery

Correctness must not depend on best-effort messages:

- partition commits store durable invalidation/change records
- projection processors store durable progress
- Connection DO reconnect can rerun the current query set
- routers can catch up from partition/projection logs

## WebSocket Hibernation

Connection Durable Objects can use WebSocket hibernation. Avoid a topology that
requires every connection object to maintain many outgoing internal
WebSockets. Prefer explicit RPC/fetch notifications and durable catch-up.

## Required Tests

- existing client connects and subscribes
- partition-local mutation invalidates matching query
- unrelated partition mutation does not invalidate query
- projection update invalidates projection query
- workflow mutation produces live intermediate updates
- reconnect rebuilds dependency registrations
- missed notification is recovered from durable change record
- N+1 cross-partition query hits configured fanout limit
