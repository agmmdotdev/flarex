# Postgres-Authoritative Sync And Cloudflare Coordination

## Status And Authority

Accepted replacement integration direction; implementation is incomplete.
[Runtime-agnostic query sync](./runtime-agnostic-query-sync-engine.md) owns the
versioned live-query service, fixed targets and portable session semantics.
[FlarexDB's accepted design](./flarex-db-accepted-design.md) continues to own
application-data, transaction, snapshot and committed-change authority.

This note replaces its former moving-latest activation, mandatory exact result
publication and per-client Postgres reconnect-registry prescriptions. Where
[roadmap 21](../roadmaps/21-cloudflare-freshness-cache.md) or older preflights repeat
those prescriptions, use this note and the
[current query-sync roadmap](../roadmaps/query-sync-engine/README.md).
Postgres authority, gap recovery, safe mutation reads and deferred cache actors
are unchanged. The docs do not implement the replacement or delete old state.

## Ownership Map

| Layer | Owns | Does not own |
| --- | --- | --- |
| FlarexDB / trusted executor | Logical catalog, business rows/history/indexes/relations, transactions, exact reads, authoritative source positions and change feed | Browser subscriptions, query-set transitions or sync-result queues |
| Flarex bridge | Authenticated query resolution, bounded executable material/resolver, dependency/authority projections and source/evaluator composition | Another database, invalidation algorithm or subscriber registry |
| Portable query-sync | Query instances, fixed targets, versioned result reuse, sessions, leases, bounded progress and reset/recovery | Business data, SQL layouts for the core, sockets or framework schemas |
| Sync state adapter | Atomic infrastructure storage and internal migrations for derived query/session state | Application schema definitions or per-collection DDL |
| Cloudflare host/gateway | Scope placement, private service calls, local transaction bridge, scheduling and transport | Portable session policy or authoritative committed data |

Existing business families such as `fx_app_row_rev`, `fx_app_row_current`,
`fx_app_index_entry_rev`, `fx_app_index_entry_current`, `fx_app_unique_key`,
`fx_app_edge_current` and `fx_app_edge_adjacency_version` are not subscription
registries. The shared logical storage redesign owns their evolution.

The current generation-4 adapter's seven `deployment_sync_*` tables store
contract/scope state, queries, dependencies, pending publications, an in-flight
publication and publication bookkeeping. These are current infrastructure
representation, not tables generated for each business collection or the required
replacement layout. Source: `packages/flarex-backend/src/deploymentSync/StorageContractGeneration4.ts`.

## Initial Placement

```text
ordinary query / reactive client
               |
      authenticated Flarex gateway
               |
       Flarex bridge and scope host
          /                    \
private executor         query-sync service + sync SQLite
Postgres snapshots       query tracking + session coordination
and committed changes              |
                            connection delivery
```

One scope coordinator DO is the initial capacity hypothesis. Engine identities
remain platform-neutral; do not mandate an actor per query, table or subscriber.
Executor query work and network delivery occur outside its local state
transactions. Gateway connection resources may be separated for capacity, but
session consistency/reconnect logic is not reimplemented in that gateway.

`DeploymentSyncDO` exposes only a private catch-up probe. Its selected
[translated Core cutover](../roadmaps/query-sync-engine/preflight/16-translated-core-source-retirement.md)
is a fixed-target checkpoint consumer for an empty query set; it preserves
bounded progress and reconstruction without claiming fixed-target sessions or
production delivery. Historical generation-4 records remain private baseline
evidence; its unconsumed adapter runtime and compatibility closure are retired.
The
[source/host record](../roadmaps/query-sync-engine/preflight/13-qsync-fx02-postgres-host-composition.md)
and [producer record](../roadmaps/query-sync-engine/preflight/14-qsync-fx02-c-application-query-evidence.md)
retain that evidence and the known durable-execution-material gap.

## Exact Source Contract

Postgres remains the only committed-data authority. The selected translated
source binds published Core timestamps to the Application deployment, scope,
epoch and authenticated source identity. These positions are sparse; subtraction
does not count commits. The former scope/epoch/dense-commit contract remains with
its named unmigrated consumers and is not a wrapper for Core timestamps. Epoch
replacement fences old work without resetting authoritative data. A captured
log interval or complete dependency-validity certificate must correlate target,
retention and current authority; direct wakes never supply truth. The owner
selected pinned Convex log/retention semantics rather than the former feed's
extra independent missing-commit corruption evidence.

The bridge must prove selected-target logical snapshots or an equivalent
certified coherent query-set snapshot. Existing current-snapshot producer evidence
alone does not prove that capability. Reuse row/history/index and snapshot
owners; do not hold a database transaction across untrusted code or remote I/O,
create a second read engine or relabel an arbitrary newer result as target-valid.

At target `T`, all required session query values must be valid together.
Reconcile dependencies around installation and preserve every relevant change
after `T` as subsequent work. Source progress may advance while the session
finishes its fixed target; that alone must not force rerunning the target. A
missing retained interval, schema/head incompatibility or authority revocation
requires explicit handling, not fabricated validity.

Mutation reads still require their exact begin snapshot plus admitted pending
write overlay. A cached row from 105 is not a valid read at 100 merely because
105 is newer. Database commit and its outcome recovery never wait for sync.
Reactive client mutation visibility is a separate post-commit session barrier;
transport failure cannot be called transaction rollback.

## Dependency And Authority Mapping

Reuse logical read observation from the actual query runtime. Successful missing
point reads and empty ranges are dependencies, and nested reads share one
snapshot. The translated Core captures exact index intervals, including its
virtual metadata identities. Preserve that evidence at the source instead of
flattening it into the former producer's equality/table keys. Core tokens are
trusted source evidence, never untrusted subscription inputs or physical commit
capabilities. Complete service query tracking remains a separate gate. Framework
and relation consumers must use the same execution owner instead of adding
their own sync algorithms.

The bridge binds canonical function/arguments, code/schema/runtime policy and
effective authorization. Query sharing never uses equal text alone. All mutable
authority must have defined observation/fencing; reconnect reauthorizes, and
observed revocation fences buffered frames. A hash is neither executable input
nor a permanent credential. Store bounded executable material/resolver references
within the sync registration lifecycle, with privacy and expiry limits.

## Recovery And Data Disposition

Sync owns leased subscriber interest, derived results/dependencies and session
progress. The initial host retains useful state for restart, but expired/lost
state can require generation-fenced reset and automatic re-registration. A
gateway must detect state-generation loss; old frames cannot enter the rebuilt
session. Corruption is not authorized fresh absence.

No mandatory database-core subscription or browser reconnect table is added.
An actual source snapshot pin needed to complete a bounded target remains
source-owned and requires its retention contract. It is not an indefinite lease
on all history for every disconnected browser. A resume request older than
retained evidence resets rather than claiming complete incremental replay.

Preserve retained source coverage and reliable wake evidence. Source-certified
token validity over a complete retained interval can replace raw feed
enumeration; do not fabricate dense commits or a second durable receipt chain.
A host recovery
owner must close lost direct wakes before any results are queued, plus missed
notifications on active connections. A checkpoint mirror, if justified, may lag
actual progress but never lead, and cannot become a second query registry.

Prototype Postgres subscription/delivery/connection tables and exact publication
attempt state are retirement candidates, not deletion instructions. Inventory
named stored state and real consumers; switch a complete target-only path and
remove displaced callers together. No dual engine, dual registry or fallback.
The database's business-event outbox and mutation journals/outcomes are unaffected.

## Deferred Work And Exit Gate

Cache actors, sharding, additional service indexes, external result stores and
additional transports require measured need and separate ownership proofs.
Durable Streams is optional, not a blocker for the ordinary query path or the
owner of portable session consistency. App schema evolution does not normally
change sync DDL; internal sync migrations belong to its state adapter.

The permanent standalone source/SQLite/loopback suite and a narrow early Flarex
feasibility witness progress together. The real integration must prove mutation
visibility, fixed-target progress, query-set consistency, permission changes,
lease cleanup, lost wake/send, restart/reset, two-scope isolation and bounded
resource use. Local reopen is not deployed eviction or WebSocket hibernation.
Use [conformance and adoption](../roadmaps/query-sync-engine/04-conformance-and-flarex-adoption.md)
and the [redesign preflight](../roadmaps/query-sync-engine/preflight/15-live-query-service-redesign.md)
before runtime changes.
