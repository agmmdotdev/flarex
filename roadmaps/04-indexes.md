# Indexes

## Persist Target-Native Ordered Index Entry History

What changed:

- Migration `0040` adds private immutable index-entry revisions and exact
  live-current pointers keyed by scope, physical definition, canonical key bytes,
  and the separate 16-byte row tie breaker.
- Each revision records Ordered Index V1 codec identity, the immutable physical
  spec SHA-256, canonical key bytes and SHA-256, table/row identity,
  prior-pointer provenance, and the exact
  app-row commit/epoch foreign key. The current table contains no duplicate
  digest, lifecycle, bounds, or build evidence.
- A transaction-only Result mutation accepts only the exact module-minted,
  scope/deployment-bound receipt identity from the persistence catalog's
  verified definition lookup, derives the
  definition/table/spec/digest as one authority value, validates keys against
  that located physical specification, proves live entries reference a live exact app-row
  revision, and performs insert/update/tombstone CAS. Tombstones delete the
  range-facing pointer while immutable history retains chain provenance.
  Effect-native snapshot/current readers apply exact half-open byte bounds and
  exclusive physically validated `(key,row)` cursors, return frozen bounded
  pages, and verify both the located physical-spec commitment and every visible
  key before projection.

Why it changed:

S03-D4 readiness needs real physical index evidence, but immutable definitions
and build-state rows did not yet have a target-native entry consumer. S10 adds
that storage owner without making a build ready or changing the existing row,
commit, OCC, or activation owners.

Known limitations and follow-up:

- S11 now owns private target-native unique claims; S03-D3 still owns build
  reconciliation; C08 owns lowering final row bodies into index revisions and
  unique claims inside the existing commit; O09 owns unique contention and
  multi-row rollback integration; and O10 owns indexed dependencies and
  phantom validation.
- No readiness, active-reader selection, routing, production trigger, legacy
  removal, or package-root mutation API is added.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test:pglite:migrations
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/appIndexEntries.test.ts --no-file-parallelism
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/appIndexEntries.postgres.test.ts --no-file-parallelism --testTimeout=60000
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm check:effect-boundaries
git diff --check
```

## Current Row Tie-Breaker Identity

S05-A's exact 16-byte row tie-breaker is now the UUID-byte projection frozen by
Replacement Document ID V1. Index ordering remains raw-byte ordering after the
encoded field tuple. UUID generation time, version, insertion locality, and the
public textual form do not create a second ordering contract.

## Persist Authenticated Table-Owned Creation-Time Definitions

Previous completed checkpoint: `478137e` Broaden standing code reviewers.

Previous completed FlarexDB checkpoint: `268cc83` Prepare app schema catalog
publication.

What changed:

- Derived the complete ordered set of opaque per-table intrinsic tokens from
  D2a's authenticated C2/D1 state. Canonical creation-time bytes and digest are
  reused rather than accepted from a caller or recomputed.
- Added a per-token caller-owned-transaction writer that verifies the exact
  bound app table under the deployment lock, shares C3's deployment-wide
  physical-ID allocator, and exactly creates/replays the table-owned definition.
- Correlated access owner and storage owner in the shared type model and kept
  intrinsic/developer result discriminants exact.
- Kept `logical_index_id` null and wrote no schema binding or build row.
  PGlite covers replay, stale parent identity, collision, and rollback;
  PostgreSQL 18.3 covers concurrent replay plus existing developer regressions.

Why it changed:

The D1 intrinsic requirement was complete but not persistable. A raw intrinsic
spec writer would create caller authority, while table-ID-only validation could
attach a stale planned ID to the wrong table. D2b binds canonical evidence and
the expected logical name behind repository-authenticated identity.

Convex references inspected:

- `crates/database/src/bootstrap_model/table.rs`
- `crates/common/src/types/index.rs`
- `crates/common/src/bootstrap_model/index/database_index/indexed_fields.rs`
- `crates/database/src/bootstrap_model/index.rs`
- `crates/indexing/src/index_registry.rs`

How Flarex differs:

Convex creates enabled `by_creation_time` metadata with a new empty table.
Flarex persists only immutable control definition identity here; D3/D4 retain
build and readiness authority, and direct row identity still satisfies `by_id`.

Known limitations and follow-up:

- D2c must consume every intrinsic and developer requirement and exactly verify
  the full control projection. D2b neither loops the set nor publishes the
  artifact.
- No entries, backfill, planner, readiness, activation, adapter schema, or
  Cloudflare behavior changed.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol exec vitest run test/index-definition.test.ts --no-file-parallelism
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/appCreationTimeIndexDefinitions.test.ts test/appIndexDefinitions.test.ts --no-file-parallelism
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/appIndexDefinitions.postgres.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm check:effect-boundaries
git diff --check
```

## Couple The Complete Index Set To One Publication Attempt

Previous completed checkpoint: `423ba8a` Compile app schema catalog
requirements.

What changed:

- D2a now derives stable table/index bindings, recompiles the complete D1
  developer plus intrinsic creation-time requirements, and prepares the exact
  full manifest artifact as one authenticated no-write unit.
- The input cannot carry caller-selected physical specs, definition IDs,
  activation flags, lifecycle, readiness, or precompiled requirements. The
  opaque token exposes none of its coupled index state.
- Focused PGlite tests cover full-set coupling, impossible index fields,
  unknown ID targets, immutable snapshots, token forgery, and zero definition,
  binding, or build-state writes.

Why it changed:

Publishing developer indexes without the intrinsic creation-time set, or
mixing requirements with a different stable-ID plan, would create a normalized
projection that cannot be proven from its immutable source artifact. D2a makes
that invalid composition unavailable to later package code.

Convex references inspected:

- `crates/application/src/lib.rs`
- `crates/model/src/components/config.rs`
- `crates/database/src/bootstrap_model/schema/mod.rs`
- `crates/database/src/bootstrap_model/table.rs`

How Flarex differs:

Convex prepares pending index metadata in the same integrated database as its
schema. Flarex first creates a process-local authenticated control-catalog
attempt; D2c later persists the exact projection, while D3 separately
reconciles located build rows.

Known limitations and follow-up:

- At the D2a checkpoint, C3 still wrote only developer definition/binding pairs
  and D2b had not yet added the table-owned `by_creation_time` definition path.
- No definition allocation, build transition, entry fanout, backfill, query
  planning, readiness, activation, or adapter schema generation changed.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/appSchemaPublicationPreparation.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm check:effect-boundaries
git diff --check
```

## Compile The Complete App Physical-Requirement Set

Previous completed checkpoint: `e383e39` Fence per-scope index build state.

What changed:

- Added a pure D1 compiler that validates every developer index field against
  its table validator with Convex's `can_contain_field` semantics and own-field
  lookup rather than inherited JavaScript prototype properties.
- Derived canonical physical evidence for one `by_creation_time` access per app
  table and every developer logical binding. Results are deterministic, frozen,
  and always required for later activation. `by_id` produces no physical
  definition/build requirement.
- Recursively checks ID validator targets against the closed app-v1 table set
  plus intrinsic `_storage`. Caller-selected specs, physical IDs, activation
  flags, and build/readiness state are rejected by the strict manifest decoder.

Why it changed:

One-index C3 preparation proved a single definition but could not prove that a
full schema contained every required developer and intrinsic access path.
Freezing the complete pure set prevents D2 from publishing a partial projection
or trusting caller-composed physical evidence.

Convex references inspected:

- `crates/application/src/lib.rs`
- `crates/common/src/schemas/mod.rs`
- `crates/common/src/schemas/validator.rs`
- `crates/database/src/bootstrap_model/table.rs`
- `crates/common/src/bootstrap_model/index/database_index/index_state.rs`
- `crates/indexing/src/index_registry.rs`

How Flarex differs:

- Convex injects creation time and persists pending index metadata in its
  integrated database. Flarex D1 derives canonical evidence only; D2 publishes
  control rows and D3 reconciles per-scope build rows.
- Convex may allow undeclared tables outside an enforced schema. Flarex app-v1
  fails closed except for `_storage`; later namespaces must extend the policy
  with explicit source-driven contracts.

Known limitations and follow-up:

- D1 allocates no definition ID and writes no definition, schema binding, or
  build row. D2 must recompile its authenticated manifest and verify exact
  owner plus canonical bytes; it must not accept D1 output as write authority.
- There is no entry writer, backfill, query planner, readiness calculation,
  analyzer route, Payload/Medusa integration, Cloudflare deployment, or legacy
  rewiring.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol exec vitest run test/app-schema-catalog.test.ts --no-file-parallelism
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-protocol build
corepack pnpm check:effect-boundaries
git diff --check
```

## Fence Per-Scope Physical Index Builds

Previous completed checkpoint: `37c522b` Persist immutable index definitions.

What changed:

- Added data-plane `fx_system_index_build_state` with scoped physical-definition
  identity, exact storage generation/fence/epoch/start snapshot, closed
  lifecycle, positive signed-int64 attempt fence, and exact cursor codec v1.
- Defined cursor v1 as the exclusive last committed 16-byte row identity in an
  ascending snapshot scan. Removed the earlier unbounded JSON cursor and
  rejected cursors during `declared`/`building` preparation.
- Added a one-statement clock-anchored point read returning frozen
  `absent | current | stale` results with a lifecycle-discriminated build
  record. Exact mismatch fields are visible, missing
  clock authority fails, and start snapshots cannot lead the clock. Currency is
  deliberately separate from `enabled`/readiness.
- Kept all build mutation absent. Tests use raw fixtures to prove DDL/read
  behavior without accidentally creating a standalone lifecycle writer.

Why it changed:

The earlier control-table sketch combined deployment catalog and scope runtime
authority and could not work in database-per-scope placement. A local clock
parent plus explicit historical pin lets stale workers stop without blocking a
clock cutover or fabricating a second deployment authority.

Convex references inspected:

- `crates/common/src/bootstrap_model/index/database_index/index_state.rs`
- `crates/indexing/src/index_registry.rs`
- `crates/database/src/bootstrap_model/index.rs`
- `crates/database/src/bootstrap_model/index_backfills/types.rs`
- `crates/database/src/bootstrap_model/index_backfills/mod.rs`
- `crates/database/src/database_index_workers/index_writer.rs`
- `crates/database/src/database_index_workers/mod.rs`

How Flarex differs:

- Convex keeps definition state and progress under one database worker lease.
  Flarex must pin located Postgres authority explicitly because control and data
  may be separate and Cloudflare workers are distributed.
- Flarex's `building` phase is only pre-backfill physical/write-fanout
  preparation. Like Convex pending indexes, no non-enabled phase may serve app
  queries.

Known limitations and follow-up:

- S03-D still owns control-definition verification, split-store reconciliation,
  progress checkpoints, transitions, validation/readiness, and publication.
  S10 owns entry tables and exact snapshot/current range reads only.
- No builder, backfill, active-schema planner, analyzer/compiler, Payload/Medusa,
  Cloudflare deployment, or legacy rewiring changed.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/indexBuildStates.test.ts test/pglite.test.ts --no-file-parallelism
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/indexBuildStates.postgres.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm check:effect-boundaries
git diff --check
```

## Persist Immutable Physical Index Generations

Previous completed checkpoint: `6ac7286` Freeze ordered index key codec.

What changed:

- Added a separately branded deployment-local physical definition ID and an
  exact canonical representation of the accepted app ordered-index spec.
  Public read evidence is immutable branded hex, while Postgres stores bounded
  bytes/digest plus size-bounded strict JSON.
- Added immutable `fx_control_index_definition` rows. Developer generations are
  owned by the matching stable logical index/table tuple; intrinsic
  `by_creation_time` generations are table-owned without fake logical IDs.
  Direct `by_id` has no definition because it uses only row identity.
- Added developer schema-version bindings with a composite foreign key proving
  the chosen definition belongs to that exact logical index. Exact specs reuse
  a definition across schema versions; changed specs receive a new generation
  while the old one remains addressable.
- Added an internal caller-owned transaction operation that derives the physical
  spec, canonical bytes, SHA-256, required activation flag, and physical ID.
  Public APIs expose only decoded reads; there is no standalone allocation or
  definition reservation route. It preflights an existing schema binding before
  inserting and compares prepared evidence without hashing under the lock.
- Added PGlite and PostgreSQL 18.3 proofs for migration, replay, coexistence,
  ownership, corruption, exhaustion, rollback, and concurrent competition.

Why it changed:

The logical descriptor must remain stable when fields change, but physical
entries/builds cannot collide during replacement. The previous all-non-null
logical-owner sketch also contradicted the accepted intrinsic creation-time
path. The discriminated owner and separate generation ID fix both issues before
build-state or entry DDL exists.

Convex references inspected:

- `crates/common/src/types/index.rs`
- `crates/common/src/bootstrap_model/index/index_config.rs`
- `crates/database/src/bootstrap_model/index.rs`
- `crates/indexing/src/index_registry.rs`

How Flarex differs:

- Convex gives each `_index` metadata document an `IndexId` and permits pending
  plus enabled copies of one logical name. Flarex uses a compact Postgres
  physical ID and normalizes immutable spec from mutable per-scope lifecycle.
- Convex materializes system index metadata. Flarex keeps creation-time identity
  table-owned and keeps `by_id` definition-free; the later compiler must verify
  intrinsic requirements against the full schema artifact.

Known limitations and follow-up:

- S03-C4 now owns fenced build state. D1 compiles complete requirements, D2
  owns manifest-to-catalog verification/publication, S10 owns entry history,
  the live-current sidecar, and exact snapshot/current range reads, and O10
  owns indexed read dependencies plus OCC/phantom validation.
- No backfill, enable/retire transition, analyzer, compiler, active-schema
  planner, Payload/Medusa, Cloudflare, or legacy rewiring changed.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/appIndexDefinitions.test.ts test/pglite.test.ts --no-file-parallelism
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/appIndexDefinitions.postgres.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm check:effect-boundaries
git diff --check
```

## Freeze The Replacement Ordered App-Index Codec

Previous completed checkpoint:
`8c9b3ba` Define generated relations and managed schema deploys.

Previous completed index-foundation checkpoint:
`9fe45b5153e1917c6375aff980081cb68acc188a` Persist stable logical index catalog.

What changed:

- Added strict physical lowering for developer indexes and intrinsic
  `by_creation_time`/direct `by_id` paths without changing the C1 logical
  manifest. Trusted creation time is encoded after declared fields; the exact
  16-byte row identity stays separate.
- Added canonical ordered values with immutable branded byte values, strict
  byte encoding/decoding, branded raw versus canonical keys, 2,049-byte bound
  values, `(encodedKey, rowId)` total positions, bounded input preflights,
  typed terminal errors, and half-open range compilation.
- Froze the complete encoded field-tuple ceiling at 2,048 bytes, `binaryUtf8`
  collation, and exact golden vectors. Escaped-prefix regressions prove partial
  endpoints use `0x16`, while exact full tuples use `key || 0x00`.

Why it changed:

A logical descriptor can survive changed fields, but each physical byte/spec
generation must remain immutable while old and new builds coexist. C3 therefore
needs this byte contract before it allocates physical definition identity.

Convex references inspected:

- `crates/value/src/sorting.rs`
- `crates/common/src/index.rs`
- `crates/common/src/query.rs`
- `crates/common/src/interval/key.rs`
- `crates/common/src/bootstrap_model/index/database_index/indexed_fields.rs`
- `crates/application/src/lib.rs`
- `crates/common/src/document.rs`
- `crates/database/src/system_tables.rs`

How Flarex differs:

- Convex encodes its developer ID into the key and its Postgres storage may
  split after a 2,500-byte prefix. Flarex fails closed above 2,048 field bytes
  and orders the separate compact 16-byte row identity afterward.
- Flarex reserves `0x16` as the partial-component endpoint so escaped NUL or
  empty-object-field extensions cannot leak into equality/range results.

Known limitations and follow-up:

- No physical definition/build/entry table, query integration, analyzer field
  extraction, backfill, activation, Payload/Medusa, or legacy rewiring exists.
- `by_id` needs a separate row-ID point/range API. These bounds are transient
  query values, not durable cursors or OCC dependency records.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol exec vitest run test/ordered-index.test.ts --no-file-parallelism
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/orderedIndexKeyCodec.test.ts --no-file-parallelism
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/orderedIndexKeyCodec.postgres.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm check:effect-boundaries
git diff --check
```

## Persist And Plan Stable Logical Index Bindings

Previous completed checkpoint: `3104aa1` Freeze logical index manifest
contracts.

What changed:

- Added `fx_control_index` with deployment-local positive logical IDs, unique
  `(deployment_id, table_id, descriptor)` identity, and a composite foreign key
  to the stable table catalog.
- Added generic read-only catalog lookups while keeping allocation internal and
  refusing a standalone reservation API.
- Added one opaque app-schema plan that binds indexes only through its exact
  prospective table plan, allocates missing IDs by `(tableId, descriptor)`,
  preserves logical IDs when fields change, and emits ID-ordered frozen logical
  bindings.
- Revalidation runs under the deployment lock and treats changed bindings,
  changed frontiers, and any partial application across both catalogs as typed
  stale outcomes. Exact complete replay is idempotent.

Why it changed:

Logical identity must be durable before full artifact publication, but it must
remain independent of physical spec generations. The combined plan gives the
full app-schema publisher canonical stable IDs without letting callers reserve
them or pair an index plan with table IDs from a different attempt.

Convex references inspected:

- `crates/common/src/types/index.rs`
- `crates/common/src/schemas/mod.rs`
- `crates/common/src/bootstrap_model/index/index_config.rs`
- `crates/database/src/bootstrap_model/index.rs`
- `crates/database/src/bootstrap_model/schema/mod.rs`
- `crates/database/src/writes.rs`
- `crates/database/src/committer.rs`
- `crates/database/src/database.rs`

How Flarex differs:

- Convex's logical identity is the ordered table/descriptor name and physical
  incarnations are `_index` metadata documents. Flarex maps that logical name
  to a compact numeric ID; S05-A now freezes its codec, while C3 still chooses
  physical definition identity/DDL.
- Convex persists `by_id` and `by_creation_time` metadata automatically.
  Flarex v1 keeps both intrinsic; C2 writes no rows and consumes no logical IDs
  for them. C2 keeps developer fields logical; S05-A now owns their separate
  physical lowering.

Known limitations and follow-up:

- No physical definition, schema-definition binding, build state, entry row,
  query planner, backfill, readiness, or activation behavior exists yet.
- S05-A is complete; S03-C3/C4 are next. Full-envelope canonical publication
  and stale retry belong to S03-D, not this internal transaction primitive.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/schemaManifestAppSchemaBindings.test.ts test/pglite.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/schemaManifestAppSchemaBindings.postgres.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm check:effect-boundaries
git diff --check
```

## Freeze Logical Index Semantics Before Physical Catalog DDL

Previous completed checkpoint: `636fa50` Register app schema artifacts
atomically.

What changed:

- Added nominal deployment-scoped `CatalogIndexId` for stable logical access
  paths and a strict unbound developer-index declaration contract.
- Added closed, ID-ordered `indexBindings` plus the composite `appSchema`
  semantic envelope. The existing table-only publication API is unchanged.
- Ported Convex descriptor, field-path, duplicate-spec, quota, implicit `_id`,
  and appended `_creationTime` rules. `by_id` and `by_creation_time` are
  intrinsic app-table paths and reserved from developer declarations.
- Corrected the replacement design: physical entries and build state require a
  separate immutable definition-generation identity. They must never key only
  the stable logical ID.

Why it changed:

Convex can keep one enabled and one pending physical index with the same
developer name while a changed field spec backfills. The old one-ID Flarex
sketch would collide those entries. A semantic checkpoint before DDL preserves
that coexistence requirement and keeps lifecycle out of immutable specs.

Convex references inspected:

- `crates/common/src/types/index.rs`
- `crates/common/src/schemas/json.rs`
- `crates/common/src/bootstrap_model/index/index_config.rs`
- `crates/common/src/bootstrap_model/index/database_index/indexed_fields.rs`
- `crates/database/src/bootstrap_model/index.rs`
- `crates/indexing/src/index_registry.rs`
- `crates/application/src/lib.rs`

How Flarex differs:

- Convex's logical identity is `(table, descriptor)` and its physical ID is an
  `_index` document ID. Flarex keeps a compact numeric logical ID, but a later
  codec/definition slice must add a distinct compact physical identity.
- The immutable Flarex envelope contains logical bindings only. Physical codec,
  build state, backfill, and active-schema query selection are not C1 behavior.

Known limitations and follow-up:

- No index DDL, entry writes, analyzer route, OCC, planner, backfill, activation,
  Payload/Medusa adapter, or Cloudflare behavior changed.
- S03-C2 owns the stable logical catalog/planner. Ordered-key bytes and physical
  definition identity must be frozen before definition/build tables are added.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-protocol exec vitest run test/schema-manifest-index-bindings.test.ts test/schema-manifest-table-definitions.test.ts test/schema-manifest.test.ts --no-file-parallelism
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm check:effect-boundaries
git diff --check
```

## Real Postgres Indexed Freshness Plan Check

Previous completed checkpoint: `51911da` Harden indexed freshness range checks.

What changed:

- Added an optional real Postgres integration check for the indexed freshness
  predicate used by live-query invalidation and index-read OCC validation.
- The test runs in temporary schemas, commits an indexed document write through
  the same persistence API as PGlite, and verifies the SQL plan can use
  `indexes_by_index_id_key_prefix_ts` for:

```sql
deployment_id = ?
and index_id = ?
and key_prefix >= ?
and key_prefix < ?
and ts > ?
```

Why it changed:

The previous PGlite checkpoint proved the range predicate is semantically
correct. Real Postgres must also prove that the planner sees the btree path
the hosted executor depends on before indexed live-query fanout scales beyond
prototype traffic.

Convex references inspected:

- `crates/database/src/reads.rs`
  - index read intervals conflict only with overlapping index writes.
- `crates/database/src/query/index_range.rs`
  - range bounds are part of the recorded read dependency.

Flarex differences:

- Convex validates overlap inside backend read/write-log structures. Flarex
  validates overlap through persisted ordered index bytes and SQL predicates.
- The test is skipped unless `FLAREX_POSTGRES_DATABASE_URL` is set, so default
  local runs remain fast and do not require an external service.

Known limitations:

- This only checks the freshness existence predicate. SQL-pushed-down
  `listDocumentsInIndexAtTs(...)` execution and pagination are still future
  work.
- Search/vector freshness is still not implemented.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/postgres.test.ts --testTimeout=30000
```

## Legacy Prototype Decision (Superseded For Replacement Work)

Indexes are part of the shard-local authoritative database. A document write
must produce index delete entries for the previous value and index insert
entries for the new value.

This section records the implemented Durable Object compatibility prototype.
The accepted replacement makes Postgres authoritative and follows the logical
versus physical index identity contract above; do not use this section as new
catalog or persistence authority.

## Implemented So Far

`PartitionDO` stores:

- `indexes`
- `index_entries`
- `current_index_entries`

On write:

- old index entries are tombstoned in `index_entries`
- old current entries are removed
- new index entries are inserted
- new current entries are upserted
- index writes are copied into `write_log` for OCC checks

Invoke now syncs the target `PartitionDO` schema cache before transaction
begin, so index definitions from `DeploymentDO` are present when mutation
writes commit.

## Convex References

- `crates/common/src/types/index.rs`
  Index definitions and index update shape.
- `crates/database/src/committer.rs`
  `compute_writes` calculates document and index writes together.
- `crates/database/src/reads.rs`
  Indexed read intervals are used for OCC overlap checks.
- `crates/database/src/write_log.rs`
  Write log stores writes by index for efficient stale-read detection.

## Cloudflare Difference

Convex stores binary ordered index keys. Flarex encodes ordered bytes as
lowercase hexadecimal text so SQLite's binary `TEXT` collation preserves byte
ordering while DO requests and write logs remain easy to serialize.

## Known Limitations

- Need reactive pagination page-splitting semantics and query planner behavior.
- Need staged/backfilled index states before production schema changes.
- The codec currently covers JSON-compatible values. Convex `int64`, binary
  bytes, and exact cross-runtime value compatibility still need work.
- Index codec changes require rebuilding existing index entries. Schema
  deployment does not automate that migration yet.
- The generated standalone Worker currently evaluates index predicates through
  a table scan; it preserves API semantics for the prototype but is not the
  authoritative indexed/OCC execution path.

## Last Update

Added Convex-style named index queries:

```ts
await ctx.db
  .query("lessonProgress")
  .withIndex("by_user_lesson", q =>
    q.eq("userId", userId).eq("lessonId", lessonId),
  )
  .collect();
```

The SDK types index names, index field order, equality values, and returned
documents from the generated data model. It provides `collect`, `take`,
`first`, and `unique` consumers.

The authoritative invoke layer now resolves `{tableName, indexName}` through
`DeploymentDO` schema metadata, converts the range into ordered half-open
bounds, and calls `SingleShardTransaction.queryIndex`.
That preserves index read-set recording and OCC overlap validation. Tests now
assert the named query produces the expected `IndexRead`.

Supported in this slice:

- whole-index reads using `.withIndex(name)`
- equality prefixes in index-field order
- `gt`, `gte`, `lt`, and `lte` on the field after the equality prefix
- `collect`, `take`, `first`, and `unique`

Intentionally rejected for now:

- table scans on the authoritative backend
- staged or disabled indexes

Convex references:

- `npm-packages/convex/src/server/database.ts`
- `npm-packages/convex/src/server/query.ts`
- `npm-packages/convex/src/server/index_range_builder.ts`
- `crates/database/src/reads.rs`
- `crates/database/src/transaction.rs`

## Colocated Query Placement Update

Root tables using `partitionBy(field)` now follow the same owner-field query
rule as colocated tables when `field !== "_id"`.

Checkpoint title: `Enforce partitionBy field ownership`

Previous completed checkpoint: `9e60c33` Require colocated query placement
equality.

For a table declared as:

```ts
cartItems: defineTable({
  cartId: v.string(),
  sku: v.string(),
}).partitionBy("cartId")
```

index reads must constrain the owner field:

```ts
ctx.db
  .query("cartItems")
  .withIndex("by_cart_sku", q => q.eq("cartId", cartId).eq("sku", sku))
```

Reads that use only a secondary field are rejected:

```ts
ctx.db.query("cartItems").withIndex("by_sku", q => q.eq("sku", sku));
```

Convex references:

- `npm-packages/convex/src/server/index_range_builder.ts`
- `crates/common/src/query.rs`
- `crates/database/src/reads.rs`

Cloudflare difference:

- Convex indexes are deployment-wide. Flarex owner-field indexes must be
  queried through the selected shard owner because the backend talks to one
  `PartitionDO`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example build
```

## Previous Update

Colocated table index reads now require a placement-field equality before the
query reaches `PartitionDO`.

Checkpoint title: `Require colocated query placement equality`

Previous completed checkpoint: `3326e3f` Enforce colocated placement at
commit.

For a table declared as:

```ts
scores: defineTable({
  userId: v.id("users"),
  score: v.number(),
}).colocateWith("users", "userId")
```

this is valid inside a transaction routed to `partitionKey === userId`:

```ts
ctx.db
  .query("scores")
  .withIndex("by_user_score", q => q.eq("userId", userId).eq("score", 10))
  .collect();
```

These are rejected:

```ts
ctx.db.query("scores").withIndex("by_score", q => q.eq("score", 10));
ctx.db.query("scores").withIndex("by_user_score", q => q.eq("userId", otherUserId));
```

Convex references:

- `npm-packages/convex/src/server/index_range_builder.ts`
  - range builders preserve equality/inequality expression structure.
- `crates/common/src/query.rs`
  - index ranges are compiled from structured equality prefixes.
- `crates/database/src/reads.rs`
  - read sets track indexed intervals for transaction validation.

Cloudflare difference:

- Convex index reads are deployment-wide. Flarex colocated index reads must be
  owner-scoped because the target `PartitionDO` represents only one shard.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example build
```

Cloudflare difference: Flarex resolves names at the Worker/invoke boundary,
then sends the numeric index ID and encoded range to the target `PartitionDO`.
The generated standalone Worker currently scans its local SQLite table as a
prototype fallback. Production execution must use the authoritative invoke/OCC
path rather than treating that scan implementation as the final index engine.

## Ordered Tuple And Range Update

Replaced JSON-string keys with an ordered tuple codec inspired by
`crates/value/src/sorting.rs`:

- ordered value type tags
- sortable IEEE-754 float encoding
- UTF-8 strings with escaped null terminators
- self-delimiting arrays and objects
- a distinct missing-field value
- lowercase hexadecimal storage preserving byte order

Authoritative reads now use half-open intervals, `[lower, upper)`. The range
compiler follows `crates/common/src/query.rs`: equalities form a prefix and an
optional inequality on the next field becomes lower and upper bounds.
`PartitionDO` SQL and OCC write-log checks use the same bounds.

Tests prove numeric and compound tuple ordering, prefix and inequality range
behavior, named invoke range execution, and an OCC conflict when a concurrent
insert enters a mutation's previously read index prefix.

## Stable Cursor Pagination Update

Authoritative index keys now append the document ID after declared index
fields, matching Convex's `IndexKey` shape in `crates/common/src/index.rs`:

```txt
(indexedField1, indexedField2, ..., documentId)
```

This gives every index row a unique total order even when many documents have
identical indexed values.

Added:

- `.order("asc" | "desc")`
- `.paginate({ numItems, cursor })`
- `paginationOptsValidator`
- opaque hexadecimal index-key cursors
- strict cursor advancement after the last returned key
- `numItems + 1` reads to compute `isDone`
- ascending and descending duplicate-key pagination tests

`PartitionDO` returns each document with its authoritative index key, and
`SingleShardTransaction.queryIndexPage` exposes the page plus
`continueCursor`. Paginated reads conservatively record the full requested
index interval in the OCC read set, preserving correctness at the cost of
potentially more conflicts.

This follows Convex references:

- `crates/common/src/index.rs`
- `crates/common/src/query.rs`
- `crates/database/src/query/index_range.rs`
- `npm-packages/convex/src/server/pagination.ts`

Known differences:

- Flarex cursors currently contain only the ordered key and are not signed or
  bound to a query fingerprint. Reusing a cursor with a different query is not
  yet rejected.
- Reactive page splitting, `endCursor`, `splitCursor`, and page status are not
  implemented.
- Existing indexes must be rebuilt when the key codec changes.

Verified with:

```sh
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend test
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

## Postgres Index Freshness Update

Previous completed checkpoint: `ccc5dea` Harden executor sync integration.

What changed:

- Added a Postgres persistence helper that checks whether any durable index
  entry changed after a subscription's observed timestamp.
- Reused the existing ordered index key range bounds instead of introducing a
  parallel freshness key codec.
- Indexed query syscalls now also record returned documents with exact
  `observedTs` values so non-index-field updates to returned rows invalidate
  live queries and mutation read sets.
- Added durable PGlite coverage proving an indexed read set becomes stale only
  when a changed index entry falls inside the subscribed range.

Why it changed:

The local `/sync` executor integration was previously forced through a
table-scan query because index/range freshness was still unsupported. Real
Convex-style apps use `.withIndex(...)` for ordinary list queries, so the
Postgres executor must classify those subscriptions precisely.

Convex references inspected:

- `crates/database/src/reads.rs`
  - `ReadSet` tracks indexed intervals and checks whether committed index
    writes overlap those intervals.
- `crates/database/src/query/index_range.rs`
  - range query execution records the consumed index interval into the
    transaction read set.

Flarex differences:

- Convex keeps subscription invalidation inside the integrated backend read-set
  and write-log machinery. Flarex's Postgres path persists index history and
  asks that history whether an index range changed after the subscription's
  observed timestamp.
- Flarex explicitly combines an index range dependency for membership changes
  with document dependencies for returned-row content changes.
- Memory-only freshness stores still report index reads as unsupported because
  they do not hold durable index-write history.

Known limitations:

- The Postgres helper currently scans candidate index rows in process after a
  timestamp/index filter. It is correct for PGlite and early Postgres work, but
  production needs a tighter SQL range predicate over encoded key bytes.
- Search/vector freshness is still not implemented.
- Paginated query subscriptions conservatively depend on the requested range,
  not a narrower page-specific invalidation model.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/pglite.test.ts --testTimeout=30000
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor exec vitest run test/sessions.test.ts test/liveQueries.test.ts --testTimeout=30000
```

## Indexed Freshness SQL Predicate Update

Previous completed checkpoint: `120dcaa` Implement indexed live query freshness.

What changed:

- Added a Drizzle schema index and migration for
  `(deployment_id, index_id, key_prefix, ts)` on the persisted `indexes` table.
- Changed `hasIndexEntryAfterTs(...)` and the OCC helper
  `hasIndexEntryBetweenTs(...)` to use SQL `key_prefix` lower/upper predicates
  with a key-prefix-first btree path instead of loading all post-read index
  rows and filtering ranges in TypeScript.
- Added PGlite coverage for matching range changes, non-matching ranges,
  deletion/tombstone index changes, and same-key patches that should not create
  index membership changes.

Why it changed:

The previous checkpoint made indexed freshness semantically correct, but its
storage helper still scanned every write to a hot index after the observed
timestamp. Live-query fanout needs the range filter pushed into storage before
more subscription machinery builds on top of it.

Convex references inspected:

- `crates/database/src/reads.rs`
  - `writes_overlap_by_index` narrows conflict checks to writes for the read
    index and interval.
- `crates/database/src/query/index_range.rs`
  - `IndexRange` records the consumed interval through
    `record_indexed_directly`.

Flarex differences:

- Convex checks interval overlap against backend in-memory/index write maps.
  Flarex's Postgres path uses persisted encoded `key_prefix` byte ranges and
  timestamp predicates.
- Flarex keeps document-content invalidation separate from index-membership
  invalidation; same-key patches are covered by returned document reads, not by
  index history rows.

Known limitations:

- Real Postgres query plans still need a production correctness/performance
  lane beyond PGlite.
- `listDocumentsInIndexAtTs(...)` still performs snapshot visibility grouping
  in TypeScript. The freshness/OCC existence checks are now pushed down, but
  query execution itself remains a prototype implementation.
- Search/vector freshness is still not implemented.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres db:generate
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/pglite.test.ts --testTimeout=30000
corepack pnpm --filter @flarex/freshness test
corepack pnpm --filter @flarex/executor exec vitest run test/sessions.test.ts test/liveQueries.test.ts --testTimeout=30000
```
