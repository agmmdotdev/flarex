# FlarexDB Schema And Migration Plan

Status: S01 through S02-C, resolve-only S02-D1, catalog checkpoints S03-A
through S03-D2b, and the interleaved S05-A ordered-index prerequisite are
complete. Hosted-proof H01-H04 and H05-A are complete, while H05-B and S02-D2
production routing are deferred as core work proceeds to S03-D2c.

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
- In the replacement shared-database schema, store trusted scope and epoch
  components as native Postgres `uuid`; branded `scope_<uuid>` and
  `epoch_<uuid>` values remain boundary representations. Migration code owns a
  reversible mapping and does not rewrite public identifiers.
- Use compact numeric physical keys for hot stable catalog identities. Keep an
  additional opaque UUID only where a catalog identity must be globally
  portable. Do not repeat wide catalog strings through every app-side index.
- Preserve opaque, table-qualified developer document IDs using a compact table
  key plus 16-byte internal identity. The generator choice remains a gated
  Convex-port-versus-UUIDv7 decision; UUIDv7 is not accepted as a substitute for
  commit cursors or explicit ordering.
- Compile Payload and Medusa identity types from their real schemas. A wide
  adapter-owned external ID may use a compact physical surrogate, but its
  external uniqueness and round-trip identity must remain intact.
- Ordered pagination indexes end in a unique row tie-breaker. Every secondary
  index needs a named access-path owner, and the ordered-key codec enforces a
  maximum B-tree-safe encoded size.
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
- V1 keeps stable table/index identities. The immutable manifest is the only
  versioned table-definition source; do not add a table-definition projection.
  Index definitions are intentionally normalized in S03-C. Stable relation and
  constraint IDs remain a design gate until a real compiler contract defines
  their semantics. `R01` and `R02` now own that relation gate before `S12`; do
  not manufacture opaque IDs or optional JSON placeholders.
  Physical field, constraint-definition, and relation-definition catalogs
  remain deferred until a real compiler or adapter requires them.
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
  - [x] S02-D1 — Add the host-neutral read-only authority resolver for shared
    and ready split placements without routing executor traffic.
  - [ ] S02-D2 — Compose the resolver into persisted session execution,
    remove the compatibility alias, and enable production routing only after
    H05-B closes the hosted activation gate.
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
C2 may expose an explicit inventoried bootstrap repair. The compatibility
provisioner currently emits `scope_<lowercase uuid-v4>` and
`epoch_<lowercase uuid-v4>` boundary identifiers behind the trusted factory.
That implemented representation is not the replacement physical schema: future
shared Postgres tables decode the trusted UUID components into native `uuid`
columns while preserving the public values through a reversible mapping. The
general brands remain non-empty strings for controlled imports and tests.

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

S02-D1 now resolves a deployment through its persisted scope metadata and the
current data-plane clock. Every topology uses an exact locator-bound target.
Split placement first requires the matching `ready` receipt, then reads a
clock for the same scope from that target. The result preserves the actual
generation, generation fence, epoch, and counters;
missing or inconsistent metadata never becomes an implicit `legacy_v1`.

This checkpoint deliberately does not compose `createFlarexExecutor`, replace
the persisted-session compatibility alias, issue snapshots, or route reads and
writes. The live H05-B activation proof is deferred with deployment work and
still gates S02-D2 production routing. It does not block S02-D1 or the next
unrouted, additive S03-S05/O01 core turns.

S02-B, S02-C, and S02-D1 are deliberately host-neutral. They add, bootstrap,
and resolve trusted database authority without composing a production runtime.
Before S02-D2, a separate proof must bundle the framework-neutral executor
into the dedicated private `flarex-executor` Cloudflare Worker, use a
request-scoped Postgres
client through cache-disabled Hyperdrive, exclude filesystem migration/PGlite
code from the Worker import graph, and pass a real-Postgres service-binding
smoke. Failure of that proof blocks S02-D2 production runtime routing, not the
read-only S02-D1 resolver, additive clock/catalog DDL, or repositories.

S02-A fixed the compatibility bootstrap ID convention before any rows are
backfilled: the trusted control plane currently issues `scope_<uuid-v4>`
boundary identifiers using lowercase RFC 4122 UUID text. The value is opaque
and stable; it is never derived from deployment, project, tenant, topology, or
database names. S02-C1 now also fixes initial epochs as opaque
`epoch_<uuid-v4>` boundary values and owns generation plus idempotent insertion
under the unique deployment mapping. Replacement DDL stores their decoded UUID
components natively; this does not change the external identifier contract.
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

Progress:

- [x] S03-A — Persist deployment-scoped stable table identities, expose
  transaction-only idempotent allocation and deployment-qualified point reads,
  and prove the additive migration without schema-version or index-catalog
  behavior.
- [x] S03-B1 — Persist immutable schema-version artifacts, canonical manifest
  bytes, and SHA-256 checksums without lifecycle or activation behavior.
- [x] S03-B2 — Bind stable table identities to immutable versioned table
  definitions without a second persisted definition copy.
  - [x] S03-B2a — Freeze the strict, composable app-document table-definition
    section and deterministic ordering/uniqueness rules.
  - [x] S03-B2b — Resolve/allocate stable catalog IDs, verify name bindings,
    assemble the section deterministically, and persist the existing B1
    artifact.
    - [x] S03-B2b1 — Prepare an opaque deterministic binding plan and add the
      transaction-only stale-check/exact-ID application primitive.
    - [x] S03-B2b2 — Canonicalize the planned section outside SQL, then apply
      the plan and insert/replay the B1 artifact atomically with bounded stale
      retries.
- [x] S03-C — Add stable logical index identities, immutable physical index
  definitions, and per-scope build state.
  - [x] S03-C1 — Freeze strict unbound developer-index declarations, branded
    logical index identity, and the closed composite app-schema envelope.
  - [x] S03-C2 — Add the deployment-scoped stable logical index catalog and
    opaque table/index optimistic planner without a standalone reservation API.
  - [x] S03-C3 — With S05-A complete, add immutable physical
    definition/schema-binding DDL and choose a compact definition-generation
    identity that permits old/new builds to coexist.
  - [x] S03-C4 — Add fenced per-scope build-state DDL/read contracts; mutation
    and reconciliation remain S03-D3 work.
- [ ] S03-D — Compile, publish, reconcile, and verify normalized catalog state
  before activation.
  - [x] S03-D1 — Purely verify the bound app manifest and derive the complete
    canonical developer plus intrinsic creation-time requirement set.
  - [ ] S03-D2 — Prepare, publish, and exactly verify the full immutable
    artifact and its normalized control-catalog projection.
    - [x] S03-D2a — Compose one strict unbound C2 binding plan, D1 requirement
      set, and exact full-manifest artifact into a process-local authenticated
      no-write token.
    - [x] S03-D2b — Derive identity-only table-owned `by_creation_time` tokens
      from authenticated D2a evidence and ensure/replay each definition through
      the shared C3 allocator after exact locked table-parent verification.
    - [ ] S03-D2c — In one caller-owned control transaction, revalidate/apply
      the C2 plan, insert/replay the artifact, persist every required definition
      and schema binding, and exactly verify the projection.
    - [ ] S03-D2d — Add bounded whole-preparation stale retry, the routed V2
      facade, canonical-byte/platform quota, and real-Postgres
      whole-publication concurrency/rollback proof.
  - [ ] S03-D3 — Reconcile required definitions into located per-scope build
    state through a durable idempotent protocol.
  - [ ] S03-D4 — Persist validation evidence and compute readiness from real
    row/index backfill results; do not mutate the active pointer.

Outcome:

- Add `fx_control_schema_version` with an immutable manifest, canonical bytes,
  checksum, and deployment ownership. D4 validation evidence and build
  lifecycle remain separate; neither adds mutable status to this artifact.
- Add stable `fx_control_table` and logical `fx_control_index` identities.
- Add relation and constraint IDs only after their source-driven semantic
  contract is accepted; B2a deliberately does not invent them.
- Add a separate physical definition-generation identity, immutable
  `fx_control_index_definition`, and fenced per-scope
  `fx_system_index_build_state`. Stable logical index ID alone must never key
  entries or builds.
- Compile the bound manifest before SQL, then publish and verify the normalized
  control catalog against its authenticated artifact; do not independently
  edit normalized rows or accept caller-authored compiled evidence.
- Keep plan application internal until B2b2 composes it with artifact insertion;
  never publish naked ID reservations as a successful schema operation.
- Gate readiness only after required index backfill/validation succeeds; S04
  alone mutates the active-schema pointer.

Exit gate:

- stable table/logical-index IDs survive multiple schema versions, and any later
  relation/constraint IDs pass their own semantic-identity gate;
- cross-deployment foreign keys and activation are rejected;
- exactly one scope pointer is mutable authority;
- field/relation physical catalogs have not slipped into the first migration.

#### S03-A Implementation Checkpoint

Previous completed checkpoint: `9b924dd` Resolve trusted scope authority.

What changed:

- Added the branded positive signed-32-bit `CatalogTableId` contract and the
  closed `app | payload | medusa | system` namespace contract under the
  internal catalog protocol subpath.
- Added additive `fx_control_table` with primary key
  `(deployment_id, table_id)` and unique
  `(deployment_id, namespace, logical_name)`. Database checks enforce parent
  ownership, compact positive IDs, accepted namespaces, and nonblank names.
- Added a transaction-only allocator that accepts no table ID, locks the owning
  deployment, replays an existing name mapping, and otherwise appends the next
  deployment-local ID. Rollback consumes no identity.
- Added deployment-qualified point reads by compact ID and namespace/name. No
  allocator was added to the general runtime persistence facade.
- Added PGlite contract, constraint, rollback, and no-backfill upgrade coverage
  plus a real-Postgres concurrent replay test.

Why it changed:

Stable table identity must outlive any one schema manifest. The current
analyzer derives ordinals from sorted table names, so adding an earlier name can
renumber later tables. Those version-local ordinals cannot become catalog
authority.

Convex sources inspected:

- `crates/database/src/bootstrap_model/table.rs`
- `crates/database/src/bootstrap_model/schema/mod.rs`
- `crates/common/src/bootstrap_model/schema_state.rs`

How Flarex differs:

- Flarex qualifies the compact numeric identity by deployment in a shared
  Postgres control plane and serializes allocation with a parent-row lock.
  Convex maintains its table mapping inside its transactional metadata model.
- Flarex makes the four accepted adapter namespaces explicit. They reserve
  identity domains but implement no Payload or Medusa behavior.
- Each deployment-local sequence currently starts at `1`; this slice does not
  copy Convex system-table number ranges. Any reservation must be an explicit
  decision before app document IDs depend on it.

Known limitations and follow-up:

- S03 remains open. There is no schema-version row, canonical manifest/hash,
  versioned table definition, stable index/relation/constraint identity, index
  build state, compiler, validation, or activation.
- The analyzer and executor do not populate or consume this catalog yet.
- No rename, retirement, deletion, or privileged-SQL immutability policy is
  defined. The repository exposes only ensure/read operations.
- No OCC, codec, app-row storage, commit compiler, sync, Payload, Medusa, or
  Cloudflare deployment behavior changed.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/stableTableCatalog.test.ts test/pglite.test.ts --no-file-parallelism
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/stableTableCatalog.postgres.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm check:effect-boundaries
git diff --check
```

#### S03-B1 Implementation Checkpoint

Previous completed checkpoint: `54f0022` Persist stable table identities.

What changed:

- Added branded schema-version identity, positive signed-32-bit version,
  manifest-codec version, canonical-byte, and 32-byte SHA-256 contracts under
  the focused `flarex-protocol/schema-manifest` subpath.
- Froze manifest codec v1 as a domain-separated JSON envelope with
  locale-independent UTF-16 object-key ordering, preserved array order, strict
  JSON input validation, UTF-8 bytes, and Web Crypto SHA-256. The hash input is
  those canonical bytes, never PostgreSQL `jsonb` serialization.
- Added the deployment-owned `fx_control_schema_version` artifact table with
  deployment-qualified identity and version uniqueness, codec version,
  semantic `jsonb`, canonical `bytea`, checksum `bytea`, creation metadata,
  restrictive deployment ownership, and no status or active pointer.
- Added transaction-only idempotent insertion plus deployment-qualified point
  reads. Exact artifacts replay; identity/version reuse conflicts fail typed;
  and equal hashes with unequal bytes fail as collisions. Full point reads
  re-encode stored JSON and verify both bytes and checksum outside the locked
  write phase.
- Final review hardened the codec against array subclasses/replaced prototypes
  and removed dispatch through input-owned array methods. Repository-owned
  preparation now validates, canonicalizes, and hashes before SQL begins,
  returns an opaque token to the transaction-only phase, and distinguishes
  invalid manifests from operational preparation failures.
- The final review also made created-result byte arrays defensive copies and
  kept canonicalization/Web Crypto out of the deployment-lock phase.
  Transactional replay compares stored codec/byte/digest evidence; the explicit
  point-read APIs remain the full JSON integrity audit.
- Added protocol edge-case and golden-vector tests, PGlite repository,
  constraint, rollback, corruption, isolation, and additive-upgrade tests, plus
  real-Postgres concurrent replay/conflict proofs in a non-public schema.
- Aligned the higher-authority internal-schema and v1-cutline sketches with the
  accepted deployment-owned artifact, retained canonical bytes, raw digest,
  deferred lifecycle state, and sole future scope activation pointer.

Why it changed:

Later table definitions, indexes, compilation, validation, and activation need
one immutable source artifact whose identity and bytes survive retries and
PostgreSQL JSON normalization. Persisting only that source keeps S03-B1 small
and prevents lifecycle state or normalized rows from becoming a second schema
authority.

Convex sources inspected:

- `crates/common/src/bootstrap_model/schema_metadata.rs`
- `crates/database/src/bootstrap_model/schema/mod.rs`
- `crates/common/src/bootstrap_model/schema_state.rs`
- `crates/application/src/schema_worker/mod.rs`

How Flarex differs:

- Convex compares typed `DatabaseSchema` values inside its metadata model and
  separates submission from later validation/activation. Flarex additionally
  freezes a versioned canonical JSON codec and SHA-256 because shared
  PostgreSQL `jsonb` does not preserve checksum input bytes.
- Flarex owns the artifact by deployment and serializes registration with one
  short deployment-row lock. The future sole active authority remains
  `fx_control_scope.active_schema_version_id`; this checkpoint does not read or
  write it.
- Versions are explicit positive values and IDs are trusted opaque values. No
  gapless allocator, content-addressed identity, or checksum uniqueness is
  implied.

Known limitations and follow-up:

- S03-B2 still owns versioned table definitions. S03-C owns stable indexes and
  build state. D1 now owns pure trusted compilation, D2 owns control
  publication, D3 owns build reconciliation, and D4 owns validation readiness.
- The repository is append-only but privileged SQL can still coherently mutate
  JSON, bytes, and checksum. A trigger/role policy is a separate hardening
  decision.
- Codec v1 fixes a nesting limit of 128 but no maximum canonical byte size yet;
  the API must remain trusted and unrouted until a bound is accepted.
- Canonicalization normalizes object-key order only. Semantically reordered
  arrays remain different artifacts until the trusted compiler constructs a
  deterministic domain manifest.
- This checkpoint adds no analyzer/executor routing, OCC, app rows, commit
  compiler, sync, Payload, Medusa, or Cloudflare deployment behavior.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol exec vitest run test/schema-manifest.test.ts
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/schemaVersionArtifacts.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/pglite.test.ts -t "runs Drizzle Kit migrations idempotently|adds immutable schema artifacts" --no-file-parallelism
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/schemaVersionArtifacts.postgres.test.ts --no-file-parallelism
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/pglite.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/schemaVersionArtifacts.test.ts test/stableTableCatalog.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm check:effect-boundaries
git diff --check
```

The monolithic persistence-package test command was also attempted. Its
assertions reached 173 passed and 28 skipped without a test failure, then a
Vitest worker exited with a Windows/V8 zone out-of-memory error. The complete
PGlite migration file and affected artifact/stable-catalog files were rerun in
fresh bounded processes as the green regression gate above.

#### S03-B2a Implementation Checkpoint

Previous completed checkpoint: `00e15c7` Require evidence-first design review.

What changed:

- Extracted the existing Convex-shaped validator codec into focused,
  host-neutral immutable `ValidatorJsonV1`/`ObjectValidatorJsonV1` contracts
  while preserving the old names and deployment-protocol re-export as
  compatibility aliases.
- Added a strict semantic `tableDefinitions` section contract under
  `flarex-protocol/schema-manifest`. Section v1 accepts only the proven
  `appDocument` variant with a required object `documentType`, positive branded
  `CatalogTableId`, Convex-compatible non-system app table name, and explicit
  definition version. The same 64-byte ASCII identifier rule applies
  recursively to object fields and `v.id(...)` targets, and the definition
  pins the validator-v1 union so later compatibility growth cannot widen it.
- Required strictly increasing numeric table IDs, allowing gaps, and unique
  `(namespace, logicalName)` bindings. Exact decoding rejects legacy placement
  and lifecycle fields, physical names, opaque definition copies, indexes,
  relations, unknown validator fields, and unsafe JSON/text.
- Kept the B1 JSON codec generic and separate. Callers must decode the semantic
  section before canonical hashing; B2a adds no persistence or migration.
- Superseded the proposed `fx_control_table_definition` DDL and corrected the
  accepted design/cutline so `manifest_json` remains the sole persisted
  versioned table-definition source.

Why it changed:

Convex stores one typed whole-schema artifact and a separate stable table
mapping, not a second per-table definition JSON copy. Freezing only the proven
table section also prevents the current app validator model from falsely
claiming to represent Payload or Medusa relational schemas.

Convex sources inspected:

- `crates/common/src/bootstrap_model/schema_metadata.rs`
- `crates/common/src/bootstrap_model/tables.rs`
- `crates/common/src/schemas/mod.rs`
- `crates/common/src/schemas/json.rs`
- `crates/common/src/schemas/validator.rs`
- `crates/value/src/table_name.rs`
- `npm-packages/convex/src/server/schema.ts`

How Flarex differs:

- Convex keys a schema's tables by name and carries component namespace outside
  the schema. Flarex repeats its deployment catalog namespace/name beside the
  stable numeric ID as a version-pinned assertion because app, Payload,
  Medusa, and system identities share one catalog.
- Convex normalizes table-array semantics through a `BTreeMap`. Flarex requires
  the trusted binder to emit strict numeric-ID order before the B1 codec hashes
  the preserved array order.
- Section v1 is app-document-only. Payload and Medusa must add explicitly
  versioned source-derived variants rather than reuse `ValidatorJson`.

Known limitations and follow-up:

- S03-B2b still owns catalog resolution/allocation, exact mapping checks,
  deterministic section construction, and B1 artifact persistence.
- S03-C owns indexes and build state. Relation/constraint semantics and IDs,
  lifecycle/readiness, activation, OCC, app rows, commit compilation, sync,
  Payload, Medusa, and Cloudflare routing remain out of scope.
- S03-D still owns target-existence and cross-reference validation; B2a proves
  only validator structure plus identifier-level semantics.
- The generic B1 codec still accepts any strict JSON object by design; trusted
  composition must invoke semantic section decoding first.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol exec vitest run test/schema-manifest-table-definitions.test.ts
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter @flarex/analysis typecheck
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-dev typecheck
corepack pnpm check:effect-boundaries
git diff --check
```

#### S03-B2b1 Implementation Checkpoint

Previous completed checkpoint: `cd7cec2` Freeze semantic table definition
contracts.

What changed:

- Added a strict unbound app-table declaration contract derived from the B2a
  name/definition schemas. It forbids caller table IDs/namespaces, rejects
  duplicates and excess fields, and ports Convex's 10,000-user-table ceiling
  before recursive JSON/element decoding or any catalog planning.
- Added an internal PostgreSQL/PGlite optimistic binding planner. It validates
  every declaration, sorts missing names with locale-independent ASCII/UTF-16
  ordering, observes current app bindings plus the deployment-wide catalog
  high-water mark, assigns candidate compact IDs, emits an ID-ordered decoded
  `tableDefinitions` section, and recursively freezes the exposed plan.
- Centralized deployment-wide catalog high-water reads and checked next-ID
  allocation in one package-internal helper shared by the ordinary stable-table
  allocator and schema binding planner so their hashed-ID policy cannot drift.
- Added an opaque transaction-only apply primitive. It locks the deployment,
  re-reads exact name bindings, accepts exact replay, rejects changed frontier,
  changed bindings, or partial prior application with typed stale-plan errors,
  and inserts only repository-planned IDs. It never commits or hashes.
- Kept the primitive out of the public persistence facade and package root.
  The following B2b2 checkpoint now composes it with artifact insertion in one
  outer transaction; B2b1 itself added no standalone reservation workflow.
- Added focused protocol and PGlite proofs for input exclusion, deterministic
  candidate allocation, existing-ID preservation, numeric final ordering,
  exact replay, invalid-before-SQL behavior, every typed stale branch,
  rollback, empty schemas, missing deployment, opaque plan authentication,
  package-root/facade non-export, and absence of schema-artifact writes.
- Added an environment-gated real-Postgres suite for concurrent exact replay,
  competing same-frontier plans, and post-lock visibility when the existing
  catalog allocator wins first. It is part of `test:postgres`.

Why it changed:

Stable IDs are part of Flarex's canonical manifest bytes, but B1 correctly
forbids canonicalization and Web Crypto under the deployment lock. A naive
two-transaction binder would leave committed IDs if artifact persistence
failed. The optimistic plan lets B2b2 hash outside SQL and then atomically
revalidate/apply mappings with the immutable artifact, retrying from
preparation when the observed catalog changed.

Convex sources inspected:

- `crates/application/src/deploy_config.rs`
- `crates/database/src/bootstrap_model/schema/mod.rs`
- `crates/database/src/bootstrap_model/table.rs`
- `crates/database/src/database.rs`
- `crates/application/src/schema_worker/mod.rs`
- `crates/common/src/bootstrap_model/schema_metadata.rs`
- `crates/common/src/schemas/json.rs`

How Flarex differs:

- Convex evaluates schema code before SQL, then creates missing mappings and
  its Pending name-keyed schema row in one transaction. It does not embed table
  IDs or hash canonical schema bytes.
- Flarex plans IDs optimistically because those IDs affect the hash. The final
  B2b2 transaction must revalidate the opaque plan and co-publish mappings plus
  artifact, preserving Convex's atomic publication boundary without holding a
  lock during hashing.

Known limitations and follow-up:

- Resolved by the following B2b2 checkpoint: the final facade now owns artifact
  preparation, same-transaction plan application plus artifact replay, and
  bounded stale retries. The internal apply primitive remains hidden.
- The real-Postgres binding concurrency suite was added but skipped in this
  local run because `FLAREX_POSTGRES_DATABASE_URL` is unset and the installed
  local server requires credentials. B2b2 adds mapping-plus-artifact cases to
  that lane without replacing the binding-only cases.
- Catalog lifetime quotas across repeated distinct failed schema attempts need
  a public-routing policy even with the per-schema 10,000-table cap.
- Analyzer routing, indexes, relation/constraint validation, activation, OCC,
  rows, commit compilation, sync, Payload, Medusa, and Cloudflare remain out of
  scope.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol exec vitest run test/schema-manifest-table-definitions.test.ts
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/schemaManifestTableBindings.test.ts test/stableTableCatalog.test.ts test/schemaVersionArtifacts.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/schemaManifestTableBindings.postgres.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm check:effect-boundaries
git diff --check
```

#### S03-B2b2 Implementation Checkpoint

Previous completed checkpoint: `4ef6f0c` Prepare stable schema table bindings.

What changed:

- Added one high-level persistence-facade operation,
  `ensureAppSchemaVersionArtifactV1`, whose exact input is deployment/schema
  identity, numeric version, and unbound app-table declarations. Callers cannot
  provide a manifest section, stable IDs, namespace, canonical bytes, digest,
  child plan, or prepared artifact.
- Added one repository-authenticated combined prepared token. Its private state
  retains the B2b1 binding plan and the B1 artifact prepared only from that
  plan's frozen, ID-ordered section; the child tokens and transaction helper
  remain absent from the package root and public facade.
- Narrowed the package root so the B1 artifact write functions and stable-table
  transaction allocator are no longer exported. Read/result/error contracts
  remain available; concrete Drizzle/schema adapter access is a privileged
  backend escape hatch, not a supported publication path.
- Composed B2b1 mapping application and B1 artifact insert/exact replay in one
  short Drizzle transaction. An artifact conflict or later failure rolls back
  every mapping inserted by that attempt.
- Added a fixed three-total-attempt coordinator. It catches only
  `SchemaManifestTableBindingPlanStaleError`; each retry reruns binding
  preparation plus canonical encoding/SHA-256 before opening another
  transaction. Exhaustion is typed, while all other failures propagate
  unchanged after one attempt.
- Added a dedicated internal Drizzle transaction repository to the runtime
  driver so PGlite, pooled Postgres, and connected-client adapters can support
  the coordinator without widening the existing public SQL-only transaction
  callback.
- Added focused PGlite proofs for catalog/artifact coherence, declaration-order
  replay, replay after unrelated frontier movement, conflict rollback and ID
  reuse, whole-preparation stale retry, bounded exhaustion, terminal-error
  propagation, exact public API shape, and combined-token authentication.
- Added environment-gated real-Postgres cases for concurrent exact
  co-publication, an allocator-first lock race that must shift the planned ID
  and stored hash on the fresh attempt, and artifact-conflict rollback of a
  mapping insert. No DDL or migration changed.
- Reused one shared Postgres deployment-lock harness across B2b1/B2b2. It
  identifies the exact blocker backend and follows its transitive lock queue,
  so unrelated parallel database sessions cannot satisfy the test barrier.

Why it changed:

`fx_control_table` and `fx_control_schema_version` have independent keys, so SQL
constraints alone cannot prove that an artifact's stable IDs match the mapping
rows committed beside it. Stable IDs also participate in canonical bytes, so a
stale mapping plan cannot safely retry only its transaction. The coordinator
makes mapping plus artifact registration one atomic invariant and rebuilds the
entire prepared value when that invariant races.

Convex sources inspected:

- `crates/application/src/deploy_config.rs`
- `crates/model/src/components/config.rs`
- `crates/database/src/bootstrap_model/schema/mod.rs`
- `crates/database/src/bootstrap_model/table.rs`
- `crates/database/src/database.rs`
- `crates/database/src/committer.rs`
- `crates/common/src/schemas/json.rs`

How Flarex differs:

- Convex reruns a full schema callback through its database OCC helper and
  creates mappings plus a mutable Pending schema row in one commit. Its schema
  JSON is name-keyed and excludes stable numeric IDs.
- Flarex prepares stable-ID-bearing canonical bytes outside SQL, revalidates
  under a deployment lock, and inserts/replays one immutable artifact. This
  slice retries only the typed stale binding-plan race; identity/content
  conflicts, corruption, checksum anomalies, and unknown SQL failures are
  terminal. Activation and supersession remain later lifecycle work.

Known limitations and follow-up:

- The three new B2b2 cases plus the surrounding B1/B2b1 files pass all eight
  focused tests against a disposable local PostgreSQL 18.3 cluster. The cluster
  was stopped and removed after the run.
- The facade accepts only the closed app-document table section. S03-C owns
  stable index identities/definitions; Payload and Medusa require their own
  source-derived namespace contracts instead of entering this app variant.
- No analyzer/compiler route invokes this facade yet. Activation, lifecycle,
  indexes, relation/constraint compilation, rows/value codecs, OCC, commit
  compilation, sync, and Cloudflare hosting remain unchanged.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/appSchemaVersionArtifacts.test.ts test/schemaManifestTableBindings.test.ts test/schemaVersionArtifacts.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/appSchemaVersionArtifacts.postgres.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter @flarex/executor-worker typecheck
corepack pnpm check:effect-boundaries
git diff --check
```

#### S03-C1 Implementation Checkpoint

Previous completed checkpoint: `636fa50` Register app schema artifacts
atomically.

What changed:

- Added the branded positive signed-32-bit `CatalogIndexId` contract and named
  it explicitly as stable logical identity, not a physical definition/build ID.
- Added strict unbound app developer-index declarations containing only table
  logical name, developer descriptor, and ordered field paths. Caller-supplied
  table/index/definition IDs, namespace, codec version, lifecycle, and prepared
  state are rejected.
- Added closed `indexBindings` and `appSchema` semantic formats. Bound entries
  carry `logicalIndexId`, stable `tableId`, app namespace, descriptor, and a
  versioned developer-ordered logical spec; logical IDs must be strictly
  increasing and table references must resolve inside the same envelope.
- Ported Convex identifier/reserved-name discipline, duplicate descriptor/spec
  rejection, 64 developer indexes per table, and effective 16-field semantics.
  V1 accepts at most 15 declared fields because physical lowering appends
  `_creationTime`; `_id` remains the implicit final tie-breaker.
- Decided that `by_id` and `by_creation_time` are intrinsic app-table access
  paths, not developer-owned logical index bindings. Developer declarations
  reserve both names and every `_`-prefixed descriptor/system field path.
- Added focused protocol proofs for nominal identity, exact public input shape,
  path/name/count rules, redundant-spec rejection, stable binding order,
  cross-table references, closed-envelope versioning, and canonical hashing.
- Corrected the design sketches so stable logical index identity no longer keys
  physical entries/builds. A separate immutable definition-generation identity
  is required before DDL; build state must pin storage generation/fence, epoch,
  start commit sequence, and a versioned cursor.

Why it changed:

The prior S03-C line combined semantic input, stable catalog allocation,
physical definition identity, codec choice, and mutable build state in one
goal. More importantly, one stable `index_id` cannot safely represent both a
logical name and physical data: changing fields must allow the old enabled
index and a new backfilling index to coexist. Freezing the closed logical
contract first prevents an unsafe one-ID DDL from becoming a migration.

Convex sources inspected:

- `crates/common/src/types/index.rs`
- `crates/common/src/schemas/mod.rs`
- `crates/common/src/schemas/json.rs`
- `crates/common/src/bootstrap_model/index/index_config.rs`
- `crates/common/src/bootstrap_model/index/index_metadata.rs`
- `crates/common/src/bootstrap_model/index/database_index/indexed_fields.rs`
- `crates/common/src/bootstrap_model/index/database_index/index_state.rs`
- `crates/database/src/bootstrap_model/index.rs`
- `crates/application/src/lib.rs`
- `crates/application/src/deploy_config.rs`
- `crates/model/src/components/config.rs`
- `crates/indexing/src/index_registry.rs`

How Flarex differs:

- Convex uses `(table, descriptor)` as logical identity and a `_index` metadata
  document ID as one physical incarnation. Flarex keeps a compact numeric
  deployment-scoped logical ID for compiler/protocol references, but now
  requires a different physical definition/build identity.
- Convex stores a mutable schema/index lifecycle. Flarex's C1 artifact is an
  immutable logical envelope; codec-bearing physical definitions and fenced
  per-scope lifecycle rows remain later trusted compilation work.
- The existing `ensureAppSchemaVersionArtifactV1` remains the exact bare
  table-section compatibility API. A later full-envelope publication boundary
  must use a new API version rather than silently widening V1.

Known limitations and follow-up:

- C1 adds no DDL, allocator, persistence facade, analyzer route, physical codec,
  definition row, build transition, backfill, readiness, activation, index
  entry, OCC, commit compiler, sync, Payload, Medusa, or Cloudflare behavior.
- S03-C2 owns the logical index catalog/planner. S05-A must then freeze
  ordered-key bytes before S03-C3 decides the compact definition identity;
  stable logical ID alone is forbidden for build/entry keys.
- Field existence against table validators and trusted injection/lowering of
  intrinsic access paths remain compiler validation, not declaration parsing.
- The generic canonical codec still has no byte-size cap. The trusted route
  remains unrouted, and C1 caps developer index declarations at 10,000 total.

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

#### S03-C2 Implementation Checkpoint

Previous completed checkpoint: `3104aa1` Freeze logical index manifest
contracts.

What changed:

- Added additive `fx_control_index` as the deployment-scoped stable mapping
  from `(table_id, descriptor)` to a compact logical index ID. The row stores no
  fields, schema version, physical definition ID, codec, lifecycle, or build
  state; its composite foreign key pins the table to the same deployment.
- Added deployment-qualified read-only catalog lookups and kept the high-water
  and checked next-ID allocator package-internal. There is deliberately no
  standalone logical-index reservation operation or persistence-facade method.
- Added one repository-authenticated combined table/index optimistic plan. It
  reuses the exact table plan, resolves index table names only through that
  prospective schema, allocates missing logical IDs by numeric table ID then
  ASCII descriptor, and emits one deeply frozen `appSchema` manifest ordered by
  final logical IDs.
- Added one caller-owned transaction primitive that locks the deployment once,
  revalidates both catalogs, rejects changed frontiers/bindings, classifies
  partial application across tables and indexes before insertion, then inserts
  tables before indexes for foreign-key order. Exact complete replay succeeds;
  the helper never commits and is not exported from the package root.
- Added the `0021 -> 0022` additive migration proof, focused PGlite catalog and
  planner proofs, and real-Postgres lock/concurrency/rollback coverage. The
  generated composite foreign key was made search-path-relative after the real
  Postgres lane proved that an explicit `public` qualifier breaks isolated
  deployment schemas.

Why it changed:

The logical name `(table, descriptor)` must survive schema versions and spec
changes, but IDs embedded in a future immutable artifact must still be planned
outside the short SQL lock. A combined authenticated plan preserves stable
identity without allowing naked reservations or a table-only concurrent commit
to be mistaken for a complete table/index publication.

Convex sources inspected:

- `crates/common/src/types/index.rs`
- `crates/common/src/schemas/mod.rs`
- `crates/common/src/bootstrap_model/index/index_config.rs`
- `crates/database/src/bootstrap_model/index.rs`
- `crates/database/src/bootstrap_model/schema/mod.rs`
- `crates/database/src/transaction.rs`
- `crates/database/src/writes.rs`
- `crates/database/src/committer.rs`
- `crates/database/src/database.rs`
- `crates/application/src/deploy_config.rs`
- `crates/model/src/components/config.rs`

How Flarex differs:

- Convex orders logical names directly and stores physical index incarnations
  as `_index` metadata documents inside its OCC transaction. Flarex assigns a
  compact deployment-local logical ID optimistically, then revalidates exact
  table/index bindings and catalog frontiers under a Postgres deployment lock.
- Convex's metadata document combines more physical spec/state concerns. This
  C2 row is intentionally only logical identity; changed fields reuse the same
  logical ID and must receive a distinct immutable physical definition in C3.
- Convex automatically persists reserved system indexes. Flarex v1 treats
  `by_id` and `by_creation_time` as intrinsic manifest semantics, so C2 creates
  no catalog rows and consumes no logical IDs for them.

Known limitations and follow-up:

- C2 does not publish a V2 schema artifact and adds no retry coordinator. S03-D
  must later bind this internal plan to canonical full-envelope artifact
  insertion and retry only fresh typed stale attempts.
- S05-A subsequently froze physical ordered fields, trusted `_creationTime`,
  separate implicit `_id`, key codec/version, comparisons, byte bounds, and
  fixtures. C3 can now choose physical definition identity/DDL.
- Physical index definitions, per-scope build state, entries, backfill,
  activation, analyzer/compiler integration, Payload/Medusa compilation,
  Cloudflare routing/deployment, and legacy cleanup remain excluded. S03-C as a
  whole is not complete.

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

Progress:

- [x] S05-A — Freeze the ordered app-index physical spec and key codec first,
  including `_creationTime` augmentation, implicit `_id` tie-breaking, byte
  bounds, comparisons, and golden fixtures. S03-C3 depends on this checkpoint.
- [ ] S05-B — Freeze the full tagged Flarex value codec needed by app rows and
  later general key/value interpretation.

Outcome:

- Implement a versioned tagged Flarex value codec for JSON-compatible values,
  bigint, bytes, special numeric values, deterministic object ordering, and
  stable hashing.
- Implement a versioned ordered compound-index key codec with bound encoding,
  an explicit collation policy, and row-ID tie-breaking. S05-A pins
  `binaryUtf8`; locale-aware indexes remain adapter-specific future work.
- Store codec versions with rows/index definitions where interpretation depends
  on them.

Exit gate:

- canonical golden fixtures round-trip in runtime and persistence code;
- equality, hashing, and ordered comparison agree for null/missing, strings,
  booleans, numbers, bigint, bytes, compound values, and special values;
- changing codec bytes requires a new version and a migration, not a silent
  rewrite.

#### S05-A Implementation Checkpoint

Previous completed repository checkpoint:
`8c9b3ba` - `Define generated relations and managed schema deploys`.

Previous completed index-foundation checkpoint:
`9fe45b5153e1917c6375aff980081cb68acc188a` -
`Persist stable logical index catalog`.

What changed:

- Added the controlled `flarex-protocol/ordered-index` subpath with strict
  developer, `by_creation_time`, and direct `by_id` physical specs. Developer
  paths lower to their document fields plus trusted `systemCreationTime`; the
  final exact 16-byte row identity remains a separate tie-breaker.
- Added ordered-key codec v1 with immutable branded byte values plus distinct
  raw-key, canonical-key, bound, and row-ID representations; exact
  Convex-derived tagged bytes; strict canonical decoding; typed terminal
  failures; bounded input preflights; and half-open range compilation.
- Fixed a Convex boundary ambiguity rather than copying it: partial tuple
  endpoints append reserved byte `0x16`, above every v1 value tag and below the
  `0xff` NUL escape, while an exact full tuple ends at `key || 0x00`. This keeps
  `"a"`, bytes ending at `a`, and `{}` distinct from their escaped extensions.
- Fixed the complete encoded field-tuple ceiling at 2,048 bytes, with a
  2,049-byte maximum bound and a separate exact 16-byte row identity. Golden
  tests cover special float bits, int64 widths, strings/NULs, bytes, arrays,
  objects, malformed encodings, accessor/sparse/cycle rejection, lowering,
  positions, and bounds.
- Proved bytewise order and half-open scans in PGlite. A disposable PostgreSQL
  18.3 composite B-tree on `(scope_id, index_definition_id, encoded_key,
  row_id)` accepted the exact ceiling and preserved duplicate-key row-ID order.

Why it changed:

C3 cannot assign an immutable physical definition identity until ordered
fields, creation-time rules, codec bytes, collation, byte ceiling, tie-breaker,
and endpoints are immutable. Freezing them first prevents one physical ID from
silently changing interpretation during backfill or activation.

Convex sources inspected:

- `crates/value/src/sorting.rs`
- `crates/common/src/index.rs`
- `crates/common/src/bootstrap_model/index/database_index/indexed_fields.rs`
- `crates/application/src/lib.rs`
- `crates/common/src/document.rs`
- `crates/common/src/query.rs`
- `crates/common/src/interval/key.rs`
- `crates/common/src/interval/bounds.rs`
- `crates/database/src/system_tables.rs`
- `crates/postgres/src/sql.rs`

How Flarex differs:

- Convex appends the developer ID inside its encoded key and can split storage
  after a 2,500-byte prefix. Flarex rejects complete encoded field tuples above
  2,048 bytes and orders the separate compact 16-byte row identity afterward.
- Flarex pins `binaryUtf8`, the ceiling, and the separate tie-breaker in the
  physical spec. Locale-aware behavior requires another physical spec/version.
- Flarex's partial tuple sentinel closes the escaped-NUL prefix ambiguity in
  Convex's broad byte-prefix increment while retaining its portable value
  ordering and full-tuple `key || 0x00` rule.

Known limitations and follow-up:

- No physical definition identity/DDL, schema binding, build state, index-entry
  table, hashing, compiler/analyzer wiring, row-value codec, backfill,
  activation, Payload/Medusa, Cloudflare, or legacy replacement was added.
- `by_id` uses direct row identity and therefore needs a later row-ID point/range
  API; `OrderedIndexBoundsV1` is a transient v1 query value, not a durable
  cursor or read-dependency format. Exact pagination frontiers remain S10 work.
- The final internal row-ID generator remains open. Legacy unversioned key
  bytes must be rebuilt from authoritative rows rather than decoded as v1.

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

#### S03-C3 Implementation Checkpoint

Previous completed checkpoint: `6ac7286` Freeze ordered index key codec.

What changed:

- Added separately branded positive signed-32-bit
  `CatalogIndexDefinitionId`; it cannot be assigned where the stable logical
  `CatalogIndexId` or table ID is expected.
- Added a strict app physical-definition protocol with discriminated developer
  versus table-owned `by_creation_time` access identities. Direct `by_id` is
  intentionally not buildable/persisted. Domain-separated canonical spec bytes,
  codec v1, SHA-256, and a 131,072-byte closed-envelope ceiling pin the complete
  S05-A physical spec without confusing it with the 2,048-byte row-key ceiling.
- Added additive migration `0023` for immutable
  `fx_control_index_definition` and developer
  `fx_control_schema_version_index_binding`. Database checks pin app spec v1,
  ordered-key codec v1, binary UTF-8, the separate 16-byte tie-breaker, valid
  owner shape, compact IDs, canonical evidence size, and same-deployment
  parents. Detoasted logical JSON text size is bounded with
  `octet_length(jsonb::text)` rather than representation-dependent
  `pg_column_size`; missing JSON keys fail through an `IS TRUE` predicate, and
  current developer bindings are database-pinned to required.
  A composite definition-owner foreign key prevents a schema binding from
  naming a physical definition owned by another logical index.
- Corrected Drizzle's generated migration ordering so the referenced logical
  owner unique constraint exists before its foreign key, and removed generated
  `public` qualifiers so isolated deployment schemas remain valid.
- Added one package-internal prepare/apply boundary. Callers provide only stable
  schema/table/logical identities and the logical developer spec; trusted code
  lowers and hashes outside SQL, then under the deployment lock reuses exact
  content or allocates the next deployment-local physical ID and inserts the
  required schema binding in the caller-owned transaction. The package root
  exposes only strictly decoded reads with immutable hex evidence, not
  allocation/publication. Binding conflict classification happens before any
  insert, and locked exact-row comparison reuses prepared evidence without Web
  Crypto, so caught conflicts cannot commit orphan definitions or lengthen the
  critical section with hashing. Per-logical definition reads include the
  CHECK-equivalent developer owner identity so Postgres can use the existing
  owner/spec index before filtering accumulated generations.
- Proved exact replay, definition reuse across schema versions, changed-spec
  coexistence, table-owned creation-time representation, forged input/parent
  rejection, composite ownership, missing/oversized JSON rejection, immutable
  evidence, corruption detection, exhaustion, caught-conflict safety, maximum
  valid spec acceptance, rollback, and the additive `0022 -> 0023` upgrade in
  PGlite. PostgreSQL 18.3 proved concurrent exact convergence,
  competing-binding serialization without an orphan definition, rollback,
  search-path-safe composite foreign keys, and rejection of oversized logical
  JSON even when its source datum is TOAST-compressed below the byte ceiling.

Why it changed:

One stable logical index ID cannot identify both an enabled old spec and a
changed replacement while the latter is being built. The earlier sketch also
required every definition to carry a logical ID even though the accepted
intrinsic creation-time path deliberately consumes none. A separate physical
generation plus discriminated owner preserves both coexistence and intrinsic
identity without fabricating catalog rows.

Convex sources inspected:

- `crates/common/src/types/index.rs`
- `crates/common/src/bootstrap_model/index/index_config.rs`
- `crates/database/src/bootstrap_model/index.rs`
- `crates/indexing/src/index_registry.rs`

How Flarex differs:

- Convex uses table/descriptor as logical identity and the `_index` metadata
  document ID as physical identity; its metadata combines immutable spec with
  mutable state. Flarex adds compact deployment-local logical and physical
  integer brands, persists the exact immutable spec/canonical evidence in
  Postgres, and leaves all per-scope lifecycle to C4.
- Convex persists system index metadata. Flarex represents creation-time
  ownership directly by stable table ID and satisfies `by_id` through row
  identity without a physical definition. The C3 writer remains developer-only;
  D1 now compiles the intrinsic set; D2 must publish and verify it against the
  full artifact.

Known limitations and follow-up:

- C4 still owns storage-generation/fence/epoch-pinned per-scope build state and
  read contracts. No build transition, backfill, validation, readiness,
  activation, entry row, query planner, or active-schema route exists.
- C3 does not compare the definition set with the full app-schema artifact and
  does not publish a V2 artifact. D2 must compose all prepared definitions
  atomically, inject creation-time requirements, verify the manifest checksum,
  and retain the single active-schema authority.
- No analyzer/compiler integration, row-value codec, Payload/Medusa compiler,
  Cloudflare deployment, Worker/Hyperdrive routing, or legacy cleanup changed.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol exec vitest run test/catalog.test.ts test/index-definition.test.ts --no-file-parallelism
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/appIndexDefinitions.test.ts test/pglite.test.ts --no-file-parallelism
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/appIndexDefinitions.postgres.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm check:effect-boundaries
git diff --check
```

#### S03-C4 Implementation Checkpoint

Previous completed checkpoint: `37c522b` Persist immutable index definitions.

What changed:

- Rejected the older `fx_control_index_build_state` sketch because located
  schema/database-per-scope targets cannot foreign-key operational rows back to
  the deployment control catalog. Added data-plane
  `fx_system_index_build_state`, keyed by
  `(scope_id, index_definition_id)`, with only a local restrictive scope-clock
  foreign key. It carries no copied deployment authority and no cross-database
  definition foreign key.
- Added additive migration `0024`. SQL pins `flarexdb_v1`, positive signed-int32
  definition identity, a positive bigint generation fence, a positive
  signed-int64 attempt fence, nonblank
  epoch, nonnegative start sequence, the closed six-state lifecycle, ordered
  timestamps, and cursor/state coherence. Scope and epoch remain transitional
  text compatibility columns pending the accepted native-UUID physical cut.
- Replaced the unbounded JSON cursor sketch with cursor codec v1: the nullable
  exclusive last fully committed 16-byte row identity in an ascending exact-
  snapshot scan. `declared` and `building` require null; later phases permit
  null for an empty table. `building` means pre-backfill physical/write-fanout
  preparation and never means queryable.
- Added one root read that anchors on the scope clock and optional build row in
  one SQL statement. Its frozen result and build record are discriminated so a
  `declared`/`building` cursor is unrepresentable. The result is
  `absent | current | stale`, with exact stale fields. Missing clock authority
  fails, and a start sequence ahead of the scope clock is corruption. `current`
  proves only generation/fence/epoch currency, never enabled/readiness.
- Added no insert, transition, claim, checkpoint, enable, retire, readiness, or
  cross-store publication operation. PGlite tests use raw fixture writes only;
  D2 must validate the control definition and D3 must reconcile the located
  data plane through a durable idempotent protocol.

Why it changed:

Per-scope build lifecycle is data-plane operational state, while immutable
definition identity is deployment control state. Copying `deployment_id` and
adding control foreign keys would make the co-located test topology the hidden
authority and fail for the accepted split placements. A clock-joined read keeps
the mutable clock authoritative and preserves stale build rows for recovery.

Convex sources inspected:

- `crates/common/src/bootstrap_model/index/database_index/index_state.rs`
- `crates/indexing/src/index_registry.rs`
- `crates/database/src/bootstrap_model/index.rs`
- `crates/database/src/bootstrap_model/index_backfills/types.rs`
- `crates/database/src/bootstrap_model/index_backfills/mod.rs`
- `crates/database/src/database_index_workers/index_writer.rs`
- `crates/database/src/database_index_workers/mod.rs`

How Flarex differs:

- Convex stores pending/enabled index metadata and backfill progress in one
  transactional database under its database-worker lease. Flarex separates
  deployment catalog definitions from located scope lifecycle and therefore
  pins storage generation, fence, epoch, start sequence, and a Postgres attempt
  fence explicitly.
- Convex's database index states are `Backfilling -> Backfilled -> Enabled`.
  Flarex retains the accepted broader chain for physical preparation,
  validation, and rollback retirement, but only `enabled` may later be
  queryable and C4 adds no transition or readiness logic.

Known limitations and follow-up:

- D1 now owns trusted pure compilation and intrinsic creation-time injection.
  D2 owns control-catalog verification/publication, D3 owns cross-store
  reconciliation, and D4 owns validation evidence/readiness. An ordinary SQL
  transaction cannot publish control and database-per-scope state atomically.
- Entry/current/revision rows, worker checkpoints, cursor advancement with
  entry writes, backfill execution, query planning, and range OCC remain S06,
  S10, and later transaction work.
- No analyzer/compiler integration, Payload/Medusa compilation, Cloudflare
  deployment, runtime generation routing, or legacy cleanup changed.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol exec vitest run test/index-build-state.test.ts
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/indexBuildStates.test.ts test/pglite.test.ts --no-file-parallelism
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/indexBuildStates.postgres.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm check:effect-boundaries
git diff --check
```

#### S03-D1 Implementation Checkpoint

Previous completed checkpoint: `e383e39` Fence per-scope index build state.

What changed:

- Split S03-D into four correctness boundaries: pure compilation (D1), atomic
  control-catalog publication (D2), idempotent located build reconciliation
  (D3), and evidence-based readiness (D4). S04 alone owns active-pointer
  mutation.
- Added the focused `flarex-protocol/app-schema-catalog` compiler. It accepts
  unknown input, strictly decodes and snapshots only the already-bound
  `SchemaManifestAppSchemaV1`, and returns no source-manifest copy or accepted
  persistence token.
- Ported Convex's `can_contain_field` rule for developer index paths: an
  exhausted path or `any` succeeds, a union succeeds when any branch permits
  the path, objects traverse named fields, and scalar/array/record values cannot
  fabricate a deeper named path. Object traversal requires an own field, so
  prototype names such as `constructor`/`toString` cannot satisfy a missing
  validator path or leak an untyped runtime error.
- Recursively verifies every ID validator target. App-schema v1 is deliberately
  closed to logical app tables in the same prospective manifest plus intrinsic
  `_storage`; arbitrary app/reserved targets fail with a typed issue. Future
  Payload, Medusa, and additional system targets require explicit contracts.
- Derives frozen canonical evidence for one table-owned `by_creation_time`
  requirement per app table and one developer requirement per logical binding.
  Creation-time requirements are ordered by table ID and developer requirements
  by logical index ID. All are required for activation. Direct `by_id` remains
  row-identity access and emits no definition/build requirement.
- Rejects caller-authored physical specs/IDs, activation flags, lifecycle, and
  readiness fields through the strict manifest boundary. D1 performs no SQL,
  allocation, build transition, publication, or activation operation.

Why it changed:

The completed C2/C3 primitives could be composed incorrectly by a future
caller: one-index preparation did not prove the full manifest's field/ID
references or inject its intrinsic creation-time set. Freezing the pure trusted
compiler first prevents D2 from making caller-provided physical evidence or a
partial set into a second schema authority.

Convex sources inspected:

- `crates/isolate/src/environment/schema.rs`
- `crates/application/src/lib.rs`
- `crates/common/src/schemas/mod.rs`
- `crates/common/src/schemas/validator.rs`
- `crates/common/src/schemas/json.rs`
- `crates/database/src/bootstrap_model/table.rs`
- `crates/database/src/bootstrap_model/schema/mod.rs`
- `crates/model/src/components/config.rs`
- `crates/application/src/schema_worker/mod.rs`
- `crates/application/src/deploy_config.rs`
- `crates/common/src/bootstrap_model/index/database_index/index_state.rs`
- `crates/indexing/src/index_registry.rs`
- `npm-packages/convex/src/server/schema.ts`

How Flarex differs:

- Convex evaluates the developer schema, injects system access paths, persists
  pending schema/index metadata, validates rows, and activates within one
  integrated transactional backend. D1 ports only the pure semantic and
  lowering rules; Flarex keeps control publication, located build state,
  readiness evidence, and active-pointer mutation as separate fail-closed
  boundaries.
- Convex can permit tables outside an enforced schema. Flarex app-schema v1 is
  closed-world for app ID targets, with `_storage` as the only accepted
  intrinsic target. Later unified Payload/Medusa/system schemas must expand the
  policy explicitly rather than silently accepting unknown targets.
- Convex can mark built-ins enabled immediately for a newly empty table. Flarex
  emits creation-time requirements as required but claims no readiness until
  authoritative rows, entries, and real backfill evidence exist.

Known limitations and follow-up:

- D2 must expose a new full-envelope publication API generation while retaining
  semantic manifest v1 and canonical codec v1. It must compile its own
  authenticated C2 manifest, publish the exact control projection atomically,
  and compare owner plus canonical bytes rather than trusting SHA-256 alone.
- D3 must reconcile located build rows idempotently; an ordinary transaction
  cannot span control and database-per-scope targets. D4 depends on S06/S10 and
  later backfill/validation evidence. S04 alone may mutate the active pointer.
- The 10,000-index semantic cap bounds count but not total compiler work. A
  routed D2 API still needs a total canonical-byte/platform quota.
- No DDL, Postgres repository, PGlite/Postgres correctness lane, analyzer,
  commit compiler, Payload/Medusa, Cloudflare, or legacy behavior changed.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol exec vitest run test/app-schema-catalog.test.ts --no-file-parallelism
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-protocol build
corepack pnpm check:effect-boundaries
git diff --check
```

#### S03-D2a Implementation Checkpoint

Previous completed checkpoint: `423ba8a` Compile app schema catalog
requirements.

What changed:

- Added a package-internal V2 preparation boundary that accepts exactly
  `deploymentId`, `schemaVersionId`, `version`, unbound app table declarations,
  and unbound app index declarations. It rejects inherited, accessor,
  non-enumerable, symbol, missing, extra, and caller-authored authority fields
  without invoking getters.
- Snapshots and freezes all declarations before the first database await, then
  composes the C2 stable table/index binding plan, D1 canonical requirement set,
  and exact immutable full-manifest artifact from the same bound manifest.
- Returns only a frozen identity token. A private WeakMap authenticates the
  coupled state for later D2b/D2c package code; copied, spread, serialized, and
  structurally forged values fail closed. The token is explicitly not a
  durable receipt, serializable authority, or cryptographic capability.
- Added focused PGlite proofs that valid and failed preparation leave stable
  table/index mappings, schema artifacts, definitions, schema bindings, and
  located build rows unchanged. Preparation exposes no root facade method,
  transaction apply, retry loop, or persistence operation.

Why it changed:

Calling the existing C2 planner, D1 compiler, and artifact preparer separately
would let later publication accidentally mix evidence from different manifests
or accept caller-compiled facts. D2a creates one authenticated preparation
unit while keeping expensive canonicalization and validation outside the short
future control transaction.

Convex sources inspected:

- `crates/isolate/src/environment/schema.rs`
- `crates/application/src/lib.rs`
- `crates/model/src/components/config.rs`
- `crates/database/src/bootstrap_model/schema/mod.rs`
- `crates/database/src/bootstrap_model/table.rs`

How Flarex differs:

- Convex evaluates schema modules, injects system access paths, and prepares or
  submits schema/index metadata inside one integrated backend. Flarex has a
  separate Postgres deployment catalog and potentially separate scope data
  plane, so D2a prepares authenticated evidence without writing and later D2c
  revalidates it inside one control-database transaction.
- Convex does not need a process-local composition token for this split. The
  Flarex WeakMap token is only a package implementation seam and must never
  cross an RPC, survive restart, or become stored authority.

Known limitations and follow-up:

- At the D2a checkpoint, D2b still had to add the trusted table-owned intrinsic
  `by_creation_time` definition primitive. D2c owns transaction apply plus exact persisted
  projection verification. D2d owns bounded fresh-whole-preparation retry, the
  routed V2 facade, total canonical-byte/platform quota, and focused
  real-Postgres concurrency/rollback proofs.
- D3 remains the first located build-state mutation and cross-store
  reconciliation slice. D4 owns real validation/readiness evidence, and S04
  alone may mutate the active-schema pointer.
- No DDL/migration, definition or schema-binding write, root persistence API,
  analyzer/commit-compiler integration, Payload/Medusa schema generation,
  Cloudflare deployment, or legacy cleanup changed.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/appSchemaCatalogPublicationV2.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm check:effect-boundaries
git diff --check
```

#### S03-D2b Implementation Checkpoint

Previous completed checkpoint: `478137e` Broaden standing code reviewers.

Previous completed FlarexDB checkpoint: `268cc83` Prepare app schema catalog
publication.

What changed:

- Added one package-internal derivation from the authenticated D2a token to the
  complete, table-ID-ordered set of frozen `by_creation_time` child tokens.
  Each token exposes only deployment/table identity; private state joins the
  exact C2-bound logical name with D1's already-canonical physical evidence.
  D2b performs no second lowering, hashing, manifest persistence, or
  caller-authored physical-spec acceptance.
- Added one caller-owned-transaction ensure/replay operation per child token.
  It takes the shared C3 deployment lock, verifies the planned table still has
  the exact `app` namespace and logical name before any definition lookup or
  allocation, then returns the exact existing definition or inserts one
  table-owned generation.
- Generalized only the private C3 owner/find/insert/prepared-row verification
  kernel across developer and intrinsic access. Both paths retain one
  deployment-wide physical-definition high-water allocator, while existing
  developer schema-binding behavior remains unchanged.
- Strengthened the existing protocol storage-identity helper with
  access-discriminated overloads and made developer/intrinsic ensure results
  preserve their exact owner kind, so mismatched owner/storage pairs and
  widened intrinsic results are rejected by TypeScript.
- Exact replay compares owner, codec, SHA-256, canonical bytes, and physical
  JSON without Web Crypto under the SQL lock. Equal digest plus unequal bytes
  fails with the intrinsic collision error; missing or reassigned planned table
  parents fail before allocation. Copied/serialized child tokens fail WeakMap
  authentication.
- Focused PGlite proofs cover the complete two-table set, exact replay, no
  schema-binding/build rows, missing and stale-name parents, corruption, and
  rollback identity reuse. PostgreSQL 18.3 proves concurrent exact intrinsic
  replay and reruns the existing C3 concurrency, conflict, rollback, and TOAST
  regressions.

Why it changed:

Convex automatically creates system indexes with a table, but Flarex C2 plans
stable table IDs optimistically before the publication lock. Checking only a
planned numeric ID could attach an intrinsic definition to a different table
that won that ID concurrently. Retaining the bound logical name in authenticated
private state and checking it under the shared deployment lock closes that
stale-plan hole without letting D2b create tables or become a second catalog
authority.

Convex sources inspected:

- `crates/database/src/bootstrap_model/table.rs`
- `crates/common/src/types/index.rs`
- `crates/common/src/bootstrap_model/index/database_index/indexed_fields.rs`
- `crates/common/src/bootstrap_model/index/index_metadata.rs`
- `crates/database/src/bootstrap_model/index.rs`
- `crates/indexing/src/index_registry.rs`
- `crates/application/src/deploy_config.rs`
- `crates/model/src/components/config.rs`

How Flarex differs:

- Convex inserts `by_id` and enabled `by_creation_time` metadata atomically when
  it creates an empty table. Flarex keeps C2 as the only stable-table authority,
  represents `by_id` directly through row identity, and persists only the
  immutable table-owned creation-time definition here.
- D2b does not mark the definition declared, building, enabled, ready, or
  active. Existing rows and split placement require D3 build reconciliation
  plus D4 evidence before S04 can activate anything.
- Convex metadata lives in one transactional document database. Flarex uses a
  compact deployment-scoped physical ID and exact canonical Postgres evidence,
  with the located scope build remaining a separate later authority.

Known limitations and follow-up:

- D2b deliberately ensures one token per call. D2c must revalidate/apply C2,
  consume the complete intrinsic and developer sets, insert/replay the exact
  artifact, and verify the whole normalized control projection in one
  caller-owned transaction.
- D2d still owns fresh-whole-preparation retry, the routed V2 facade, aggregate
  quota, and whole-publication concurrency/rollback proof. D3 remains the first
  build-state mutation; D4/S04 retain readiness/activation authority.
- No DDL/migration, root facade, intrinsic schema-binding row, build state,
  analyzer/commit-compiler wiring, Payload/Medusa, Cloudflare deployment, or
  legacy cleanup changed.

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

### [ ] R01 - Freeze Relation Semantics And Stable Identity

Outcome:

- Freeze the relation definition and stable occurrence rules in
  [04-payload-relational-contract.md](./04-payload-relational-contract.md) from
  Flarex, Payload, and InstantDB source evidence.
- Define cardinality in both directions, requiredness, allowed target tables,
  polymorphism, ordering, localization, nested paths/items, and directional
  deletion policy before allocating a relation ID.
- Preserve one authoritative app/CMS row. A Payload collection binding to an
  existing table does not create another row store or schema authority.

Exit gate:

- every supported relation shape has one unambiguous semantic identity;
- repeated/localized/nested occurrences can be distinguished without position
  becoming identity;
- joins are specified as reverse-edge reads, not duplicated forward values;
- unsupported delete, locale, or polymorphic behavior fails schema validation.

### [ ] R02 - Bind Relations Into The Immutable Manifest

Outcome:

- Allocate deployment-scoped stable relation IDs through an optimistic plan
  with the same stale-plan discipline as other stable schema identities.
- Persist version-pinned relation definitions exactly once in the immutable
  schema manifest; keep a normalized `fx_control_relation_definition` table
  deferred until measured runtime introspection requires it.
- Treat rename/retarget/cardinality/delete-policy evolution as explicit schema
  migration decisions rather than guessing identity from names or shape.

Exit gate:

- exact replay preserves relation IDs and conflicting bindings fail closed;
- the manifest contains the complete accepted relation semantics required by
  storage and compiler lowering;
- no second mutable or persisted definition authority has been introduced.

### [ ] S12 — Add Stable Current Edge Occurrences

Prerequisite:

- `R01` and `R02` are complete for every relation accepted by the active
  schema. `S12` must not invent relation semantics from row values or Payload
  collection slugs.

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

## Replacement Physical Identifier And Index Policy Checkpoint

This docs-only checkpoint separates the accepted replacement schema from the
currently implemented compatibility representation. It fixes native Postgres
`uuid` storage for trusted scope/epoch components, compact hot catalog keys,
scope-local numeric cursors, stable pagination tie-breakers, bounded ordered
keys, and named ownership for every secondary index. It also preserves
Payload/Medusa identity types and leaves the Flarex app 16-byte ID generator as
a deliberate Convex-port-versus-UUIDv7 gate rather than choosing it by folklore.

Why: wide prefixed text repeated through shared multitenant indexes can become a
larger scaling cost than UUID randomness itself. IDs also must not silently
become transaction cursors or business ordering. The policy makes those
physical concerns explicit before replacement DDL is frozen.

Previous completed repository checkpoint:
`708b234ab4188ac2b16d63f8ab6c5688d886b955` —
`Gate hosted executor activation receipts`.

Convex sources inspected:

- `crates/value/src/id_v6.rs`: developer document IDs encode a compact table
  number, a 16-byte internal ID, and checksum instead of treating the public
  string as the hot physical key;
- `crates/value/src/document_id.rs`: `InternalId` is a sortable 16-byte value;
- `crates/common/src/index.rs`: the developer document ID is appended to
  declared index values as the stable ordered tie-breaker.

Flarex difference: shared Postgres authority also needs a trusted `scope_id`
prefix and Postgres-specific physical index economics. The replacement stores
scope/epoch UUID components natively and may deliberately select UUIDv7 for the
16-byte internal component only after benchmarks and an explicit compatibility
decision. Payload and Medusa continue to compile their own identity semantics.

Known limitations and follow-up:

- no migration or runtime representation changes in this checkpoint;
- existing SQL sketches still contain logical `text` declarations and must be
  compiled through the normative type policy rather than copied verbatim;
- the final app internal-ID generator, production entry-index budget/query
  plans, and partition trigger require benchmark-backed follow-up slices;
- S05-A has since fixed the v1 encoded field-tuple ceiling at 2,048 bytes,
  excluding the separate exact 16-byte row identity;
- actual DDL must prove reversible legacy-ID mapping and stable public IDs.

Verification:

```sh
git diff --check
rg -n "Replacement Design Authority|Physical Identifier And Index Scalability Policy|Normative Physical Identifier And Index Policy|Replacement Physical Identifier And Index Policy Checkpoint" AGENTS.md design-notes roadmaps/flarexdb-foundation
```

## Adapter-Facing Schema Contract

This plan creates database capabilities for later adapters without implementing
their high-level behavior:

- Payload scalar content may later use the app row/catalog/index/edge
  primitives through a Payload-owned request transaction adapter. A Payload
  collection can bind to an existing stable app `table_id`; that binding
  exposes the same rows and never creates a duplicate Payload copy. One logical
  table has one schema owner even when multiple API surfaces expose it.
- Payload relationships, uploads, joins, arrays/blocks, and localized fields
  compile according to
  [04-payload-relational-contract.md](./04-payload-relational-contract.md).
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
