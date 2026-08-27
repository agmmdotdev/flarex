# Cloudflare Sync And Freshness Coordination

## Status And Scope

Status: accepted v1 sync design with an implemented prototype pipeline.
`SYNC01-P`, the docs-only target authority and first implementation preflight,
and the bounded `SYNC01-A` cursor core are complete. The per-scope
`DeploymentSyncDO` replacement is not implemented, and cache Durable Objects
remain deferred optimizations.

Reconnect-retention DDL is not part of FlarexDB foundation S07. Existing
connection leases remain prototype mechanics, not the accepted replacement
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
- disposition and removal of the prototype Postgres subscription/connection/
  delivery registry as target coordination becomes complete; and
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
5. Current code and decisive tests prove implemented prototype behavior:
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
mechanics, not the final scope-local sync protocol. No `DeploymentSyncDO`,
`VersionDO`, `DocCacheDO`, or `QueryCacheDO` implementation exists.

The private host-neutral sync core now owns strict cursor and wake contracts,
scope-local dependency keys, logical-read projection, and validated-commit
invalidation projection. It also owns the complete canonical query identity,
strict provisional and active generation contracts, canonical bounded
dependency-set normalization, and pure activation classification. It does not
store an inverted index, run a query, publish a result, or advance a cursor
while collecting routing or activation evidence.

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
- Compatibility live-query state does not use the new private canonical-query
  and generation contracts and therefore still lacks target authority despite
  the host-neutral core now pinning every accepted identity-sensitive input.
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
  -> durable query-state validation, or explicit reset if state is unavailable
  -> dirty reruns
  -> delivery and ordered client publication
```

Remove the Postgres prototype registry after DeploymentSyncDO passes
hibernation, restart, reconnect, state-loss reset, lease cleanup, and lost-wake
proof with all callers switched. No live dual-registry migration is required.
Only after the authoritative loop is correct and measured may cache layers
enter the design.

## Next Correctness Gates

The sync replacement does not begin before roadmap 20's Wave 2 `C07` gate
proves one atomic replacement commit with the canonical commit/change feed,
idempotency outcome, and transactional outbox. Prototype fixes should be limited
to what is needed to preserve regression evidence or unblock caller migration;
they must not create a second forward sync architecture.

After `C07`, the ordered v1 gates are:

1. Freeze typed sync contracts for `SnapshotToken`, canonical query identity,
   dependency keys, provisional/active generations, cursor state, delivery
   identity, reset/resnapshot, and fenced Postgres checkpoint mirrors. Freeze
   reconnect lease identity, duration, history budget, renewal, expiry, and
   reset behavior in the same design gate.
2. Add one deterministic `DeploymentSyncDO` per scope with durable SQLite
   cursor, canonical-query, dependency-index, dirty-through, generation,
   result-hash, and continuation state.
3. Implement duplicate/reverse/gap processing and ordered Postgres catch-up;
   never advance across a missing commit.
4. Fix initial activation through provisional DeploymentSyncDO registration and
   refresh against already processed commits without dual-registering the
   prototype Postgres registry.
5. Add a durable external lagging-scope sweep whose Postgres checkpoint mirror
   may lag but can never lead the DO cursor.
6. Add generation-checked, single-flight authoritative reruns and identity/
   package/schema/policy-safe canonical sharing.
7. Integrate changed/failed result delivery and ordered ConnectionDO
   transitions without making DeliveryDO the trigger-recovery owner.
8. Immediately before O11 consumes reconnect floors or replacement sync admits
   reconnectable sessions, add the separately preflighted reconnect-retention
   DDL and focused PGlite/real-Postgres proof.
9. Prove real-Postgres mutation-to-WebSocket correctness for activation races,
   lost wakes, gaps, concurrent reruns, actor eviction, epoch rollover,
   reconnect floors, and broad dependency fallbacks.
10. Measure per-scope state, rerun load, and backpressure before deciding whether
   coordination buckets are necessary.
11. Remove the prototype SchedulerDO and Postgres registry after target-only
    recovery parity and internal-caller migration are proven.

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
