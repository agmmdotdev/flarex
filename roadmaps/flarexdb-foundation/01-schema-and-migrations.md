# FlarexDB Schema And Migration Plan

Status: S01 through S02-C and hosted-proof H01-H04 complete; H05-A local
preparation is complete, H05-B hosted activation is next, and S02-D remains
blocked through H05

This plan owns the additive physical schema, codecs, repositories, and
compatibility migration for the first Flarex app-data generation. It does not
own OCC behavior, commit compilation, Payload parity, Medusa table generation,
or live-sync coordination.

Follow the interleaved order in [README.md](./README.md). Do not complete every
schema turn before exercising the rows through OCC and the commit compiler.

## Authoritative Inputs

- [Accepted architecture and migration rule](../../design-notes/flarex-db-accepted-design.md)
- [Minimal v1 inventory and deferrals](../../design-notes/flarex-commerce-cms-v1-schema-cutline.md)
- [Long-form schema and provenance](../../design-notes/flarex-internal-db-schema.md)
- [Scope-safe physical topologies](../02-schema-placement-and-shards.md)
- [Postgres executor migration map](../20-postgres-executor.md)
- [Current legacy Drizzle schema](../../packages/persistence-postgres/src/schema.ts)
- [Current package-local migrations](../../packages/persistence-postgres/drizzle/)

Convex-first implementation references:

- [`crates/database/src/committer.rs`](../../../../crates/database/src/committer.rs)
  for validate-before-publication and ordered committed writes;
- [`crates/database/src/reads.rs`](../../../../crates/database/src/reads.rs)
  for row, missing-row, and range dependency accounting;
- [`crates/database/src/transaction.rs`](../../../../crates/database/src/transaction.rs)
  for snapshot-local reads and staged writes.

## Fixed Schema Decisions

These are not left for individual implementation turns to reinterpret:

- Use the namespaced physical families from the long-form schema:
  `fx_control_*`, `fx_app_*`, and `fx_system_*`. Short names such as
  `fx_row_current` in the v1 cutline are conceptual aliases.
- `scope_id` is present in every shared data-plane primary key, unique
  constraint, intra-scope foreign key, and repository predicate. V1 also uses a
  transaction guard that rejects absent/mismatched trusted scope and proves
  pooled connections cannot retain a prior scope. RLS is optional additional
  defense and is not claimed as implemented by a session variable alone.
- `storage_generation` and its fence are authoritative on the data-plane scope
  clock and default existing scopes to `legacy_v1`. Sessions and subscriptions
  pin them. Clients and Dynamic Workers cannot select them.
- Use `bigint` internally for commit/outbox counters and revisions. Encode them
  canonically as strings or branded values at JavaScript/protocol boundaries;
  do not rely on unsafe JS `number` precision.
- The scope clock stores the last committed sequence. Empty scope is `0`;
  commit allocates `last + 1` inside the final transaction; rollback consumes
  nothing. Commit and outbox counters are separate.
- Epoch rollover fences sessions/cursors but does not reset sequences or hide
  rows written in an older epoch.
- Canonical hashes use SHA-256 `bytea` plus the canonical encoded value needed
  to verify collisions. Equal hash plus unequal encoded bytes is a fatal
  `CanonicalKeyHashCollision`; V1 aborts rather than storing two unequal keys in
  one hash slot.
- App row JSON is authoritative. Index, edge, unique, change, and outbox rows
  are trusted deterministic products of the row and pinned catalog.
- V1 keeps stable table/index identities plus stable relation/constraint IDs in
  the immutable manifest. Index definitions are normalized. Physical field,
  constraint-definition, and relation-definition catalogs remain deferred
  until a real compiler or adapter requires them.
- Migrations are additive. Legacy `documents`, `indexes`, invoke staging,
  commits, outbox, and subscription tables are not renamed or dropped here.

## Explicitly Deferred

- physical `fx_control_column*`, constraint, and relation-definition catalogs;
- `fx_app_edge_rev`;
- a dedicated block table unless hidden declared indexes prove insufficient;
- normalized transaction dependencies until planner/measurement justifies
  them;
- a generic row-version table unless adapter integration requires it;
- Payload-specific physical lifecycle tables;
- Medusa relational table generation and migrations;
- sync cursor/query tables beyond the minimal reconnect-retention lease, client
  watermarks, caches, search, and read models;
- public high-level database or adapter APIs.

## Turn Checklist

### [x] S01 — Freeze Legacy And Add The Generation Boundary

Progress:

- [x] S01-A — Add shared branded storage-authority contracts without changing
  runtime behavior.
- [x] S01-B — Add the narrow app-data engine boundary and wrap current behavior
  as `legacy_v1`.
- [x] S01-C — Resolve generation from trusted scope authority, default existing
  scopes to `legacy_v1`, and keep `flarexdb_v1` unreachable.

Outcome:

- Preserve a named `legacy_v1` adapter over the current schema and behavior.
- Create an isolated storage-engine module boundary rather than scattering
  generation conditionals through existing document methods.
- Define branded `ScopeId`, `ScopeEpoch`, `CommitSeq`, `OutboxSeq`,
  `StorageGeneration`, and `SnapshotToken` contracts shared with the OCC plan.
- Define trusted generation resolution; do not add a request header or public
  worker option.

Ownership rule: S01 is the sole owner of shared identity/generation types and
the base legacy/new storage module split. O01 adds only OCC-specific dependency
and transaction ports. C01 adds only compiler-facing composition adapters over
those existing boundaries.

Implemented transitional S01-C rule: until S02 installs authoritative
scope-clock metadata, scope context is derived only from validated persisted
invoke-session state and only the `legacy_v1` adapter is registered. This is a
temporary compatibility default, not a permanent rule that missing metadata
means legacy after S02.

Likely code areas:

- `packages/persistence-postgres/src/`
- `packages/executor/src/types.ts` and new narrow internal modules
- existing PGlite/Postgres test helpers

Exit gate:

- [x] all legacy executor and persistence tests remain green without rewritten
  expectations;
- [x] existing scopes resolve to `legacy_v1`;
- [x] invalid token/generation combinations fail typed decoding;
- [x] no production read or write routes to the new generation.

### [ ] S02 — Add Trusted Scope Metadata And The Scope Clock

Progress:

- [x] S02-A — Add the minimal `fx_control_scope` locator catalog, typed
  repositories, additive migration, and constraint tests without backfill or
  runtime routing.
- [x] S02-B — Add the authoritative `fx_system_scope_clock` row and private
  read/lock/rollback proof without a production sequence allocator.
- [x] S02-C — Bootstrap existing deployments and make future provisioning
  establish a validated locator/clock authority pair.
  - [x] S02-C1 — Add the shared-database atomic initial-authority primitive.
  - [x] S02-C2 — Add bounded resumable bootstrap and parity inventory.
  - [x] S02-C3a — Fence executor creation behind the shared-database ready
    authority capability and prove the final cutover/parity sequence.
  - [x] S02-C3b — Add durable split-topology reservation, located-target
    recovery, and monotonic readiness semantics.
    - [x] S02-C3b1 — Add the immutable split-placement receipt and exact
      package-internal `reserved -> ready` control CAS.
    - [x] S02-C3b2 — Add trusted located-target resolution, exact initial
      clock reconciliation, failure-window recovery, and final ready
      projection.
- [x] H01 — Freeze the pre-S02-D Worker/Hyperdrive proof contract and split
  local workerd/direct-Postgres evidence from the hosted activation receipt.
- [x] H02 — Add the Worker-safe request-scoped Postgres persistence seam.
- [x] H03 — Add the private executor Worker and bundle/import-graph proof.
- [x] H04 — Prove its named local service binding against real PostgreSQL.
- [ ] H05 — Record cache-disabled Hyperdrive and hosted service-binding
  activation evidence.
  - [x] H05-A — Prepare the authenticated probe, hosted PostgreSQL runner,
    exclusive run claim, encrypted/bounded staging guards, shared OCC oracle,
    exhaustive scoped cleanup, and production/probe dry-run gates.
  - [ ] H05-B — Create and inspect the live cache-disabled Hyperdrive,
    activate the private executor and probe, collect hosted OCC/SQL and
    Cloudflare receipts, then remove or disable the probe.
- [ ] S02-D — Replace the S01 compatibility alias with trusted scope/clock
  generation resolution and fail closed on missing metadata.
- [ ] S02-E — Prove scope/fence isolation, including real-Postgres pooled
  connection and cross-scope rejection tests.

S02-B implemented only the seven-column clock, a branded positive generation
fence, validated scope-keyed reads, and a package-internal transaction-typed
lock probe. Its exact-PID contention and rollback proof passed on PostgreSQL
18. `storage_generation` is explicit rather than a DDL default; S02-C must
write `legacy_v1` deliberately during bootstrap. The migration performs no
backfill and adds no control-plane foreign key because the clock may live in a
separate data-plane database. It also adds no allocator or retained-history
floor; O06 owns allocation and S08 owns `oldest_available_commit_seq`.

S02-C1 now provides one server-only provisioner for the current co-located
`shared_database` lane. It atomically ensures deployment, locator, and clock;
explicitly initializes `legacy_v1`, fence `1`, and both counters at `0`; and
returns typed created/existing outcomes without overwriting an advanced clock.
Normal provisioning fails closed on an existing scope missing its clock; only
C2 may expose an explicit inventoried bootstrap repair. Production creation
uses `scope_<lowercase uuid-v4>` and
`epoch_<lowercase uuid-v4>` identifiers generated behind the trusted factory.
The general brands remain non-empty strings for controlled imports and tests.

S02-C2 now provides a separate server-only bootstrapper for committed
deployments in that same fixed `shared_database` placement. It captures the
greatest visible deployment ID, scans through that primary-key frontier in
validated `1..1000` pages, and uses one short transaction per deployment. A
missing scope creates the scope and initial clock together. A matching existing
scope missing its clock may be repaired only through this inventoried C2 path;
normal C1 provisioning still fails closed. Every new clock explicitly writes
`legacy_v1`, fence `1`, commit/outbox sequence `0`, and one generated epoch.
An existing valid clock, including one whose generation/fence/counters have
advanced, is never reset.

Page progress is replay-safe: no continuation cursor is returned if any item
fails, while previously committed items converge to `already_provisioned` on
retry. The parity statement classifies deployments through the frontier as
complete, missing scope, missing clock, or locator conflict and separately
counts orphan clocks. Therefore a missing pair plus an orphan cannot appear
healthy merely because total row counts match.

C2 deliberately does not claim a permanent global invariant. PostgreSQL cannot
resume the same MVCC snapshot after a process restart, and a legacy deployment
transaction may commit behind an advanced lexical cursor. Verification reports
only `complete_through_frontier` in its statement snapshot. C3a now removes the
legacy writer from the executor port and routes every current shared creation
path through C1. Production rollout must still quiesce old binaries and rerun
C2 from a fresh frontier before claiming the global invariant; the PGlite and
PostgreSQL tests prove that sequence without claiming it already occurred in a
hosted environment.

The earlier word `atomically` is now topology-sensitive. Co-located C1 rows use
one SQL transaction. Schema-per-scope needs a qualified same-connection proof,
and database-per-scope needs durable, idempotent readiness reconciliation;
neither may be claimed from the shared-schema tests. C2 can inventory committed
rows through a captured frontier for the supported lane. C3a fences current
shared executor creation. C3b owns the durable split protocol: persist exact
placement/initial-epoch intent in a `reserved` receipt, prepare and verify the
located clock, then publish `ready` monotonically. A locator without a valid
clock is incomplete and must fail closed in S02-D, never imply `legacy_v1`.

C3b1 now persists that recovery intent in the additive, one-to-one
`fx_control_scope_provisioning` table. The receipt is split-only and contains
the exact copied locator, protocol `split_scope_authority_v1`, one winning
initial epoch, `reserved | ready`, and ordered timestamps. It has no
deployment copy, credential, current clock, retry lease, error state, delete,
or reverse transition. Existing scopes are not backfilled because their
original initial epoch/protocol intent cannot be reconstructed.

The package-internal reservation primitive requires the caller's existing
short control transaction, locks and revalidates `fx_control_scope`, and adopts
the persisted epoch winner on replay or concurrency. The final primitive takes
a separate short transaction and publishes `ready` only by exact
protocol/locator/epoch/state CAS. A ready receipt records completed
publication; it is not the current data-plane clock. C3b2 must commit the
reservation first, resolve the persisted locator with a trusted server
capability outside all control transactions, atomically ensure/read back
`legacy_v1`, fence `1`, commit/outbox `0`, and the receipt epoch at the target,
then reopen control and CAS ready. A differing target clock while still
reserved is terminal and must never be overwritten. After ready, S02-D reads
current clock authority rather than requiring the initial tuple forever.

S02-C3b2 now supplies the host-neutral coordinator and concrete
node-postgres/PGlite target capabilities. Fresh split creation commits the
deployment, generated scope, frozen locator, winning epoch, and reserved
receipt atomically in control. The coordinator then resolves only that
persisted locator, ensures and reads back the exact initial clock in one target
transaction, and reopens control for exact ready CAS. Replay skips placement
planning and ID generation. Existing bare deployments, shared scopes, and
split scopes without a receipt fail closed because normal provisioning cannot
reconstruct their original intent.

Ready replay resolves and checks the current clock but does not require the
historical initial tuple or recreate a missing clock. PGlite failure injection
covers rollback and response-loss windows; paired PostgreSQL 18 schemas/pools
prove exact conflict preservation and concurrent convergence. An advisory-lock
gate holds both target transactions while a `FOR UPDATE NOWAIT` probe acquires
the deployment, scope, and receipt rows in control, proving no control
transaction spans target I/O. S02-C adds no runtime generation routing,
sequence allocation, OCC, compiler, sync, Payload, or Medusa behavior.

S02-B and S02-C are deliberately host-neutral. They add and bootstrap trusted
database authority without composing a production runtime. Before S02-D, a
separate proof must bundle the framework-neutral executor into the dedicated
private `flarex-executor` Cloudflare Worker, use a request-scoped Postgres
client through cache-disabled Hyperdrive, exclude filesystem migration/PGlite
code from the Worker import graph, and pass a real-Postgres service-binding
smoke. Failure of that proof blocks runtime routing, not the additive clock DDL
or repositories.

S02-A fixed the production bootstrap ID convention before any rows are
backfilled: the trusted control plane will issue `scope_<uuid-v4>` identifiers,
using lowercase RFC 4122 UUID text. The value is opaque and stable; it is never
derived from deployment, project, tenant, topology, or database names. S02-C1
now also fixes initial epochs as opaque `epoch_<uuid-v4>` values and owns
generation plus idempotent insertion under the unique deployment mapping.
The repository continues to accept the shared branded non-empty `ScopeId` so
tests and controlled imports are not coupled to one generator.

The S02-A locator JSON is also fixed and deliberately contains no credentials:
`{ kind, databaseKey, schemaName }`. `databaseKey` is an opaque key into trusted
server configuration, never a connection string. `kind` must match the checked
`isolation_kind`; the only accepted kinds are `shared_database`,
`schema_per_scope`, and `database_per_scope`.

Outcome:

- Add minimal `fx_control_scope` location/catalog ownership with one active
  schema pointer and physical locator.
- Add authoritative `storage_generation` and `storage_generation_fence` to the
  data-plane `fx_system_scope_clock` beside `last_commit_seq`,
  `last_outbox_seq`, epoch, and update metadata. Control routing may cache that
  state but cannot lead it or become a second authority.
- Resolve the scope/schema foreign-key creation cycle through ordered migrations
  or a later constraint, while exposing only one mutable active-schema pointer.
- Require every repository query to carry `scope_id`, establish a trusted
  transaction scope guard, reject absent/mismatched scope, and prove pooled
  connections cannot leak a previous scope. RLS remains optional defense.
- Bootstrap one clock/fence row for every existing deployment, verify
  relational anti-join parity rather than only equal totals, then make missing
  metadata fail closed. Future deployment creation writes scope location and
  data-plane clock/fence atomically within the topology's provisioning
  protocol.

Counter contract:

```text
empty scope snapshot = 0
lock scope clock
new commit sequence = last_commit_seq + 1
publish commit atom and all authoritative writes
set last_commit_seq = new commit sequence
commit
rollback = no consumed sequence
```

This is the final transaction invariant, not a standalone allocator exposed by
S02. S02 may use a private rollback/locking harness to test the clock, but only
O06 may allocate and advance a production commit sequence together with commit
publication and recovery metadata.

Exit gate:

- two scopes cannot collide;
- stale epoch/generation fences reject writes;
- rollover does not reset either counter;
- clock-row lock exclusion and rollback are proven without advancing a
  production sequence; O06 owns dense allocation and ordering proof;
- real-Postgres cross-scope read/write and pooled-scope-leak tests fail closed;
- after bootstrap, missing clock/fence metadata is never interpreted as legacy.

### [ ] S03 — Add The Minimal Stable Catalog

Outcome:

- Add `fx_control_schema_version` with immutable manifest, checksum, status,
  and deployment ownership.
- Add stable `fx_control_table` and `fx_control_index` identities.
- Assign stable relation and constraint IDs inside the immutable manifest even
  though their normalized physical definition tables remain deferred.
- Add immutable `fx_control_index_definition` and per-scope
  `fx_control_index_build_state`.
- Compile the manifest transactionally and verify the normalized catalog against
  its checksum; do not independently edit normalized rows.
- Activate a schema only after required index backfill/validation succeeds.

Exit gate:

- stable table/index/relation/constraint IDs survive multiple schema versions;
- cross-deployment foreign keys and activation are rejected;
- exactly one scope pointer is mutable authority;
- field/relation physical catalogs have not slipped into the first migration.

### [ ] S04 — Migrate Active Schema Pointer Authority

Outcome:

- Backfill `fx_control_scope.active_schema_version_id` from the implemented
  legacy `deployments.active_schema_version` pointer and verify count/value
  parity.
- Route all schema activation through one transactional service that writes the
  new authoritative pointer and the legacy column as a compatibility mirror.
- Switch executor/catalog readers to the new pointer, then reject independent
  legacy-column updates.
- Keep the mirror until every legacy storage path that reads it has retired.

Exit gate:

- activation cannot leave the two columns divergent under injected failure;
- existing deployments resolve the same active schema before and after the
  reader switch;
- new activations are visible to both generations in one transaction;
- direct legacy-pointer mutation fails after the authority switch.

### [ ] S05 — Freeze Value And Ordered-Key Codecs

Outcome:

- Implement a versioned tagged Flarex value codec for JSON-compatible values,
  bigint, bytes, special numeric values, deterministic object ordering, and
  stable hashing.
- Implement a versioned ordered compound-index key codec with bound encoding,
  locale handling, and row-ID tie-breaking.
- Store codec versions with rows/index definitions where interpretation depends
  on them.

Exit gate:

- canonical golden fixtures round-trip in runtime and persistence code;
- equality, hashing, and ordered comparison agree for null/missing, strings,
  booleans, numbers, bigint, bytes, compound values, and special values;
- changing codec bytes requires a new version and a migration, not a silent
  rewrite.

### [ ] S06 — Add App Row Revision And Current Storage

Outcome:

- Add `fx_app_row_rev` and `fx_app_row_current` with scope/table/row identity,
  commit provenance, schema/codec version, value, tombstone, and previous
  revision information required by exact snapshots.
- Add transaction-bound repository methods for point history/current reads.
- Treat current rows as a latest-read optimization; history remains sufficient
  for exact active snapshots.

Exit gate:

- exact point read, missing row, insert, update, tombstone, and delete history
  pass on PGlite;
- a later revision never leaks into an older snapshot;
- untouched rows remain visible across epoch rollover;
- shared-table scope isolation is enforced by keys and trusted binding.

### [ ] S07 — Add Session And Retention-Lease DDL

Outcome:

- Add `fx_system_tx_session` and `fx_system_snapshot_lease`, pinning request,
  scope, storage generation/fence, snapshot, catalog/policy/package identity,
  request identity, attempt fence, state, and expiry.
- Add the minimal `fx_sync_reconnect_lease` required by revision retention,
  with explicit storage generation/fence and registration generation. Query
  coordination remains deferred to the sync plan.
- Keep session-anchor and snapshot-lease creation atomic.

Exit gate:

- fresh-database apply, upgrade from the current migration set, repeated
  startup, and failure-before-migration-record tests pass;
- scope/generation foreign keys and indexes are correct;
- no application behavior routes to these tables yet.

### [ ] S08 — Add Commit And Change-Feed DDL

Outcome:

- Add `fx_system_commit` and `fx_system_commit_write` for the dense scope feed.
- Add `oldest_available_commit_seq` to the authoritative scope clock so a
  restarted server knows the actual retained-history floor.
- Keep allocation private to the final transaction primitive in O06; this turn
  adds schema and repositories but cannot advance the clock independently.

Exit gate:

- fresh apply, current-schema upgrade, repeated startup, and failure-before-
  migration-record tests pass;
- scope/epoch/sequence foreign keys and ordered `listAfter` queries pass;
- no gap-producing standalone allocation API exists.

### [ ] S09 — Add Idempotency And Leased-Outbox DDL

Outcome:

- Add result-bearing `fx_system_idempotency` keyed by
  `(scope_id, request_key)`.
- Add `fx_system_outbox` with independent scoped ordering, claim fence,
  attempts, retry time, delivery state, and dead-letter metadata.
- Add `fx_system_outbox_cursor` for every required consumer's durable progress
  and delivery-idempotency retention.

Exit gate:

- database uniqueness enforces one request row; O07 trusted logic must still
  compare identity, function, and request hash and reject mismatched reuse;
- commit/idempotency/outbox foreign keys are scope-safe;
- pending/claimed rows are never GC candidates, and delivered rows remain until
  all required consumer cursors and idempotency windows permit compaction;
- no application behavior routes to these tables yet.

### [ ] S10 — Add Index Revision And Current Sidecars

Outcome:

- Add `fx_app_index_entry_rev` and `fx_app_index_entry_current` with codec
  version, canonical encoded key, SHA-256 hash, row identity, and commit
  provenance.
- Keep range bounds and pagination frontiers in typed query/dependency APIs,
  not duplicated on every physical index entry.
- Add repository operations for deterministic key insertion, movement,
  deletion, and codec-versioned exact range reads.

Exit gate:

- compound ordering, inclusive/exclusive bounds, empty ranges, pagination
  frontiers, key movement, and delete history pass;
- equal hashes compare canonical bytes; unequal bytes produce a fatal collision
  error;
- a real-Postgres query-plan check shows the intended scope/index/key path.

### [ ] S11 — Add Unique-Key Storage

Outcome:

- Add `fx_app_unique_key` with scope, stable manifest constraint identity,
  canonical encoded key, SHA-256 hash, owning row, schema/codec version, and
  update provenance.
- Define sparse, null/missing, localized, and delete/reuse semantics in tests.
- Treat equal hash plus unequal encoded bytes as fatal rather than attempting
  to represent two unequal keys in one uniqueness slot.

Exit gate:

- single-transaction insert/update/delete/reuse semantics pass;
- the same logical key may exist in another scope;
- canonical collision detection cannot overwrite an existing claim;
- real concurrent claim/rollback proof remains O09's responsibility.

### [ ] S12 — Add Stable Current Edge Occurrences

Outcome:

- Add only `fx_app_edge_current` for v1.
- Use the stable relation ID from the immutable manifest even though the
  normalized relation-definition catalog remains deferred.
- Derive stable occurrence identity from relation identity, source row, stable
  nested item/block identity, path, locale, and occurrence identity.
- Store mutable list position only as ordering metadata.

Exit gate:

- repeated occurrences of the same target remain distinct;
- reorder does not change identity;
- locale/path/nested-block changes and stale-edge cleanup are covered;
- relation ID is never null and `fx_app_edge_rev` has not been added.

### [ ] S13 — Add Resumable Current-State Baseline Import

Outcome:

- Add a migration state machine separate from authoritative
  `storage_generation`, with source/target generation, phase, start/high/
  applied-through legacy `ts` watermarks, cursor, lease fence, counts/hashes,
  validation status, rollback support, and error report.
- Import only the latest current row/tombstone state needed at the final legacy
  watermark under an explicit immutable legacy manifest/codec. Do not claim
  historical FlarexDB snapshot support or invent old schema provenance.
- Derive target indexes, unique keys, and edge occurrences from those final row
  bodies and the pinned import manifest; do not declare copied legacy index
  bytes authoritative.
- Build an unsealed baseline at reserved FlarexDB `commit_seq = 1` in bounded,
  idempotent batches. Target-generation repositories must reject it while the
  migration is unsealed, and no canonical commit row exists yet.
- Mirror ordered legacy changes through a recorded legacy `ts` watermark by
  updating that unsealed baseline. Never write legacy `ts` into `commit_seq`.
- Emit no canonical commit and no external-effect outbox row during import.
  O12 drains legacy work; S15 then seals baseline commit 1, sets clock/floor to
  1, and flips authority atomically. Old sessions/reconnects are reset rather
  than served from missing imported history.
- Import every recoverable committed legacy idempotency key into
  `fx_system_idempotency`. Preserve a full outcome where available; otherwise
  write a permanent `LegacyCommittedOutcomeUnavailable` tombstone. Duplicate
  or contradictory legacy keys block validation.
- Resolve/fence every in-progress or uncertain legacy key. Treat keys already
  GCed or lacking proof as part of an implicit reject-only legacy namespace;
  after cutover they return `LegacyOutcomeUnknown` and never execute.

Exit gate:

- crash/restart resumes without duplication;
- repeated backfill is deterministic;
- unsealed baseline rows are impossible to read through the authoritative
  FlarexDB engine and have no owner in the canonical commit feed;
- unmapped scopes, duplicate legacy idempotency keys, untracked revisions, and
  corrupt encodings block validation rather than being guessed away.

### [ ] S14 — Add Verification And Shadow Comparison

Outcome:

- Verify row counts, current-to-revision consistency, tombstones, catalog IDs,
  index keys, unique claims, edge occurrences, and snapshot-visible normalized
  current values at the same fenced legacy watermark and reserved baseline
  sequence.
- Record shadow mismatches durably with enough context to reproduce them.
- Keep the legacy generation authoritative; shadow reads never silently serve
  as fallback results.

Exit gate:

- injected corruption is detected;
- comparison cannot run across different watermarks/generations;
- a clean report is reproducible on PGlite and real Postgres.

### [ ] S15 — Finalize Generation Routing And Rollback State

Outcome:

- Add transaction-bound repositories for authoritative generation/fence
  transitions, separate migration phase, rollback window, validation watermark,
  and irreversible-boundary metadata.
- Add a reverse legacy compatibility publisher for every operation allowed
  during the rollback window. It writes the complete legacy data/index/commit
  projection in the same SQL transaction as the FlarexDB commit while
  suppressing duplicate external outbox effects.
- Make both generation adapters consult the same scope-wide
  `fx_system_idempotency` outcome before execution. The legacy adapter must
  replay FlarexDB results/tombstones and reject identity/function/request-hash
  mismatches before and after rollback; it cannot reapply a committed request.
- Before cutover, make every new legacy commit dual-record its generation-
  independent outcome/tombstone in the same SQL transaction for a declared
  compatibility window. Seal the implicit legacy request namespace at cutover;
  new canonical request keys use a server-issued namespace prefix.
- Require repair, migration, and admin writers to use the same bridge during
  the window. If an operation cannot be represented exactly, it is forbidden
  until the rollback promise is ended.
- Add repository primitives for the cutover drain protocol: enter draining
  under the fence, block new legacy starts, enumerate/expire old attempts,
  record the final catch-up watermark, compare-and-set the fence/generation,
  and record reset requirements.
- Add a generation-rebind CAS for an unchanged
  `(scope, request_key, identity, function, request_hash)` only after outcome
  lookup proves no commit, the old anchor is terminal/fenced, and no commit is
  in flight. An uncertain decision remains blocked until resolved.
- Add one final sealing primitive that locks clock/migration state, verifies the
  final baseline hash/watermark, inserts synthetic system commit 1 with
  `source = legacy_import` and `requires_resnapshot`, sets
  `last_commit_seq = oldest_available_commit_seq = 1`, bumps/flips the storage
  generation fence, and commits without external-effect outbox rows.
- Do not route a canary or remove legacy tables in this schema turn; O12 owns
  behavioral cutover and O13 remains blocked on the later sync plan.

Exit gate:

- transition, drain, and rollback-state repositories pass PGlite and real-
  Postgres concurrency tests;
- compatibility projection tests prove matching visible legacy state and a
  stable mapping between FlarexDB commits and legacy revision metadata;
- result replay, expired-result tombstone, mismatched-key, and uncertain-outcome
  tests pass across FlarexDB-to-legacy rollback;
- stale fences cannot flip authority;
- every phase is auditable and restart-recoverable;
- no migration drops or rewrites the legacy generation.

## Adapter-Facing Schema Contract

This plan creates database capabilities for later adapters without implementing
their high-level behavior:

- Payload scalar content may later use the app row/catalog/index/edge
  primitives through a Payload-owned request transaction adapter.
- Medusa does not store products, orders, carts, pricing, or inventory in
  `fx_app_row_*`. A later Medusa adapter keeps relational tables and joins the
  scope clock, commit/change feed, and outbox within its own trusted SQL
  transaction.
- Neither adapter receives arbitrary physical identifiers or authors system
  commit/outbox rows.

## Verification Template

Every schema turn runs the focused subset plus the applicable package gates:

```sh
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres build
```

Clock, constraint, concurrency, outbox, migration, and cutover turns also run:

```sh
corepack pnpm --filter @flarex/persistence-postgres test:postgres
```

When executor ports change:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor build
```

Phase checkpoints additionally run workspace `typecheck`, `test`, and `build`.
DDL turns generate package-local Drizzle migrations and commit the migration
snapshot. Significant code turns require both standing diff reviewers before
the automatic checkpoint commit.
