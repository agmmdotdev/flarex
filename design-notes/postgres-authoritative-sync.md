# Postgres-Authoritative Sync and Cloudflare Cache Design

This note records the current research finding for an alternative Flarex
authority model:

```txt
Postgres is the source of truth.
Cloudflare runs user code, WebSockets, live-query state, and edge caches.
Trusted executors near Postgres own authoritative commits.
```

This is not the current default implementation. The current implementation is
still Durable Object shard-authoritative. This note exists because the
Postgres-authoritative design may better preserve Convex-style global database
semantics while still using Cloudflare for sandboxed execution and realtime
fanout.

Physical storage for this track should use the Convex-style generic
multitenant document/index schema described in
`postgres-multitenant-persistence-schema.md`. Sync/cache freshness depends on
versioned document history, encoded index entries, commit records, and outbox
events being written by the same trusted Postgres transaction.

## Finding

The Durable Object shard model gives strong local transactions but makes
arbitrary cross-shard atomic writes expensive. Moving authority to Postgres
changes the constraint:

```txt
DO-authoritative:
  one PartitionDO is one transaction manager
  cross-shard atomicMutation needs coordination

Postgres-authoritative:
  Postgres is one transaction manager
  rows across many logical tables can commit in one SQL transaction
```

This removes the small `atomicMutation` participant limit for data that lives
inside the same Postgres primary. It does not remove performance limits. The
new sensitive areas are:

- network distance between transaction executor and Postgres,
- number of SQL round trips,
- connection pool pressure,
- row and index lock contention,
- long transaction age,
- sync invalidation fanout.

The safe rule is:

```txt
Untrusted user code must not hold a Postgres transaction open.
```

User code can run in a Cloudflare Dynamic Worker and produce read dependencies
plus write intent. A trusted executor near Postgres opens a short transaction,
revalidates the read set or predicates, applies the write batch, writes a
change-log/outbox entry, and commits.

## Proposed Runtime Split

```txt
Browser
  <WebSocket>
ConnectionDO on Cloudflare
  owns query subscriptions, local result cache, and fanout

Dynamic Worker on Cloudflare
  runs untrusted user TypeScript
  uses a restricted ctx.db syscall/client API
  does not receive a raw Postgres connection

Query runtime on Cloudflare
  can run read-only query code
  can use Hyperdrive for ordinary reads
  records read dependencies and observed freshness

Trusted mutation executor near Postgres
  opens short DB transactions
  revalidates versions and predicates
  applies writes
  writes outbox/change_log rows
  commits

Postgres
  source of truth
  global constraints and transactions

Outbox dispatcher near Postgres
  reads committed change_log/outbox rows
  forwards commit events to Cloudflare
```

## Query Versus Live Query

Convex exposes one server `query(...)` API. The distinction is client-side:

```ts
useQuery(api.messages.list, args);       // live subscription
await client.query(api.messages.list, args); // one-shot result
```

Flarex should keep that developer model. Internally, however, live queries need
stricter freshness handling than one-shot queries.

```txt
one-shot query:
  may use Hyperdrive cache when staleness is acceptable

live query:
  must prove its result is fresh enough for the subscription state
  must record read dependencies
  must suppress stale or out-of-order updates
```

## Hyperdrive Is Not a Freshness Proof

Hyperdrive query caching is useful for ordinary reads, but it cannot by itself
prove live-query freshness. Cloudflare documents read query caching with
`max_age` and `stale_while_revalidate`; during stale-while-revalidate a cached
result may be served while refresh is happening.

That means this sequence is possible:

```txt
T1: live query reads version 1 from cache
T2: version 2 commits in Postgres
T3: Hyperdrive starts revalidation
T4: version 3 commits in Postgres
T5: live query still receives version 1 or version 2
```

The sync layer must not treat a Hyperdrive result as current unless it also has
a trusted freshness marker.

References:

- Cloudflare Hyperdrive query caching:
  https://developers.cloudflare.com/hyperdrive/concepts/query-caching/

## Freshness Mirror Idea

The proposed Cloudflare-side freshness layer:

```txt
Postgres transaction
  writes app rows
  writes outbox/change_log rows in the same transaction
  commits

Outbox dispatcher
  forwards commitVersion, row ids, row versions, and optional row images

VersionDO / DocCacheDO / QueryCacheDO
  stores latest known versions and hot replicated document/query data
```

Then a live query can use Hyperdrive but validate the result against the
freshness mirror:

```txt
1. Query reads through Hyperdrive.
2. Result includes row versions and observed commit marker.
3. ConnectionDO asks VersionDO for latest known versions.
4. If Hyperdrive result is older, do not publish it as latest.
5. Retry through no-cache path, wait for cache refresh, or use replicated row
   image from DocCacheDO.
```

This avoids an additional Postgres query just to detect stale results.

Detection is not the same as repair:

```txt
Hyperdrive returned version 17.
VersionDO knows version 18 exists.
```

At that point Flarex still needs one of:

- retry Hyperdrive until the observed version catches up,
- use a no-cache query executor path,
- read a replicated latest row image from DocCacheDO,
- rebuild the affected shared query from QueryCacheDO.

## Document Freshness Versus Range Freshness

Single document freshness is straightforward:

```txt
row: carts/cart_123
returned version: 17
latest known version: 18
result is stale
```

List and index queries need range freshness:

```ts
await ctx.db
  .query("cartItems")
  .withIndex("by_cart", q => q.eq("cartId", cartId))
  .collect();
```

A stale cached result might omit a new row entirely. The returned documents
cannot prove freshness for rows that are missing. The freshness mirror must
therefore track query dependency ranges:

```txt
range: cartItems.by_cart(cart_123)
latestRangeVersion: 44
queryObservedRangeVersion: 41
result is stale
```

This is close to the same dependency model needed for Convex-style live query
invalidation: document reads, table/index range reads, result hashes, and
commit watermarks.

## Sync Flow

```txt
Client subscribes:
  ConnectionDO records query path and args.

Initial run:
  Query runtime runs user query.
  Runtime returns result, read dependencies, resultHash, and observedVersion.
  ConnectionDO stores subscription state.

Mutation:
  Dynamic Worker runs user mutation and produces write intent.
  Trusted executor near Postgres opens transaction.
  Executor revalidates read dependencies.
  Executor applies writes and outbox rows.
  Executor commits.

Invalidation:
  Outbox dispatcher forwards commitVersion and changed dependencies.
  Cloudflare freshness/cache DOs update their version mirrors.
  ConnectionDO or SubscriptionDO finds affected live queries.
  Affected shared queries rerun with required freshness >= commitVersion.
  Only fresh changed results are published over WebSocket.
```

## Cache Layer Roles

```txt
VersionDO:
  latest known document/table/range versions
  lightweight freshness checks

DocCacheDO:
  hot replicated document rows
  useful for get-by-id live queries and fanout

QueryCacheDO:
  canonical shared query results
  resultHash, observedVersion, dependency ranges
  many subscribers can share one rerun

ConnectionDO:
  WebSocket session state
  client query-set protocol
  maps client subscriptions to shared query entries
```

This reduces trusted query/mutation executor load:

- repeated subscribers can share one query result,
- hot document reads can be served from Cloudflare SQLite,
- Hyperdrive can accelerate cold or ordinary reads,
- VersionDO can reject stale cached results without hitting Postgres,
- Postgres-side executors focus on commits, cold reads, and cache rebuilds.

## What This Does Not Solve

This design does not make Hyperdrive a correctness source. It also does not
make Cloudflare cache authoritative for writes.

The authoritative write path remains:

```txt
trusted executor near Postgres -> short Postgres transaction -> outbox -> commit
```

The cache path is a replicated read and freshness layer. It can lag. It must be
replayable from Postgres outbox or CDC. It must handle duplicates,
out-of-order events, dispatcher crashes, and backpressure.

## Phased Plan

Phase 1:

- Keep Postgres-authoritative design as an option, not current default.
- Use no-cache or near-Postgres query executor for live-query reruns.
- Use Hyperdrive for one-shot/ordinary reads where stale cache is acceptable.

Phase 2:

- Add `commitVersion`/LSN-style metadata and Postgres transactional outbox.
- Add `VersionDO` to replicate document/table/range versions into Cloudflare.
- Live query reruns must publish only results fresh through the required
  commit version.

Phase 3:

- Add `DocCacheDO` for hot row images.
- Serve simple get-by-id live queries from Cloudflare when version matches.

Phase 4:

- Add shared `QueryCacheDO` for canonical live query results.
- Deduplicate reruns and fan out one fresh result to many subscribers.

## Convex Comparison

Convex can run user function execution, transaction state, database reads, and
sync invalidation very close together. That is why its `ctx.db` calls can be
ergonomic and reactive without exposing cache freshness details.

This Postgres-authoritative Flarex design keeps the Convex developer surface
where possible, but the runtime boundary differs:

```txt
Convex:
  backend-owned function execution and database engine are close together

Flarex Postgres-authoritative:
  untrusted user code runs on Cloudflare
  authoritative commits happen near Postgres
  sync freshness is bridged through outbox and Cloudflare cache DOs
```

The required invariant is:

```txt
Developer-facing query API can stay Convex-like.
Runtime live-query freshness must be explicit and versioned internally.
```

## Open Questions

- Should Postgres authority replace DO authority, or remain an alternative
  backend mode?
- What is the smallest read-dependency model that supports both OCC commit
  validation and live query invalidation?
- Do we use commit sequence numbers, WAL LSNs, or logical timestamps as the
  primary freshness marker?
- Which live queries are allowed to use Hyperdrive cache during initial load?
- How should range versions be represented for index queries without exploding
  version cardinality?
- How much replicated row data should DocCacheDO store before it becomes a
  second database to operate?
- Should QueryCacheDO be per deployment, per table/index family, or per
  canonical query hash?
