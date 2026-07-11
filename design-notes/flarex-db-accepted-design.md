# FlarexDB Accepted Design And Review

Status: accepted architecture correction; implementation is still incomplete

Last reviewed: 2026-07-11

This document is the decision record for the proposed unified FlarexDB schema,
commit compiler, sync engine, Payload adapter, and Medusa integration. It keeps
the useful motivation from the longer research notes while correcting the
parts that were unsafe or internally contradictory.

When another design note conflicts with this document, this document controls.
The domain roadmaps remain the chronological implementation record.

## Verdict

The storage backbone is good, but the original unified-runtime proposal was
too broad for v1.

Accept:

```text
Postgres is the only authoritative committed data store.
App/CMS rows use typed JSON plus derived indexes, edges, and unique keys.
Medusa commerce uses Medusa-owned relational tables and transaction semantics.
Every authoritative write advances one scope-local commit stream and writes
recovery metadata atomically.
Cloudflare owns sandboxed execution, WebSockets, coordination, and disposable
cache state.
```

Reject as a v1 promise:

```text
one universal SessionDO transaction engine for Flarex, Payload, and Medusa
automatic atomic ctx.db + ctx.commerce transactions
cache freshness defined as observedCommitSeq >= mutation beginTs
VersionDO + DocCacheDO + QueryCacheDO as prerequisites for correct live sync
caller-authored locks, physical uniqueness rows, freshness rows, or system
outbox rows in a commit intent
```

The correct unification point is the trusted Postgres authority, scope clock,
commit feed, outbox, and adapter contracts. It is not one universal physical
table shape or one universal user-visible transaction.

## Hosted Runtime Topology

The hosted production target is a dedicated private `flarex-executor`
Cloudflare Worker:

```text
public backend Worker
  -> artifact-runtime Worker
  -> generated Dynamic Worker shell around untrusted user modules
  -> private FLAREX_EXECUTOR service binding
  -> trusted executor Worker
  -> cache-disabled Hyperdrive
  -> authoritative Postgres
```

This removes the former Cloudflare-to-Node/Nitro/Vercel deployment bridge. It
does not remove the sandbox syscall boundary. The generated Dynamic Worker
shell may call the executor binding, but developer modules receive only the
restricted `ctx` capabilities. They never receive Hyperdrive, `pg`, Drizzle,
SQL, persistence, physical routing, or transaction handles.

Keep the stable `/invoke/start`, `/invoke/syscall`, `/invoke/finish`, and
`/invoke/abort` Fetch protocol for the first Worker host. A service-binding
Fetch is an internal capability call, not a public executor URL. Workers RPC
may replace that transport later only as an independent compatibility change;
it is not a FlarexDB correctness prerequisite.

The trusted executor core and commit compiler remain framework-neutral and are
called in-process by the executor Worker adapter. The Worker persistence
adapter uses a request-scoped `pg.Client` through a cache-disabled Hyperdrive
binding and closes it in `finally`. It does not retain the current Node-style
`pg.Pool`, run filesystem-backed migrations, or perform unbounded migration,
backfill, or maintenance work inside request handling. Migration generation
and application remain deployment/control-plane or Node CLI responsibilities.
PGlite remains the fast local/test lane. Nitro/Vercel remains an optional
compatibility host until explicitly retired after hosted parity.

Cloudflare's current connection-lifecycle guidance says invocation-scoped
Workers-to-Hyperdrive clients are cleaned up automatically. Flarex still owns
an explicit `client.end()` attempt in `finally` for deterministic portability
through the direct-Postgres local/test lane. That rule is not a claim that
Hyperdrive requires driver cleanup, and a cleanup failure must not replace the
primary request failure. No client or driver pool may live in module scope.

The host decision is accepted, but production activation remains gated on a
small proof: Worker-safe import graph and Wrangler bundle, request cleanup,
cache-disabled Hyperdrive, and real-Postgres transaction/OCC behavior. S02-B
and S02-C are host-neutral persistence turns. This proof must pass before
S02-D wires production generation resolution into the hosted executor.

Cloudflare references:

- [Postgres drivers and Hyperdrive](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/)
  for `pg`, Drizzle, `nodejs_compat`, and request-scoped clients;
- [Hyperdrive behavior](https://developers.cloudflare.com/hyperdrive/concepts/how-hyperdrive-works/)
  for transaction pooling and the lack of write-driven query-cache
  invalidation;
- [Workers service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
  for private Worker-to-Worker Fetch and RPC boundaries.

## Document And Implementation Status

| Layer | Status | Meaning |
| --- | --- | --- |
| Existing `documents`, `indexes`, invoke sessions, Postgres live-query registry, and delivery outbox | Implemented baseline | Preserve while the replacement is built. Do not silently describe it as the final FlarexDB schema. |
| Typed app row JSON with revision/current, declared index, edge, and unique sidecars | Accepted target | Prove first behind a storage-generation flag. |
| SessionDO journal plus trusted commit compiler | Accepted only for a bounded app-data slice | Point reads and writes first. Broader query overlays must fail closed until implemented. |
| Payload adapter | Staged target | Start with reserved logical collections and scalar CRUD/transaction conformance; add relations, versions/drafts, globals, auth, locks, and hooks incrementally. |
| Medusa adapter | Separate trusted transaction lane | Preserve real Medusa repository, workflow, link, migration, and transaction behavior. |
| DeploymentSyncDO | Accepted v1 coordination target | One deterministic instance per scope, durable SQLite cursor/query/dependency state, Postgres catch-up. |
| VersionDO, DocCacheDO, QueryCacheDO | Deferred optimization | Add only after measurement and a gap-free freshness protocol. |
| Generic atomic `ctx.db + ctx.commerce` | Rejected | Commerce-affecting atomic behavior belongs behind a Medusa-owned facade/workflow. Cross-boundary follow-up uses IDs and the transactional outbox. |

Replacement storage must use an explicit compatibility migration:

```text
new generation behind a flag
  -> backfill
  -> verify invariants
  -> dual-read comparison
  -> scoped cutover
  -> rollback switch retained until confidence is established
```

## Authority And Scope

`scope_id` is the data-plane authority. It is not an optional hint supplied by
the mutation journal. Scope-qualified key rules apply to data-plane rows and
per-scope operational state. Control-plane catalog identities may use globally
unique opaque IDs, but every versioned definition must be tied by foreign keys
to the same deployment as its stable identity and schema version.

The trusted executor derives scope from an authenticated server-side session or
grant. In a shared-table topology, every primary key, unique constraint, and
intra-scope foreign key includes `scope_id`. A child relationship has the
shape:

```sql
foreign key (scope_id, parent_id)
  references parent_table (scope_id, id)
```

RLS or an equivalent transaction-local scope binding should provide defense in
depth. In schema-per-scope or database-per-scope deployments, redundant scope
columns may be omitted physically, but the logical authority remains the same.

Use a shared physical Medusa schema only when the platform enforces one
homogeneous Medusa schema and module set. Projects with staggered Medusa
versions, custom modules, or custom repository/provider behavior should use a
per-project schema or database until a safe compiled shared strategy is proven.

## Physical Identifier And Index Scalability Policy

This policy applies to the replacement FlarexDB schema. Existing prefixed-text
identifiers and legacy Durable Object keys are migration inputs, not the future
physical-type authority.

- Keep branded public identifiers at API and protocol boundaries, but do not
  repeat strings such as `scope_<uuid>` through every hot Postgres primary key,
  foreign key, and secondary index. The shared-database replacement stores the
  trusted scope and epoch components as native `uuid` values and converts at the
  trusted boundary.
- Keep app document IDs opaque and table-qualified in the developer API. The
  physical form must contain a compact table identity plus a 16-byte internal
  identity. UUIDv7 is a candidate internal generator when time-ordered insertion
  materially improves the measured Postgres workload, but it is not accepted
  merely because lexical ID order looks convenient. A final choice must compare
  it with Convex's portable table-number plus 16-byte internal-ID model and name
  the compatibility, timestamp-disclosure, and ordering differences.
- Prefer compact numeric physical identities for hot stable catalog keys such
  as table, index, relation, and constraint identities. Public or globally
  portable catalog references may additionally carry opaque UUIDs; those do not
  need to be repeated in every data-plane index.
- Preserve adapter-owned identity semantics. Payload collection IDs and Medusa
  module IDs are compiled from their actual schema/manifest. Do not coerce them
  all to UUID. If a wide external ID would dominate hot indexes, keep the
  external unique key and add a compact trusted surrogate.
- Continue using scope-local `bigint` commit and outbox sequences. IDs never
  replace `commit_seq`, `outbox_seq`, or explicit business ordering.
- Every ordered pagination index ends in a unique deterministic tie-breaker,
  normally the compact row identity. Queries must use explicit `ORDER BY`; heap
  or UUID insertion order is not an API contract.
- Every index must correspond to a named read, uniqueness, OCC, delivery, or
  recovery path. Avoid overlapping indexes unless query plans prove both are
  necessary. Partial indexes, BRIN, hash partitioning, and scope promotion are
  measured physical options, not unconditional v1 requirements.
- The ordered-key codec has an enforced maximum encoded size. Equality hashes
  cannot substitute for ordered bytes in range scans, and oversized compound
  keys must fail deterministically rather than discover the B-tree tuple limit
  in production.

The migration must preserve a reversible mapping from legacy public IDs to the
new compact physical representation. Public ID stability is required even when
the underlying storage type changes.

Postgres references for this policy:

- [UUID type](https://www.postgresql.org/docs/current/datatype-uuid.html) and
  [UUID functions](https://www.postgresql.org/docs/current/functions-uuid.html)
  for native UUID storage and the time-ordered UUIDv7 candidate;
- [multicolumn indexes](https://www.postgresql.org/docs/current/indexes-multicolumn.html)
  and [indexes and ordering](https://www.postgresql.org/docs/current/indexes-ordering.html)
  for equality prefixes, range columns, deterministic suffixes, and backward
  B-tree scans;
- [B-tree indexes](https://www.postgresql.org/docs/current/btree.html) for index
  tuple-size constraints and
  [BRIN indexes](https://www.postgresql.org/docs/current/brin.html) for measured
  append-correlated history/feed optimization.

## Catalog And Schema Evolution

Catalog identity must survive schema activation. Separate stable identities
from immutable versioned definitions:

```text
stable:
  table_id, index_id, relation_id, constraint_id

versioned:
  table_definition, column_definition, index_definition,
  relation_definition, constraint_definition
```

An index definition carries its ordered-key codec version and lifecycle:

```text
declared -> building -> backfilling -> validating -> enabled -> retiring
```

A schema version is activatable only when required backfills and validations
have succeeded. There is one authoritative active schema pointer per scope;
deployment metadata may reference it, but must not create a second authority.

The row value codec must be versioned before `jsonb` is treated as a complete
Flarex value representation. BigInt, byte arrays, special numeric values, key
ordering, equality, and hashing need deterministic tagged encodings shared by
the runtime and Postgres.

## App Rows, Indexes, Edges, And Retention

For app/CMS content, the typed row body is authoritative. Index, edge, block,
and unique-key rows are trusted, deterministic products of that body and the
pinned catalog. They are written in the same commit and are never accepted as
physical facts from untrusted user code.

Every relation occurrence needs a stable identity. Repeated targets, localized
fields, and nested block paths cannot be keyed only by source and target:

```text
edge_id / occurrence_key = hash(
  relation_id,
  source row,
  stable nested item or block id,
  field path,
  locale,
  occurrence identity
)
```

Mutable list position is stored for ordering, not used as the occurrence
identity. Block metadata keys include locale.

Engine revision retention must account for active snapshots and reconnect
cursors. Keep a minimal authoritative snapshot lease:

```text
scope_id
session_id
begin_epoch
begin_commit_seq
storage_generation
storage_generation_fence
expires_at
```

GC uses the minimum active snapshot/reconnect floor plus a safety margin for
row, index, edge, commit, and sync change-feed history. Payload user-visible
versions are product data and are not deleted by engine-history GC. Outbox
retention is separate: pending/claimed rows are never GCed, dead letters follow
explicit operator policy, and delivered rows compact only after required
consumer progress plus delivery-idempotency retention.

Reconnect retention uses a bounded lease:

```text
scope_id
connection_or_session_id
epoch
minimum_required_commit_seq
storage_generation
storage_generation_fence
registration_generation
expires_at
```

If a reconnect cursor is from another epoch or older than the retained floor,
the server sends an explicit reset/resnapshot response. It never pretends a
partial replay is complete.

## One Snapshot Token

Do not mix wall-clock time, a global sequence, a row version, and a scope-local
commit cursor. The authoritative token is:

```ts
type SnapshotToken = {
  scopeId: ScopeId;
  epoch: ScopeEpoch;
  commitSeq: CommitSeq;
};
```

Postgres issues the token from the scope clock. Mutation reads mean exactly:

```text
authoritative data as of SnapshotToken
+ the attempt's supported staged-write overlay
```

A cache value produced at commit 105 is not valid for a mutation snapshot at
commit 100 merely because `105 >= 100`. V1 mutation/session reads therefore use
Postgres history. A future cache may serve a mutation only when it can return an
MVCC version valid at the exact snapshot and prove missing rows/ranges.

Live-query freshness is different. A full result may be published from a
snapshot at or after `requiredFreshThrough`, provided the whole result is
snapshot-consistent and the dependency token has been advanced through a
contiguous commit feed.

Epoch rollover is a fencing discontinuity, not a data reset. It invalidates old
sessions and forces clients/subscriptions to resnapshot. Scope-local commit and
outbox sequences remain strictly monotonic and are never reset or reused, so
untouched rows and uniqueness constraints remain valid. Revision, commit,
change, snapshot-lease, outbox, and cursor records still carry epoch wherever a
token is interpreted; an old-epoch session cannot commit even if its sequence
is numerically earlier.
Epoch on a persisted row/change is write provenance, not a filter that hides
untouched data after rollover. Current-row and uniqueness keys remain
epoch-independent.

## Commit Compiler Trust Boundary

The compiler is a pure lowering boundary, not a new authority:

```text
SessionJournal
  local read dependencies and logical app operations

CommitEnvelopeV1
  session id, attempt fence, protocol version, journal digest

CommitPlanner
  trusted catalog lookup and adapter-specific logical lowering

CommitExecutor
  authorization, OCC, constraints, timestamp allocation, physical writes,
  idempotency outcome, commit record, freshness atoms, and outbox
```

Postgres retains a small authoritative session/grant anchor containing:

```text
scope
immutable package/artifact identity
function reference and kind
identity/access-policy fingerprint
validated canonical arguments
authenticated inert identity claims / allowed capabilities
authorization grant id and revocation epoch
schema and policy version
snapshot token
expiry
attempt fence
request/idempotency identity
```

SessionDO SQLite may hold the read/write journal, but it is temporary. It must
not supply physical scope, table names, lock targets, unique-key rows,
freshness atoms, system outbox rows, actor identity, or schema authority. The
trusted planner derives those from logical writes, the session anchor, the
pinned catalog, and adapter rules.

The trusted boundary validates arguments against the pinned authoritative
argument validator before the attempt runs. It validates the encoded return
value against the pinned return validator before a mutation can commit. Worker
validation is useful feedback but is not the authority.
The short-lived authorization grant pins policy semantics through expiry unless
its authoritative revocation epoch advances; revocation invalidates the
attempt. The grant encodes scope, function, allowed operations/capabilities,
claims needed by policy, policy version, expiry, and revocation epoch.

The session lifecycle is explicit and fenced:

```text
created -> running -> finishing -> committing -> committed
             ^                         |
             |                         | OCC conflict
             +------ retrying <--------+
                                       | aborted
                                       | expired
```

Requirements:

- monotonic syscall sequence numbers;
- one fenced attempt owner;
- an OCC retry atomically enters `retrying`, increments the attempt fence,
  replaces the snapshot lease, discards the old journal, and returns the same
  request anchor to `running` without changing storage generation;
- canonical journal digest;
- rejection of late syscalls after `finishing` begins;
- idempotent repeated `finish`;
- committed-outcome lookup after a lost response;
- bounded journal size, TTL, and sensitive-data cleanup.

The first compiler slice supports Flarex app point CRUD and only the query
shapes with a complete overlay implementation. After a relevant staged write,
an unsupported index, relation, scan, Payload, or Medusa read fails closed.
Falling back to Postgres cannot implement read-your-writes because Postgres
cannot see the DO journal.

## Idempotency And Retry Classes

The idempotency record is written atomically with the data, commit, and outbox.
Its lookup/uniqueness key is `(scope_id, request_key)`. The stored row contains
the identity fingerprint, function reference, and canonical argument/request
hash, plus the successful result and commit token.

Reusing the same request key with a different identity, function, or request
hash is an error. A lost response is resolved by reading and replaying the
stored outcome.

`in_progress` attempt leases expire. A committed request key does not become
reusable: after the result replay window, Flarex may clear the large result/log
payload but retains a compact tombstone containing key, identity/function/hash,
and commit token for the scope lifetime. A late retry then returns
`CommittedResultExpired` rather than reapplying the mutation. Future watermark
compaction may remove tombstones only when it can prove the client request
namespace is permanently retired.

Storage-generation cutover fences request namespaces. Recoverable legacy
committed keys are imported with their outcomes; committed keys without a
recoverable result become permanent `LegacyCommittedOutcomeUnavailable`
tombstones. An unnamespaced/legacy key that was already GCed or cannot be
proven returns `LegacyOutcomeUnknown` and is never executed after cutover. New
requests use a server-issued namespace prefix inside the canonical
`request_key`; this does not make any old canonical key reusable.

Keep three retry classes separate:

1. OCC conflict: discard the journal and rerun user code at a new snapshot.
2. SQL serialization/deadlock before a known decision: retry the same
   deterministic physical plan within a bound.
3. Uncertain connection outcome: look up the idempotency/session result before
   rerunning anything.

All authoritative writers, including migrations, backfills, admin tools,
Payload, and Medusa adapters, must acquire the scope-clock/commit-lane lock or
use a formally equivalent serializable/fencing protocol that participates in
the same conflict validation. Merely writing version/commit/outbox metadata is
not equivalent because a writer could otherwise commit between another
transaction's validation and publication. Bypassing the lane breaks OCC and
sync.

## Payload Boundary

Do not infer the Payload contract from a few handwritten tables. Derive it from
`BaseDatabaseAdapter`, sanitized internal collections, transaction behavior,
and adapter conformance tests.

V1 starts with reserved logical Payload collections over the app row store for
scalar CRUD and request transactions. Later slices add:

```text
relationships and uploads
collection and global versions/drafts
polymorphic document locks and auth owners
preferences, migrations, jobs, and query presets as enabled
access policy and hook ordering
```

Dedicated physical `fx_payload_*` tables are allowed only after parity or
measured performance justifies them. Payload request transactions use a
Payload-owned adapter lane until every required read/write overlay is proven;
they are not automatically compiled by the generic SessionDO journal.

## Medusa Boundary

Medusa schema input is not DML alone:

```text
DML models
+ ModuleJoinerConfig and link schema
+ ModuleMigrationAdapter history, including backfills/triggers
+ custom repository/provider capability declarations
```

Medusa keeps a trusted, short Postgres transaction lane behind its existing
repository, transaction-manager, module, and workflow boundaries. That
transaction also writes Flarex commit/change atoms and outbox records before it
commits. Flarex-native workflow tables must not be claimed as a lossless Medusa
workflow store; Medusa workflow persistence is compiled from its own model or
handled by an adapter-specific schema.

There is no automatic global transaction across `ctx.db` and `ctx.commerce`.
If extension state must be atomic with a commerce invariant, expose the whole
operation through a Medusa-owned facade/workflow and let that lane own the
transaction. Display/custom app state normally references stable commerce IDs
and follows commerce changes through the transactional outbox.

## V1 Sync Engine

Use the smallest topology that can prove correctness:

```text
Postgres per scope
  epoch + scope-monotonic commit_seq
  canonical commit/change feed
  authoritative data and history
  durable active subscription registry during migration

DeploymentSyncDO per scope
  durable SQLite appliedThrough cursor
  canonical query definitions
  dependency -> query index
  dirtyThrough, runningAt, generation, and bounded rerun state

ConnectionDO
  WebSocket/session attachment
  client query set and auth/version metadata
  ordered transitions
```

Direct wake is a latency hint. A queue, cron, or executor-side durable sweep
must wake every scope whose sync cursor trails the latest committed sequence.
The DeploymentSyncDO advances only through a contiguous feed. Receiving commit
`N > appliedThrough + 1` forces Postgres catch-up for the missing interval.

Initial subscription uses two-phase activation:

1. Register a provisional canonical query and cursor in DeploymentSyncDO.
2. Execute at a known snapshot.
3. During migration, durably upsert the same provisional generation,
   epoch/package/policy/identity, refined dependency token, and result hash in
   the Postgres registry.
4. Install/refine the DeploymentSyncDO dependency set.
5. Replay/refresh through the current contiguous cursor.
6. Mark the generation active and publish only if the token remains valid;
   otherwise rerun. Removal is idempotent and deactivates the Postgres registry
   before the DO forgets its final durable registration.

This closes the execute-before-register missed-commit race.

Canonical query identity includes:

```text
scope
scope epoch
active package hash
schema and policy version
function/component path
canonical arguments
identity/access-policy fingerprint
```

The Postgres live-query registry remains the durable baseline while
DeploymentSyncDO SQLite is introduced. Remove it only after eviction,
hibernation, reconnect, and replay parity tests prove another recovery owner.
DeploymentSyncDO SQLite is the hot actor cursor authority. A fenced Postgres
cursor is a conservative operational mirror updated only after the DO commits
its local cursor; it may lag but must never lead. The external sweep reads the
mirror, so lag produces harmless duplicate wakes.

`VersionDO`, `DocCacheDO`, and `QueryCacheDO` are later measured optimizations.
They are not part of the v1 correctness proof.

## Executable First Slices

The executor-ready, turn-by-turn form of these slices is maintained in
[`../roadmaps/flarexdb-foundation/README.md`](../roadmaps/flarexdb-foundation/README.md),
with separate schema/migration, OCC/transaction, and commit-compiler plans.
That index interleaves the three domains around one vertical app-data proof; it
does not authorize completing the whole physical schema before exercising its
snapshot and commit semantics.

1. Introduce one scope/epoch/commit-sequence token in the existing executor.
2. Add stable catalog identities plus immutable versioned definitions.
3. Build app row revision/current, index revision/current, edge occurrence, and
   unique-key storage behind a generation flag.
4. Prove point CRUD, exact-snapshot OCC, result-bearing idempotency, and atomic
   commit/outbox on PGlite and real Postgres.
5. Prove one indexed live query with two-phase activation and lost-wake
   recovery through a per-scope DeploymentSyncDO.
6. Add a small Payload scalar adapter slice.
7. Add one small Medusa module through its real repository, migration, link,
   workflow, and transaction boundaries.

Do not start by replacing every current table or by implementing all cache DOs.

## Required Correctness Gates

- duplicate `finish`, lost commit response, DO restart, expired/stale attempt;
- same idempotency key with different identity/function/arguments;
- mutation at snapshot 100 while a cache contains a value from 103;
- unsupported read after a relevant staged write;
- row, index-range, edge, insert/delete, and pagination phantom conflicts;
- real PostgreSQL serialization and deadlock behavior;
- commit between initial query execution and registration;
- duplicate, reversed, and gapped commit delivery;
- lost direct wake before a delivery row exists;
- concurrent reruns of one query and simultaneous work for two scopes;
- package activation and identity/policy change against cached queries;
- ConnectionDO and DeploymentSyncDO eviction/hibernation/reconnect recovery;
- unchanged Payload and Medusa adapter/module tests for each claimed feature.

## Provenance

Convex-first references inspected for the design:

- `../../../crates/database/src/committer.rs`
  - validate reads before publishing writes and commit metadata.
- `../../../crates/database/src/transaction.rs`
  - transaction-local reads/writes and read-your-writes behavior.
- `../../../crates/database/src/subscription.rs`
  - dependency refresh against committed writes.
- `../../../crates/sync/src/worker.rs`
  - query tokens, subscription activation, rerun, and ordered publication.

Current Flarex implementation evidence:

- `packages/persistence-postgres/src/schema.ts`
  - current document/index, invoke-session, subscription, and outbox baseline.
- `packages/executor/src/sessions.ts`
  - current session finish, commit, and best-effort post-commit wake boundary.
- `packages/flarex-backend/src/connectionDO.ts`
  - current query execution followed by registration, which exposes the
    activation race.
- `packages/flarex-backend/src/schedulerRoutes.ts` and `schedulerDO.ts`
  - current global scheduler routing and singleton pending/rerun state.
- `packages/flarex-backend/src/worker.ts`
  - current scheduled recovery coverage.

Adapter contract references inspected:

- Payload `packages/payload/src/database/types.ts` and Drizzle transaction,
  version, draft, and lock implementations.
- Medusa DML, repository service, `ModuleJoinerConfig`, migration adapter, link
  migration, and workflow execution models in the local Medusa fork.

## Remaining Risks

The accepted direction is still not a proven database. The largest open risks
are shared-table bloat and isolation, precise range OCC, ordered-key/value codec
compatibility, snapshot-retention cost, Medusa adapter parity, Payload lifecycle
parity, per-scope sync hot spots, and operational recovery under real Postgres
and Cloudflare eviction. Each must be closed by a narrow vertical slice and a
compatibility test, not by expanding the design promise.
