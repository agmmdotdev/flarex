# Cloudflare Sync And Freshness Coordination

## Status And Scope

Status: accepted v1 sync design with an implemented compatibility pipeline;
the per-scope `DeploymentSyncDO` replacement is not implemented, and cache
Durable Objects remain deferred optimizations.

Reconnect-retention DDL is not part of FlarexDB foundation S07. Existing
connection leases remain compatibility mechanics, not the accepted replacement
retention authority. This roadmap must resolve reconnect identity, duration,
history budget, renewal, expiry, and reset semantics before requesting a
separate just-in-time schema gate.

This roadmap owns the durable direction for:

- transporting authoritative Postgres commit/change information into
  Cloudflare coordination;
- `DeploymentSyncDO`, `ConnectionDO`, and delivery-worker responsibilities;
- canonical live-query identity, dependency indexing, rerun coalescing, and
  result-hash suppression;
- initial subscription activation, contiguous cursor processing, gap catch-up,
  lost-wake recovery, reconnect, and ordered publication;
- the compatibility Postgres subscription/connection/delivery registry during
  migration; and
- the conditions under which `VersionDO`, `DocCacheDO`, or `QueryCacheDO` may
  eventually be introduced.

This roadmap does not own:

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

1. [`../design-notes/flarex-db-accepted-design.md`](../design-notes/flarex-db-accepted-design.md)
   owns Postgres authority, `SnapshotToken`, scope epoch/commit semantics,
   retention, and the accepted v1 sync topology.
2. [`../design-notes/postgres-authoritative-sync.md`](../design-notes/postgres-authoritative-sync.md)
   owns the focused activation, cursor, recovery, canonical-query, dependency,
   and deferred-cache design.
3. [`20-postgres-executor.md`](./20-postgres-executor.md) owns the executor,
   storage-generation, commit-feed, and transactional-outbox prerequisites.
4. [`35-commit-compiler-and-session-intent.md`](./35-commit-compiler-and-session-intent.md)
   owns mutation/session reads and the rule that unsupported staged overlays
   fail closed.
5. Current code and decisive tests prove the compatibility behavior:
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
   - [`packages/flarex-protocol/src/live-query.ts`](../packages/flarex-protocol/src/live-query.ts)

[`05-sync-and-subscriptions.md`](./05-sync-and-subscriptions.md) and
[`05-sync-protocol-implementation.md`](./05-sync-protocol-implementation.md)
remain compatibility implementation inventories until they are compacted.
Their historical partition-local or singleton-scheduler design is not the
accepted target when it conflicts with this roadmap or the design notes above.

## Current Architecture

### Implemented compatibility pipeline

The working Postgres-executor compatibility lane is approximately:

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
when the Postgres executor binding is absent. That fallback is prototype
compatibility behavior, not the forward authority.

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

These are useful migration assets, but the timestamp/deployment mirror and
singleton scheduler are not the accepted scope-local commit-feed design.

### Accepted v1 topology

The target correctness path is deliberately smaller than the historical cache
proposal:

```text
authoritative Postgres per scope
  epoch + scope-lifetime monotonic commit_seq
  canonical commit/change feed
  transactional wake/outbox evidence
  durable compatibility subscription registry
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
3. During migration, the same provisional generation and its
   package/policy/identity inputs are durably recorded in Postgres.
4. `DeploymentSyncDO` installs the dependencies and refreshes them against all
   commits through its current cursor.
5. It activates and publishes only if no relevant commit invalidated that
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

### Retain the Postgres registry during migration

The implemented subscription registry and connection leases are the current
durable recovery baseline. `DeploymentSyncDO` may rebuild from them while its
SQLite ownership is proven. Removing the registry before eviction, reconnect,
lease, and lost-wake parity would create two incomplete authorities rather than
one safe migration.

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

### Postgres compatibility state

The current schema and persistence layer implement:

- commit and transactional outbox rows for the legacy timestamp-based engine;
- idempotent outbox-to-freshness projection;
- document/table freshness mirrors and durable index-history checks;
- active live-query definitions with read sets, result hashes, arguments, and
  execution identity;
- connection leases, expiry scans, and idempotent removal; and
- delivery rows with claims, lease expiry, attempt/failure metadata,
  acknowledgement, and dead-letter state.

### Executor compatibility behavior

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

### Cloudflare compatibility behavior

The backend implements:

- Convex-style query-set state and WebSocket transitions in `ConnectionDO`;
- executor-backed subscription registration and delivery consumption;
- bounded DeliveryDO drains with alarm continuation and skip/failure metrics;
- SchedulerDO continuations for reruns, delivery reconciliation, dead-letter,
  and expired-connection cleanup; and
- hosted/generated integration coverage for initial query execution, mutations,
  indexed/paginated queries, multi-connection fanout, changed results, failures,
  and reconnect candidates.

These capabilities prove migration components, not the final scope-local sync
protocol. No `DeploymentSyncDO`, `VersionDO`, `DocCacheDO`, or `QueryCacheDO`
implementation exists.

## Known Gaps And Limitations

- Current live-query commits and mirrors use `deployment_id` plus wall-clock
  `ts`, not `scope_id`, epoch, and contiguous `commit_seq`.
- `ConnectionDO` executes an initial query before durable registration, leaving
  a missed-commit activation race.
- All deployments currently route scheduled reruns through one compatibility
  SchedulerDO name with singleton pending/in-flight rerun state.
- The mutation finish hook notifies sync best-effort; current recovery does not
  close the pre-rerun lost-trigger gap.
- No durable per-scope sync cursor or ordered Postgres gap-catch-up loop exists.
- Current stale detection scans active Postgres subscriptions rather than a
  typed dependency-to-query inverted index.
- Current canonical query state does not fully pin active package hash, schema
  version, policy version, registration generation, and every identity-sensitive
  input required by the accepted key.
- Concurrent reruns lack the accepted compare-and-swap generation protocol.
- Current connection leases are compatibility leases, not the accepted
  reconnect-retention token tied to scope epoch, storage generation, fence, and
  minimum required commit sequence.
- Typed ordered range/edge dependency contracts and shared OCC/sync interval
  encoding remain incomplete.
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

The target live-query lifecycle is:

```text
provisional canonical registration
  -> authoritative query at SnapshotToken
  -> dependency/result registration
  -> refresh through contiguous DeploymentSyncDO cursor
  -> activate generation
  -> process commit feed in order
  -> mark affected canonical queries dirty
  -> single-flight authoritative rerun at snapshot >= dirtyThrough
  -> generation CAS
  -> refresh unchanged result or create durable changed-result delivery
  -> ordered ConnectionDO transition
```

Recovery is equally important:

```text
lost wake / DO eviction / Worker crash
  -> durable sweep finds Postgres latest commit ahead of mirrored cursor
  -> deterministic DeploymentSyncDO wakes
  -> contiguous Postgres interval catch-up
  -> registry/query-state rebuild or validation
  -> dirty reruns
  -> delivery and ordered client publication
```

The Postgres registry remains until DeploymentSyncDO passes eviction,
hibernation, reconnect, lease cleanup, and lost-wake parity. Only after the
authoritative loop is correct and measured may cache layers enter the design.

## Next Correctness Gates

The sync replacement does not begin before roadmap 20's Wave 2 `C07` gate
proves one atomic replacement commit with the canonical commit/change feed,
idempotency outcome, and transactional outbox. Compatibility bug fixes may
continue, but they must not create a second forward sync architecture.

After `C07`, the ordered v1 gates are:

1. Freeze typed sync contracts for `SnapshotToken`, canonical query identity,
   dependency keys, provisional/active generations, cursor state, delivery
   identity, reset/resnapshot, and fenced Postgres checkpoint mirrors. Freeze
   reconnect lease identity, duration, history budget, renewal, expiry, and
   reset behavior in the same design gate.
2. Immediately before O11 consumes reconnect floors or replacement sync admits
   reconnectable sessions, add the separately preflighted reconnect-retention
   DDL and focused PGlite/real-Postgres proof.
3. Fix initial activation through provisional registration and refresh against
   already processed commits while retaining the Postgres registry.
4. Add one deterministic `DeploymentSyncDO` per scope with durable SQLite
   cursor, canonical-query, dependency-index, dirty-through, generation,
   result-hash, and continuation state.
5. Implement duplicate/reverse/gap processing and ordered Postgres catch-up;
   never advance across a missing commit.
6. Add a durable external lagging-scope sweep whose Postgres checkpoint mirror
   may lag but can never lead the DO cursor.
7. Add generation-checked, single-flight authoritative reruns and identity/
   package/schema/policy-safe canonical sharing.
8. Integrate changed/failed result delivery and ordered ConnectionDO
   transitions without making DeliveryDO the trigger-recovery owner.
9. Prove real-Postgres mutation-to-WebSocket correctness for activation races,
   lost wakes, gaps, concurrent reruns, actor eviction, epoch rollover,
   reconnect floors, and broad dependency fallbacks.
10. Measure per-scope state, rerun load, and backpressure before deciding whether
   coordination buckets are necessary.
11. Remove the compatibility SchedulerDO and eventually the Postgres registry
    only after the replacement demonstrates recovery parity.

`VersionDO`, `DocCacheDO`, and `QueryCacheDO` are not next gates. They require a
separate measured need and their own gap-free correctness proofs after v1 sync
is operational.
