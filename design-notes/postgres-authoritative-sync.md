# Postgres-Authoritative Sync And Cloudflare Coordination

Status: accepted v1 sync design; caches remain deferred optimizations

Last reviewed: 2026-07-10

This note defines the sync design that follows from
`flarex-db-accepted-design.md`. It replaces the earlier assumption that
`VersionDO`, `DocCacheDO`, and `QueryCacheDO` must be built before Flarex can
provide correct live queries.

## Verdict

Postgres-authoritative sync is the right direction. The earlier cache topology
was too complex for the correctness proof and did not define gap-free ordering,
initial subscription activation, identity-safe cache keys, or lost-wake
recovery.

V1 is:

```text
Postgres commit feed per scope
  -> deterministic per-scope DeploymentSyncDO
  -> ConnectionDO query sets and WebSocket delivery
```

Direct wakes reduce latency. A durable sweep and Postgres catch-up provide
recovery. Live-query reruns use authoritative Postgres reads. Cache DOs are
optional later layers.

## Authority Model

Postgres owns:

- authoritative rows and revision history;
- the scope epoch and commit sequence;
- canonical commit/change atoms;
- canonical commit/change recovery feed plus transactional commit-wake
  evidence; and
- a conservative fenced DeploymentSyncDO cursor mirror for the external sweep.

Cloudflare owns:

- sandboxed function execution;
- WebSocket sessions;
- active query coordination and dependency indexes;
- ordered delivery state;
- disposable cached results when later enabled.

Cloudflare does not own committed data or the only copy of recovery state.

## Tokens And Freshness

Use the same scope-local token as the transaction engine:

```ts
type SnapshotToken = {
  scopeId: ScopeId;
  epoch: ScopeEpoch;
  commitSeq: CommitSeq;
};
```

Commit/outbox sequences are scope-monotonic and never reset or reused. Epoch
rollover fences old sessions/subscriptions and requires a full client/query
resnapshot, but it does not copy or reset authoritative data.

There are two different correctness rules.

### Mutation/session reads

Mutation reads require the exact begin snapshot plus the supported staged-write
overlay. A value from a newer commit is not valid merely because its sequence
is greater:

```text
mutation begins at commit 100
row changes at commit 103
cache holds commit 105

105 >= 100 does not make that value valid at snapshot 100
```

V1 uses Postgres history for mutation/session reads. A future cache needs an
MVCC version valid at the exact token and absence/range proofs.

### Live-query publication

A live-query result may be computed at a snapshot at or after
`requiredFreshThrough` when:

- the whole result is from one consistent snapshot;
- the executor returns its actual snapshot token and dependency set;
- the sync cursor reached every commit in between without gaps;
- package, schema, policy, and identity inputs still match;
- publication is generation-checked and ordered.

Hyperdrive response caching is not a freshness proof. Correct live-query reruns
use a no-cache authoritative path until an explicit versioned cache protocol is
proven.

## V1 Components

### Postgres commit feed

Each scope has one current epoch and a monotonically increasing scope-lifetime
`commit_seq`. The final
data transaction writes:

```text
authoritative data/history
derived index/edge/unique sidecars
commit row
typed change atoms / dependency summary
transactional outbox rows
```

The commit feed, not generic side-effect delivery order, is the canonical sync
ordering source. Outbox workers can transport wake hints and other effects, but
DeploymentSyncDO catches up by `(scope_id, epoch, commit_seq)`.

### DeploymentSyncDO per scope

Use one deterministic name initially:

```text
deployment-sync:{scopeId}
```

Durable Object SQLite stores:

```text
epoch
appliedThroughCommitSeq
dirtyThroughCommitSeq
canonical query definitions
dependency -> canonical query index
query generation / runningAt / result hash / requiredFreshThrough
active ConnectionDO targets or recoverable registration handles
bounded work continuation state
```

Do not keep correctness state only in JavaScript memory. Do not use one global
SchedulerDO singleton for unrelated scopes.

The first per-scope DO is a correctness boundary and may be a throughput hot
spot. Add coordination buckets only after measurement and an explicit rule for
query ownership and cursor handoff.

### ConnectionDO

ConnectionDO owns:

- the WebSocket/session attachment;
- client query identifiers and transition ordering;
- scope, epoch, active package, schema/policy, and identity metadata;
- mapping client subscriptions to canonical DeploymentSyncDO queries;
- reconnect/resubscribe behavior.

ConnectionDO must not become the only copy of a subscription needed for
post-eviction recovery.

Each reconnectable session has a bounded Postgres reconnect lease containing
scope, epoch, minimum required commit sequence, generation, and expiry. Commit
history retention respects the minimum live lease. Epoch mismatch or a cursor
below the retained floor produces an explicit reset/resnapshot response.

### One target query-state owner

The current implementation relies on Postgres live-query subscription and
connection-lease rows, but that unshipped prototype does not require a live
dual-registry migration. The target authority split is:

```text
Postgres
  authoritative commit feed + conservative fenced cursor mirror

DeploymentSyncDO SQLite
  canonical query/dependency/generation/rerun coordination owner
```

Do not run two independent query-state authorities. Hibernation and restart
retain DO storage. If required query state is explicitly lost, fail closed into
reset/resubscribe and rebuild from authoritative Postgres query execution rather
than treating the prototype registry as a second owner. Remove that registry
after target-only hibernation, reconnect, state-loss reset, lease cleanup, and
lost-wake tests pass.

## Canonical Query Identity

The key must include every input that can change a result:

```text
scope
scope epoch
active package hash
schema version
policy version
function/component path
canonical encoded arguments
identity/access-policy fingerprint
```

Do not share results across identities unless authoritative analysis proves the
query is identity-independent. Package activation invalidates or namespaces old
query entries even when the path and arguments are unchanged.

Canonical identical queries rerun once and fan out to many client
subscriptions. Overlapping but non-identical queries share dependency keys,
not result identity.

## Initial Subscription Activation

Executing first and registering afterward can miss a commit. Use two-phase
activation:

1. ConnectionDO asks DeploymentSyncDO to create a provisional canonical query
   registration with the current contiguous cursor.
2. The trusted query executor runs at a known Postgres snapshot and returns
   result, result hash, dependency set, and snapshot token.
3. DeploymentSyncDO installs/refines the dependency set for that provisional
   generation.
4. It refreshes the token against every commit through the current contiguous
   cursor.
5. If no relevant change invalidated the result, it marks the DO generation
   active and publishes it. Otherwise it reruns before publication.

Removal is idempotent in the same DeploymentSyncDO coordination authority. The
Postgres cursor mirror remains conservative operational evidence, not a query
registry or independent activation authority.

This follows the Convex idea that a query token is refreshed against already
processed writes before the subscription is accepted.

## Commit Processing And Gap Recovery

`appliedThroughCommitSeq` means every commit through that number has been
examined. It is not the maximum sequence observed.

An epoch mismatch stops incremental processing. DeploymentSyncDO fences the old
query generations and adopts the new epoch only through a full authoritative
resnapshot. It then records the current scope-monotonic commit sequence; it does
not reset the cursor to zero.

```text
receive N == appliedThrough + 1
  -> apply change atoms
  -> advance cursor

receive N <= appliedThrough
  -> duplicate; ignore idempotently

receive N > appliedThrough + 1
  -> do not advance
  -> load the missing Postgres commit interval
  -> apply commits in order
```

Changed dependencies mark canonical queries dirty. Per query:

```text
dirtyThrough = max(dirtyThrough, changedCommitSeq)
single-flight one rerun generation
execute authoritatively at snapshot >= dirtyThrough
compare-and-swap expected generation
publish only if result hash changed
advance freshness even when result is unchanged
```

If another commit arrives while a rerun is in flight, the query remains dirty
and runs again or refreshes its dependency token before publication.

## Wake And Recovery Ownership

The final commit or outbox dispatcher may directly call
`DeploymentSyncDO.wake(scope, epoch, commitSeq)` as a fast path. Failure of that
call must not lose invalidation.

At least one durable external owner periodically compares the latest Postgres
scope commit with the sync cursor and wakes lagging scopes. This may be a queue
consumer, cron sweep, or executor dispatcher, but it must run even when no
delivery row has been created yet.

DeploymentSyncDO SQLite is the actor's cursor authority. After committing its
local cursor, the DO may advance a fenced Postgres checkpoint mirror. That
mirror may lag but must never lead. The external sweep reads the Postgres
mirror; lag creates a duplicate idempotent wake, not missed work.

Recovery flow:

```text
lost direct wake / DO eviction / Worker crash
  -> durable sweep observes scope cursor behind latest commit
  -> wakes deterministic DeploymentSyncDO
  -> DO catches up the contiguous Postgres interval
  -> rebuilds or validates query registrations
  -> reruns dirty canonical queries
  -> ConnectionDO delivers ordered transitions
```

Delivery rows and claim leases remain useful after changed results exist, but a
delivery reconciler alone cannot recover a trigger lost before reruns created
those rows.

## Dependency Model

V1 dependency types:

- exact app row;
- declared app index/range with typed ordered bounds;
- relation/edge occurrence or relation range;
- conservative table/index version fence for adapter reads that do not yet
  have precise interval conflict data.

The safe fallback is broader invalidation and rerun, not stale publication.
Opaque strings are insufficient for precise range overlap. Bounds must carry
codec version, inclusivity, and ordered key bytes.

Maintain a dependency-to-query inverted index in DeploymentSyncDO SQLite. The
current `all active subscriptions x all dependencies` scan is prototype
behavior, not the target scaling model.

## Cache Layers Are Deferred

### VersionDO

A maximum observed sequence is not an applied-through proof. A sharded
VersionDO would need a transactionally generated contiguous bucket stream or a
catch-up rule before it could claim freshness. Defer it.

### DocCacheDO

Hot row images can later accelerate exact-snapshot reads only when each entry
has version validity intervals and tombstone/absence proofs. Otherwise use it
for non-authoritative one-shot reads only.

### QueryCacheDO

DeploymentSyncDO can initially own canonical result hashes and single-flight
reruns. Split query results into QueryCacheDO only after memory/load measurements
justify another actor and generation handoff is specified.

All cache state is disposable. An uncertain cache entry is marked dirty and
rebuilt from Postgres.

## Implemented P0 Problems To Fix Before Claiming V1 Safety

The current code remains an unshipped prototype baseline and has known P0 gaps:

- `packages/flarex-backend/src/connectionDO.ts` executes a query before its
  durable registration, exposing a missed-commit activation race.
- `packages/flarex-backend/src/schedulerRoutes.ts` routes unrelated deployments
  to one scheduler name, while `schedulerDO.ts` has singleton pending/in-flight
  rerun state.
- `packages/executor/src/sessions.ts` performs post-commit notification
  best-effort, while current scheduled recovery does not own the pre-rerun
  trigger gap.
- current query cache proposals omit active package and identity/access-policy
  fingerprints.
- concurrent reruns need compare-and-swap generations so Postgres/DO/delivery
  state cannot retain different winners.

These are implementation findings, not evidence that the Postgres-authoritative
direction is wrong.

## Phased Plan

Phase 1, correctness:

1. Adopt `SnapshotToken` and scope-local contiguous commit feed.
2. Fix initial subscription activation.
3. Route deterministic per-scope DeploymentSyncDO instances.
4. Persist cursor, query definitions, dependency index, and generations in DO
   SQLite.
5. Add durable lagging-scope sweep and ordered Postgres catch-up.
6. Prove target-only hibernation, reconnect, state-loss reset, and lost-wake
   recovery without dual-registering the prototype Postgres registry.
7. Execute live-query reruns through authoritative no-cache Postgres reads.

Phase 2, scaling:

1. Canonical query deduplication and inverted dependency indexes.
2. Bounded rerun continuations, backpressure, and per-scope load tests.
3. Remove the prototype Postgres registry after recovery parity and caller
   migration.

Phase 3, measured caches:

1. MVCC-aware DocCacheDO for proven hot point reads.
2. QueryCacheDO split for large shared results.
3. VersionDO only with a gap-free bucket-feed protocol.

## Correctness Tests

- a commit lands during initial query execution/registration;
- duplicate, reverse-ordered, and gapped commit notifications;
- lost direct wake before any changed-result delivery exists;
- simultaneous triggers for two scopes;
- concurrent reruns of one canonical query;
- commit arrives while a rerun is running;
- package activation and identity/policy change;
- mutation at snapshot 100 while a cache has a row from 103;
- DeploymentSyncDO and ConnectionDO eviction/hibernation;
- reconnect with cursor or epoch mismatch;
- broad dependency fallback for inserts, deletes, key moves, and pagination;
- real Postgres mutation-to-WebSocket recovery, not PGlite alone.

## Convex Comparison

Relevant Convex sources:

- `../../../crates/database/src/subscription.rs`
  - refreshes subscription tokens against processed writes.
- `../../../crates/sync/src/worker.rs`
  - query execution, subscription activation, rerun, and ordered updates.
- `../../../crates/sync/src/state.rs`
  - active query state and result-hash suppression.
- `../../../crates/database/src/committer.rs`
  - commit/write metadata feeds invalidation.

Convex keeps these pieces close in one backend. Flarex bridges Postgres and
Cloudflare, so it needs explicit cursors, deterministic actor routing, durable
lag detection, and idempotent catch-up. The developer-facing query model can
remain Convex-like; the internal recovery protocol cannot be implicit.

## Remaining Questions

- How much durable query state fits safely in one DeploymentSyncDO before
  coordination buckets are necessary?
- Which precise typed interval encoding should be shared by OCC and sync?
- What is the operational owner and cadence for lagging-scope sweeps?
- What reconnect-lease duration and history budget are operationally feasible?
  The semantic floor is already the minimum live snapshot/reconnect lease plus
  safety margin; older cursors reset/resnapshot.
- Which queries can be proven identity-independent and safely shared?

These are implementation choices to prove after the v1 correctness topology,
not reasons to add cache actors early.
