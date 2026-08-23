# FlarexDB Schema And Migration Plan

## Status And Scope

Status: `S01`, `S02-A` through `S02-C`, resolve-only `S02-D1`, `S03-A`
through `S03-D2d`, interleaved `S05-A`/`S05-B`, `S06`, `S07`, and the narrow
`S07-A` scope-revocation prerequisite and C03's bounded exact-attempt journal
DDL are complete. S08, S09-A, S09-B, and O08-B2b1/C06-A's migration-0032
exact-attempt execution-claim DDL are also complete. Hosted proof `H01` through
`H04` and `H05-A` are complete. `S02-E0` admits the mandatory scoped-execution
kernel plan and production-inert `S02-E1` is complete; genuine-Postgres
`S02-E2` is complete and bypass closure `S02-E3` is next. `H05-B` and
production routing `S02-D2` remain deferred. The
`O03-A` parent is complete:
protocol-only `O03-A1`, auth-
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
   - [`../../packages/persistence-postgres/src/transactionExecutionClaim.ts`](../../packages/persistence-postgres/src/transactionExecutionClaim.ts)
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
| Build state | Fenced per-scope index-build state, reconciliation, the relation-free intrinsic builder, scope-clock-fenced readiness settlement, and shared-primary activation/coherent reads exist; production prepared-start remains separate. |
| Ordered keys | Ordered-index spec/codec v1, binary UTF-8 collation, bounded tuple bytes, typed bounds, and separate 16-byte row identity are frozen. |
| Flarex values | Value Codec V1 covers the portable runtime value domain, strict tagged JSON, canonical UTF-8 bytes/SHA-256, general/app-document limits, a narrow NUL-string `jsonb` tag, and lowering through S05-A for ordered consumers. S06 is its first replacement-row consumer; no replacement route consumes it yet. |
| Full catalog publication | D2d exposes `publishAppSchemaV1` over D2c's atomic attempt, snapshots input once, retries only typed staleness with fresh preparation, preserves the protocol declaration maxima while bounding the current serial path to 256 combined definition work items, rejects guaranteed oversized input before cloning/catalog access, enforces the exact canonical-byte ceiling, and has focused real-Postgres bounded-work, concurrency, and rollback proof. Production replacement routing remains inactive. |
| Replacement app data | Native scope/epoch projections, strict Document ID V1, authoritative row revisions, pointer-only current storage, current scope-revocation storage, signed transaction-grant integration, the required non-routing mutation-session authority core, private exact-snapshot semantic point reads with typed dependencies, C03's bounded exact-attempt point journal/overlay/seal, C04A/C04B1/C04B2 authenticated verification, corrected C04C1 logical point planning, S08's native commit/change-feed schema plus bounded private reader, S09-A's private committed-success result storage, S09-B's fixed-kind private commit-wake schema/repository, O06's rollback-proven private point-commit transaction kernel, O07-A's read-only committed-outcome resolution, O07-B's atomic point publication and fixed-kind outbox production, C05-A's exact finishing transition, C05-B's fresh-process reconstruction/composition, O08-A's atomic exact-attempt replacement, O08-B1's bounded same-factory fresh-attempt handoff, O08-B2a's same-process runtime-neutral rerun composition, O08-CD0's transaction-decision provenance, O08-C's bounded known-settled SQL transaction retry, O08-D's bounded uncertainty recovery, O08-B2b1/C06-A's migration-0032 exact-attempt execution claim plus host-neutral admission, O08-B2b2a's private safe-state composer, O08-B2b2b1's migration-0033 bounded inert discovery indexes, and schema-free O08-B2b2b2a dirty/failed-attempt disposition are implemented. O08-B2b2b2b execution-claim liveness/renewal and production scheduling/redelivery and dispatch, C06-B endpoint/dispatcher policy, result-expiry policy, reconnect retention/retained-floor advancement, index sidecars, edges, target-native readiness, routing/activation, and prototype retirement are not implemented; C04C2 and O03-B2b2 snapshot-lease renewal remain conditional on proven consumers. |

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
- Ordinary app-document evolution may shadow-enforce at most one non-active
  candidate schema per scope while the active schema remains authoritative.
  The accepted fixed-frontier scan, concurrent-write, receipt, activation, and
  rollback contract lives in `05-managed-schema-deployment.md`. The separate
  private `@flarex/managed-schema` package owns compatibility and lifecycle
  policy; persistence and current commit/readiness owners receive only narrow
  adapters. `M01-A` provides only the pure bounded compatibility classifier;
  `M01-B` adds protocol-owned canonical progress, bounded failure-evidence,
  and final-receipt contracts without storage. `M02` adds a storage-free,
  read-only plan identity with exact active/candidate artifact and data-frontier
  pins, stable-ID-preserving rename intent, bounded non-sensitive evidence, and
  remediation/prerequisite data. Persistence, scanning, commit, readiness,
  activation, and every adapter remain separately gated.
- For the private Application revision generation, Application Analysis
  cold-loads the executable function-registration and schema modules from
  authenticated Source Artifact V2. Their loaded registrations and schema are
  the only analyzer acceptance inputs, and the strict immutable Application
  Manifest is the only analyzed table-definition authority. Canonical Declarative
  Program may remain an upstream authoring/code-generation compatibility input,
  while Semantic Artifact is historical evidence/decoding only; neither may be
  consulted after cold load as a second acceptance input. Names in normalized
  catalogs are verified assertions, not competing copies. This does not change
  roadmap 49's no-go production-cutover decision.
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
  deletes it before the lease/session transition. O08-A now deletes that root
  and its children before the exact lease, advances the parent fence, and
  atomically installs a fresh lease plus pristine database-time-seeded root.
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
- Relation IDs are allocated only after `R01` freezes the admitted semantics,
  `R01-P` selects one physical snapshot support/access plan, and `R02` binds the
  complete immutable meaning through post-analysis app-schema publication. The
  current strict `ApplicationManifestV1.schema` table/index shape must not gain
  an undeclared relation field, and current `SchemaManifestAppSchemaV1` must not
  gain undeclared relation bindings; `R01` owns an explicit analysis-contract
  evolution for canonical relation declarations, while `R02` owns a distinct
  post-analysis binding-contract evolution for stable catalog/physical IDs.
  Field and constraint projections stay deferred until a proven consumer needs
  them.
- Schema work is additive while the target proof is incomplete. Legacy tables
  are never reinterpreted as replacement tables. After equivalent target paths,
  tests, internal callers, and recovery are proven, remove those prototype
  tables without inventing a data-migration ceremony.

## Explicitly Deferred

- physical column, constraint-definition, and relation-definition catalogs;
- `fx_app_edge_rev` unless `R01-P` selects edge-history support, and an
  adjacency-version table unless `R01-P` selects version support; only `S12`
  may introduce current-edge storage plus the one selected snapshot-support
  representation, never both supports as parallel acceptance paths;
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
- [ ] `S02-E`: make scoped execution structurally mandatory and prove real-
  Postgres scope/fence isolation, pooled-connection cleanup, and cross-scope
  rejection.
  - [x] `S02-E0`: admit the persistence-owned kernel, package boundary, proof
    matrix, and no-RLS first-slice decision.
  - [x] `S02-E1`: implement the production-inert scoped-execution kernel and
    migrate one current query and one current writer through its opaque
    transaction capability.
  - [x] `S02-E2`: prove same-connection reuse, stale-authority rejection,
    rollback, interruption, settlement uncertainty, and quarantine on genuine
    PostgreSQL.
  - [ ] `S02-E3`: close production-intended bypasses, migrate the remaining
    located FlarexDB consumers, and hand the enforced boundary to `H05-B` and
    later `S02-D2` routing.

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

#### [x] S02-E0 — Admit The Mandatory Scoped-Execution Kernel

Decision: FlarexDB application-data operations must become impossible without
a trusted, transaction-scoped database capability. Application code and future
developer APIs remain scope-free: they name logical tables, indexes, documents,
and predicates, while trusted backend preparation selects the persisted scope.
No caller-authored `scopeId`, raw SQL string, physical table, Drizzle database,
or PostgreSQL client can establish application-data authority.

The first implementation stays inside `@flarex/persistence-postgres` under a
domain-first `scopeExecution/` owner. A new top-level `core` or adapter-neutral
package is rejected for this checkpoint: the guarantee depends on the concrete
PostgreSQL connection, transaction, clock lock, settlement, release, and
quarantine owners, and the current package direction already has executor and
Standard invocation depend on persistence. A later preflight may extract only
a proven host-neutral logical query/operation contract after a second concrete
adapter requires it; it may not move PostgreSQL lifecycle or authority into
that package.

The domain has two deliberately different lifetimes:

- `ScopeExecution` is the long-lived, stateless Effect service-shaped
  capability. Its live Layer captures no request, target, pool client, or
  transaction state: each operation supplies the resolver-issued located
  authority and target, while the target retains its existing pool/settlement
  owner. `ApplicationQuerySystem` consumes and provides that Layer at its
  composition boundary. The local multi-instance activation-target factory
  receives the same live capability explicitly rather than hiding target state
  in Context.
- `ScopedTransaction` is an opaque, package-internal value created for one
  request transaction. It is owned by Effect's uninterruptible
  acquire/use/release lifecycle, cannot be reconstructed structurally, cannot
  retain usable authority after its callback closes, and never becomes a
  global Context service. Persistence-owned registered operations consume it;
  application, Worker, route, executor, framework, and SDK code never receive
  a raw transaction.

The kernel sequence is fixed:

1. receive only a resolver-issued `LocatedTrustedScopeAuthority` and a package-
   owned operation; snapshot the complete deployment, scope, physical locator,
   storage generation, generation fence, and epoch before asynchronous work;
2. acquire the exact target connection through the located target owner and
   begin the requested isolation mode;
3. configure only transaction-local state. If the implementation uses a
   PostgreSQL scope setting or `search_path`, it must be transaction-local and
   parameterized; session-global `SET`, caller-authored identifiers, and
   interpolated locator SQL are forbidden;
4. lock/read the target scope clock inside that transaction and compare the
   exact scope, locator, generation, fence, and epoch before any domain read or
   write;
5. mint the opaque `ScopedTransaction`, run the persistence-owned operation,
   and keep every physical app-data predicate qualified by trusted
   `scope_uuid` plus its stable table/index identity;
6. commit or roll back through the existing located settlement owner; and
7. release only a demonstrably safe connection. Transaction uncertainty,
   connection failure, configuration failure, or cleanup failure quarantines
   or discards the connection instead of returning it to the pool.

This is capability enforcement, not HTTP middleware. HTTP, Queue, Task,
scheduled recovery, internal calls, and framework adapters enter through
different hosts, so none of them owns the guarantee. Their application-data
operations must converge below those hosts on the same scoped-execution
boundary. The Dynamic Worker continues to receive only restricted `ctx.db`
syscalls; the trusted snapshot/journal/commit adapters remain the only bridge
to persistence.

The first slice keeps the existing explicit `scope_uuid` predicates, composite
keys, stable catalog bindings, OCC journal, commit compiler, commit execution,
feeds, outbox, and outcome semantics. PostgreSQL RLS is optional defense in
depth and is not part of `S02-E1` or an excuse to weaken the capability guard.
Adding RLS, changing roles, or making a database/session setting authoritative
requires a separate evidence-backed preflight covering migrations, plans,
pooling, framework adapters, and operational recovery.

Failure ownership remains exact:

- missing, corrupt, or inconsistent persisted metadata is a terminal trusted-
  authority failure and never a compatibility default;
- a changed scope, generation, fence, or epoch rejects before domain work. The
  caller may re-resolve only through an operation-specific retry owner;
- ordinary callback failure preserves its typed domain Cause and proves
  rollback before release;
- acquisition/configuration/resource failures remain distinct from domain
  failures and are retryable only where their owning operation says so; and
- commit/cleanup uncertainty is never blindly retried. Existing durable
  evidence and idempotent outcome recovery remain authoritative.

`S02-E1` is the first implementation checkpoint. It must:

1. add the `scopeExecution/` domain contract, errors, live Postgres
   implementation, and opaque transaction capability without a new package or
   ordinary public raw-transaction export;
2. adapt the existing located transaction construction seam rather than create
   a second transaction wrapper;
3. route the current `ApplicationQuerySnapshot` read and the located point-
   mutation session-activation writer through the kernel, preserving their
   exact snapshot/OCC/commit behavior; and
4. add focused capability-authenticity, lifetime, stale-authority, and no-work-
   before-guard tests. It adds no route, binding, trigger, production caller,
   storage-generation switch, RLS policy, DDL, dual execution, or fallback.

Completion receipt: `scopeExecution/` now owns the stateless service and live
Layer, the final in-transaction scope-clock guard, registered opaque
read/write operations, and the WeakMap-authenticated `ScopedTransaction`
lifecycle. Dynamic callers cannot unwrap or retain a raw transaction, and a
direct raw-transaction result is rejected as a defect. `ApplicationQuerySnapshot`
and both located point-mutation session-activation branches use that kernel on
top of the existing read-committed settlement owner; query operations reuse the
kernel's locked clock and the index path derives its scope from the guarded
transaction context. Focused PGlite proofs
cover authentic, forged, expired, stale-fence, foreign-locator, rollback,
interruption, exact-replay, query revalidation, retained-history, snapshot-close
serialization, and ordered-index behavior. Persistence and Standard invocation
typechecks plus
the Effect runtime-boundary check pass. This receipt makes no genuine-
PostgreSQL pool or Hyperdrive claim; those remain `S02-E2` and `H05-B`.

`S02-E2` owns the genuine PostgreSQL proof. Its pool must deliberately reuse
the same backend connection, recording `pg_backend_pid()`, so a scope-A
transaction followed by scope B proves that no transaction-local scope,
`search_path`, timeout, listener, callback, or authority state survives reuse.
The matrix must also cover concurrent A/B access, cross-scope identity reuse,
wrong locator, stale generation/fence/epoch between preliminary resolution and
the clock lock, callback rollback, interruption, timeout, connection failure,
post-callback settlement uncertainty, release failure, quarantine, and safe
reuse only after known cleanup. PGlite remains the fast mapping lane but cannot
claim pool or connection-lifecycle proof.

`S02-E2` execution preflight keeps production behavior unchanged. A gated
genuine-PostgreSQL suite constructs the committed Postgres located-transaction
runner over deliberately bounded pools and invokes it only through
`ScopeExecution`. A one-connection lane proves sequential A-to-B reuse and
transaction-local reset; a two-connection lane proves simultaneous A/B
isolation. Fault lanes prove wrong-placement rejection before acquisition,
stale generation/fence/epoch rejection after preliminary resolution, callback
rollback, statement timeout, Effect interruption waiting for database
settlement, backend termination after callback completion, release failure,
connection quarantine/replacement, and reuse only after known cleanup. The
tests record backend PIDs and exact guarded scope context. They do not add a
route, schema object, migration, RLS policy, Hyperdrive binding, production
caller, fallback, or alternate settlement implementation. `S02-E2` cannot be
marked complete from a skipped environment-gated run; its completion receipt
requires the genuine PostgreSQL lane to execute successfully.

Completion receipt: the environment-gated S02-E2 suite executed against
genuine PostgreSQL 18. A pool capped at one connection recorded the same
`pg_backend_pid()` across scope A and scope B, reset transaction-local
`search_path` and statement timeout, removed its checked-out-client error
observer before reuse, and kept the same logical input bound to each guarded
scope's own persisted clock. A pool capped at two connections held A and B
simultaneously on distinct backend PIDs. Separate fault paths rejected foreign
placement before acquisition and stale generation, fence, and epoch before
domain work; proved rollback and statement-timeout cleanup on the same PID;
deferred interruption until the database transaction settled; and converted
backend termination after callback completion plus injected release failure
into uncertain outcomes that destroyed the affected connection before a new
PID could serve later work. The suite adds no production route, DDL, RLS,
Hyperdrive claim, or settlement path. S02-E remains incomplete until S02-E3
closes the production-intended bypass inventory.

`S02-E3` owns closure rather than new behavior. It inventories every ordinary
production-intended FlarexDB query, mutation, Task/System writer, recovery, and
framework-adapter construction seam; migrates them to the kernel or records an
explicit non-app-data reason; rejects unauthorized raw database/transaction
imports through an executable boundary check; and proves no package export,
route, Worker binding, or test helper can mint `ScopedTransaction`. System-test
raw seams may remain only behind explicit `internal/system-test` exports.

S02-E completion does not complete live Hyperdrive proof or production routing.
After `S02-E1`–`S02-E3` are green, `H05-B` must exercise the same kernel through
the cache-disabled hosted Hyperdrive path and mandatory teardown. Only then may
`S02-D2`, together with its other route-specific correctness gates, select
`legacy_v1` versus `flarexdb_v1` from persisted authority.

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
- [x] `S03-D3`: durable per-scope definition-to-build reconciliation over the
  authenticated immutable publication and located scope clock.
- [x] `S03-D4`: scope-clock-fenced validation/readiness derived from real
  target rows, physical builds, immutable Declarative V2 candidate/verifier
  evidence, and adapter evidence. Every readiness-relevant index-state
  mutation and readiness transition locks and revalidates the same located
  scope-clock row first. It never mutates activation and never discovers or
  rewrites declarative metadata. Legacy backfill/comparison evidence remains
  conditional on a changed shipped-state declaration.

  The relation-free first lane now settles one private canonical
  `flarex.system/application-revision-readiness-receipt/v1` receipt. Migration
  `0043` refuses non-empty dormant V1 verdict storage, retargets verdict
  ownership to the V2 attempt and exact inactive revision, and preserves the
  later activation FK without writing activation state. Expected missing or
  non-enabled builds remain non-persisted typed not-ready results; stale,
  corrupt, retryable, and uncertain outcomes stay outside that result.

Declarative V2 S1 owns verifier progress before S03-D4. Its private exact-key
repository uses database-time lease/fence claims and short
reserve/work/settle transactions over the S0 tables. Work occurs outside the
transaction; settlement locks the attempt first, validates page predecessors,
applies immutable evidence plus link/frontier version-and-previous-digest CAS
in fixed order, and clears pending state last. Takeover preserves a pending
reservation without recharging it. Uncertain settlement returns no receipt or
continuation and must be resolved from durable state. S1 never locks the scope
clock, must not be nested inside S03-D4/S04 transactions, and cannot produce a
verdict or readiness fact. S03-D4 later locks the scope clock first and consumes
only fully settled verifier evidence.

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
codec version. Build-state mutation was deliberately outside D2d and is now
owned only by the separate completed S03-D3 reconciliation boundary.
Readiness, active-schema activation, `S03-D4`, `S04`, app rows, production
replacement routing, Payload,
Medusa, and Cloudflare deployment remain outside
this facade. The standalone `O01` abstraction gate was retired before
implementation and its necessary scope-authority seam was folded into completed
`O02`; completed `S05-B` changes no catalog publication or routing behavior.
`S06`, `S07`, `S07-A`, protocol-only `O03-A1`, auth-provenance `O03-A2a`,
host-neutral grant authority `O03-A2b`, and A2c's located current-epoch plus
two-sided preparation boundaries are complete. This catalog gate does not
authorize `O03-B`, production metadata binding, checked revocation, or hosted
adapters.

#### Completed Boundary: S03-D3

S03-D3 reads the immutable schema artifact, recompiles its existing D1
physical requirements, and verifies the exact C3 definition and schema-version
binding projection before locating the deployment scope. The locator's
`databaseKey` and `schemaName` are opaque placement identity; the trusted target
resolver, not caller configuration, owns the actual database capability.

The located READ COMMITTED transaction locks and revalidates the scope clock,
then processes at most the existing 256-definition publication ceiling in
ascending definition-ID order. Missing rows are inserted as `declared` at the
locked commit frontier with cursor codec 1 and attempt fence 1. Exact-current
rows, including rows already advanced by a future builder, replay unchanged.
Rows fenced by an older generation, generation fence, or epoch are reset to
`declared` at the current frontier and increment their attempt fence so old
work cannot continue. Partial required sets complete atomically; contradictory
or corrupt rows fail closed. A commit-response uncertainty is observed through
the same located target before success can be reported.

Control publication and located build rows remain separately committed
authorities. S03-D3 re-reads the authenticated immutable definition set after
the target commit and reports typed change if it moved; it never claims a
distributed transaction or cross-database foreign key. Focused PGlite and
PostgreSQL 18 proofs cover replay, partial restart, stale fencing, rollback,
uncertain completion, concurrency, and shared/schema-per-scope/
database-per-scope locator behavior. No builder lifecycle beyond declaration,
readiness verdict, activation, route, or production trigger is introduced.

Exit gates for the complete S03 stream:

- stable table/logical-index IDs survive multiple schema versions;
- old/new physical definitions and builds coexist safely;
- cross-deployment parents/bindings fail closed;
- exact replay is idempotent and conflicting replay is typed;
- readiness follows real target validation and any required target-native
  population evidence; and
- no speculative field/relation/constraint catalog has become authority.

### [x] S04 — Establish Target-Local Activation Revision And Head Authority

Scheduling: Wave 4 after `S03-D4` has derived evidence-backed readiness. This
gate does not block the private test-generation point kernel or `C07`, but it
does own the production activation source that the checked preparation kernel
must consume before production prepared-start authority can exist.

S04 is not a mutable schema pointer layered beside package metadata. It owns one
target-local activation revision/head that coherently binds the
readiness-approved Declarative V2 candidate, package, artifact, immutable
source and semantic roots, declared handler/registration and validator roots,
schema artifact/bindings, both analysis projections, verifier identities, and
the exact located scope generation/fence/epoch.

Outcome:

- S03-D4 locks the located scope clock first and settles the exact readiness
  verdict without activation.
- S04 locks that same scope clock first, revalidates the complete readiness
  evidence, then CASes the target-local activation revision/head in one short
  transaction. The activation head is absent until an explicit activation;
  migration and candidate insertion never enroll it.
- Canonical immutable frames own semantic truth. Normalized columns are only
  local foreign keys, bounded pagination, fencing, metadata-first admission,
  and lock/CAS predicates. They are not an alternate active model.
- The coherent reader accepts only the exact active revision and rejects
  missing, stale, corrupt, partially ready, superseded, or mixed-version
  evidence. It never falls back to DeploymentDO, legacy package JSON,
  `activePackageId`, `analysisJson`, or `active_schema_version_id`.
- Retain incomplete, abandoned, rejected, superseded, active, and
  rollback-referenced evidence initially. Cleanup is a later owner and may not
  invalidate active, rollback, or readiness proof.
- Current production activation is approved only for the composed shared
  `primary/public` target. Schema-per-scope and database-per-scope activation
  remain blocked until their host composition and located transaction owner are
  proven.

Exit gates:

- injected failure, interruption, confirmed rollback, and commit-decision
  uncertainty cannot expose a partial or mixed activation;
- concurrent activation has one CAS winner and a typed stale loser;
- exact activate-request replay is deterministic and every failed or uncertain
  non-committed attempt preserves the previous usable revision. Dormant
  `action=rollback` storage remains unimplemented and unreachable;
- clean scopes resolve exactly one readiness-approved package/artifact/source/
  semantic/function-validator/schema snapshot; and
- V1 remains compatibility-only and PAM-ineligible with no fallback, shadow,
  dual write, or dual authority.

Migration 0035 and the private physical codecs/repository are the inert S0
foundation for this target. They create the candidate, verifier-progress,
evidence, verdict, revision, and head shapes but do not insert an activation
head, compose a production reader, mutate S03-D4 state, or authorize S04.
The private S1 verifier-progress repository consumes those shapes only through
non-finalizing reserve/work/settle. Its owner/fence, process tokens, progress
cursor, command root, and receipt are restart and concurrency evidence, not
readiness or activation authority. FSV05/S04 now consumes the independent
S03-D4 readiness receipt under the common scope-clock-first lock. It uses the
existing activation revision/head schema and physical frames without a
migration, supports only shared `primary/public`, and exposes only a private
coherent reader and coordinator. It adds no route, SAP04 invocation, or
production prepared-start authority.

C03-V now consumes that coherent reader without adding storage. Its scoped
opaque validator rechecks the exact scope clock and active head inside the
existing C03 point-operation transaction and validates insert, patch, and
replace results before journal/overlay persistence. Typed document validation
is catchable; stale, forged, corrupt, mixed, closed-scope, interrupted, and
defective authority remains fail-closed. C04B2 retains final live-overlay
validation as an independent defense. The setup-seeded C04B1 proof adapter is
still test-only. FSV06 now makes FSV05 plus C03-V the sole journal-construction
path for the private SAP04 vertical; adapter deletion remains gated on the
separate production prepared-start/caller replacement because the adapter is
still unreachable from production selection.

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
  or O08-A's production exact-attempt replacement primitive;
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

### [x] O08-B2b1/C06-A — Add Exact-Attempt Execution Claim Authority

Outcome:

- Migration `0032` adds one claim keyed by exact
  `(scope_uuid, session_id, attempt_fence)` ownership and a cascading FK to the
  C03 journal root. The row stores only the server owner, positive checked
  claim fence, database-owned claimed time, and finite expiry.
- O03 fence-1 activation and O08-A replacement create the initial claim in the
  same transaction before `running`; C05-A deletes the exact owner/fence while
  entering `finishing`. The migration deliberately performs no backfill or
  authority fabrication for pre-existing attempts.
- Claim expiry is separate from snapshot-lease, grant/hard expiry, and attempt
  terminalization. Live claims are busy; only an expired claim may be taken
  over under the locked scope/session/lease/root order and database time.
- Migration 0032 itself adds no renewal, discovery index, dirty-attempt policy,
  dispatcher, routed endpoint, runtime adapter, or crash-safe user-code
  redispatch; the separate bounded discovery indexes arrive in migration 0033.

Exit gates:

- fresh install, 0031 upgrade without backfill, replay, injected-failure
  recovery, non-public-schema parity, FK/check/cascade constraints, and Drizzle
  consistency pass; and
- PGlite plus isolated real Postgres prove atomic O03/O08-A creation, rollback,
  one-winner takeover, stale-fence rejection, settlement uncertainty, C05-A
  consumption, same-scope serialization, and independent-scope progress.

### [x] O08-B2b2b1 — Add Bounded Inert Attempt Discovery Indexes

Outcome:

- Migration `0033` adds exactly two access paths: the scope/claim-expiry/session/
  fence execution-claim index and the scope/update/session/fence partial index
  for `finishing` sessions. It adds no table, column, backfill, queue, trigger,
  claim state, or alternate authority.
- One package-private, read-only located-target operation returns at most 100
  frozen inert hints under one database-owned horizon. Its continuation is
  pagination data only; it carries no owner, claim fence, journal evidence, or
  process capability.
- Exact-selector B2b2a composition plus locked C06-A acquisition remains the
  sole authority path. O08-B2b2b2a now adds schema-free, claim-fenced dirty/
  failed-attempt disposition without changing migration 0032 or 0033. O08-
  B2b2b2b execution-claim liveness/renewal and production scheduling/redelivery,
  C06-B, routing, and runtime adapters remain pending.

Exit gates:

- fresh install, 0032 upgrade, replay, injected-failure recovery, schema parity,
  and Drizzle consistency prove the exact two-index migration; and
- PGlite and isolated real Postgres prove bounded global pagination, authority-
  bound continuations, contradictory-state rejection, scope isolation, and
  index-backed plans without discovery writes or capability minting.

### [x] S10 — Add Index Revision And Current Sidecars

Outcome:

- Migration `0040` adds package-private `fx_app_index_entry_rev` history and
  `fx_app_index_entry_current` live pointers. Immutable revisions bind physical
  definition, table and row identity, Ordered Index V1 codec identity,
  immutable physical-spec SHA-256, canonical key bytes and SHA-256,
  previous/current commit provenance, and the exact authoritative
  app-row revision/epoch. The current row duplicates only live pointer identity;
  tombstones remove it while history retains chain-head provenance.
- The transaction-only append/CAS primitive consumes only the exact
  persistence-minted, scope/deployment-bound located-definition receipt,
  derives definition/table/spec as
  one authority value, validates canonical keys against the located physical
  spec, rejects live entries over exact row tombstones,
  and supports deterministic insert, move, and tombstone chains without adding
  a second commit owner. Exact
  snapshot/current range readers use half-open byte bounds plus the separate
  physically validated row-identity tie breaker and verify the located
  physical-spec commitment plus stored canonical key/digest before returning
  frozen pages.
- Bounds and continuations remain typed read inputs rather than stored entry
  state. The module is not a package-root mutation surface and adds no build,
  readiness, activation, planner, OCC, route, trigger, or legacy bridge.

Exit gates:

- PGlite proves fresh install, 0039 upgrade, replay, injected-failure rollback,
  ordering, exact bounds, composite pagination, key movement, tombstones,
  history, live-current churn cleanup, stale-chain cleanup, malformed-key and
  digest-corruption rejection;
- isolated real PostgreSQL proves snapshot/current reads, concurrent replay
  with one immutable winner, and the intended scope/definition/key plans; and
- key hash equality is verified against canonical bytes on every returned row.

### [x] S11 — Add Unique-Key Storage

Outcome:

- Add scope/constraint/canonical-key claims with hash, owning row,
  schema/codec version, and provenance.
- Freeze sparse, null/missing, localized, delete, and reuse behavior.

Implemented boundary:

- Migration `0041` adds `fx_app_unique_key`, a current target-native claim
  table keyed by scope UUID, constraint ID, canonical locale, and canonical
  key SHA-256. Each claim retains Ordered Index V1 codec identity and bytes,
  the owning table/row, schema version, write epoch, and commit sequence, with
  foreign keys to the scope clock and exact authoritative app-row revision.
- The package-private transaction-only mutation canonicalizes at most fifteen
  unique components plus the locale prefix, treats sparse top-level missing as
  omission while preserving explicit null as a distinct claim, verifies equal
  digests against equal canonical bytes, and performs claim, provenance
  advance, release, and reuse inside the caller's existing transaction. Its
  named Effect operation has `R = never`, preserves domain failures, maps
  foreign persistence failures once, and separately validates authoritative
  app-row lineage from prior unique-claim lineage.
- This slice does not resolve semantic constraint definitions or start a
  transaction. C08 remains the owner that lowers trusted final rows into these
  claims; O09 remains the owner of concurrent-contention and multi-row
  rollback integration. Exact mutation replay remains with the existing outer
  point-commit idempotency/outcome owner because current terminal state cannot
  authenticate the same prior-claim facts; repeated claim and release requests
  therefore fail closed locally.

Exit gates:

- insert/update/delete/reuse is atomic;
- the same key may exist in another scope;
- collisions cannot overwrite claims; and
- O09 separately proves concurrent contention and rollback.

Evidence:

- PGlite proves canonical sparse/null/missing/locale behavior, claim advance,
  conflict without overwrite, delete/reuse, cross-scope reuse, forced digest
  collision rejection, caller-owned transaction rollback, fresh migration,
  `0040` upgrade, injected migration rollback, and fail-closed repeated claim
  and release;
- genuine PostgreSQL 18 proves claim, repeated-claim rejection, conflict, and
  cross-scope behavior with zero skips; and
- typecheck, build, Drizzle metadata, Effect-boundary, and diff checks remain
  green without adding a public export or production caller.

### [ ] R01 — Freeze Relation Semantics And Stable Identity

Outcome:

- Freeze only the first admitted native subset: same-scope, top-level,
  nonlocalized, monomorphic relations; duplicate target occurrences are
  rejected; inverse cardinality is reverse-many; every target must be live at
  commit; and target deletion uses `restrict`.
- Defer nested or localized occurrences, polymorphic targets, reverse-one,
  `detach`, and `cascade` to separately approved relation gates. Their codecs,
  claims, delete races, and activation rules are not inferred from the first
  subset.
- Separate stable logical `relation_id`, immutable semantic relation
  definition, and immutable physical edge definition. Classify every semantic
  change as API/policy-only, validation-only, or edge-set/read-key changing.
- Freeze the first-subset canonical occurrence codec and version, including the
  top-level source path, source/target identity, explicit locale absence, and
  retained collision evidence. Position remains ordering only and cannot make a
  duplicate target valid.
- Treat the cold-loaded executable function-registration and schema modules and
  the strict Application Manifest emitted by current Application Analysis as
  the sole declaration and analysis authority after cold load. A generated
  Standard input may use
  Canonical Declarative Program as upstream code-generation input, but neither
  its bytes nor Semantic Artifact evidence can validate or supplement the
  loaded result.
- Preserve one authoritative app/CMS row when Payload exposes an existing
  table.

Exit gates:

- every supported relation has unambiguous semantic identity;
- every lowering/read semantic states whether it preserves the existing
  physical edge definition or requires a replacement;
- duplicate targets and every deferred nested/localized/polymorphic/reverse-one
  or non-`restrict` shape fail Application Analysis before publication;
- the target-live and `restrict` meanings are exact enough for `C09` to prove
  same-commit final-state and concurrent insert/delete behavior without a
  fallback;
- the strict Application Manifest contract has one explicit evolution path for
  the admitted relation meaning rather than a silent field addition or second
  declaration authority;
- digest collisions cannot silently alias two canonical occurrences.

### [ ] R01-P — Select Relation Snapshot Support And Access Plan

Prerequisite: `R01` has frozen the first admitted semantic and occurrence
contract. This preflight must finish before `R02` binds physical meaning or
`S12` adds DDL.

Outcome:

- Keep current edge occurrences as the rebuildable present-state sidecar and
  select exactly one physical exact-snapshot support: immutable edge-occurrence
  history, or an adjacency version atomically advanced for every matching
  current-edge change.
- Freeze the current-edge outgoing/incoming access key and the selected
  support's equality prefix, total order, covering columns, snapshot
  reconstruction or validation rule, writer update obligations,
  backfill/repair behavior, and any O11 retention/anchor contract.
- Compare both candidates on genuine PostgreSQL with populated same-scope data,
  high-fanout endpoints, tenant and endpoint skew, insert/delete/retarget/reorder
  churn, concurrent writers, representative `EXPLAIN (ANALYZE, BUFFERS)` plans,
  index size, write amplification, lock contention, and vacuum pressure. PGlite
  remains useful for semantics but cannot select the physical authority.
- Record why the rejected candidate loses and the evidence boundary under which
  the decision must be reopened. O10-R later implements the selected support;
  it does not choose again.

Exit gates:

- one candidate is selected and one rejected with reproducible real-Postgres
  receipts under accepted ceilings and skew;
- the selected key/version or history identity covers ordinary commits,
  managed backfill, repair, stale-definition coexistence, and rollback without
  an unbounded commit-feed scan;
- edge-history selection includes retained-floor/anchor behavior, while
  adjacency-version selection fixes its granularity and every event
  that advances it; and
- no DDL, compiler, reader, or activation gate may retain the rejected candidate
  as a compatibility or fallback path.

### [ ] R02 — Bind Analyzed Relations Into App-Schema Publication

Prerequisites: `R01` and `R01-P` are complete for the admitted subset.

Outcome:

- Allocate stable relation IDs with optimistic stale-plan discipline.
- Consume the R01-frozen Application Manifest evolution through current
  Application Analysis so it carries only canonical analyzed relation
  declarations and analysis-local ordinals, never deployment-stable relation or
  physical-edge IDs. Do not reinterpret `ApplicationManifestV1` or accept a
  second relation declaration during migration.
- From that exact manifest, bind separately typed immutable semantic-relation
  and physical-edge definition identities through post-analysis app-schema
  publication. Persist the stable IDs, complete version-pinned semantic
  definition, edge-definition binding, and `R01-P`'s selected immutable read key
  and snapshot meaning in one explicitly evolved bound publication contract.
  Keep normalized definition tables deferred unless the chosen identity or
  build authority proves one necessary.
- Pin the analyzed manifest digest and bound publication digest together. A
  consumer must never infer that an analyzer ordinal is a catalog ID or accept
  either artifact without the other.
- Treat rename/retarget/cardinality/delete-policy changes as explicit schema
  evolution decisions. For the admitted subset, polymorphism, localization,
  reverse-one, `detach`, and `cascade` remain typed rejections rather than
  evolution options.

Exit gates:

- exact analysis replay preserves canonical declarations/ordinals, while exact
  binding replay preserves stable IDs and conflicts fail closed;
- logical relation, semantic definition, and physical edge definition
  identities cannot be interchanged;
- a compatible new semantic definition can deliberately reuse one physical
  edge definition, while physically different definitions cannot alias;
- old and replacement edge definitions can coexist and can be resolved by
  edges, plans, dependencies, and later build/readiness state;
- the analyzed manifest carries every declaration semantic, while the bound
  publication carries stable identities plus selected read-key/snapshot meaning;
- C09 can pin and verify both artifacts without consulting mutable active state;
- no second mutable definition authority exists.

### [ ] S12 — Add Stable Current Edges And Selected Snapshot Support

Prerequisite: `R01`, `R01-P`, and `R02` are complete for every accepted
relation.

Outcome:

- Add current edge occurrences plus exactly the `R01-P`-selected snapshot
  support: immutable edge-occurrence history or the selected adjacency-version
  authority. Do not add the rejected support for comparison, fallback, or later
  choice.
- Key every edge to the stable logical relation and exact immutable physical
  edge definition that produced it.
- Derive occurrence identity from the versioned canonical occurrence codec over
  edge definition, source row, top-level path, absent locale, target row, and
  occurrence identity; retain the evidence required to detect digest collisions
  and reject duplicate targets.
- Store list position only as ordering metadata.
- Add edge-definition-aware outgoing and incoming access paths only after
  their exact equality prefix, ordering, covering columns, and bounded-read
  semantics are frozen by `R01-P`/`R02`.
- When history is selected, make edge revisions participate in the accepted
  retained-floor and anchor rules. When adjacency versions are selected,
  persist and transactionally advance their exact granularity for commits,
  managed backfill, and repair.

Exit gates:

- duplicate targets fail closed before edge publication;
- reorder preserves identity;
- top-level path changes, source deletion, retarget, and stale cleanup pass;
- collision fixtures fail closed without overwriting an edge;
- absent locale, nullable position, and total bounded order match the R01/R02
  contract;
- genuine PostgreSQL proves the selected high-fanout/skew access plans and
  write path under the accepted ceilings, not merely empty-table index use;
- no nullable relation or physical edge-definition ID is introduced; and
- the rejected snapshot support remains absent.

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
