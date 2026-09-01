# Cloudflare Sync And Freshness Coordination

## Status And Scope

Status: accepted Flarex Postgres/Cloudflare adapter direction with an
implemented prototype pipeline and production-inert per-scope cursor owner.
Portable query-sync semantics are now owned by
[`query-sync-engine/`](./query-sync-engine/README.md), not this roadmap.
Completed `SYNC01-A` through `SYNC01-F` remain current implementation evidence.
`SYNC01-GP` is retained adapter-design evidence but its authorization to
implement `SYNC01-G` directly as backend-owned semantics is superseded and
held. Portable semantic state and reference orchestration are complete through
`QSYNC01-C4`; their first real Flarex mappings and SQLite adoption are
owned by the accepted
[`QSYNC-FX01` preflight](./query-sync-engine/preflight/07-qsync-fx01-flarex-mappings-and-sqlite-state.md).
`QSYNC-FX01-A` is complete, private, and production-inert. The docs-only
[`QSYNC-FX01-B` verdict](./query-sync-engine/preflight/08-qsync-fx01-b-semantic-persistence-verdict.md)
is complete and records its historical stop-before-schema verdict. The accepted
[`QSYNC01-D0` record](./query-sync-engine/preflight/09-qsync01-d-operation-scoped-transition-plans.md)
freezes that seam and its D1-D4 implementation order; D1-D4 and the private
transition-plan export are complete. `QSYNC-FX01-C1` and its generation-2
three-operation SQLite vertical are complete in `b94abbb0`. The accepted
[`QSYNC-FX01-C2` checkpoint](./query-sync-engine/preflight/11-qsync-fx01-c2-sqlite-evaluation-vertical.md)
and its generation-3 six-operation evaluation vertical were implemented on
2026-08-30; its pinned local Workerd exit proof completed on 2026-08-31. C2 is
complete, private, unrouted, and production-inert. The accepted docs-only
[`QSYNC-FX01-C3` checkpoint](./query-sync-engine/preflight/12-qsync-fx01-c3-publication-lifecycle.md)
now contains its bounded generation-4 publication-lifecycle vertical plus
phase-2 and phase-3 closure; exact limits and the final Workerd exit remain
incomplete.
Roadmap 21 remains the accepted concrete Flarex/Cloudflare adapter authority.
Completion/recovery SQLite state, ordered Postgres catch-up, registration,
reset/reconnect, rerun, Durable Streams delivery, and production caller
integration remain incomplete. Cache Durable Objects remain deferred
optimizations.

Reconnect-retention DDL is not part of FlarexDB foundation S07. Existing
connection leases remain prototype mechanics, not the accepted replacement
retention authority. This roadmap must resolve reconnect identity, duration,
history budget, renewal, expiry, and reset semantics before requesting a
separate just-in-time schema gate.

This roadmap owns the concrete Flarex adapter direction for:

- transporting authoritative Postgres commit/change information into
  Cloudflare coordination;
- per-scope `DeploymentSyncDO` construction, namespace binding, SQLite state
  adaptation, `ConnectionDO`, and delivery-worker responsibilities;
- mapping Flarex canonical live-query identity, dependency facts, query
  execution, and result evidence into the portable engine;
- initial subscription activation, contiguous cursor processing, gap catch-up,
  lost-wake recovery, reconnect, and ordered publication;
- evaluation and possible adoption of upstream Durable Streams as the
  Cloudflare-native outbound delivery-log adapter;
- disposition and removal of the prototype Postgres subscription/connection/
  delivery registry as target coordination becomes complete; and
- the conditions under which `VersionDO`, `DocCacheDO`, or `QueryCacheDO` may
  eventually be introduced.

This roadmap does not own:

- runtime-neutral query-sync models, transition policies, semantic store
  contracts, or conformance;
- authoritative app-row, OCC, commit, or transactional-outbox semantics;
- temporary mutation/session journaling or commit-plan lowering;
- public client protocol parity beyond the internal correctness requirements;
- artifact execution and backend analysis; or
- chronological implementation history.

Roadmap 20 owns the Postgres executor and commit source. Roadmap 35 owns
session intent and the fail-closed read overlay. Git owns the historical
checkpoint record previously accumulated here.

## Current Sources Of Truth

Use these sources in order:

1. [`../design-notes/runtime-agnostic-query-sync-engine.md`](../design-notes/runtime-agnostic-query-sync-engine.md)
   and [`query-sync-engine/README.md`](./query-sync-engine/README.md) own the
   portable engine/product boundary, semantics, package direction, and
   conformance gates.
2. [`../design-notes/flarex-db-accepted-design.md`](../design-notes/flarex-db-accepted-design.md)
   owns Postgres authority, `SnapshotToken`, scope epoch/commit semantics,
   retention, and the accepted v1 sync topology.
3. [`../design-notes/postgres-authoritative-sync.md`](../design-notes/postgres-authoritative-sync.md)
   owns the focused activation, cursor, recovery, canonical-query, dependency,
   and deferred-cache design for the Flarex adapter composition.
4. [`20-postgres-executor.md`](./20-postgres-executor.md) owns the executor,
   storage-generation, commit-feed, and transactional-outbox prerequisites.
5. [`35-commit-compiler-and-session-intent.md`](./35-commit-compiler-and-session-intent.md)
   owns mutation/session reads and the rule that unsupported staged overlays
   fail closed.
6. Current code and decisive tests prove implemented prototype and
   production-inert adapter behavior:
   - [`packages/freshness/src/index.ts`](../packages/freshness/src/index.ts)
   - [`packages/executor/src/liveQueries.ts`](../packages/executor/src/liveQueries.ts)
   - [`packages/executor/src/liveQueryDeliveries.ts`](../packages/executor/src/liveQueryDeliveries.ts)
   - [`packages/executor/src/outbox.ts`](../packages/executor/src/outbox.ts)
   - [`packages/executor/src/sessions.ts`](../packages/executor/src/sessions.ts)
   - [`packages/persistence-postgres/src/schema.ts`](../packages/persistence-postgres/src/schema.ts)
   - [`packages/persistence-postgres/src/liveQuerySubscriptions.ts`](../packages/persistence-postgres/src/liveQuerySubscriptions.ts)
   - [`packages/persistence-postgres/src/liveQueryConnections.ts`](../packages/persistence-postgres/src/liveQueryConnections.ts)
   - [`packages/persistence-postgres/src/liveQueryDeliveries.ts`](../packages/persistence-postgres/src/liveQueryDeliveries.ts)
   - [`packages/flarex-backend/src/connectionDO.ts`](../packages/flarex-backend/src/connectionDO.ts)
   - [`packages/flarex-backend/src/schedulerDO.ts`](../packages/flarex-backend/src/schedulerDO.ts)
   - [`packages/flarex-backend/src/deliveryDO.ts`](../packages/flarex-backend/src/deliveryDO.ts)
   - [`packages/flarex-backend/src/deploymentSync`](../packages/flarex-backend/src/deploymentSync)
   - [`packages/flarex-backend/src/deploymentSyncDO.ts`](../packages/flarex-backend/src/deploymentSyncDO.ts)
   - [`packages/flarex-protocol/src/live-query.ts`](../packages/flarex-protocol/src/live-query.ts)

[`05-sync-and-subscriptions.md`](./05-sync-and-subscriptions.md) and
[`05-sync-protocol-implementation.md`](./05-sync-protocol-implementation.md)
remain compatibility implementation inventories until they are compacted.
Their historical partition-local or singleton-scheduler design is not the
accepted target when it conflicts with this roadmap or the design notes above.

## Framework Ownership And Implementation Hold

The accepted runtime-agnostic Query Sync Engine decision supersedes this
roadmap only where it previously made `flarex-backend` and Cloudflare SQLite the
owner of portable query-sync semantics.

Completed cursor, wake, dependency, generation, authenticated-head, and
per-scope actor work remains valid evidence. The existing production-inert
`DeploymentSyncDO` remains the first Flarex host placement. It must later
construct/adapt the portable engine; it does not become a second engine.

`SYNC01-G` has not started. Its direct package-local backend form is permanently
withdrawn as implementation authority and does not resume. Its useful evidence
flows only through the successor `QSYNC-FX01` adapter gates. The portable
transition/reference, semantic-state/orchestration, and D1-D4 planner
prerequisites are complete; C1 completed and C2 implemented their separately
accepted adapter slices. C2's full proof completed on 2026-08-31. C3 is
implemented through phase 3; exact limits and the final Workerd exit remain
incomplete.

The Flarex model/source/SQLite adapter may proceed independently of delivery
selection. Durable Streams must pass its own feasibility gate before any
Durable Streams publication, client adoption, reconnect claim, or production
cutover.

This correction authorizes no package, schema, migration, route, caller, dual
registry, fallback, delivery cutover, relation behavior, or production change.

## Current Architecture

### Implemented prototype pipeline

The working initial-Postgres prototype lane is approximately:

```text
legacy mutation commit
  -> legacy commit/outbox rows and timestamp-based write summary
  -> post-commit freshness projection and best-effort trigger
  -> singleton compatibility SchedulerDO
  -> Postgres active-subscription scan and authoritative query reruns
  -> durable live_query_deliveries rows
  -> DeliveryDO bounded claim/ack/retry/dead-letter loop
  -> ConnectionDO ordered WebSocket transitions
```

The implementation also retains the older PartitionDO subscription fallback
when the Postgres executor binding is absent. That fallback is unshipped
prototype behavior, not the forward authority or a migration obligation.

### Implemented replacement substrate

The private replacement foundation now has S08's canonical scope-local commit
headers/change rows and bounded reader, S09-A's committed-success result
receipt, and S09-B's single-purpose `deployment_sync_commit_wake_v1` table and
fenced claim/settlement repository. The wake is an at-least-once latency hint;
S08 remains the recovery authority, including across epoch rollover and feed
compaction. No target producer, C06 dispatcher, `DeploymentSyncDO` sink,
external lag sweep, reconnect activation, or delivery-retention policy is
implemented yet.

Postgres currently persists:

- legacy commit and outbox rows keyed by `deployment_id` and wall-clock `ts`;
- idempotent freshness-processed events;
- document and table freshness versions;
- active live-query definitions, read sets, identity, arguments, result, and
  result hash;
- connection leases and closure/expiry state; and
- durable delivery rows with claims, expiry, attempts, errors, delivery state,
  and dead-letter state.

The executor can record/remove subscriptions, classify stale read sets, rerun
queries through invoke sessions, refresh unchanged results, create changed or
failed delivery rows, claim/ack deliveries, clean expired connections, and
continue bounded maintenance scans.

The Cloudflare backend currently provides:

- `ConnectionDO` for WebSocket/query-set state and delivery consumption;
- `DeliveryDO` for bounded delivery drains and continuation alarms; and
- one compatibility `SchedulerDO` name for rerun, delivery reconciliation,
  dead-letter, and connection-cleanup work.

These are useful regression assets, but the timestamp/deployment mirror and
singleton scheduler are not the accepted scope-local commit-feed design.

### Accepted v1 topology

The target correctness path is deliberately smaller than the historical cache
proposal:

```text
authoritative Postgres per scope
  epoch + scope-lifetime monotonic commit_seq
  canonical commit/change feed
  transactional wake/outbox evidence
  conservative fenced sync-checkpoint mirror for external sweep
        |
        v
deterministic DeploymentSyncDO: deployment-sync:{scopeId}
  durable SQLite contiguous cursor
  canonical queries and generations
  dependency -> query inverted index
  dirty-through and single-flight rerun state
  bounded continuation/recovery state
        |
        v
durable changed-result delivery / ConnectionDO
  ordered query-set and WebSocket transitions
```

Direct wakes reduce latency. They are not recovery authority. A durable
external sweep compares the latest Postgres scope commit with a fenced sync
checkpoint and wakes lagging deterministic actors. `DeploymentSyncDO` then
catches up every missing commit in order.

### Mutation freshness and live-query freshness differ

The authoritative token is:

```ts
type SnapshotToken = {
  scopeId: ScopeId;
  epoch: ScopeEpoch;
  commitSeq: CommitSeq;
};
```

Mutation/session reads require the exact snapshot plus the attempt's supported
staged-write overlay. A cache holding commit 105 is not a valid answer for a
mutation snapshot at commit 100 merely because `105 >= 100`. V1 mutation reads
therefore use Postgres history.

A live query may publish a complete result computed at a snapshot at or after
`requiredFreshThrough` only when:

- the result came from one consistent authoritative snapshot;
- its actual snapshot token and dependency set are returned;
- every intervening commit was processed contiguously;
- package, schema, policy, identity, and registration generation still match;
  and
- publication is compare-and-swap generation checked and ordered.

Hyperdrive caching, a maximum observed version, or an outbox delivery timestamp
is not a freshness proof.

### Initial activation is two phase

The accepted activation order is:

1. `ConnectionDO` asks `DeploymentSyncDO` to create a provisional canonical
   query generation at the current contiguous cursor.
2. The trusted executor runs the query at a known Postgres snapshot and returns
   the result, result hash, dependency set, and token.
3. `DeploymentSyncDO` installs the dependencies and refreshes them against all
   commits through its current cursor.
4. It activates and publishes only if no relevant commit invalidated that
   generation; otherwise it reruns before publication.

The current `ConnectionDO` executes a query before durable registration, so
this activation race remains open.

### Contiguous commit processing

`appliedThroughCommitSeq` means every commit through that sequence was examined;
it never means the maximum notification observed.

```text
N == appliedThrough + 1
  -> apply change atoms and advance

N <= appliedThrough
  -> duplicate; ignore idempotently

N > appliedThrough + 1
  -> do not advance
  -> load and apply the missing Postgres interval in order
```

Epoch mismatch fences existing query generations and requires an authoritative
resnapshot. It does not reset scope commit sequences or hide untouched data.

### Query identity and dependency routing

A canonical query identity includes every result-affecting input:

```text
scope + epoch
active package hash
schema and policy version
function/component path
canonical encoded arguments
identity/access-policy fingerprint
```

Identical canonical queries rerun once and fan out to many subscribers.
Overlapping but non-identical queries share typed dependency keys, not result
identity. `DeploymentSyncDO` maintains the dependency-to-query inverted index;
it does not scan all Durable Object instances.

V1 dependency shapes include exact rows, typed index/range dependencies,
relation/edge occurrences or ranges, and conservative table/index fences when
precise intervals are not yet available. Broader reruns are the safe fallback.

The current private scope-sync contract implements three scope-local keys. An
`appRowPoint` key carries the canonical Application document ID, an `appTable`
key carries the catalog table ID, and an `appRelationIncoming` key carries the
edge-definition ID plus target row ID. Scope and epoch belong to the enclosing
`DeploymentSyncDO` and query generation rather than every inverted-index key.

Logical point reads use the exact row key. Index-range reads currently use the
conservative table key because the canonical feed does not yet carry old and
new ordered-index key evidence. Incoming relation reads use the exact relation
key; their observed adjacency version and active-head witness remain generation
evidence rather than routing-key fields. Each validated app-row commit fact
produces its exact row and table keys, and each incoming relation fact produces
its exact relation key. The paired outgoing fact produces no incoming key: the
relation writer and feed preserve the matching incoming target fact for every
admitted edge action. Any future outgoing-query profile requires its own typed
key.

This projection is pure, deterministic, and deduplicating. It rejects malformed
app-row identity bytes before returning any invalidation keys. The keys are
routing evidence only; no dependency persistence, registration, cursor
transaction, Durable Object, or host route exists yet.

## Invariants And Trust Boundaries

1. **Postgres remains authoritative.** Cloudflare coordination and caches are
   rebuildable and never own committed app data or the only recovery record.
2. **The commit feed is canonical ordering.** Outbox or direct wake delivery
   order cannot replace `(scope_id, epoch, commit_seq)` catch-up.
3. **Cursors advance contiguously.** Duplicate and out-of-order notifications
   are safe; gaps trigger Postgres interval reads before advancement.
4. **One deterministic actor initially owns one scope.** A global singleton
   cannot conflate rerun or continuation state across scopes.
5. **Initial registration cannot miss a write.** A provisional generation is
   refreshed through the processed cursor before activation.
6. **Query sharing is identity safe.** Package, schema, policy, and identity
   inputs namespace or invalidate canonical results.
7. **Reruns are generation fenced.** One canonical query has one single-flight
   generation; stale completions cannot overwrite a newer winner.
8. **Unchanged results still advance freshness.** `resultHash` suppresses a
   client transition, not cursor/dependency advancement.
9. **A direct wake is only a fast path.** A durable external sweep must recover
   a lost wake even when no delivery row was ever created.
10. **Delivery is downstream of invalidation.** Delivery claim/ack recovery
    cannot repair a trigger lost before reruns produced delivery rows.
11. **ConnectionDO is not the only durable registration owner.** Eviction,
    hibernation, reconnect, and lease cleanup must preserve recoverability.
12. **Reconnect retention is bounded and explicit.** Epoch mismatch or a cursor
    below the retained floor returns reset/resnapshot, never partial success.
13. **Unsupported dependency precision fails safe.** Conservative invalidation
    is acceptable; stale publication is not.
14. **Mutation caches require exact MVCC validity.** At-least-fresh values,
    maximum versions, and Hyperdrive cache hits cannot serve exact snapshots.
15. **Cache state is disposable.** Uncertain entries become dirty and rebuild
    from authoritative Postgres state.

## Decisions And Rationale

### Prove sync before adding cache actors

The earlier `VersionDO -> DocCacheDO -> QueryCacheDO` phase order introduced
three new actors without solving contiguous ordering, activation races,
identity-safe keys, or lost wakes. V1 therefore proves authoritative rerun and
recovery first. Caches may reduce latency later; they are not prerequisites for
correct live queries.

### Use one DeploymentSyncDO per scope first

Deterministic naming makes routing and recovery explicit, while Durable Object
SQLite keeps cursors and query/dependency state durable across eviction. A hot
scope may eventually need coordination buckets, but bucketing before measuring
load would introduce query ownership and cursor-handoff problems prematurely.

### Build the target without a dual subscription registry

The implemented Postgres subscription registry and connection leases are
prototype regression evidence. They were not shipped and must not force target
dual registration. `DeploymentSyncDO` SQLite owns canonical query, dependency,
generation, and contiguous-cursor coordination; Postgres owns the commit feed
and a conservative fenced cursor mirror for the external sweep. Hibernation and
restart retain DO storage. Explicit actor-state loss must fail closed into a
reset/resubscribe path rather than silently rebuilding ambiguous authority from
the prototype registry.

### Keep DeliveryDO downstream

Claim leases, bounded drains, retries, failure metadata, dead letters, and
reconnect candidates are valuable delivery mechanics. They remain separate
from commit-gap detection and query invalidation so a delivery reconciler is
not mistaken for the sync recovery owner.

### Use authoritative no-cache reruns in v1

Live-query correctness requires one consistent result and a dependency token.
Until a cache protocol proves version intervals, absence/range semantics, and
gap-free application, reruns use authoritative Postgres reads. Hyperdrive may
pool connections but its response cache is not publication evidence.

## Convex Compatibility And Flarex Divergences

Flarex follows these Convex sources and patterns:

- [`../../../crates/database/src/subscription.rs`](../../../crates/database/src/subscription.rs)
  for refreshing subscription tokens against already processed writes;
- [`../../../crates/sync/src/worker.rs`](../../../crates/sync/src/worker.rs)
  for activation, query reruns, and ordered transitions;
- [`../../../crates/sync/src/state.rs`](../../../crates/sync/src/state.rs)
  for active query state and result-hash suppression; and
- [`../../../crates/database/src/committer.rs`](../../../crates/database/src/committer.rs)
  for deriving invalidation from committed write metadata.

The necessary Flarex divergences are:

| Concern | Convex pattern | Flarex divergence |
| --- | --- | --- |
| Placement | Database commit processing and sync workers are close in one backend. | Postgres authority and Cloudflare actors are separated, so Flarex needs explicit cursors, wakes, catch-up, and durable lag detection. |
| Actor lifecycle | Backend sync state is not subject to Cloudflare DO eviction/hibernation. | Query definitions, dependency indexes, cursors, generations, and continuations must survive in DO SQLite or a proven durable registry. |
| Routing | Convex does not need cross-product Durable Object names. | Flarex routes one deterministic `deployment-sync:{scopeId}` actor initially and may bucket only after measurement. |
| Recovery | Process-local coordination can observe the database write stream directly. | Flarex requires a durable external sweep because a service-binding wake can fail before any delivery exists. |
| Delivery | Sync state and client connection handling remain within the hosted backend. | Flarex may materialize durable Postgres delivery rows and use DeliveryDO/ConnectionDO across Worker boundaries. |

These deployment differences do not justify changing the developer-facing
Convex query model or weakening subscription-token semantics.

## Implemented Capabilities

### Initial Postgres prototype state

The current schema and persistence layer implement:

- commit and transactional outbox rows for the legacy timestamp-based engine;
- idempotent outbox-to-freshness projection;
- document/table freshness mirrors and durable index-history checks;
- active live-query definitions with read sets, result hashes, arguments, and
  execution identity;
- connection leases, expiry scans, and idempotent removal; and
- delivery rows with claims, lease expiry, attempt/failure metadata,
  acknowledgement, and dead-letter state.

### Prototype executor behavior

The executor implements:

- subscription record/remove and connection cleanup operations;
- read-set freshness classification for documents, tables, and durable index
  history;
- limited stale-subscription scans and invoke-backed authoritative reruns;
- changed-result and query-failure delivery creation;
- unchanged-result freshness refresh;
- bounded claim/ack, pending/stuck scans, retry reporting, and dead-letter
  primitives; and
- outbox delivery batches with idempotent freshness projection.

### Prototype Cloudflare behavior

The backend implements:

- Convex-style query-set state and WebSocket transitions in `ConnectionDO`;
- executor-backed subscription registration and delivery consumption;
- bounded DeliveryDO drains with alarm continuation and skip/failure metrics;
- SchedulerDO continuations for reruns, delivery reconciliation, dead-letter,
  and expired-connection cleanup; and
- hosted/generated integration coverage for initial query execution, mutations,
  indexed/paginated queries, multi-connection fanout, changed results, failures,
  and reconnect candidates.

These capabilities preserve useful regression cases and reusable delivery
mechanics, not the final scope-local sync protocol. The production-inert
`DeploymentSyncDO` remains an empty placement shell. The backend now contains
one private generation-3 normalized SQLite authority intended for its
object-local database. Its six-operation evaluation vertical covers binding,
namespace initialization/inspection, evaluation begin, atomic admitted-batch
invalidation plus cursor advance, completion evidence and dependency roles,
pending-publication intent, evaluation claiming, and attempt outcomes. No
production host constructs the adapter; publication claiming, publication
attempt outcomes, and publication completion remain absent. No catch-up loop,
`VersionDO`, `DocCacheDO`, or `QueryCacheDO` implementation exists.

The current private protocol/model/adapter work owns strict cursor and wake
contracts, scope-local dependency keys, logical-read projection, validated-
commit invalidation projection, canonical Flarex query identity, and the
generation-3 SQLite representation. Portable query/generation decisions come
from `@flarex/query-sync`; the deleted backend-local policy must not be
recreated. The adapter has a normalized reverse dependency index and advances
the cursor only through portable admitted-batch semantics. It does not run a
query, claim publication work, deliver a result, or expose a production route.

## Known Gaps And Limitations

- Current live-query commits and mirrors use `deployment_id` plus wall-clock
  `ts`, not `scope_id`, epoch, and contiguous `commit_seq`.
- `ConnectionDO` executes an initial query before durable registration, leaving
  a missed-commit activation race.
- All deployments currently route scheduled reruns through one compatibility
  SchedulerDO name with singleton pending/in-flight rerun state.
- The mutation finish hook notifies sync best-effort; current recovery does not
  close the pre-rerun lost-trigger gap.
- The production-inert per-scope cursor exists, but no ordered Postgres
  gap-catch-up loop or production caller exists.
- Current stale detection scans active Postgres subscriptions rather than a
  typed dependency-to-query inverted index.
- Compatibility live-query state does not use the new private canonical-query
  and generation contracts and therefore still lacks target authority despite
  the backend-local policy/protocol work pinning every accepted
  identity-sensitive input.
- Concurrent reruns lack the accepted compare-and-swap generation protocol.
- Current connection leases are compatibility leases, not the accepted
  reconnect-retention token tied to scope epoch, storage generation, fence, and
  minimum required commit sequence.
- The initial row, table-fallback, and incoming-relation dependency-key core is
  implemented, but persisted indexing, exact ordered-range facts, outgoing
  query profiles, and shared OCC/sync interval encoding remain incomplete.
- Delivery reconciliation can recover pending result rows, but it cannot detect
  a commit whose invalidation wake was lost before rerun.
- Real-Postgres mutation-to-WebSocket recovery across actor eviction, reversed
  notifications, gaps, epoch changes, and reconnect floors is not proven.

## Deferred Cache Layers

### VersionDO

Deferred. A maximum observed sequence is not an applied-through proof. Any
future sharded version mirror needs a transactionally generated contiguous
bucket stream or an authoritative catch-up rule before claiming freshness.

### DocCacheDO

Deferred. A future hot-row cache may serve one-shot reads, but exact mutation
snapshots require MVCC validity intervals plus tombstone, absence, and range
proofs. Otherwise the trusted executor reads Postgres history.

### QueryCacheDO

Deferred. `DeploymentSyncDO` initially owns canonical result hashes and
single-flight rerun state. Split large shared results into QueryCacheDO only
after memory/load measurements justify another actor and a generation handoff
protocol is defined.

Cache actors, if introduced, use internal scope/dependency/canonical-query
identity. They never reintroduce public partition keys or authoritative
Cloudflare data storage.

## Target Direction

The target Flarex adapter lifecycle is:

```text
authenticated Flarex query request
  -> bind one scope/namespace and canonical access-aware query identity
  -> portable engine begins a provisional generation
  -> Flarex executes the authoritative query at SnapshotToken
  -> portable engine refreshes against contiguous admitted Postgres facts
  -> Cloudflare SQLite adapter atomically activates the exact generation
  -> portable engine processes later commit facts in order and marks dirty work
  -> generation-fenced authoritative rerun at snapshot >= dirtyThrough
  -> unchanged freshness update or durable publication-outbox entry
  -> append through the accepted authenticated delivery adapter
       Durable Streams remains the current candidate
  -> client applies the result before advancing its transport checkpoint
```

Recovery is equally important:

```text
lost wake / DO eviction / Worker crash
  -> durable sweep finds Postgres latest commit ahead of mirrored cursor
  -> deterministic DeploymentSyncDO wakes
  -> namespace engine performs contiguous Postgres interval catch-up
  -> semantic SQLite state validation, or explicit reset if state is unavailable
  -> dirty reruns
  -> publication-outbox replay with the identical stream producer identity
  -> delivery resume or explicit stream rotation/resnapshot
```

Remove the Postgres prototype registry only after the portable engine plus
Flarex/Cloudflare adapters pass restart, reconnect, state-loss reset, stream
rotation, authorization, lease cleanup, and lost-wake proof with all callers
switched. No live dual-registry migration is required. Only after the
authoritative loop is correct and measured may cache layers enter the design.

## Next Correctness Gates

The sync replacement does not begin before roadmap 20's Wave 2 `C07` gate
proves one atomic replacement commit with the canonical commit/change feed,
idempotency outcome, and transactional outbox. Prototype fixes should be limited
to what is needed to preserve regression evidence or unblock caller migration;
they must not create a second forward sync architecture.

After `C07`, completed `SYNC01-A` through `SYNC01-F` remain evidence. The next
ordered gates are now:

1. Query Sync Engine `QSYNC01-A` completed the pure transition kernel/reference
   model without changing the current actor/store/protocol.
2. Query Sync Engine `QSYNC01-B` through `QSYNC01-C4` completed the trusted
   change-model boundary, semantic atomic state contract, and Effect-native
   reference orchestration.
3. The accepted `QSYNC-FX01` preflight completed A's mapping slice and B's
   historical docs-only access-plan verdict. `QSYNC01-D1` through D4 then
   completed the operation-scoped portable planner seam for all nine methods.
4. `QSYNC-FX01-C1` completed the private generation-2 binding, initialization,
   begin, and admitted-batch SQLite vertical in `b94abbb0`.
5. `QSYNC-FX01-C2` implemented the private generation-3 six-operation
   evaluation vertical on 2026-08-30 without duplicate state, compatibility
   writes, a second reducer, or production routing. Its exact migration fault
   matrix and SQLite-local 4,096-query streaming migration proof are complete.
6. `QSYNC-FX01-C2` exited privately on 2026-08-31 after its non-migration
   maximum-population, race/read-trace, and pinned local Workerd proof matrix
   completed. This is not deployed Cloudflare evidence or a measured 128 MiB
   guarantee, and dispose/recreate does not prove eviction or hibernation.
7. Implement and prove the accepted docs-only
   [`QSYNC-FX01-C3` checkpoint](./query-sync-engine/preflight/12-qsync-fx01-c3-publication-lifecycle.md):
   its generation-4 publication lifecycle and complete private nine-operation
   adapter. C3 implementation and proof are complete through phase 3; exact
   limits and the final Workerd exit remain. FX01 remains incomplete until C3
   exits.
8. Independently run `QSYNC-CF01` against pinned upstream Durable Streams
   packages on real Cloudflare; accept or reject on conformance,
   auth/isolation, retention/rotation, payload, uncertainty recovery,
   lifecycle, and numeric cost gates. Rejection changes the delivery adapter,
   not the portable engine or Flarex state/source mapping.
9. Implement duplicate/reverse/gap processing and ordered Postgres catch-up
   through the trusted Flarex `ChangeSource`; never advance across a missing
   commit.
10. Add provisional registration, refresh against already processed commits,
   generation-fenced single-flight reruns, and unchanged-result suppression.
11. Process the already-semantic durable query-result publication outbox
    through the accepted delivery adapter without adding a second outbox or
    making transport the trigger-recovery owner.
12. Add a durable external lagging-scope sweep whose Postgres checkpoint mirror
   may lag but can never lead the namespace cursor.
13. Immediately before replacement sync admits reconnectable sessions, freeze
     query leases, stream age/message/byte budgets, rotation, renewal, expiry,
     auth change, and reset/resnapshot; add only the separately justified
     retention storage.
14. Prove real-Postgres mutation-to-client correctness for activation races,
     lost wakes, gaps, concurrent reruns, actor eviction, epoch rollover,
     publication uncertainty, stream rotation, reconnect, and broad dependency
     fallbacks.
15. Remove prototype SchedulerDO/Postgres registry and displaced unshipped sync
     code only after target-only recovery parity and all supported callers move.
16. Run `R03-B` through the accepted portable engine plus Flarex adapters; no
     Legacy timestamp registry or compatibility `SchedulerDO` is an interim
     owner.

`VersionDO`, `DocCacheDO`, and `QueryCacheDO` are not next gates. They require a
separate measured need and their own gap-free correctness proofs after v1 sync
is operational.

### [x] SYNC01-P — Freeze Target Authority And The First Cursor Core

Status: docs-only preflight completed on 2026-08-27. This checkpoint authorizes
only the private protocol and host-neutral cursor core described below. It adds
no Durable Object binding, route, alarm, SQLite table, Postgres mirror, direct
wake, subscription registration, query rerun, delivery, reconnect lease,
public SDK, Payload adapter, production caller switch, or compatibility-path
change.

#### Authority cut

- One deterministic `DeploymentSyncDO` remains the eventual coordination owner
  for one authenticated scope. Its SQLite state will own the applied-through
  cursor, provisional and active query generations, dependency index,
  dirty-through frontier, result hash, and bounded continuation state.
- Postgres remains authoritative for the scope clock, retained floor, commit
  headers and typed children, current Application active head, and any later
  conservative cursor mirror. A Postgres mirror may lag the DO cursor but must
  never lead it.
- The existing Postgres subscription registry, deployment-timestamp freshness
  mirror, singleton `SchedulerDO`, and `ConnectionDO` query-first activation
  path remain compatibility evidence only. The target core must not write or
  consult them as a second registration or cursor authority.
- The commit feed remains the only data-change order. A wake is merely a hint
  to catch up and must never advance the applied-through cursor by itself.
  Only a fully validated contiguous commit returned by the existing bounded
  repeatable-read feed may produce the next cursor. An epoch-mismatched wake is
  also only a hint: it requires an authenticated current-scope epoch read. It
  is an old-epoch duplicate when authority still matches the cursor and may
  require reset only when authority has left the cursor epoch.

#### Two independent registration fences

A target query registration must eventually carry both:

1. the exact `SnapshotToken` for data visibility and a typed logical dependency
   set; and
2. the authenticated current Application active-head witness used by query
   selection, including its activation sequence and active-head digest.

The point-commit feed does not describe Application activation. Do not invent
an activation-shaped app-data commit or relation fact. New registrations are
namespaced by their active-head witness, while an existing registration is
invalidated or resnapshotted when the separately read authenticated active head
no longer matches. The later host/sweep preflight must prove lost-wake recovery
for that head comparison as well as for the app-data cursor.

For the first relation profile, the query owner must return a private sync
receipt without changing the existing RQ01 logical result. That receipt contains
the exact snapshot token and one
`LogicalApplicationRelationIncomingReadDependencyV1`, whose activation
sequence and active-head digest are the same witness validated during the
read. Standard callers still receive only `sources` and `exhausted`.

#### First authorized implementation slice: SYNC01-A

`SYNC01-A` is deliberately smaller than the complete typed-contract gate in the
ordered list above. It may add:

- one strict internal protocol envelope for a persisted scope-sync cursor and
  one strict internal wake envelope, both keyed by canonical scope UUID, epoch
  UUID, and non-negative commit sequence;
- one pure host-neutral cursor policy that classifies duplicate, exact-next,
  gap, scope-mismatch, and epoch-mismatch inputs;
- one separate advancement decision that consumes an already validated
  `CommitFeedCommitV1`, treats an already-applied commit as a successful no-op,
  and returns a candidate next cursor only for exactly one sequence; and
- focused protocol and policy tests proving unknown-field rejection, canonical
  persisted encoding and decoding, no advancement from a wake, duplicate
  idempotence, gap refusal, authority-neutral epoch checks, old-epoch duplicate
  handling, confirmed epoch reset, scope isolation, and exact contiguous
  advancement.

Protocol owns only the persisted/wire shapes and intrinsic value invariants.
The backend sync domain owns cursor decisions. Persistence continues to own
feed decoding and corruption classification. No new generic utility or
universal database API is introduced.

`SYNC01-A` does not complete the first ordered contract gate and does not make
`R03-B` implementable by itself. The next preflight must freeze canonical query
identity, provisional/active generations, the complete dependency index,
active-head observation, cursor-mirror fencing, and reconnect retention before
the Durable Object or relation registration is wired.

### [x] SYNC01-A — Strict Scope Cursor And Wake Core

Status: completed on 2026-08-27. The private protocol now owns strict cursor and
wake Schemas with precision-safe canonical decimal-string sequence encoding.
The backend sync domain owns pure decisions for wake classification,
authenticated epoch resolution, duplicate commit replay, exact-next candidate
cursor construction, and fail-closed scope, feed-epoch, and gap rejection.

Completion evidence:

- canonical cursor and wake round trips are proven above JavaScript's safe-
  integer range through the maximum persisted signed-int64 value;
- a wake cannot advance a cursor, and a mismatched wake epoch cannot authorize
  reset without a separately supplied authoritative epoch;
- already-applied feed commits are successful no-ops, while exact-next returns
  only an immutable candidate cursor for a later host-owned atomic transaction;
- focused protocol and backend tests, full protocol tests, strict typechecks,
  core and diff lint, and both standing reviewer passes are green.

This checkpoint adds no Durable Object, storage table, feed loop, dependency
application, query generation, registration, rerun, delivery, reconnect, or
production routing. The next ordered work remains the target contract/owner
preflight above; `R03-B` is still blocked.

### [x] SYNC01-BP — Freeze The Private Relation Query Receipt Boundary

Status: docs-only preflight completed on 2026-08-27. This checkpoint authorizes
only one private receipt-producing variant of the existing RQ01 relation read
plus focused unit and paired database-system proof. It does not complete the
first ordered typed-contract gate and does not authorize a sync owner, query
registration, or `R03-B`.

The active query-snapshot owner is the only component authorized to construct
this receipt. After the existing read has validated one unchanged adjacency
version at or before its exact snapshot commit, it may return:

- the unchanged logical `{ sources, exhausted }` page;
- an owned copy of that exact snapshot's `SnapshotToken`; and
- one `LogicalApplicationRelationIncomingReadDependencyV1` whose edge
  definition, target row, and observed adjacency version came from that same
  physical read, and whose activation sequence and active-head digest came
  from the same authenticated relation selection already validated by the
  snapshot.

No receipt may be returned when the adjacency version changes during the read,
is newer than the snapshot, the active selection is stale, or any existing
authority validation fails. The existing Standard
`takeIncomingRelationSources` method and its public result remain unchanged.
Only the private selection-owned port may expose the receipt-producing method.

This slice deliberately leaves canonical query identity, provisional and
active generations, dependency-index storage, cursor-mirror fencing,
reset/resnapshot envelopes, reconnect leases, `DeploymentSyncDO`, registration,
reruns, delivery, public SDK work, and production routing undefined or
unimplemented. Those remain separately preflighted gates; the receipt is
evidence for a later owner, not registration authority by itself.

### [x] SYNC01-B — Private Relation Query Sync Receipt

Status: completed on 2026-08-27. The persistence snapshot owner now returns an
optional private receipt-bearing result from the same validated relation read.
The Standard selection port exposes that variant only to trusted internal
callers; the existing active-selection method and its logical page result are
unchanged.

Completion evidence:

- the receipt owns an exact `SnapshotToken` copy and one frozen typed incoming-
  relation dependency;
- the dependency's target row, edge-definition identity, and stable adjacency
  version come from the same bounded physical read, while its activation
  sequence and active-head digest come from that read's already authenticated
  relation selection;
- existing stale-selection and snapshot-change failures still return no page
  or receipt;
- focused Standard unit tests prove the private port boundary without changing
  the ordinary operation, and the PGlite system proof checks the complete
  receipt against actual active authority and relation state; and
- persistence, Standard invocation, and system-test strict typechecks pass.

No real-Postgres receipt acceptance was claimed in this checkpoint. The paired
acceptance assertion is present and remains to be run in the authenticated
PostgreSQL lane. This checkpoint still adds no registration, dependency index,
cursor mirror, `DeploymentSyncDO`, rerun, delivery, reconnect, or production
route. The first ordered typed-contract gate remains incomplete and `R03-B`
remains blocked.

### [x] SYNC01-DP — Freeze Canonical Query And Generation Semantics

Status: docs-only preflight completed on 2026-08-27. This checkpoint authorizes
only the strict internal canonical-query and generation contracts plus a pure
host-neutral provisional-to-active policy. It does not authorize a Durable
Object, SQLite schema, registration route, query execution, feed loop, active-
head reader, cursor mirror, subscriber registry, reconnect lease, delivery,
public SDK, compatibility write, or production caller switch.

One canonical query identity contains every currently admitted result-affecting
pin:

- canonical scope UUID and epoch UUID;
- the Application activation sequence and active-head SHA-256 witness;
- the selected source-package SHA-256, schema-version ID, and policy version;
- an explicit root-or-named component path and the function path;
- the SHA-256 of arguments encoded through Flarex Value Codec 1; and
- the SHA-256 of the authenticated identity/access-policy projection.

The digest fields are collision-resistant matching evidence, not authority.
Their producers remain responsible for canonical argument encoding,
authentication, policy construction, active selection, and source-package
verification. The scope-sync protocol validates their exact lowercase
SHA-256 spelling but does not recompute or authorize them.

A provisional generation owns that complete identity, one positive generation
sequence, and the exact scope cursor at which registration began. An active
generation additionally owns the query snapshot sequence, the cursor through
which dependencies were refreshed, a canonical sorted unique dependency-key
set, and the SHA-256 of the result encoded through Flarex Value Codec 1. The
dependency set is bounded by the existing
logical-read budgets. It is generation evidence for a later storage owner; it
does not create a persisted inverted index in this slice.

The pure activation policy must enforce all of the following:

1. the completion targets the exact provisional generation;
2. provisional identity and registration cursor have the same scope and epoch;
3. the query snapshot has that same scope and epoch and is not older than the
   registration cursor;
4. dependency refresh reaches at least the query snapshot and uses the same
   scope and epoch;
5. the receipt active-head witness matches the canonical identity;
6. a separately authenticated current active-head witness still matches;
7. an invalidation through or before the query snapshot is already visible in
   that result, while an invalidation after the snapshot returns a normal
   `rerunRequired` decision; and
8. an active-head change returns `resnapshotRequired`, while malformed,
   cross-scope, cross-epoch, stale-generation, or incomplete-refresh evidence
   is a typed failure and never an active candidate.

Activation returns only an immutable candidate for a later host-owned atomic
transaction. It cannot mutate a cursor, install dependencies, publish a result,
or acknowledge any feed or delivery work.

#### Authorized implementation slice: SYNC01-D

`SYNC01-D` may add the strict protocol Schemas, owned capture and decode
helpers, bounded dependency-set normalization, pure provisional construction,
pure activation classification, tagged policy errors, and focused protocol and
backend tests for the rules above. It must keep current cursor and dependency-
routing behavior unchanged and must not import or reproduce OCC, journal,
commit, persistence, Durable Object, runtime-host, or delivery authority.

### [x] SYNC01-D — Canonical Query And Generation Core

Status: completed on 2026-08-27. The private protocol now owns the complete
canonical identity, positive generation sequence, strict provisional/active
state, lowercase SHA-256 evidence fields, and sorted unique dependency set
bounded by the existing logical-read budgets. Strict decoding rejects unknown
fields, malformed pins, noncanonical dependency order, duplicate keys,
cross-authority generation state, and active state whose refresh cursor is
behind its snapshot.

The backend sync domain now owns pure provisional construction and activation
classification. Exact-generation completion matching,
registration/snapshot/refresh ordering, receipt-head agreement, separately
authenticated current-head comparison, and dirty-after-snapshot handling are
explicit. Host-owned atomic installation and stale-writer CAS remain unwired.
A matching candidate activates;
a later relevant commit returns `rerunRequired`; a changed active head returns
`resnapshotRequired`; and stale-generation or malformed authority evidence is
a typed failure. Dependency inputs are copied, sorted, deduplicated, frozen,
and detached before entering an active candidate.

Focused protocol and backend tests plus strict package typechecks prove the
contract and the pre-existing cursor/dependency-routing tests remain green.
This checkpoint still adds no Durable Object, SQLite or Postgres state,
persisted inverted index, registration route, query execution, feed loop,
active-head reader, cursor mirror, reconnect lease, rerun execution, delivery,
public SDK, compatibility write, or production caller switch. The first
ordered typed-contract gate remains incomplete and `R03-B` remains blocked.

### [x] SYNC01-EP — Freeze Authenticated Current-Head Observation

Status: docs-only preflight completed on 2026-08-27. This checkpoint authorizes
one private current-Application-head observation boundary needed by the
already-completed generation classifier. It does not authorize the
`DeploymentSyncDO`, SQLite state, generation installation, stale-writer CAS,
dependency-index persistence, commit catch-up, cursor mirror, reconnect lease,
delivery, route, public SDK, compatibility write, or caller switch.

The protocol observation is strict evidence containing the canonical scope and
epoch UUIDs, `flarexdb_v1`, the positive storage-generation fence, the scope
commit sequence observed in the same transaction, and the coherent current
Application activation sequence and active-head SHA-256. It is evidence only:
Schema decoding does not authenticate the scope, clock, or head.

Persistence may produce that evidence only after all of the following succeed
in one located READ COMMITTED transaction:

1. current control metadata and the located scope clock resolve through the
   existing trusted scope-authority ports;
2. the existing `ScopeExecution` read boundary acquires the scope-clock share
   lock and rechecks placement, `flarexdb_v1`, storage-generation fence, and
   epoch;
3. the existing active-head reader authenticates both the current head frame
   and the immutable activation row selected by that head; and
4. the canonical scope/epoch projections plus activation sequence and digest
   decode without weakening their protocol contracts.

The backend activation classifier must require the observation's scope and
epoch to equal the canonical query identity and its observed commit sequence to
be at least the query snapshot. The query receipt's storage generation and
generation fence must also exactly equal the authenticated current-head
observation before activation. It then compares the observed activation
sequence and digest with the identity as before. A mismatched identity returns
the existing normal `resnapshotRequired` decision; malformed, cross-authority,
or displaced-fence observation evidence is a typed failure.

This read does not make Postgres Application activation atomic with a later
Durable Object installation transaction. A head change after observation must
still be recovered by the separately preflighted active-head wake/sweep and
generation CAS. This slice must not fabricate an app-data commit, modify the
activation owner, or consult the Legacy subscription registry.

#### Authorized implementation slice: SYNC01-E

`SYNC01-E` may add the strict observation Schema and owned capture/decode
helpers, one persistence-owned Effect observation operation using the existing
trusted authority and `ScopeExecution` capabilities, the relation-query
receipt's existing storage-generation authority, the connected backend
classifier checks, and focused protocol/backend plus paired PGlite/PostgreSQL
proof. It must preserve upstream typed failures and keep current cursor,
generation, OCC, journal, commit, activation, and delivery behavior unchanged.

### [x] SYNC01-E — Authenticated Current-Head Observation

Status: implementation and paired database acceptance are complete. The
internal protocol owns one strict, owned current-head observation envelope.
Persistence produces it only through current trusted scope-authority
resolution, the existing located `ScopeExecution` read transaction and
scope-clock share lock, and the existing coherent active-head plus
immutable-activation-frame reader. The observation
therefore carries the current canonical scope/epoch projection,
`flarexdb_v1`, storage-generation fence, same-transaction scope commit
sequence, activation sequence, and lowercase active-head SHA-256 without
creating another activation authority.

The relation-query receipt now retains the storage generation and generation
fence under which the query ran. The backend activation classifier rejects an
observation from another scope or epoch, one taken before the query snapshot,
or one whose storage generation or fence differs from that receipt. A matching
observation retains the existing head comparison, while a changed activation
sequence or digest still returns `resnapshotRequired` rather than installing a
candidate.

Focused protocol and backend tests, strict protocol/backend/system-test
typechecks, and the paired relation-query PGlite and genuine-PostgreSQL system
proofs are green. The PostgreSQL proof runs with an ordinary PostgreSQL 18 role
and traverses the located READ COMMITTED transaction, scope-clock share lock,
coherent active-head and immutable-activation reads, matching current-head
observation, and typed missing-head failure without adding another authority.

This checkpoint adds no Durable Object, SQLite or Postgres write, generation
installation, dependency index, catch-up loop, head-change wake/sweep, cursor
mirror, reset/reconnect state, delivery, route, public SDK, compatibility
write, or production caller. A head change after the observation remains
recoverable only after those later gates exist. The first ordered typed-
contract/owner gate remains incomplete and `R03-B` remains blocked.

### [x] SYNC01-FP — Freeze The Durable Scope Cursor Owner

Status: docs-only preflight complete. This checkpoint authorizes the next
private implementation slice, `SYNC01-F`, but does not implement it. The slice
establishes one production-inert `DeploymentSyncDO` and its fenced SQLite
scope-cursor state. It deliberately does not persist canonical queries,
generations, dependencies, dirty frontiers, results, continuations, connection
targets, or reconnect leases.

The narrower split is required because the existing strict canonical-query
identity has no separately owned persisted query-key digest or canonical
storage codec. Deriving an ad hoc JSON hash in the Durable Object would create
a second identity contract. Query-key encoding, generation rows, and the
dependency-to-query index therefore require their own preflight after the
scope-cursor owner is real.

#### Actor And Routing Authority

- One actor owns one canonical `ScopeUuidV1`. Its deterministic name is
  `deployment-sync:${scopeUuid}`; this makes the older `{scopeId}` notation
  precise at the protocol boundary. The backend host owns the only name
  constructor and resolves it through the `DEPLOYMENT_SYNCS` namespace.
- The new class is the plain current `DeploymentSyncDO`, added as a new SQLite
  Durable Object class in the next Wrangler migration. It does not replace or
  rename `DeploymentDO`, and no current route or scheduled caller invokes the
  new binding in this slice.
- A Durable Object cannot infer the string originally supplied to named-ID
  routing. Every package-local store operation therefore carries the canonical
  scope UUID, and the first durable row binds that identity. Every later store
  operation checks the same identity before reading or mutating the cursor.
- Postgres remains authoritative for scope placement, epoch, storage
  generation and fence, retained floor, current commit, and the commit feed.
  The actor's cursor proves only that this actor examined every admitted feed
  commit through one sequence. It is never the maximum wake or commit sequence
  merely observed.
- The prototype Postgres subscription registry, deployment timestamp mirror,
  singleton `SchedulerDO`, and query-first `ConnectionDO` flow are neither
  read nor written. They remain regression evidence, not fallback authority.

#### Fenced SQLite State

The first store has one singleton scope-state row and no query tables. Its
logical columns are:

| Field | Contract |
| --- | --- |
| local schema revision | positive implementation-owned integer for exact store decoding |
| scope UUID | canonical lowercase `ScopeUuidV1` text and immutable actor identity |
| epoch UUID | canonical lowercase `ScopeEpochUuidV1` text |
| storage generation | literal `flarexdb_v1` |
| storage-generation fence | canonical positive decimal text decoded by `StorageGenerationFenceSchema` |
| applied-through commit sequence | canonical non-negative decimal text decoded by `CommitSeqSchema` |

The fence and commit sequence are stored as canonical decimal text, not as a
JavaScript-facing SQLite integer. Cloudflare documents that numeric SQLite
columns are returned through JavaScript numbers and can lose precision above
52 bits. Ordering and arithmetic remain typed `bigint` operations after decode;
the store uses exact text equality only for compare-and-swap predicates.

An absent row means `uninitialized`, not cursor zero. A malformed, duplicate,
or partially populated row is corruption and fails closed. Constructor schema
creation must never synthesize scope authority or silently repair an invalid
row. The store is per-Durable-Object-instance state, not a global Context
service, and no network or untrusted application work runs inside its
synchronous SQLite transaction.

#### Initialization And Cursor Transitions

`SYNC01-F` may implement only these state transitions:

1. A fresh, empty actor may initialize from one already-authenticated
   `ScopeSyncActiveHeadObservationV1`. Because this slice admits no query or
   connection registrations, it may set the initial applied-through cursor to
   that observation's current commit sequence without hiding invalidations.
   Strict decoding alone does not authenticate this evidence. `SYNC01-F`
   exposes no host or RPC caller; a later caller gate must obtain the
   observation through the trusted persistence operation completed in
   `SYNC01-E` and retain that trust boundary through store invocation.
2. Exact initialization replay is an immutable no-op. A differing scope,
   epoch, generation, fence, or commit sequence is a typed conflict and leaves
   state unchanged. Initialization is never an advance operation.
3. An already validated feed commit may enter the existing pure
   `advanceScopeSyncCursorV1` policy. Duplicate commits remain no-ops;
   scope/epoch mismatch and gaps fail before storage mutation.
4. An exact-next candidate updates the singleton row in one
   `transactionSync` compare-and-swap from the exact expected decimal sequence
   to the exact next sequence. A lost compare-and-swap is a typed state
   conflict. Any transaction failure leaves the prior cursor readable.
5. A wake remains a hint and cannot invoke the storage transition. Epoch
   adoption, reset, Postgres catch-up, and checkpoint-mirror publication are
   not authorized by this slice.

Fresh initialization is not the future state-loss recovery protocol. Once
query or reconnect registrations exist, an empty actor cannot distinguish a
brand-new scope from destroyed coordination state by itself. The later
registration/reset gate must provide durable external evidence and fail closed
to reset/resubscribe; it must not reuse this empty-owner bootstrap as silent
recovery.

#### Authorized Implementation Slice: SYNC01-F

`SYNC01-F` may add:

- the `DEPLOYMENT_SYNCS` environment binding, `DeploymentSyncDO` export, and
  new-SQLite-class Wrangler migration with no production caller;
- one backend-owned deterministic actor-name helper over `ScopeUuidV1`;
- one package-local SQLite store and precise tagged initialization,
  corruption, conflict, and storage errors;
- package-local initialize, read, and already-validated cursor-transition
  operations with no fetch, RPC, alarm, or scheduled surface; and
- focused pure/store tests plus a genuine Workerd SQLite proof that exercises
  the store through the test harness for actor isolation, exact replay, maximum
  signed-64-bit fence and sequence round trips, constructor re-entry,
  corruption refusal, duplicate/gap/scope/epoch behavior, atomic compare-and-
  swap, rollback, and absence of prototype-registry access.

It must keep the existing protocol cursor and pure policy as the only
advancement semantics. It adds no feed interval reader, fetch or RPC method,
wake route, alarm, external sweep, Postgres cursor mirror, canonical-query key,
query or dependency table, registration, activation, rerun, delivery,
reconnect, public SDK, relation API, Payload adapter, or production caller
switch.
`R03-B` remains blocked after this slice.

Platform evidence was rechecked against Cloudflare's current
[SQLite-backed Durable Object storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
[named Durable Object namespace API](https://developers.cloudflare.com/durable-objects/api/namespace/),
and [named-object metadata limitation](https://developers.cloudflare.com/durable-objects/examples/reference-do-name-using-init/).
Those sources support private strongly consistent SQLite state,
`transactionSync`, deterministic named routing, and the explicit stored
identity check required above; they do not supply Flarex scope authority.

### [x] SYNC01-F — Durable Scope Cursor Owner

Status: completed on 2026-08-27. The backend now exports one production-inert
`DeploymentSyncDO`, binds it through `DEPLOYMENT_SYNCS`, and adds it as its own
SQLite Durable Object migration. The backend-owned deterministic name is
`deployment-sync:${scopeUuid}`. The class exposes no fetch, RPC, alarm, or
scheduled operation, and no production route or caller resolves the binding.

The package-local store owns one strictly decoded singleton scope-state row.
It preserves the protocol-owned scope and epoch UUIDs, literal
`flarexdb_v1` generation, storage-generation fence, and applied-through commit
sequence. Fence and sequence values round-trip as canonical decimal text and
decode back to bounded branded `bigint` values. Empty state remains explicit
uninitialized state; schema construction inserts no authority and does not
repair malformed state.

Initialization accepts only an already-typed active-head observation, exact
replay is an immutable no-op, and any differing identity or cursor field is a
typed conflict. Read and advance operations check the caller-supplied canonical
scope against the stored identity. Advancement continues to use
`advanceScopeSyncCursorV1` as its only policy: duplicates do not write;
scope/epoch mismatches and gaps fail before mutation; exact-next commits use
one synchronous transaction and exact-text compare-and-swap. Corruption,
uninitialized access, initialization disagreement, lost compare-and-swap, and
SQLite failures remain distinct tagged failures.

This checkpoint adds no query-key codec, query/generation/dependency table,
feed interval reader, wake handler, catch-up loop, reset/reconnect state,
checkpoint mirror, rerun, delivery, public route, public SDK, relation API,
Payload adapter, or production caller. The portable engine gates must define
semantic query/generation/dependency state before a fresh roadmap-21 adapter
preflight may authorize those SQLite tables. `R03-B` remains blocked.

### [x] SYNC01-GP — Persisted Query State Preflight, Superseded As Implementation Authority

Status: completed docs-only preflight; superseded as implementation authority
and retained as Flarex/Cloudflare adapter design evidence.

The runtime-agnostic Query Sync Engine decision supersedes only this
checkpoint's authorization to implement `SYNC01-G` directly as backend-owned
sync semantics and package-local SQLite state. The canonical Flarex query
frame, active/provisional coexistence, dependency-index correctness, atomic
replacement, collision/corruption rules, and cursor-plus-invalidation
constraints below remain candidate requirements for a later Flarex/Cloudflare
state-adapter preflight.

`SYNC01-G` has not started and remains on hold. Portable semantic state,
orchestration, planner seams, and reference conformance are complete through
`QSYNC01-C4` and `QSYNC01-D4`. The accepted `QSYNC-FX01` adapter preflight is
the successor: A and B are complete, C1 completed the private generation-2
three-operation adapter, and C2 implemented the private generation-3
six-operation evaluation adapter and completed its exit proof on 2026-08-31.
This does not displace this roadmap's
concrete Flarex/Cloudflare ownership. Completed `SYNC01-A` through `SYNC01-F`
remain valid evidence. This
retained superseded checkpoint authorizes no new schema, migration, route,
caller, dual registry, fallback, compatibility write, or production behavior.

The storage split preserves two different facts. The active generation is the
last installed result and dependency set against which already admitted
commits must be routed. A provisional generation is one in-flight candidate.
Beginning a provisional generation must not delete or replace the active
generation or its dependency rows. They coexist until exact-generation
activation atomically replaces the active slot. This is still one single-flight
candidate per canonical query; the retained active slot is not a second rerun.

#### Canonical Persisted Query Key

This superseded proposal required a protocol-owned concrete versioned
canonical query-key frame rather than permitting the Durable Object to hash an
ordinary JavaScript object or implementation-dependent JSON. The proposed
FX01 record retains that requirement but assigns the new frame to a focused
scope-sync query-model V1 module. The frame contains the complete already
accepted `ScopeSyncCanonicalQueryIdentityV1` and no omitted, derived, host,
subscription, or connection fields. Its representation is:

1. one strict envelope whose format is
   `flarex.scope-sync-canonical-query-key`, version is `1`, and identity is the
   complete strict canonical-query identity;
2. all bigint-backed sequences represented as their canonical decimal text,
   with `componentPath: null` remaining distinct from every string;
3. canonical JSON encoded by the protocol's existing `encodeCanonicalJson`
   contract and then UTF-8 encoded; and
4. a maximum canonical frame size of 131,072 bytes before hashing or storage.

The protocol owns branded canonical bytes plus exact 32-byte SHA-256 evidence,
canonicalize/decode operations, and the byte recanonicalization check. The
backend adapter maps those raw digest bytes to the portable unpadded base64url
query key; it never hashes hexadecimal text. SHA-256 is supplied through a
narrow Effect service, matching existing protocol codecs; the Durable Object
does not import a particular crypto host. Decode verifies the strict envelope,
re-encodes it, requires byte-for-byte canonical equality, recomputes the
digest, and requires the expected key to match. Unexpected crypto defects
remain defects, while malformed, oversized, noncanonical, or digest-mismatched
evidence is a typed codec failure.

The SHA-256 key is a lookup and sharing key, not identity or authorization
authority. SQLite stores the complete canonical frame bytes beside it. Every
read revalidates the frame and digest. If the same digest is presented with
different canonical bytes, registration fails with a typed collision conflict;
it never aliases the identities, overwrites the existing query, or falls back
to another key. Scope, epoch, active head, package, schema, policy, function,
arguments, and identity/access-policy authority remain with their existing
producers and must still agree with the actor's fenced scope state.

#### Retained Cloudflare SQLite Query And Dependency Requirements

A later fresh adapter preflight may adapt the existing package-local
`DeploymentSync` store to the portable semantic state contract. It must not
create another engine, service, actor, cursor, transaction owner, query
registry, table set, or compatibility write. The previously proposed schema
kept one query row per canonical query key with these logical fields:

| Field group | Contract |
| --- | --- |
| identity | portable base64url SHA-256 query key plus owned canonical frame bytes |
| generation allocator | latest positive generation as canonical decimal text |
| active slot | nullable generation, snapshot sequence, refreshed-through sequence, result SHA-256, dependency count, and nullable dirty-through sequence |
| provisional slot | nullable generation and registration cursor sequence |

All sequence columns use canonical decimal text decoded by their existing
protocol Schemas. An absent active slot requires every active field to be null
and has no dependency rows. A present active slot requires every active field,
a non-negative dependency count within the protocol limit, and exactly that
many strictly decoded dependency rows. An absent provisional slot requires its
registration cursor to be null; a present provisional slot requires both
fields. The active and provisional generation may differ and, when both exist,
the provisional generation is newer. The stored identity's scope and epoch and
every stored cursor must equal the singleton actor state.

The dependency child table stores only the active generation. Each row owns
the query key, active generation, dependency kind, and two non-null canonical
text parts. `appRowPoint` stores its document ID in part one and the empty
sentinel in part two; `appTable` stores its table ID in part one and the empty
sentinel in part two; `appRelationIncoming` stores edge-definition ID and
target-row ID respectively. Strict shape checks and protocol decoding recover
the existing dependency union. The primary key is the complete query,
generation, kind, and parts tuple; the reverse index starts with kind and both
parts and ends with query key. Empty sentinels are storage representation only
and cannot be interpreted as admitted domain IDs.

The query row's dependency count makes an empty set distinguishable from a
truncated child directory. Reads are bounded by
`MAX_SCOPE_SYNC_DEPENDENCY_KEYS_V1`, decode every row once, require one active
generation, reconstruct strict sorted-unique protocol order, and reject extra,
missing, duplicate, wrong-generation, malformed, or orphan rows as corruption.
The store does not rely on an undocumented foreign-key PRAGMA for correctness:
it explicitly checks parent/child agreement and orphan absence. Replacement
deletes the prior active directory and inserts the new directory in the same
`transactionSync` callback as the active-slot compare-and-swap.

#### Retained Candidate State Transitions

A later adapter preflight may retain only semantically equivalent transitions,
derived from the portable reference model:

1. Canonicalize and register one query identity against the exact current actor
   scope, epoch, and cursor. A new identity begins generation `1`. Exact replay
   of an already provisional identity returns the same provisional generation;
   it does not allocate another candidate. Starting a new candidate for an
   identity with only an active slot increments the stored generation with
   bounded bigint arithmetic while retaining the active slot and dependencies.
2. Read one exact query or perform a bounded reverse dependency lookup. Both
   paths strictly decode stored state and return owned immutable values. A
   digest/frame disagreement is collision or corruption, never absence.
3. Install only an already classified active candidate for the exact current
   provisional generation. Inside one synchronous transaction, the actor
   scope/epoch still match, the stored cursor exactly equals the candidate's
   refreshed-through cursor, and the generation compare-and-swap succeeds.
   The transaction replaces the active fields and dependency directory, clears
   the provisional slot, and leaves the new dirty-through frontier null. A
   stale generation, later cursor, or changed authority leaves the old active
   slot and provisional state unchanged and returns a typed conflict requiring
   refresh, rerun, or resnapshot at the owning caller.
4. This superseded design originally proposed preserving cursor-only `advance`
   while no query rows existed. C1 deliberately rejected that compatibility
   path: generation 2 exposes only portable `applyAdmittedBatchAndAdvance`,
   which routes invalidations and advances the cursor in one synchronous
   transaction. No direct cursor-only runtime operation remains.

An activation with an unchanged result hash still replaces dependency and
freshness evidence; result equality cannot skip the transaction. The retained
candidate transitions publish no result, delete no query, acknowledge no
commit, change no connection lease, and schedule no rerun. Any dirty-through
storage must be justified by the later semantic adapter preflight rather than
created from this superseded authorization.

#### Withdrawn Direct-Backend Slice: SYNC01-G

The direct-backend implementation described by this old checkpoint is not
authorized. A fresh adapter preflight may reuse the versioned Flarex protocol
frame and require equivalent canonical JSON, bounded bytes, injected SHA-256,
strict codecs, collision/corruption behavior, and focused tests, but only as a
mapping into the accepted portable engine and semantic state contract.

That later adapter acceptance must prove deterministic identity-to-key vectors, null-versus-text
and field-sensitive separation, maximum-size refusal, noncanonical-byte and
digest mismatch refusal, injected collision refusal, signed-64-bit sequence
round trips, fresh and replayed provisional registration, active/provisional
coexistence, stale-generation and later-cursor rollback, atomic dependency
replacement, exact reverse lookup for all three dependency variants, empty-set
and bounded-maximum handling, child corruption detection, constructor re-entry,
orphan detection, transaction rollback, and complete direct-cursor-advance
refusal. C1 now proves that refusal regardless of whether query state exists.

Nothing in this retained section adds a query runner, feed interval reader,
wake handler, catch-up loop, dirty-marking operation, alarm, external sweep,
Postgres checkpoint mirror, registration or activation RPC, connection target,
lease, delivery, public SDK, relation API, Payload adapter,
prototype-registry access, or production caller. `R03-B` remains blocked on the
portable engine and complete Flarex adapter/reconnect proof.

Platform evidence was rechecked against Cloudflare's current
[SQLite-backed Durable Object storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
and [SQL storage limits](https://developers.cloudflare.com/durable-objects/platform/limits/).
Those sources support private strongly consistent SQLite storage, synchronous
SQL operations, indexes, and a two-megabyte BLOB/row ceiling. They do not make
foreign-key enforcement a Flarex portability contract, so explicit bounded
parent/child validation remains required above.

### [ ] QSYNC-FX01 -- Flarex Mapping And Complete SQLite State Adapter

Status: accepted split preflight. A is complete, private, and
production-inert. B is complete docs-only with a historical stop-before-schema
verdict. D1-D4 and the private planner seam are complete. C1 and its private
generation-2 three-operation SQLite adapter are complete in `b94abbb0`. C2's
private generation-3 six-operation evaluation vertical was implemented on
2026-08-30 and exited privately on 2026-08-31; C3 is implemented through phase
3 but has not exited, and FX01 remains incomplete.

The accepted umbrella record is
[`query-sync-engine/preflight/07-qsync-fx01-flarex-mappings-and-sqlite-state.md`](./query-sync-engine/preflight/07-qsync-fx01-flarex-mappings-and-sqlite-state.md).
It retains this roadmap as owner of concrete Flarex/Cloudflare schema and
lifecycle decisions while leaving portable semantics in `@flarex/query-sync`.

The completed first medium slice, `QSYNC-FX01-A`, owns versioned canonical
query/dependency/authority frames, one backend-owned Flarex model projector,
and canonical result/publication vectors. It added no SQLite schema, Durable
Object behavior, Postgres source read, evaluator, publisher, route, or caller.

The completed docs-only B verdict is
[`query-sync-engine/preflight/08-qsync-fx01-b-semantic-persistence-verdict.md`](./query-sync-engine/preflight/08-qsync-fx01-b-semantic-persistence-verdict.md).
It proves bounded logical plans for all nine operations and records why B
historically rejected schema work before the portable operation-plan design
existed. D1-D4 closed that core seam and C1 evolved the existing cursor database
in place without a second authority. The completed
[`QSYNC-FX01-C2` checkpoint](./query-sync-engine/preflight/11-qsync-fx01-c2-sqlite-evaluation-vertical.md)
records the completed six-operation generation-3 evaluation boundary. The later
C3 complete adapter must continue using one table set and cursor
authority, pass reference/oracle plus genuine Workerd restart/rollback/
corruption proof, and retain no direct cursor/query-generation compatibility
path. Nothing here reauthorizes the withdrawn direct-backend `SYNC01-G` design
or unblocks `R03-B`.
