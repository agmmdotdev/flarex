# Indexes

## Close The Unique Definition Set Before Building It

The first `C08-B1` foundation is implemented privately and remains
production-inert. A canonical protocol value commits the complete ordered set
of schema-version unique definitions by logical identity, physical definition,
stable table, and physical-spec digest. The control catalog closes that exact
set once per schema version under the existing deployment lock. After closure,
exact definition replays remain idempotent but any late or changed binding
fails closed. PostgreSQL stores only this compact authority and its digest, not
application code or artifact bodies.

Migration `0049` adds one immutable control closure and one target-native build
row per `(scope, schemaVersion)`. It deliberately does not create one build row
per constraint. Reconciliation resolves the existing trusted scope authority,
locks the existing scope clock, pins the storage-generation fence, epoch, and
start commit frontier, and creates or re-declares a replay-safe attempt fence.
The row reserves the bounded lifecycle and cursor state that the backfill owner
will advance; this checkpoint does not run a backfill or make the set eligible.

PGlite proves canonical vectors, closure replay, late-binding refusal,
changed-after-prepare rejection, transaction rollback, absent-before-closure,
build replay, stale-fence redeclaration, injected fault recovery, fresh
migration, atomic upgrade rollback, and migration replay. A genuine PostgreSQL
concurrency/rollback/fence suite is present and has a green local PostgreSQL
18.3 receipt after the migration-isolation correction described below.

The second private `C08-B1` checkpoint now performs page-bounded,
frontier-aware backfill through a dedicated replay-safe S11 transaction
primitive. One set-based `(definitionId,rowId)` scan finds immutable candidates
at the accepted start frontier; every candidate is re-read through the current
canonical app-row owner before lowering, so a later update or deletion cannot
be resurrected. Exact current claims replay, absent claims are acquired, and a
duplicate owner, contradictory lineage, lowering failure, or injected fault
rolls back both the page and its cursor. The existing single build row advances
through `declared`, `building`, and `backfilling` and stops at `validating`.
Current scope-epoch authority is authenticated separately from each retained
row revision's historical write-epoch UUID, so an ordinary epoch rotation does
not orphan unchanged rows or rewrite their claim lineage.

The third private `C08-B1` checkpoint now performs an exact page-bounded
validation pass over the union of current rows and S11 claim-only rows. Each
candidate is lowered from canonical current-row evidence and checked through
an S11 transaction primitive that authenticates exact claim identity and
lineage without mutating claim ownership. Bounded owner-index range probes
reject any claim outside the definition's exact locale and table dimensions.
Missing, unexpected, mismatched, or corrupt claims fail closed. Every material
point commit resets all validating schema-version builds for its scope inside
the existing scope-clock transaction, independent of the optional B2 locator,
so old-schema commits, prospective builds, sparse rows, and omitted rows cannot
escape a clean complete pass. A primary-key-ordered cap-plus-one selection
bounds the complete per-scope build directory to 32 rows and fails the entire
commit closed above that ceiling; only non-null validating cursors from that
locked snapshot are rewritten. The reconciliation writer applies the same
bounded directory admission before inserting a missing row, so it rejects row
33 atomically rather than creating a durable write-denial state. Validation faults roll
back the page and cursor;
point-commit faults roll back the cursor reset together with application-row,
claim, commit-feed, and outbox publication evidence.

`C08-B1` remains production-inert. Its private planner-eligibility gate must not
invent a second schema authority or widen the public schema-manifest protocol.
The selected shape is one opaque process-local eligibility facet owned by the
exact B2 point-commit port. It reads the already-closed control set, verifies
the target-native build against the current scope clock, and returns only the
authenticated set digest, table membership, and build pins. The stored-attempt
planner may consume that snapshot without catalog I/O and must reject a B2
maintenance port that lacks the facet or a set that is not enabled. An exact
closed schema-version set with no unique bindings keeps the lower planner path,
while any missing closure or B2
composition with a binding but no closed set, enabled build, or exact facet
fails closed before point-commit SQL.

The separately reviewed readiness folding checkpoint is implemented without a
new receipt, root identity, protocol field, or migration. FSV04 obtains C08-B1
eligibility only through the exact B2 point-commit facet, revalidates the same
opaque evidence after taking its existing target scope-clock lock, and appends
the closed-set digest, exact table membership, scope pins, start commit, and
attempt fence to the existing `enabledBuildRootSha256` preimage. An exact
closed empty set appends no items, preserving the previous root byte for byte.
The facet, readiness catalog, and target-authority resolver must be the exact
same captured objects; independently reconstructed or cross-catalog
compositions fail closed before they can authorize a receipt.
Readiness preparation uses the C08 eligibility reader's dedicated scope-clock
share-lock path, while point-commit planning retains the existing update-lock
path; coherent active reads therefore do not acquire a writer-grade lock merely
to replay readiness.
Stored readiness replay, FSV05 activation, and the coherent active reader carry
the same exact point-commit facet and rerun the same in-transaction validator;
missing closure/build, non-enabled build, and changed build authority fail
closed. The change remains private and production-inert and adds no activation
mutation, route, trigger, alternate OCC/commit owner, or compatibility path.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres test:c08-b1a:pglite
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/persistence-postgres test:c08-b1a:postgres
corepack pnpm --filter @flarex/persistence-postgres test:c08-b1b:pglite
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/persistence-postgres test:c08-b1b:postgres
corepack pnpm --filter @flarex/persistence-postgres test:c08-b1c:pglite
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/persistence-postgres test:c08-b1c:postgres
corepack pnpm --filter @flarex/executor exec vitest run test/storedAttemptAuthentication.test.ts --no-file-parallelism --testTimeout=180000
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/system-test test:fsv04:pglite
corepack pnpm --filter @flarex/system-test test:fsv05:pglite
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm check:effect-boundaries
git diff --check
```

The focused B1C-plus-eligibility PGlite lane passes 98 tests, and the pure
stored-attempt planner lane passes 61 tests. It proves exact capability
anti-forgery, one-time option capture, closed-empty lower-lane preservation,
unclosed-set global refusal, same-object planner/executor composition,
no-material eligibility laziness,
B2-without-eligibility refusal, closed-set/build lifecycle and scope-clock
staleness rejection, affected-table refusal, and eligible planning before any
point-commit SQL. The approved migration-isolation correction below now lets
the genuine-PostgreSQL lane reach its test bodies. A fresh isolated PostgreSQL
18.3 run passes the two direct C08-B0 definition cases and all 26 C08-B1C
build/eligibility/point-commit cases.

### Recorded PostgreSQL Migration-Isolation Defect

During DTE05 final validation on 2026-08-09, the standard genuine-PostgreSQL
temporary-schema helper failed before reaching scheduler-directory behavior.
Migration `0047_nifty_whistler.sql` creates the unique-constraint binding tables
on the helper's active search path but hardcodes its foreign-key parents as
`public.fx_control_schema_version` and
`public.fx_control_unique_constraint_definition`. A fresh disposable
PostgreSQL 18 cluster therefore fails with SQLSTATE `42P01` because those parent
tables exist in the isolated schema rather than `public`.

Expected behavior is replay-safe migration inside the helper-owned temporary
schema. Actual behavior crossed that isolation boundary through the hardcoded
schema qualification. This is a C08-B0 migration-owner defect, not scheduling
authority. Its disposition is **resolved under the separately approved
2026-08-10 migration-portability repair**. Because `flarexdb_v1` is still the
explicitly unshipped, runtime-unreachable first-shippable generation, the
repair corrects the generated history in place: four `0047` and two `0049`
foreign-key parents are now search-path-relative. It changes no table,
constraint identity, snapshot, journal receipt, protocol, transaction owner,
or post-migration application-runtime behavior. A fresh disposable
PostgreSQL 18.3 cluster migrates through both files and passes the two-case
C08-B0 plus 26-case C08-B1C PostgreSQL suites. The corresponding focused
PGlite B1C lane passes 98 cases.

## Maintain Unique Claims In The Existing Point Commit

`C08-B2` now supplies the production-inert lowering and transaction mechanics
that `C08-B1` needs before it can safely reconcile or declare a unique build
ready. A private control-catalog port locates only opaque, process-local
definitions bound to the pinned schema version and touched tables. Point commit
captures that port once, validates the exact scope/deployment/schema identity,
and lowers verified prior/final application documents through the shared
Ordered Index V1 field-path primitive and the existing S11 canonical-key owner.

The existing scope-clock point-commit transaction remains the sole commit
owner. It writes application revisions first, then performs a deterministic
three-phase unique plan: release every changed/deleted prior claim, advance
same-key claims, then acquire every inserted/moved claim. This permits atomic
multi-row key swaps without weakening collision checks. Existing claims must
match the exact prior row commit and canonical key. A missing claim is accepted
only for pre-B1 online convergence; B1 must backfill and validate the complete
required set before readiness. S11 still owns scope/epoch fencing, parent-row
lineage, canonical digest-collision verification, exclusive claim acquisition,
and typed conflicts.

Because S11 currently performs one transaction-local mutation per action,
this first generation caps one commit at 32 definition/row transitions and 64
release/advance/claim actions, materially below the general material-row
ceiling. Exact owner positions are loaded set-wise; no Cartesian table/row
lookup is used. PGlite proves insert, duplicate conflict with full rollback,
same-key advance, move, delete, sparse omission, two-row key swap, capability
capture/anti-forgery, oversized-key refusal, fault after the second unique
write, retry, and the transition ceiling. The genuine-PostgreSQL suite contains insert, move,
second-write rollback/retry, and duplicate-conflict atomicity scenarios and
runs when `FLAREX_POSTGRES_DATABASE_URL` is supplied. O09-B now adds a green
isolated PostgreSQL 18.3 receipt for combined developer-index/unique rollback,
real concurrent claim contention, and delete/reuse.

This checkpoint is deliberately not production composition. The subsequent
private B1 checkpoints close the exact schema-version definition set,
reconcile/backfill all existing rows, validate current S11 ownership, persist
invalidatable build evidence, and bind planner eligibility to the exact B2
point-commit capability. They do not widen the public Standard schema manifest.
The lower O07/C07 lane remains available when B2 is absent or the exact closed
schema-version set has no unique bindings. No revision readiness, activation, active
reader, route, trigger, query authority, alternate OCC/commit owner, schema
change, or migration is added here. `O09-B` still owns real contention/stress
acceptance beyond these bounded functional proofs; that acceptance is now
complete without changing the C08-B2 owner.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres test:c08-b2:pglite
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/persistence-postgres test:c08-b2:postgres
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm check:effect-boundaries
git diff --check
```

## Bind Immutable Unique-Constraint Definitions Without Enforcing Them

`C08-B0` establishes the production-inert authority that later unique
lowering needs. The first generation accepts only ordered, non-localized app
field paths plus an explicit sparse policy. It commits the exact Ordered Index
V1 component codec identity/version into canonical bytes and SHA-256 evidence.
Localized constraints remain unrepresentable and therefore fail closed until
their locale owner is designed.

Migration `0047` adds three compact control relations with no user-code or
artifact bodies: one stable deployment/table/descriptor identity, immutable
physical generations, and schema-version bindings. This separation is
intentional. A logical constraint can keep its identity while a later schema
version changes ordered fields or sparse policy, and old/new physical
generations can coexist during a future reconciliation gate. S11 claim IDs are
now the exact physical definition IDs rather than a parallel local brand.

The private repository prepares canonical evidence outside SQL, mints an
opaque process-local token, locks the existing deployment catalog lane, checks
the real schema/table parents, allocates IDs only inside the caller's
transaction, and treats exact replay as idempotent. It creates no claim,
backfill/build/readiness row, active head, route, or commit hook. `C08-B2` now
owns the private point-commit lowering mechanics through S11. `C08-B1` still
owns reconciliation/backfill/validation, invalidatable readiness evidence, and
the closed required-definition gate; `O09-B` now supplies the completed
contention/stress acceptance.

Focused PGlite coverage proves canonical replay, changed-generation
coexistence, conflicting binding refusal, forged-token refusal, migration
replay, and three-table rollback. The genuine PostgreSQL suite contains exact
concurrent replay and rollback proofs and runs when
`FLAREX_POSTGRES_DATABASE_URL` is supplied.

## Build And Maintain Relation-Free Intrinsic And Developer Indexes

What changed:

- The private `C08-I1` composition locates the authenticated table-owned
  `by_creation_time` definition and maintains its S10 revision/current chain in
  the existing O07-B point-commit transaction for every material final-row
  transition. Live inserts, patches, and replacements publish the exact
  same-commit app-row revision; deletes tombstone the prior index head. A
  missing prior head is valid only for online-build convergence, while an
  existing head must retain exact prior app-row and index lineage.
- A bounded private builder uses the existing C4 row and short transactions
  only. It locks the located scope clock, then the exact build row, scans the
  immutable app-row history at the accepted start frontier in row-ID order,
  revalidates current rows before publishing, and advances declared through
  building, backfilling, validating, and enabled. Validation also runs in
  bounded row-ID pages with exact S10 current-entry verification. Any relevant
  point commit during validation resets the stored cursor in its same commit,
  so an insert or change behind that cursor forces a complete new pass before
  enabled can be reached.
- Point commits maintain the intrinsic sidecar from the declared frontier, so
  a row updated or deleted before its backfill page cannot be resurrected and
  an online insert behind the cursor remains visible to exact validation. Page
  writes, cursor/lifecycle settlement, rollback, retry, and replay stay inside
  the existing target transaction. The page ceiling is 16 rows and the genuine
  PostgreSQL proof exercises that ceiling. Migration `0042` adds only the
  non-unique `(scope_uuid, index_definition_id, row_id)` access path required
  by that resumable validation scan; populated-data upgrade and a
  larger-cardinality PostgreSQL `EXPLAIN` prove the row survives and the real
  predicate/order uses the index with the normal planner configuration. No
  lease, unbounded application materialization, or parallel builder authority
  was added.
- `C08-A` adds the first real consumer of published developer definitions. A
  private pre-transaction adapter verifies the pinned schema's immutable
  bindings and locates only definitions for touched tables. The existing O07-B
  transaction then batch-locks their C4 build rows, verifies prior canonical
  app-row evidence, lowers prior/final Ordered Index V1 keys, and appends the
  existing S10 chains. Inserts and same-key updates publish live revisions,
  moves tombstone the prior key and publish the new key, and deletes tombstone
  the prior key. Entry actions are canonically ordered and capped at 256 per
  commit. Enabled builds require exact prior lineage; validating builds are
  invalidated in the same transaction. The planner retains its former typed
  rejection unless the exact point-commit port was constructed with the
  private C08-A maintenance dependency; structural copies and host literals do
  not confer that authority.

Known limitations and follow-up:

- Intrinsic and developer-index maintenance are implemented for the
  relation-free Standard application path. Unique lowering mechanics are now
  implemented privately in C08-B2, B1 readiness/backfill and O09-B contention
  proof are complete, while relations, index queries, and phantom OCC remain
  open.
- Enabled is physical build evidence only. S03-D4 readiness, activation,
  active-reader authority, SAP04, routing, and production triggers remain
  separate unopened gates.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres test:c08-i1:pglite
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/persistence-postgres test:c08-i1:postgres
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/storedAttemptEvidence.test.ts --no-file-parallelism --testTimeout=180000
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/pointCommitTransaction.postgres.test.ts --no-file-parallelism --testTimeout=180000
corepack pnpm --filter @flarex/executor exec vitest run test/storedAttemptAuthentication.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres test:pglite:migrations
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm check:effect-boundaries
git diff --check
```

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

- S11 owns private target-native unique claims; S03-D3 still owns build
  reconciliation; C08-I1 owns intrinsic creation-time population and
  maintenance; C08-A owns developer-index final-row lowering; C08-B2 owns
  private unique final-row lowering inside the existing commit; C08-B1 owns
  unique reconciliation/readiness; O09-B has completed unique contention and
  complete sidecar contention/rollback integration; and O10 owns indexed
  dependencies and phantom validation.
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
  to a compact numeric ID and currently deduplicates immutable physical
  definitions by deployment, logical owner, and physical-spec digest. Target
  sidecars, build state, readiness, transaction journals, and point commits use
  that definition ID directly; there is no separate target-local incarnation
  key. `M05-X0` therefore adopts Convex's logical-removal-first policy but
  rejects adding fresh-incarnation plumbing as an incidental cleanup change.
  Such a change requires its own index/OCC and unique-claim contract preflight.
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

## Replacement Indexed Mutation OCC Authority

The accepted replacement contract is now
[`flarexdb-foundation/06-indexed-range-occ.md`](./flarexdb-foundation/06-indexed-range-occ.md).
It owns O10's first exact ascending developer-index `take(n)`, canonical
consumed composite `(encodedKey, rowId)` interval, complete staged
read-your-writes overlay, S10 history validation, and existing O08 conflict
replacement.

The historical freshness and legacy invoke-session work below remains useful
comparison evidence, but it is not replacement implementation authority. In
particular, O10 must not reuse:

- wall-clock `beginTs` or legacy numeric `ts` as `SnapshotToken.commitSeq`;
- `invoke_session_index_reads` or the legacy `indexes`/write-log tables;
- full-requested-range pagination invalidation when only a consumed prefix was
  observed;
- the legacy in-process full-range overlay and sort; or
- the old key-prefix query-plan receipt as evidence for S10's
  `(scope, definition, encodedKey, rowId, commitSeq)` history.

O10-PF2 has now produced genuine-PostgreSQL 18.3 post-snapshot-overlap plans
against populated S10-shaped history. It retains the existing key-first index
for snapshot pages and selects the supporting order
`(scope_uuid,index_definition_id,commit_seq,encoded_key,row_id)` for bounded
history validation, with a conservative 128-commit span and a 32-dependency
ceiling. Exact measurements, query-shape cautions, and the required O10-P0
shared read-admission prerequisite live in the owning foundation roadmap. Do
not introduce a second index-membership store, global range-version hotspot,
alternate commit lane, or dual-write bridge.

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
