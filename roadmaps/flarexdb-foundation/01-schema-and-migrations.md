# FlarexDB Schema And Migration Plan

## Status And Scope

Status: `S01`, `S02-A` through `S02-C`, resolve-only `S02-D1`, `S03-A`
through `S03-D2d`, and the interleaved `S05-A` prerequisite are complete.
Hosted proof `H01` through `H04` and `H05-A` are complete. `H05-B` and
production routing `S02-D2` remain deferred. The current next implementation
gate is `O01` in the OCC and transaction plan and still requires its normal
design preflight and approval.

This plan owns the additive physical schema, codecs, repositories, stable
catalog, and compatibility migration for the first Flarex app-data generation.
It does not own OCC behavior, commit compilation, Payload parity, Medusa table
generation, live-sync coordination, or chronological implementation history.

Follow the interleaved order in [`README.md`](./README.md). Do not complete the
entire schema before exercising its rows through OCC and the commit compiler.
Git owns the checkpoint history previously accumulated in this file.

## Current Sources Of Truth

Use these sources in order:

1. [`../../design-notes/flarex-db-accepted-design.md`](../../design-notes/flarex-db-accepted-design.md)
   owns architecture, authority, physical identity, snapshot, commit, and
   migration rules.
2. [`../../design-notes/flarex-commerce-cms-v1-schema-cutline.md`](../../design-notes/flarex-commerce-cms-v1-schema-cutline.md)
   owns the minimal v1 inventory and explicit deferrals, not verbatim DDL.
3. [`README.md`](./README.md) owns interleaved turn order and current phase
   sequencing.
4. [`../20-postgres-executor.md`](../20-postgres-executor.md) owns executor,
   hosted routing, and storage-generation status.
5. [`../../design-notes/flarex-internal-db-schema.md`](../../design-notes/flarex-internal-db-schema.md)
   is a long-form physical-policy inventory, proposal, provenance record, and
   risk register. Its sketches are not automatically accepted.
6. Current schema, contracts, repositories, and tests prove implementation:
   - [`../../packages/persistence-postgres/src/schema.ts`](../../packages/persistence-postgres/src/schema.ts)
   - [`../../packages/persistence-postgres/drizzle`](../../packages/persistence-postgres/drizzle)
   - [`../../packages/persistence-postgres/src/scopeAuthorityResolution.ts`](../../packages/persistence-postgres/src/scopeAuthorityResolution.ts)
   - [`../../packages/persistence-postgres/src/stableTableCatalog.ts`](../../packages/persistence-postgres/src/stableTableCatalog.ts)
   - [`../../packages/persistence-postgres/src/schemaVersionArtifacts.ts`](../../packages/persistence-postgres/src/schemaVersionArtifacts.ts)
   - [`../../packages/persistence-postgres/src/stableLogicalIndexCatalog.ts`](../../packages/persistence-postgres/src/stableLogicalIndexCatalog.ts)
   - [`../../packages/persistence-postgres/src/appIndexDefinitions.ts`](../../packages/persistence-postgres/src/appIndexDefinitions.ts)
   - [`../../packages/persistence-postgres/src/indexBuildStates.ts`](../../packages/persistence-postgres/src/indexBuildStates.ts)
   - [`../../packages/persistence-postgres/src/appSchemaCatalogPublicationV2.ts`](../../packages/persistence-postgres/src/appSchemaCatalogPublicationV2.ts)
   - [`../../packages/persistence-postgres/src/appSchemaCatalogPublicationV2Policy.ts`](../../packages/persistence-postgres/src/appSchemaCatalogPublicationV2Policy.ts)
   - [`../../packages/persistence-postgres/src/appSchemaCatalogPublicationV2Transaction.ts`](../../packages/persistence-postgres/src/appSchemaCatalogPublicationV2Transaction.ts)
   - [`../../packages/persistence-postgres/src/appSchemaVersionArtifactsV2.ts`](../../packages/persistence-postgres/src/appSchemaVersionArtifactsV2.ts)
   - [`../../packages/flarex-protocol/src/storage-authority.ts`](../../packages/flarex-protocol/src/storage-authority.ts)
   - [`../../packages/flarex-protocol/src/app-schema-catalog.ts`](../../packages/flarex-protocol/src/app-schema-catalog.ts)
   - [`../../packages/flarex-protocol/src/ordered-index.ts`](../../packages/flarex-protocol/src/ordered-index.ts)

Convex-first implementation references include:

- [`../../../../crates/database/src/committer.rs`](../../../../crates/database/src/committer.rs)
  for validate-before-publication and ordered committed writes;
- [`../../../../crates/database/src/reads.rs`](../../../../crates/database/src/reads.rs)
  for row, missing-row, and range dependencies;
- [`../../../../crates/database/src/transaction.rs`](../../../../crates/database/src/transaction.rs)
  for exact-snapshot reads and staged writes;
- the bootstrap table/index models and index registry for stable identity,
  immutable definitions, and backend-owned lifecycle; and
- Convex value/index ordering and document-ID sources for portable key and ID
  semantics.

## Current Implemented State

| Area | Current truth |
| --- | --- |
| Storage generation | `legacy_v1` is the only routed app-data engine. `flarexdb_v1` is defined but unreachable from production execution. |
| Scope authority | `fx_control_scope`, split provisioning receipts, and `fx_system_scope_clock` exist. Shared/split provisioning, reconciliation, and read-only authority resolution exist; production routing does not. |
| Scope clock | Epoch, storage generation/fence, last commit sequence, and last outbox sequence are persisted. No standalone production sequence allocator exists. |
| Stable table catalog | Deployment-scoped stable table IDs and exact name/ID reads exist. |
| Schema artifacts | Immutable canonical manifest bytes, SHA-256 checksum, deployment/version ownership, and exact replay/collision checks exist. |
| Table definitions | Strict app-document definitions live only inside the immutable manifest; no second table-definition projection exists. |
| Logical indexes | Stable deployment-scoped logical index identities and optimistic table/index binding preparation exist. |
| Physical index definitions | Immutable physical definitions, table-owned creation-time definitions, schema-version bindings, and separate physical IDs exist. |
| Build state | Fenced per-scope index-build state DDL and `absent | current | stale` reads exist; reconciliation/readiness mutation does not. |
| Ordered keys | Ordered-index spec/codec v1, binary UTF-8 collation, bounded tuple bytes, typed bounds, and separate 16-byte row identity are frozen. |
| Full catalog publication | D2d exposes the V2 persistence facade over D2c's atomic attempt, snapshots input once, retries only typed staleness with fresh preparation, preserves the protocol declaration maxima while bounding the current serial path to 256 combined definition work items, rejects guaranteed oversized input before cloning/catalog access, enforces the exact canonical-byte ceiling, and has focused real-Postgres bounded-work, concurrency, and rollback proof. Production replacement routing remains inactive. |
| Replacement app data | Row revision/current, session leases, commit feed, result-bearing idempotency, replacement outbox, index sidecars, edges, backfill, and cutover are not implemented. |

Existing `documents`, `indexes`, invoke-session, commit, outbox, freshness, and
subscription tables remain the compatibility baseline. The replacement
control catalog does not make replacement app storage active.

## Fixed Schema Decisions

These decisions are durable and are not re-opened by each implementation turn:

- Use namespaced physical families: `fx_control_*`, `fx_app_*`, and
  `fx_system_*`. Shorter names in design notes are conceptual aliases.
- In a shared data plane, every primary key, unique constraint, intra-scope
  foreign key, and repository predicate includes trusted `scope_id`. A trusted
  transaction scope guard is required; RLS is optional defense in depth.
- `storage_generation` and its positive fence live on the data-plane scope
  clock. Sessions, snapshots, subscriptions, and migrations pin them. Clients
  cannot select them.
- Use native Postgres `uuid` for trusted replacement scope/epoch components.
  Branded `scope_<uuid>` and `epoch_<uuid>` strings remain reversible boundary
  representations.
- Use `bigint` for revisions and commit/outbox sequences. Encode them as
  strings or branded values at JavaScript/protocol boundaries.
- Empty scope sequence is `0`. A successful final transaction allocates
  `last + 1`; rollback consumes nothing. Commit and outbox counters are
  independent and never reset on epoch rollover.
- Use compact numeric hot catalog identities. Preserve additional opaque/global
  identity only where portability requires it; do not repeat wide names through
  every app-side index.
- Developer document IDs remain opaque and table-qualified while physical rows
  use compact table identity plus a 16-byte internal identity. The internal-ID
  generator remains an explicit Convex-port-versus-UUIDv7 gate.
- Payload and Medusa external identities retain their real schema semantics;
  compact surrogates cannot weaken external uniqueness or round trips.
- App row JSON is authoritative. Index, edge, unique, change, and outbox rows
  are trusted deterministic products of final rows and the pinned catalog.
- Stable table and logical-index identities survive schema versions. Immutable
  physical definitions/builds are separate so old and new builds can coexist.
- The immutable manifest is the only versioned table-definition authority.
  Names in normalized catalogs are verified assertions, not competing copies.
- Physical index definitions are normalized because runtime build identity and
  coexistence require them. Mutable build/readiness state remains separate.
- Every ordered secondary index ends in a separate exact 16-byte row identity
  tie-breaker. Ordered field tuples use codec v1, `binaryUtf8`, and a 2,048-byte
  ceiling excluding the row identity.
- Canonical hashes use SHA-256 plus retained canonical bytes. Equal hash with
  unequal bytes is a fatal collision, never a second value in one slot.
- Relation IDs are allocated only after `R01` freezes semantic identity and
  `R02` binds the complete immutable definition. Field, constraint, and
  relation-definition projections stay deferred until a proven consumer needs
  them.
- Migrations are additive throughout the proof. Legacy tables are not renamed,
  reinterpreted as replacement tables, or dropped before cutover/rollback
  gates pass.

## Explicitly Deferred

- physical column, constraint-definition, and relation-definition catalogs;
- `fx_app_edge_rev`;
- dedicated block tables unless declared indexes prove insufficient;
- normalized transaction dependencies until planner evidence requires them;
- a generic row-version abstraction unless adapter integration requires it;
- Payload-specific physical lifecycle tables;
- Medusa relational table generation or migrations;
- sync query/cursor state beyond the minimum reconnect-retention lease;
- cache actors, search, and read models; and
- public high-level database or adapter APIs.

## Turn Checklist

### [x] S01 — Freeze Legacy And Add The Generation Boundary

Completed scope:

- shared branded storage-authority contracts;
- narrow app-data engine boundary;
- named `legacy_v1` adapter;
- trusted generation resolution from persisted session/scope authority; and
- `flarexdb_v1` kept unreachable.

Durable exit state:

- existing behavior remains behind the legacy adapter;
- invalid authority/generation combinations fail typed validation; and
- no request header, public option, or scattered generation conditional can
  select the replacement engine.

### [ ] S02 — Add Trusted Scope Metadata And The Scope Clock

Progress:

- [x] `S02-A`: minimal scope locator catalog and typed repositories.
- [x] `S02-B`: authoritative data-plane scope clock and private lock/rollback
  proof without a production allocator.
- [x] `S02-C`: shared and split provisioning, resumable bootstrap, readiness
  receipts, reconciliation, and final ready projection.
- [x] `H01`–`H04`: host contract, request-scoped Postgres seam, private Worker,
  bundle/import proof, and named local service-binding real-Postgres proof.
- [x] `H05-A`: bounded authenticated live-host proof tooling without changing
  Cloudflare resources.
- [ ] `H05-B`: provision/inspect cache-disabled Hyperdrive, deploy the private
  executor/probe, capture hosted SQL/OCC/control/trace receipts, and remove or
  disable the probe.
- [x] `S02-D1`: host-neutral read-only shared/split authority resolver.
- [ ] `S02-D2`: compose resolver into persisted-session execution and enable
  production routing only after `H05-B`.
- [ ] `S02-E`: prove real-Postgres scope/fence isolation, pooled-connection
  cleanup, and cross-scope rejection.

Durable provisioning rules:

- Shared placement creates deployment, scope locator, and initial clock in one
  transaction.
- Split placement commits an immutable `reserved` receipt, resolves only the
  persisted locator outside control transactions, atomically ensures/verifies
  the target clock, then publishes `ready` by exact monotonic CAS.
- Control transactions never span target database I/O.
- Initial clock is explicit `legacy_v1`, fence `1`, commit/outbox `0`, and one
  opaque epoch. Existing advanced clocks are never reset.
- Missing/inconsistent scope, clock, locator, or split receipt fails closed;
  it never implies legacy authority.
- Bootstrap parity uses relational anti-joins through a captured frontier, not
  equal row counts or a claim of a restart-stable MVCC snapshot.
- The locator contains only `{ kind, databaseKey, schemaName }`; `databaseKey`
  is trusted configuration identity, never a connection string.

Outcome:

- one authoritative scope locator and one data-plane scope clock;
- topology-correct provisioning/recovery semantics;
- one mutable active-schema pointer; and
- read-only authority resolution without premature runtime routing.

Remaining exit gates:

- live hosted `H05-B` proof before production routing;
- stale epoch/generation/fence writes reject;
- rollover preserves counters and existing row visibility;
- pooled connections cannot retain a prior scope; and
- missing metadata never becomes an implicit compatibility default.

### [ ] S03 — Add The Minimal Stable Catalog

Progress:

- [x] `S03-A`: stable deployment-scoped table identities.
- [x] `S03-B1`: immutable canonical schema-version artifacts.
- [x] `S03-B2a`: strict composable app-document table definitions.
- [x] `S03-B2b1`: opaque deterministic binding plan and transaction-only
  stale-check/exact-ID application.
- [x] `S03-B2b2`: bounded atomic table mapping plus artifact registration.
- [x] `S03-C1`: strict developer-index declarations, branded logical index
  identity, and closed composite app-schema envelope.
- [x] `S03-C2`: stable logical index catalog and one opaque table/index
  optimistic plan without standalone reservations.
- [x] `S05-A`: ordered physical index spec and codec prerequisite.
- [x] `S03-C3`: immutable physical definitions and schema-version bindings.
- [x] `S03-C4`: fenced per-scope build-state DDL and read contracts.
- [x] `S03-D1`: pure bound-manifest verification and complete developer plus
  intrinsic creation-time requirement derivation.
- [x] `S03-D2a`: authenticated no-write composition of binding plan,
  requirements, and exact immutable artifact.
- [x] `S03-D2b`: identity-only intrinsic token derivation and caller-transaction
  ensure/replay after exact locked table-parent verification.
- [x] `S03-D2c`: atomic full publication and exact projection verification.
- [x] `S03-D2d`: bounded whole-preparation retry, routed V2 facade, fixed
  publication resource limits, and real-Postgres bounded-work/concurrency/
  rollback proof.
- [ ] `S03-D3`: durable per-scope definition-to-build reconciliation, deferred
  to Wave 3 after the physical sidecar consumer exists.
- [ ] `S03-D4`: validation evidence and readiness derived from real backfill,
  deferred to Wave 4 after baseline import and shadow comparison; no
  active-pointer mutation.

Stable catalog rules:

- `fx_control_table` owns stable `(deployment, namespace, logical_name)` to
  compact table identity.
- `fx_control_schema_version` owns immutable manifest, canonical bytes,
  checksum, deployment, and version; it has no mutable lifecycle status.
- `fx_control_index` owns stable developer access-path identity.
- `fx_control_index_definition` owns immutable physical interpretation and a
  separately branded deployment-local positive signed-32-bit ID.
- Schema-version index bindings pin logical access paths to physical
  definitions. Per-scope build state keys the physical definition and current
  scope generation/fence.
- Catalog preparation validates/canonicalizes outside locks, then a short
  transaction locks the deployment, revalidates the opaque plan, applies exact
  IDs, inserts/replays immutable facts, and verifies the result.
- Fully exact replay succeeds. Partial application, conflicting bindings, or a
  stale high-water frontier fails before publication and restarts preparation.
- Normalized rows are derived projections of the authenticated immutable
  artifact; they are never edited independently.

#### Completed Boundary: S03-D2d

D2c provides one package-internal, caller-transaction-owned atomic attempt.
It authenticates the D2a envelope, revalidates/applies stable bindings,
inserts/replays the artifact and every required physical definition/binding,
then verifies exact artifact evidence and the complete schema-version binding
set before returning. It performs no retry, commit, hashing under the lock,
build mutation, readiness claim, or activation.

D2d closes the trusted publication boundary:

1. exposes one routed V2 persistence facade over strict unbound declarations,
   without exporting internal tokens or row writers;
2. snapshots caller input once, makes at most three total attempts, and rebuilds
   database-dependent planning, compilation, canonical bytes, and hashes after
   each typed combined stale-plan outcome;
3. preserves the protocol ceilings of 10,000 app tables and 10,000 total
   developer indexes while imposing a current V2 operational ceiling of 256
   combined table/index definition work items. Count checks precede decode and
   catalog planning;
4. rejects a guaranteed-over-limit decoded payload before structured cloning
   or catalog reads, then authoritatively checks the exact 16 MiB canonical
   manifest ceiling after every fresh preparation and before its write
   transaction;
5. proves the 256-item operational boundary, concurrent exact replay,
   competing publication, separate table- and index-frontier stale recovery,
   and the full rollback matrix on real Postgres; and
6. preserves terminal typed invalid-input, quota, conflict, collision,
   corruption,
   exhaustion, and SQL failures without retrying them.

The lower operational work ceiling and canonical-byte checks are
generation/resource-safety limits, not dynamic product-plan or lifetime
quotas; the larger protocol declaration maxima do not promise that the current
serial V2 route will accept that much locked work. D2d changes neither V1
behavior nor semantic manifest/canonical-codec versions. Build-state mutation,
readiness, active-schema activation, `S03-D3`, `S03-D4`, `S04`, app rows, production
replacement routing, Payload, Medusa, and Cloudflare deployment remain outside
this facade. `O01` is the next candidate gate, not an implemented or
pre-approved OCC slice.

Exit gates for the complete S03 stream:

- stable table/logical-index IDs survive multiple schema versions;
- old/new physical definitions and builds coexist safely;
- cross-deployment parents/bindings fail closed;
- exact replay is idempotent and conflicting replay is typed;
- readiness follows real validation/backfill evidence; and
- no speculative field/relation/constraint catalog has become authority.

### [ ] S04 — Migrate Active Schema Pointer Authority

Scheduling: Wave 4 after `S03-D4` has derived evidence-backed readiness. This
gate does not block the private test-generation point kernel or `C07`.

Outcome:

- Backfill `fx_control_scope.active_schema_version_id` from the legacy active
  pointer and verify value parity.
- Route activation through one transaction that writes the new authority and
  legacy compatibility mirror.
- Switch readers to the scope pointer, reject independent legacy mutation, and
  retain the mirror until legacy readers retire.

Exit gates:

- injected failure cannot leave pointers divergent;
- existing deployments resolve the same schema before/after switch; and
- new activation is visible to both generations atomically.

### [ ] S05 — Freeze Value And Ordered-Key Codecs

Progress:

- [x] `S05-A`: ordered app-index spec/key codec, `_creationTime`, implicit
  `_id` tie-breaking, bounds, comparisons, byte limits, and golden fixtures.
- [ ] `S05-B`: full tagged Flarex value codec for replacement rows and general
  key/value interpretation.

Durable S05-A decisions:

- developer keys encode declared fields plus trusted creation time where
  required; row identity remains a separate exact 16-byte tie-breaker;
- ordered field tuples are capped at 2,048 bytes;
- full-tuple upper bound is `key || 0x00`; partial tuple bounds use a reserved
  sentinel that cannot collide with v1 value tags or escaped NUL bytes;
- collation is `binaryUtf8`; locale-aware ordering requires another physical
  spec/version; and
- unversioned legacy bytes are rebuilt from authoritative rows, not decoded as
  codec v1.

Remaining outcome:

- versioned tagged values cover JSON-compatible values, bigint, bytes, special
  numbers, deterministic objects, stable hashing, and explicit missing/null;
- stored rows/definitions pin every interpretation-relevant codec version.

Exit gates:

- runtime and persistence golden fixtures agree;
- equality, hashing, and ordering agree across supported values; and
- byte changes require a new version and migration.

### [ ] S06 — Add App Row Revision And Current Storage

Outcome:

- Add `fx_app_row_rev` and `fx_app_row_current` with scope/table/row identity,
  commit provenance, schema/codec version, value, tombstone, and prior revision.
- Add transaction-bound exact point history/current repositories.
- Treat current rows only as a latest-read optimization.

Exit gates:

- point/missing/insert/update/delete/tombstone history passes;
- later revisions never leak into older snapshots; and
- epoch rollover does not hide untouched rows.

### [ ] S07 — Add Session And Retention-Lease DDL

Outcome:

- Add authoritative transaction-session and snapshot-lease rows pinning scope,
  generation/fence, snapshot, catalog/policy/package, identity, attempt fence,
  request key, lifecycle, and expiry.
- Add the minimal reconnect-retention lease required by history GC.
- Create the anchor and snapshot lease atomically.

Exit gates:

- fresh apply, current upgrade, replay, and migration failure recovery pass;
- scope/generation keys and indexes are correct; and
- no runtime routes to these rows before OCC/compiler composition.

### [ ] S08 — Add Commit And Change-Feed DDL

Outcome:

- Add scope-local commit and typed change rows.
- Add `oldest_available_commit_seq` to the authoritative scope clock.
- Keep allocation private to the final O06 transaction; schema repositories
  cannot advance the clock independently.

Exit gates:

- scope/epoch/sequence keys and ordered `listAfter` pass;
- upgrade/replay/failure recovery passes; and
- no gap-producing standalone allocator exists.

### [ ] S09 — Add Idempotency And Leased-Outbox DDL

Outcome:

- Add result-bearing idempotency keyed by `(scope_id, request_key)`.
- Add independently ordered scope outbox rows with claim fence, attempts,
  retry time, state, and dead-letter metadata.
- Add required-consumer cursor and delivery-idempotency retention state.

Exit gates:

- uniqueness prevents duplicate request rows while trusted logic validates
  identity/function/request-hash reuse;
- all commit/outcome/outbox keys are scope safe; and
- pending/claimed rows are never GCed, while delivered rows wait for consumer
  progress and idempotency retention.

### [ ] S10 — Add Index Revision And Current Sidecars

Outcome:

- Add revision/current index entries with physical definition, codec version,
  canonical bytes/hash, row identity, and commit provenance.
- Keep bounds/frontiers in typed query/dependency APIs rather than duplicating
  them on entries.
- Add deterministic insert/move/delete and exact range repositories.

Exit gates:

- ordering, bounds, pagination, key movement, tombstones, and history pass;
- hash equality is verified against canonical bytes; and
- real-Postgres plans use the intended scope/definition/key path.

### [ ] S11 — Add Unique-Key Storage

Outcome:

- Add scope/constraint/canonical-key claims with hash, owning row,
  schema/codec version, and provenance.
- Freeze sparse, null/missing, localized, delete, and reuse behavior.

Exit gates:

- insert/update/delete/reuse is atomic;
- the same key may exist in another scope;
- collisions cannot overwrite claims; and
- O09 separately proves concurrent contention and rollback.

### [ ] R01 — Freeze Relation Semantics And Stable Identity

Outcome:

- Freeze bidirectional cardinality, requiredness, allowed targets,
  polymorphism, ordering, locale, nested occurrence identity, and directional
  deletion in [`04-payload-relational-contract.md`](./04-payload-relational-contract.md).
- Preserve one authoritative app/CMS row when Payload exposes an existing
  table.

Exit gates:

- every supported relation has unambiguous semantic identity;
- repeated/localized/nested occurrences remain distinguishable without using
  mutable position as identity; and
- unsupported behavior fails schema validation.

### [ ] R02 — Bind Relations Into The Immutable Manifest

Outcome:

- Allocate stable relation IDs with optimistic stale-plan discipline.
- Persist complete version-pinned relation definitions once in the immutable
  manifest; keep normalized relation-definition tables deferred.
- Treat rename/retarget/cardinality/delete-policy changes as explicit schema
  evolution decisions.

Exit gates:

- exact replay preserves IDs and conflicts fail closed;
- the manifest carries every lowering-relevant semantic; and
- no second mutable definition authority exists.

### [ ] S12 — Add Stable Current Edge Occurrences

Prerequisite: `R01` and `R02` are complete for every accepted relation.

Outcome:

- Add only current edges for v1.
- Derive occurrence identity from relation, source row, stable nested item,
  path, locale, and occurrence identity.
- Store list position only as ordering metadata.

Exit gates:

- repeated targets remain distinct;
- reorder preserves identity;
- locale/path/nested changes and stale cleanup pass; and
- no nullable relation ID or edge-history table is introduced.

### [ ] S13 — Add Resumable Current-State Baseline Import

Outcome:

- Add migration state separate from storage authority: source/target,
  phase, watermarks, cursor, lease fence, counts/hashes, validation, rollback,
  and errors.
- Import only final current row/tombstone state under an immutable legacy
  manifest/codec; do not invent historical schema or snapshot support.
- Derive indexes, unique keys, and edges from final rows and the pinned import
  manifest rather than copying legacy physical bytes.
- Build an unreadable, unsealed baseline at reserved replacement commit `1` in
  bounded idempotent batches and mirror ordered legacy changes through a final
  watermark without emitting canonical commits or external-effect outbox rows.
- Import every provable committed legacy request outcome. Preserve results
  where possible; otherwise write permanent unavailable tombstones. Unknown or
  GCed legacy keys become reject-only after cutover.

Exit gates:

- crash/restart and repeat import converge;
- unsealed baseline rows cannot be served;
- contradictory keys, unmapped scopes, corrupt encoding, or untracked
  revisions block validation; and
- legacy timestamps never become replacement commit sequences.

### [ ] S14 — Add Verification And Shadow Comparison

Outcome:

- At one fenced legacy watermark, verify row/tombstone counts, revision/current
  consistency, catalog IDs, indexes, unique claims, edges, and normalized
  visible values against the reserved baseline.
- Persist reproducible mismatch evidence.
- Keep legacy authoritative; shadow reads never silently serve fallback data.

Exit gates:

- injected corruption is detected;
- comparisons cannot mix watermarks or generations; and
- clean reports reproduce on PGlite and real Postgres.

### [ ] S15 — Finalize Generation Routing And Rollback State

Outcome:

- Add transactional generation/fence transition, migration phase, validation
  watermark, rollback window, and irreversible-boundary repositories.
- During rollback compatibility, publish the complete legacy projection in the
  same SQL transaction as each replacement commit while suppressing duplicate
  external effects.
- Make both generations consult one scope-wide authoritative idempotency
  outcome before execution.
- Drain/fence old attempts, seal the legacy request namespace, and permit
  generation rebind only after outcome lookup proves no commit and the old
  anchor is terminal.
- Seal baseline commit `1`, set commit/floor state, and flip generation/fence in
  one transaction without external-effect outbox rows.
- Leave canary behavior to O12 and legacy retirement to O13 after sync gates.

Exit gates:

- transition/drain/rollback state passes PGlite and real-Postgres concurrency;
- legacy/replacement visible state and commit mapping agree;
- result replay, tombstone, mismatch, and uncertain-outcome behavior works
  across rollback;
- stale fences cannot flip authority; and
- no legacy migration/table is dropped or rewritten.

## Adapter-Facing Schema Contract

- Payload may later use app row/catalog/index/edge capabilities through a
  Payload-owned request transaction adapter. Binding a collection to an
  existing table exposes the same rows and creates no duplicate authority.
- Payload relations, uploads, joins, arrays/blocks, and localized fields follow
  [`04-payload-relational-contract.md`](./04-payload-relational-contract.md).
- Medusa products, orders, carts, pricing, and inventory remain in Medusa-owned
  relational tables. A trusted Medusa transaction may later participate in the
  scope clock, commit/change feed, and outbox without using app-row storage.
- Neither adapter receives arbitrary physical identifiers or authors system
  commit/outbox facts.

## Verification Matrix

Every schema implementation turn runs the focused tests plus:

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

Protocol changes run the affected `flarex-protocol` typecheck/tests/build.
Executor-port changes run the affected executor and Worker-host gates. Phase
gates add workspace checks when the correctness boundary is genuinely
cross-cutting.

DDL turns generate and validate package-local Drizzle migrations and snapshots.
Significant code turns require both standing diff reviewers before commit.
Update this plan only when durable status, decisions, sequencing, gaps, or exit
criteria change; keep command receipts and commit history in task reports and
Git.
