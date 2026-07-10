# FlarexDB Schema And Migration Plan

Status: in progress; S01-A is implemented

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

### [ ] S01 — Freeze Legacy And Add The Generation Boundary

Progress:

- [x] S01-A — Add shared branded storage-authority contracts without changing
  runtime behavior.
- [ ] S01-B — Add the narrow app-data engine boundary and wrap current behavior
  as `legacy_v1`.
- [ ] S01-C — Resolve generation from trusted scope authority, default existing
  scopes to `legacy_v1`, and keep `flarexdb_v1` unreachable.

Outcome:

- Preserve a named `legacy_v1` adapter over the current schema and behavior.
- Create an isolated FlarexDB schema/module boundary rather than scattering
  generation conditionals through existing document methods.
- Define branded `ScopeId`, `ScopeEpoch`, `CommitSeq`, `OutboxSeq`,
  `StorageGeneration`, and `SnapshotToken` contracts shared with the OCC plan.
- Define trusted generation resolution; do not add a request header or public
  worker option.

Ownership rule: S01 is the sole owner of shared identity/generation types and
the base legacy/new storage module split. O01 adds only OCC-specific dependency
and transaction ports. C01 adds only compiler-facing composition adapters over
those existing boundaries.

Likely code areas:

- `packages/persistence-postgres/src/`
- `packages/executor/src/types.ts` and new narrow internal modules
- existing PGlite/Postgres test helpers

Exit gate:

- all legacy executor and persistence tests remain green without rewritten
  expectations;
- existing scopes resolve to `legacy_v1`;
- invalid token/generation combinations fail typed decoding;
- no production read or write routes to the new generation.

### [ ] S02 — Add Trusted Scope Metadata And The Scope Clock

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
- Bootstrap one clock/fence row for every existing deployment, verify count
  parity, then make missing metadata fail closed. Future deployment creation
  writes scope location and data-plane clock/fence atomically within the
  topology's provisioning protocol.

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
