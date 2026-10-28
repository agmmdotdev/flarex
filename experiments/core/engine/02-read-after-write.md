# Concept 02: read-after-write freshness

Status: **Accepted design direction; no implementation**. Ordinary new reads use
the current ready app owner's latest fully published snapshot. New ordinary reads
wait within a bounded deadline or fail explicitly during recovery. Cache warming
is not a prerequisite for serving an eligible timestamped read. Reactive-client
timestamp synchronization is the selected direction; its wire protocol remains
open. Replication is **open and explicitly deferred**.

This refines [timestamped reads](./02-timestamped-snapshots.md) and
[commit coordination](./01-commit-coordination.md). It does not replace the
[operation deadline](./02-operation-lifetime.md) or
[authentication and grant rules](./02-read-authorization.md).

## Accepted server read-admission rule

1. A successful mutation is durably saved and published in the accepted order
   before normal success acknowledgement. Publishing includes the cache/change
   tracking needed to make the new view coherent; saved-but-unpublished work is
   not the ordinary read view.
2. The current ready app owner admits a new ordinary query at its latest safe
   published timestamp `P`. The operation keeps that timestamp across all reads.
   If mutation `M` was acknowledged before this query began, `P` must include `M`.
   Later legitimate writes may change its result again.
3. A cache entry must prove the requested result at `P`; otherwise read explicit
   history from PostgreSQL at `P`. An old or empty local cache is not a reason to
   return an older snapshot, infer absence or fall back to latest physical rows.
4. The owner supplies `P` locally while its ownership and recovered state remain
   valid. This does not require a separate timestamp-fetch request before every
   query or a PostgreSQL freshness query before every cache hit. The initial
   single-owner ordinary-read path relies on valid routing/ownership and server
   admission, rather than requiring a client minimum-timestamp token on each call.

This concerns a new call after success. A query admitted before that success can
retain an older snapshot. It is distinct from pending read-your-writes within one
atomic attempt and from a deliberately historical query or pagination cursor;
those latter API contracts remain open. Reading a previously displayed frontend
value is also not the same as executing a new backend query.

## Accepted recovery and cold-cache behavior

An app owner is not ready merely because its DO instance started or its SQLite
files survived. Before admitting new ordinary reads after startup or uncertain
persistence recovery:

- Fence old authority and establish that old database work cannot later change
  the reconstructed past.
- Reconcile all in-flight durable outcomes, including writes saved out of order.
- Reconstruct a safe published view from PostgreSQL and validate or discard local
  cached state that cannot prove eligibility for that view.
- Resume under valid ownership; fill missing rows/index ranges on demand.

While this gate is closed, new ordinary queries wait only within the applicable
bounded deadline or receive an explicit unavailable failure. Do not silently
serve a stale view. Complete cache warming is unnecessary: a ready owner can use
timestamped persistence misses. PostgreSQL remains durable authority; a local
watermark or maximum saved position alone does not prove a safe recovered view.

Concrete fencing/draining, durable recovery representation, readiness transitions,
handling of already-running operations on ownership loss, timeout values and error
mapping remain open. This policy does not claim that the recovery protocol exists.

## Cart example

1. Snapshot `100` contains cart quantity `1`.
2. Alice adds one. PostgreSQL saves the change at `101`; the app owner publishes
   `101`, applies the required cache invalidation/update, then reports success.
3. Alice starts a new cart query. Its snapshot is `101` or newer, so it sees
   quantity `2`, assuming no subsequent change. A cold cache reads at that same
   timestamp from PostgreSQL.
4. If the DO restarts between success and the query, the query passes through the
   recovery gate before selecting its snapshot. The new owner must recover a view
   containing the acknowledged update, not serve an old SQLite quantity `1`.

If a response was lost, resolve the stable operation outcome under the existing
recovery contract. The cart's current quantity is not an idempotency receipt and
the request must not blindly add one again.

## Accepted reactive-client direction

Preserve mutation commit timestamps and query-state timestamps in the eventual
reactive transport. Follow Convex's distinction between server completion and
the client's applied query state:

- A successful mutation response carries its commit timestamp.
- Resolve the reactive client's successful mutation promise after its query state
  has applied a transition at or beyond that timestamp. This is not a guarantee
  about when a browser paints a frame.
- Carry the client's highest observed timestamp on reconnect and check it against
  the ready backend view. Do not silently move the client backwards. The pinned
  Convex server reports an error when the client is ahead of its latest view.

The client timestamp is a consistency bound, not authorization or evidence that a
write committed. It cannot advance the owner's published view. No extra per-query
timestamp-fetch round trip is required. Exact encoding, app binding, reconnect
failure handling, subscription delivery and client integration remain open under
the query-sync work; this does not activate subscriptions or native result caching.
It also does not enable automatic Medusa/Payload command replay. Unknown outcomes
and resubmission keep their profile-specific ownership and idempotency rules.

## Pinned sources and necessary differences

Convex reference: `84fbb0e70b4e857913673871cb847ad11a55f3d5`; the
[source map and hashes](../REFERENCES.md#source-and-divergence-rules) identify the
inspected files. No source translation or runtime change is authorized here.

| Reference | Mechanism and limit |
| --- | --- |
| [Committer persistence completion and publish_commit](../../../../../crates/database/src/committer.rs) | Apply change tracking/cache invalidation and publish the snapshot before sending the successful commit timestamp. |
| [execute_public_query](../../../../../crates/application/src/api.rs), [ordinary HTTP query](../../../../../crates/local_backend/src/public_api.rs), [HTTP client query](../../../../../npm-packages/convex/src/browser/http_client.ts) | The ordinary path requests the latest server read timestamp without an additional timestamp-fetch call. Explicit historical queries are a distinct path. |
| [Database::now_ts_for_reads and load](../../../../../crates/database/src/database.rs), [SnapshotManager::latest_ts](../../../../../crates/database/src/snapshot_manager.rs) | New reads use the safe published snapshot. Startup loads database state and initializes its snapshot manager before the database is ready. |
| [new_idle_repeatable_ts](../../../../../crates/common/src/persistence.rs) | Establish a safe startup timestamp while holding the persistence lease with no concurrent persistence writes; future commits must be later. Do not copy only the maximum-timestamp calculation without its ownership conditions. |
| [RequestManager::onResponse and removeCompleted](../../../../../npm-packages/convex/src/browser/sync/request_manager.ts), [client transition handling](../../../../../npm-packages/convex/src/browser/sync/client.ts) | Successful mutation promises wait for applied query-state progress through the mutation timestamp. |
| [sync Connect and MutationResponse handling](../../../../../crates/sync/src/worker.rs), [client reconnect](../../../../../npm-packages/convex/src/browser/sync/client.ts) | Mutation responses carry timestamps; reconnect carries highest observed progress and the server rejects a backwards view. |
| [React client documentation](https://docs.convex.dev/client/react/overview) | Reactive queries receive updated results; pinned code establishes the exact promise/transition ordering used here. |

Necessary adaptation: the portable app owner must provide the same readiness and
monotonic visibility through PostgreSQL fencing and explicit outcome recovery
across DO restarts. The DO lifecycle and durable SQLite cache are not substitutes
for Convex's lease/quiescent-startup conditions. Framework services keep their
business results and lifecycle; transport metadata and client synchronization do
not turn them into one universal replayable mutation API.

## Remaining decisions and proof

The next question is [resumable index backfill](./OPEN-QUESTIONS.md#next-question-resumable-index-backfill).
Concrete recovery/readiness interlocks, monotonic timestamp representation,
client wire details, numerical budgets and historical pagination remain open.
Replication stays deferred; no follower-read protocol is selected.

Required later witnesses include immediate reads after success, a query begun
before the mutation, cold/evicted caches, restart after acknowledgement, saved B
while A remains unresolved, stale SQLite contents, old-owner writes, bounded
recovery refusal, mutation responses racing query transitions and reconnect with
client progress beyond the server's view. Preserve the database/host validation
gates in [VALIDATION.md](../VALIDATION.md); documentation is not correctness or
performance execution evidence.
