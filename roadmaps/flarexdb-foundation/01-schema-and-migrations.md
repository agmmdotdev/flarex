# FlarexDB Schema And Migration Plan

## Status And Scope

Status: `S01`, `S02-A` through `S02-C`, resolve-only `S02-D1`, `S03-A`
through `S03-D2d`, interleaved `S05-A`/`S05-B`, `S06`, `S07`, and the narrow
`S07-A` scope-revocation prerequisite and C03's bounded exact-attempt journal
DDL are complete. Hosted proof `H01` through
`H04` and `H05-A` are complete. `H05-B` and production routing `S02-D2` remain
deferred. The `O03-A` parent is complete: protocol-only `O03-A1`, auth-
provenance `O03-A2a`, host-neutral grant authority `O03-A2b`, and corrected
two-boundary `O03-A2c` are complete. `O03-A2` and `O03-A` are therefore
complete. The required `O03-B` authority core through activation, reload, and
exact abort/expiry terminalization is also complete; conditional renewal,
checked revocation, and hosted Worker/key adapters are deferred to their first
real consumers and do not affect schema-gate ordering.
Private non-routing snapshot resolution `O02` is complete.

This plan owns the target physical schema, codecs, repositories, stable catalog,
activation, prototype-schema retirement, and any evidence-triggered migration
for the first shippable Flarex app-data generation.
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
   - [`../../packages/persistence-postgres/src/sessionJournalStore.ts`](../../packages/persistence-postgres/src/sessionJournalStore.ts)
   - [`../../packages/persistence-postgres/src/pinnedPointTableResolution.ts`](../../packages/persistence-postgres/src/pinnedPointTableResolution.ts)
   - [`../../packages/persistence-postgres/src/scopeAuthorityResolution.ts`](../../packages/persistence-postgres/src/scopeAuthorityResolution.ts)
   - [`../../packages/persistence-postgres/src/scopeClock.ts`](../../packages/persistence-postgres/src/scopeClock.ts)
   - [`../../packages/persistence-postgres/src/stableTableCatalog.ts`](../../packages/persistence-postgres/src/stableTableCatalog.ts)
   - [`../../packages/persistence-postgres/src/schemaVersionArtifacts.ts`](../../packages/persistence-postgres/src/schemaVersionArtifacts.ts)
   - [`../../packages/persistence-postgres/src/stableLogicalIndexCatalog.ts`](../../packages/persistence-postgres/src/stableLogicalIndexCatalog.ts)
   - [`../../packages/persistence-postgres/src/appIndexDefinitions.ts`](../../packages/persistence-postgres/src/appIndexDefinitions.ts)
   - [`../../packages/persistence-postgres/src/indexBuildStates.ts`](../../packages/persistence-postgres/src/indexBuildStates.ts)
   - [`../../packages/persistence-postgres/src/appTableDefinitionsArtifacts.ts`](../../packages/persistence-postgres/src/appTableDefinitionsArtifacts.ts)
   - [`../../packages/persistence-postgres/src/appSchemaPublicationPreparation.ts`](../../packages/persistence-postgres/src/appSchemaPublicationPreparation.ts)
   - [`../../packages/persistence-postgres/src/appSchemaPublicationPolicy.ts`](../../packages/persistence-postgres/src/appSchemaPublicationPolicy.ts)
   - [`../../packages/persistence-postgres/src/appSchemaPublicationTransaction.ts`](../../packages/persistence-postgres/src/appSchemaPublicationTransaction.ts)
   - [`../../packages/persistence-postgres/src/appSchemaPublication.ts`](../../packages/persistence-postgres/src/appSchemaPublication.ts)
   - [`../../packages/flarex-protocol/src/storage-authority.ts`](../../packages/flarex-protocol/src/storage-authority.ts)
   - [`../../packages/flarex-protocol/src/transaction-session.ts`](../../packages/flarex-protocol/src/transaction-session.ts)
   - [`../../packages/flarex-protocol/src/app-schema-catalog.ts`](../../packages/flarex-protocol/src/app-schema-catalog.ts)
   - [`../../packages/flarex-protocol/src/ordered-index.ts`](../../packages/flarex-protocol/src/ordered-index.ts)
   - [`../../packages/flarex-protocol/src/value.ts`](../../packages/flarex-protocol/src/value.ts)

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
| Storage generation | `legacy_v1` is the only wired Postgres app-data engine, while PartitionDO remains a separate authoritative fallback. Both are unshipped prototypes. `flarexdb_v1` is the accepted first shippable contract but remains unreachable from runtime execution. |
| Scope authority | `fx_control_scope`, split provisioning receipts, and `fx_system_scope_clock` exist. Shared/split provisioning, reconciliation, and read-only authority resolution exist; production routing does not. |
| Scope clock | Epoch, storage generation/fence, last commit sequence, last outbox sequence, the scope-wide authorization-revocation epoch, and S08's retained-history floor are persisted. The floor is fixed at `0` until O11 owns advancement. O03-A2c consumes a high-level located read for preliminary grant admission; the exact checked-increment remains a private test primitive, and no trusted revocation command or standalone production sequence allocator exists. |
| Stable table catalog | Deployment-scoped stable table IDs and exact name/ID reads exist. |
| Schema artifacts | Immutable canonical manifest bytes, SHA-256 checksum, deployment/version ownership, and exact replay/collision checks exist. |
| Table definitions | Strict app-document definitions live only inside the immutable manifest; no second table-definition projection exists. |
| Logical indexes | Stable deployment-scoped logical index identities and optimistic table/index binding preparation exist. |
| Physical index definitions | Immutable physical definitions, table-owned creation-time definitions, schema-version bindings, and separate physical IDs exist. |
| Build state | Fenced per-scope index-build state DDL and `absent | current | stale` reads exist; reconciliation/readiness mutation does not. |
| Ordered keys | Ordered-index spec/codec v1, binary UTF-8 collation, bounded tuple bytes, typed bounds, and separate 16-byte row identity are frozen. |
| Flarex values | Value Codec V1 covers the portable runtime value domain, strict tagged JSON, canonical UTF-8 bytes/SHA-256, general/app-document limits, a narrow NUL-string `jsonb` tag, and lowering through S05-A for ordered consumers. S06 is its first replacement-row consumer; no replacement route consumes it yet. |
| Full catalog publication | D2d exposes `publishAppSchemaV1` over D2c's atomic attempt, snapshots input once, retries only typed staleness with fresh preparation, preserves the protocol declaration maxima while bounding the current serial path to 256 combined definition work items, rejects guaranteed oversized input before cloning/catalog access, enforces the exact canonical-byte ceiling, and has focused real-Postgres bounded-work, concurrency, and rollback proof. Production replacement routing remains inactive. |
| Replacement app data | Native scope/epoch projections, strict Document ID V1, authoritative row revisions, pointer-only current storage, current scope-revocation storage, signed transaction-grant integration, the required non-routing mutation-session authority core, private exact-snapshot semantic point reads with typed dependencies, C03's bounded exact-attempt point journal/overlay/seal, C04A/C04B1/C04B2 authenticated verification, corrected C04C1 logical point planning, S08's native commit/change-feed schema plus bounded private reader, S09-A's private committed-success result storage, S09-B's fixed-kind private commit-wake schema/repository, O06's rollback-proven private point-commit transaction kernel, O07-A's read-only committed-outcome resolution, O07-B's atomic point publication and fixed-kind outbox production, C05-A's exact finishing transition, and C05-B's fresh-process reconstruction/composition are implemented. C06 endpoint/dispatch and replay orchestration, O08 retry and uncertain-outcome policy, result-expiry policy, reconnect retention/retained-floor advancement, index sidecars, edges, target-native readiness, routing/activation, and prototype retirement are not implemented; C04C2 and long-running-attempt renewal remain conditional on proven consumers. |

Existing `documents`, `indexes`, invoke-session, commit, outbox, freshness, and
subscription tables remain an internal prototype behavior baseline. They are
not a shipped migration obligation. The replacement control catalog does not
make replacement app storage active.

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
  representations. S06 derives stored native projections from canonical text;
  incompatible legacy values retain null projections and replacement access
  fails closed instead of inventing another identity.
- Use PostgreSQL signed `bigint` for revisions, commit/outbox sequences, and
  fences. Protocol schemas admit only `0..9223372036854775807` for
  nonnegative counters and `1..9223372036854775807` for positive fences, using
  canonical decimal strings at encoded boundaries and branded `bigint`
  internally.
- Empty scope sequence is `0`. A successful final transaction allocates
  `last + 1`; rollback consumes nothing. Commit and outbox counters are
  independent and never reset on epoch rollover.
- Use compact numeric hot catalog identities. Preserve additional opaque/global
  identity only where portability requires it; do not repeat wide names through
  every app-side index.
- Replacement Document ID V1 is `<positive CatalogTableId>:<canonical lowercase
  UUID>`. The UUID's exact bytes are the physical 16-byte row identity, while
  the existing permissive SDK parser remains legacy-only. V1 names the first
  replacement contract, not a successor to a missing public V1. UUID generation,
  version, locality, and ordering semantics remain separate decisions; current
  generation remains UUIDv4 and UUID bytes provide no API ordering.
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
- Session request authority and current-attempt snapshot retention are
  distinct. `fx_system_tx_session` owns immutable request/generation pins; at
  most one `fx_system_snapshot_lease` per scope/session owns only the exact
  current attempt fence, snapshot token, and lease expiry. O03-B owns atomic
  activation and the exactly-one-active-lease invariant; later consumer gates
  own finish, committed, retry-replacement, and retention operations.
- Each active `running` attempt also owns exactly one
  `fx_system_tx_journal` root keyed and restrictively fenced to that session
  attempt. Its only children are one replace-in-place latest receipt, bounded
  qualified point dependency/overlay rows, and bounded ordered material-write
  events; deleting the root cascades those temporary children. Initial
  activation creates the root with a database-time creation seed. Abort/expiry
  deletes it before the lease/session transition, and O08 must create a fresh
  root atomically with any future fence/lease replacement.
- Session arguments and grants retain checked object JSON, Value Codec V1
  canonical bytes, and SHA-256. The grant contains minimized inert
  claims/capabilities. A cryptographic identity/policy digest is matching
  evidence only; unchecked JSON and the compatibility FNV fingerprint are not
  authorization authority. S07 stores only copied revocation evidence; S07-A
  adds the current scope-wide revocation storage authority, which O03-A later
  consumes for signed grants.
- Located session rows copy trusted package/artifact/schema/policy pins. They
  use a native scope UUID foreign key but do not invent impossible
  cross-database control-plane foreign keys or bind historical snapshot epochs
  to the mutable current clock.
- Value Codec V1 is independent of schema-manifest and ordered-key codec
  versions. `$integer`, `$float`, and `$bytes` preserve the portable Convex
  representation; `$string` is reserved only for NUL-containing valid-Unicode
  strings because Postgres `jsonb` rejects raw `\u0000`. Missing is not stored,
  null is a value, undefined object fields are omitted, and patch deletion is a
  later journal/compiler concern.
- Relation IDs are allocated only after `R01` freezes semantic identity and
  `R02` binds the complete immutable definition. Field, constraint, and
  relation-definition projections stay deferred until a proven consumer needs
  them.
- Schema work is additive while the target proof is incomplete. Legacy tables
  are never reinterpreted as replacement tables. After equivalent target paths,
  tests, internal callers, and recovery are proven, remove those prototype
  tables without inventing a data-migration ceremony.

## Explicitly Deferred

- physical column, constraint-definition, and relation-definition catalogs;
- `fx_app_edge_rev`;
- dedicated block tables unless declared indexes prove insufficient;
- normalized transaction dependencies until planner evidence requires them;
- a generic row-version abstraction unless adapter integration requires it;
- Payload-specific physical lifecycle tables;
- Medusa relational table generation or migrations;
- all reconnect-retention and replacement sync query/cursor state; roadmap 21
  owns a separate just-in-time schema gate after its duration/history budget is
  accepted;
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
  opaque epoch. This describes current prototype bootstrap only; target
  activation must bootstrap clean scopes directly on `flarexdb_v1`. Existing
  advanced clocks are never reset.
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
- [x] `S03-D2d`: bounded whole-preparation retry, `publishAppSchemaV1`, fixed
  publication resource limits, and real-Postgres bounded-work/concurrency/
  rollback proof.
- [ ] `S03-D3`: durable per-scope definition-to-build reconciliation, deferred
  to Wave 3 after the physical sidecar consumer exists.
- [ ] `S03-D4`: validation evidence and readiness derived from real target rows,
  physical builds, and adapter evidence, deferred to Wave 4 after their
  consumers exist; no active-pointer mutation. Legacy backfill/comparison
  evidence is conditional on a changed shipped-state declaration.

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

1. exposes `publishAppSchemaV1` over strict unbound declarations,
   without exporting internal tokens or row writers;
2. snapshots caller input once, makes at most three total attempts, and rebuilds
   database-dependent planning, compilation, canonical bytes, and hashes after
   each typed combined stale-plan outcome;
3. preserves the protocol ceilings of 10,000 app tables and 10,000 total
   developer indexes while imposing a current publication operational ceiling
   of 256 combined table/index definition work items. Count checks precede decode and
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
serial publication route will accept that much locked work. The separate
`ensureAppTableDefinitionsArtifactV1` compatibility operation retains its exact
table-only behavior. D2d changes neither the semantic manifest nor canonical
codec version. Build-state mutation, readiness, active-schema activation,
`S03-D3`, `S03-D4`, `S04`, app rows, production replacement routing, Payload,
Medusa, and Cloudflare deployment remain outside
this facade. The standalone `O01` abstraction gate was retired before
implementation and its necessary scope-authority seam was folded into completed
`O02`; completed `S05-B` changes no catalog publication or routing behavior.
`S06`, `S07`, `S07-A`, protocol-only `O03-A1`, auth-provenance `O03-A2a`,
host-neutral grant authority `O03-A2b`, and A2c's located current-epoch plus
two-sided preparation boundaries are complete. This catalog gate does not
authorize `O03-B`, production metadata binding, checked revocation, or hosted
adapters.

Exit gates for the complete S03 stream:

- stable table/logical-index IDs survive multiple schema versions;
- old/new physical definitions and builds coexist safely;
- cross-deployment parents/bindings fail closed;
- exact replay is idempotent and conflicting replay is typed;
- readiness follows real target validation and any required target-native
  population evidence; and
- no speculative field/relation/constraint catalog has become authority.

### [ ] S04 — Establish Active Schema Pointer Authority

Scheduling: Wave 4 after `S03-D4` has derived evidence-backed readiness. This
gate does not block the private test-generation point kernel or `C07`, but it
does own the production activation source that the checked preparation kernel
must consume before production prepared-start authority can exist.

S04 is only the schema-pointer owner. It does not by itself install package,
artifact, source, or function-validator authority.

Outcome:

- For clean target scopes, initialize
  `fx_control_scope.active_schema_version_id` directly from the authenticated,
  readiness-approved target schema.
- Route activation through one transaction that writes the sole target
  authority; no prototype mirror is created by default.
- Switch target readers to the scope pointer and reject any independent
  prototype mutation. If durable shipped pointers are later discovered, add a
  separately preflighted one-time mapping or live mirror only for those scopes.
- Join this schema pointer to roadmap 17's atomic package/artifact/source/
  function-validator projection and S03-D4 readiness through one coherent
  activation revision or fence before production preparation. That physical
  representation and any DDL require their own preflight; A2c's immutable
  seeded test adapter adds none.

Exit gates:

- injected failure cannot expose a partially active schema;
- clean scopes resolve exactly the readiness-approved target schema; and
- no prototype pointer or reader is required for target activation.

### [x] S05 — Freeze Value And Ordered-Key Codecs

Progress:

- [x] `S05-A`: ordered app-index spec/key codec, `_creationTime`, implicit
  `_id` tie-breaking, bounds, comparisons, byte limits, and golden fixtures.
- [x] `S05-B`: full tagged Flarex value codec for replacement rows and general
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

Durable S05-B decisions:

- Value Codec V1 covers null, signed int64 bigint, all float64 values, boolean,
  valid-Unicode string, `ArrayBuffer`, dense arrays, and plain objects; IDs stay
  strings and missing stays outside the stored value domain.
- `$integer`, `$float`, and `$bytes` follow the portable Convex tagged JSON
  representation. Flarex conditionally uses `$string` only for NUL-containing
  strings so the canonical representation survives Postgres `jsonb`.
- Canonical evidence is a versioned UTF-8 envelope plus retained bytes and
  SHA-256. The 32 MiB/64-level general profile and complete-document 1 MiB/
  16-level profile share 8,192-array and 1,024-object cardinality caps.
- Undefined object fields are omitted; null is retained; patch deletion is not
  a value. S05-A remains the sole ordered-key byte, collation, and size
  authority.
- The protocol and SDK facade plus PGlite `jsonb` proof are complete. Row DDL,
  validator/route adoption, patch journals, and production routing are not part
  of S05-B; S06 owns the first persisted-row and real-Postgres consumer proof.

Exit gates:

- runtime, protocol, and persistence fixtures agree on value semantics,
  canonical bytes, and hashes;
- shared semantic fixtures lower through S05-A, whose encoded bytes alone
  define ordered-index comparison; and
- byte changes require a new version and migration.

### [x] S06 — Add App Row Revision And Current Storage

Outcome:

- Add compatibility-safe native UUID projections to
  `fx_system_scope_clock`. The projections are derived from canonical
  `scope_<uuid>` / `epoch_<uuid>` boundary IDs; legacy noncanonical text rows
  remain valid only for legacy paths and never receive invented UUID mappings.
- Freeze replacement Document ID V1 as a positive compact table ID plus one
  canonical lowercase UUID. The UUID's exact 16 bytes are the physical row
  identity. Existing permissive SDK parsing remains a legacy compatibility
  surface; UUID bytes have no ordering semantics and UUIDv7 generation remains
  deferred pending an explicit measured decision.
- Add `fx_app_row_rev` as the only authoritative row-value store. Its key is
  native scope UUID, positive table ID, exact 16-byte row identity, and positive
  commit sequence. It retains write-epoch provenance, schema and Value Codec V1
  evidence, immutable trusted creation time, explicit tombstone state, and the
  prior commit sequence without making that predecessor a retention-blocking
  foreign key.
- Add `fx_app_row_current` as an epoch-independent pointer to one exact revision,
  protected by a composite foreign key. It does not duplicate document value
  evidence or become a second value authority.
- Add only transaction-bound append/current-advance primitives and exact
  revision reads at or before a caller-supplied commit sequence. Storage reads
  preserve `missing | live | tombstone`; completed O04 now owns the semantic
  present/qualified-missing dependency and developer-facing `null` projection.

Non-goals:

- no commit-sequence allocation, OCC/session validation, idempotency, feeds,
  routes, indexes, edges, uniqueness, retention, baseline backfill, cutover, or
  Cloudflare deployment; and
- no adoption of the legacy timestamp/unchecked-JSON document repository as
  replacement storage.

Exit gates:

- fresh and upgrade migrations preserve canonical and noncanonical clock rows,
  and replacement access fails closed when native projections are unavailable;
- native scope, positive table/commit, exact row-byte, predecessor, codec/hash,
  live/tombstone, trusted system-field, and current-pointer invariants pass;
- point/missing/insert/update/delete/tombstone history passes, later revisions
  never leak into older snapshots, and scope/table identities remain isolated;
- epoch rollover does not hide untouched rows and revision/current writes roll
  back atomically; and
- PGlite plus focused real-Postgres value round-trip and indexed backward point
  lookup evidence pass without claiming later OCC or publication behavior.

### [x] S07 — Add Transaction-Session And Snapshot-Lease DDL

Outcome:

- Add `fx_system_tx_session`, keyed by native scope UUID and native UUID session
  ID, containing immutable `flarexdb_v1` generation/fence,
  package/dynamic-worker artifact/mutation function/schema/policy pins,
  canonical argument and grant evidence, identity/policy digest, internal
  request identity with a 1,024 UTF-8-byte indexed-key ceiling, lifecycle,
  current attempt fence, protocol version, hard expiry, and timestamps.
- Add at most one `fx_system_snapshot_lease` per scope/session containing only
  the exact attempt fence, native snapshot epoch UUID, exact commit sequence,
  and lease expiry.
- Constrain every lease to the session's exact current attempt with restrictive
  parent update/delete behavior. Do not duplicate generation, package, policy,
  grant, or request authority on it.
- Align persisted sequence/fence protocol contracts with PostgreSQL's
  signed-int64 domain.

Non-goals:

- no reconnect-retention lease or replacement sync state;
- no current scope revocation authority—S07-A owns that schema/storage
  prerequisite; no signed transaction-grant semantics—O03-A owns that later
  consumer;
- no production session activation, abort, or expiry—the required O03-B core
  owns those operations and the active-child invariant; conditional renewal
  remains deferred to O03-B2b2; finish/commit/retry/retention stay
  with their later consumers;
- no journal, syscall sequence, journal digest, dependency, or OCC behavior;
- no committed result, S09-A idempotency receipt, committed outcome, commit
  feed, outbox, routing, executor wiring, backfill, or generation activation.

Exit gates:

- fresh apply, upgrade through S06, replay, and deliberate migration-failure
  recovery pass without a false receipt or partial schema;
- native scope/session identity, mutation/dynamic-worker pins, artifact/source
  pairing, lifecycle, expiry, canonical evidence, exact-hash length, bounded
  request-key bytes, fence, and signed-int64 constraints pass;
- scope/session/attempt-fence mismatches, duplicate leases, implicit parent
  fence changes, and parent deletion fail closed;
- epoch rollover remains possible because historical snapshot epochs do not
  foreign-key mutable clock values;
- caller-owned transactions prove anchor/lease creation and explicit
  delete/advance/insert replacement rollback without claiming O03-B activation
  or O08's production retry primitive;
- PGlite and real Postgres prove constraints, concurrent conflicting lease
  attempts, exact bigint boundaries, and intended lookup plans; and
- legacy `invoke_sessions`, `/invoke/*`, exports, and routing remain unchanged.

### [x] S07-A — Add Scope Authorization Revocation Epoch

Status: complete as a private, non-routing schema/repository prerequisite.
The located scope clock is the sole current authority. O03-A2c now has a
private preliminary grant-admission consumer; no trusted revocation command,
session/runtime consumer, or control-plane mutation surface exists yet.

Outcome:

- Add one nonnegative signed-bigint `authorization_revocation_epoch`, default
  `0`, to the authoritative located-data-plane `fx_system_scope_clock` through
  the normal additive receipt-tracked migration path.
- Add narrowly typed persistence operations to read the current value and to
  checked-increment it while holding the scope-clock lock in a short
  caller-owned transaction. The located scope clock remains the only current
  authority.
- Keep the repository primitive private. O03-A still owns grant semantics and
  must decide which trusted platform command may request an increment; no
  client, artifact, Dynamic Worker, or control-plane copy may mutate or replace
  the data-plane authority.

Exit gates:

- fresh apply, upgrade from completed S07, replay, and injected migration
  failure pass on PGlite and focused real Postgres;
- default-zero reads, scope isolation, exact signed-int64 bounds, checked
  overflow, rollback, and concurrent increments prove no lost update; and
- existing session rows, legacy invokes, routing, exports, and storage-
  generation behavior remain unchanged.

Non-goals:

- no grant envelope, signature, issuer/key lifecycle, claim policy, or trusted
  revocation command surface;
- no session activation, lease renewal, final-commit revalidation, or routing;
  and
- no control-plane epoch copy, per-grant database, or per-policy epoch table.

### [x] C03 DDL — Add Bounded Exact-Attempt Journal State

Outcome:

- Migration 0028 adds `fx_system_tx_journal`,
  `fx_system_tx_journal_latest_receipt`, `fx_system_tx_journal_point`, and
  `fx_system_tx_journal_write_event` in the located data-plane schema.
- The root is keyed by `(scope_uuid, session_id, attempt_fence)` and references
  the session's exact current attempt with restrictive update/delete behavior.
  All three children use the same exact key and cascade only from explicit root
  deletion.
- The receipt primary key is the attempt key, so accepted missing/no-op/error
  operations replace one row instead of amplifying storage. Point rows are
  unique by qualified table/row identity and bounded to 4,096; ordered material
  events are unique by accepted syscall sequence and bounded to 16,000 plus
  64 MiB cumulative canonical event evidence through trusted root accounting.
- Root constraints bound all six incremental counters, including
  `material_write_event_evidence_bytes` in `0..67108864`, creation-time seed/
  cursor, open/failed/sealed state evidence, and canonical sealed bytes/digests.
  Every nullable sealed, dependency-revision, and live-overlay branch is
  explicitly two-valued so SQL `NULL` cannot satisfy a `CHECK` through unknown.
  Canonicalization and SHA work do not occur under this schema's authority
  locks.
- Intra-schema foreign keys remain unqualified so PGlite, `public`, and the
  required non-public real-Postgres `search_path` lane create the same schema.

Exit gates:

- fresh install, upgrade from 0027, idempotent replay, and injected-failure
  rollback/recovery pass;
- exact-fence restriction, child cascade, counter/evidence constraints, lookup
  plans, cleanup, and concurrent operation/seal behavior pass on PGlite and
  focused real Postgres; and
- no committed app-row, commit/change, idempotency, outbox, C04 planner, inline
  carriage, or legacy-engine table is introduced.

### [x] S08 — Add Commit And Change-Feed DDL

Outcome:

- Add native scope-local commit headers and ordered typed app-row change
  children. Exact composite foreign keys bind every child to both its header's
  epoch and a row revision written with that same epoch provenance.
- Add `oldest_available_commit_seq` to the authoritative scope clock, fixed at
  `0` with no writer until O11 owns retention advancement. S08 fails closed on
  a nonzero floor and defines no reconnect/reset behavior.
- Keep zero-child headers representable while deferring their allocation policy
  and every clock advance to O07. Sequence, not `committed_at`, orders the
  feed; the clock may never advance without its corresponding header.
- Keep the reader package-private. `listAfter` captures clock, floor, headers,
  and children in one read-only repeatable-read snapshot and returns the
  largest contiguous whole-commit prefix bounded by 100 headers and 16,000
  children, with explicit continuation.
- Leave legacy commit/document/lease/outbox objects unchanged. They remain
  unshipped prototype evidence with no compatibility bridge or dual-write
  obligation.

Exit gates:

- native scope/epoch/sequence keys, exact header/revision epoch provenance,
  finite database-owned timestamps, strict child count/ordinal correlation,
  contiguous bounded `listAfter`, and tail-gap detection pass;
- fresh install, upgrade/replay/failure recovery, non-public schema parity,
  FK/restrict behavior, query plans, and PGlite/real-Postgres boundaries pass;
  and
- S08 itself adds no gap-producing allocator, floor writer, retention/reset
  policy, generic change summary, legacy bridge, S09 writer, or O07 publication
  behavior.

### [x] S09-A — Add Committed-Success Idempotency DDL

Outcome:

- Migration 0030 adds private `fx_system_idempotency`, keyed by native
  `(scope_uuid, request_key)` with only a restrictive scope-clock foreign key.
  The current server-prepared internal key is nonblank PostgreSQL text bounded
  to 1,024 UTF-8 bytes; no public client-key mapping is activated.
- Every row binds exact 32-byte identity/access-policy and canonical-request
  digests, a nonblank mutation function path, and immutable epoch plus positive
  scope-lifetime commit sequence. The commit-token audit index is intentionally
  not a foreign key to compactable S08 headers.
- `available` retains strict Value Codec V1 successful-result evidence within
  the 16 MiB semantic and 64 MiB canonical-evidence ceilings. `expired` retains
  no payload evidence and records a finite database-owned expiry timestamp not
  earlier than creation. Both states denote one committed success.
- Keep the table package-private and additive. It defines no writer, lookup or
  replay API, expiry transition, GC, error/log outcome, in-progress claim,
  outbox, O07 integration, legacy bridge, import, or dual write.

Exit gates:

- fresh install, 0029 upgrade, replay, injected-failure recovery, non-public
  schema parity, strict state/byte/time constraints, scope ownership, header
  deletion independence, and Drizzle consistency pass;
- PGlite and isolated real Postgres prove same-key one-winner behavior,
  mismatch non-overwrite, cross-scope independence, atomic rollback,
  compaction-race/corruption classification, bounded query plans, and exact/
  plus-one result limits; and
- legacy `commits`, `documents`, `leases`, and `outbox` remain unchanged as
  unshipped replacement evidence.

### [x] S09-B — Add Leased Commit-Wake DDL And Repository

Outcome:

- Migration `0031` adds one package-private, scope-owned wake row keyed by
  `(scope_uuid, outbox_seq)` and uniquely correlated to
  `(scope_uuid, deployment_sync_commit_wake_v1, commit_seq)`. The scope clock's
  `last_outbox_seq` remains the sole allocation head; S09-B adds no allocator
  or writer.
- The wake retains commit and write-epoch provenance without a lifetime-
  coupling FK to compactable S08 headers. Claim-time validation uses one
  snapshot-consistent PostgreSQL statement: a missing header is valid only
  below the inclusive retained floor, and epoch rollover never strands an
  otherwise valid old-epoch wake.
- The package-private repository uses database-time eligibility, monotonically
  fenced claims, bounded attempts and redacted failure evidence, explicit
  retry/delivered/dead-lettered settlement, and stale-fence rejection. Direct
  wake delivery is latency evidence only; S08 remains canonical recovery
  authority.
- Delivered and dead-lettered rows remain retained. S09-B adds no sink, host
  dispatcher, generic payload, consumer group/cursor, GC, or redrive policy.

Exit gates:

- fresh/upgrade/replay/failure-recovery and non-public-schema migration lanes
  pass with the strict state/nullability/time/fence matrix;
- PGlite proves scope isolation, inclusive-floor/header correlation, old-epoch
  claims, expiry/reclaim, retry/terminal settlement, and stale-fence rejection;
  and
- isolated real Postgres proves disjoint concurrent claims, one-winner direct
  claims, crash/send-before-ack recovery, compaction races, bounded plans, and
  old-epoch progress across rollover.

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

### Conditional Shipped-State Migration Branch

Status: dormant and outside the active execution order. The former `S13`
baseline import, `S14` shadow comparison, and `S15` dual-generation
routing/rollback gates must not be implemented under the current owner-declared
unshipped state.

If new evidence changes that state, preflight only the smallest applicable
branch:

- durable data without live traffic: backup, one-time current-state conversion,
  invariant verification, and recovery proof;
- live traffic: bounded import/backfill, fenced comparison, one commit authority,
  scoped cutover, and an explicit rollback-retirement gate; or
- issued identifiers/request keys/cursors only: preserve or map those boundary
  contracts without retaining the old storage engine.

Any activated migration branch must record affected scopes/environments,
immutable source interpretation, request-outcome treatment, failure recovery,
and deletion conditions. Legacy timestamps never become replacement commit
sequences, and legacy physical key bytes are never reinterpreted as target
codec bytes.

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
