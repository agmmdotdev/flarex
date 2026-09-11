# Relational Standard APIs

## Status And Scope

Classification: active focused execution plan and capability ledger.

The native non-reactive relation core is implemented privately. This roadmap
owns the remaining work to expose that capability through the Standard
Application definition and function-runtime APIs and then compose those same
APIs in `@flarex/system-test`.

This roadmap does not own relation storage, edge identity, commit lowering,
OCC, readiness, activation, or change-feed semantics. Those remain owned by
the FlarexDB relation foundation. It also does not own Payload or Medusa
adapters, general relational transactions, SQL/PGQ, query synchronization,
public SDK distribution, or production routing.

Checklist meanings:

- `[x]` means current code and decisive tests implement the stated capability.
- `[ ]` under **Standard And System-Test API Status** means required work is
  pending.
- `[ ]` under **Unsupported Or Deferred Capabilities** means the capability is
  deliberately unavailable; its reason and future gate must remain explicit.

## Current Sources Of Truth

The following authorities apply in descending order for their owned concerns:

1. [`../flarexdb-foundation/04-payload-relational-contract.md`](../flarexdb-foundation/04-payload-relational-contract.md)
   owns relation semantics, identity, storage, commit, OCC, readiness, exact
   reads, and the admitted profile.
2. [`../flarexdb-foundation/README.md`](../flarexdb-foundation/README.md) owns
   foundation gate status, including `RQ01`, `R03-A`, `SV-R Core`, `R03-B`, and
   `SV-R Live`.
3. [`../42-standard-application-apis.md`](../42-standard-application-apis.md)
   owns the clean Standard Application definition and invocation direction.
4. [`../09-sdk-and-cli-fork.md`](../09-sdk-and-cli-fork.md) owns later public
   SDK ergonomics, generated references, package publication, and the split
   between non-reactive and reactive public relation surfaces.
5. [`../11-testing-and-simulation-strategy.md`](../11-testing-and-simulation-strategy.md)
   and [`../15-test-sdk.md`](../15-test-sdk.md) own system-test evidence lanes
   and any eventual public test SDK.

Current implementation evidence includes:

- [`../../packages/flarex-protocol/src/relation-declaration-v1.ts`](../../packages/flarex-protocol/src/relation-declaration-v1.ts)
  for the exact declaration contract;
- [`../../packages/standard-application-definition/src/relationDefinition/`](../../packages/standard-application-definition/src/relationDefinition/)
  for private Standard preparation and source production;
- [`../../packages/standard-application-invocation/src/ApplicationRelationQuerySystem.ts`](../../packages/standard-application-invocation/src/ApplicationRelationQuerySystem.ts)
  for the private incoming relation operation;
- [`../../packages/persistence-postgres/src/applicationRelationCommit/`](../../packages/persistence-postgres/src/applicationRelationCommit/)
  and [`../../packages/persistence-postgres/src/applicationRelationRead/`](../../packages/persistence-postgres/src/applicationRelationRead/)
  for authoritative commit and read mechanics; and
- [`../../packages/system-test/test/integration/applicationRelationalCore.test.ts`](../../packages/system-test/test/integration/applicationRelationalCore.test.ts)
  plus its PostgreSQL peer for the private end-to-end relation vertical.

If this roadmap conflicts with the relation foundation about semantics or
authority, the relation foundation wins. If it conflicts with the Standard API
roadmap about shared Application API shape, the Standard API roadmap wins.

## Current Architecture

The authoritative relation value is stored in the source application row.
Current edge rows are derived, rebuildable adjacency sidecars. The trusted
commit compiler validates the final material row set and maintains row,
relation, adjacency-version, commit, feed, outbox, and outcome state in the
existing scope transaction.

The current private path is:

```text
exact internal relation declaration
  -> Standard source production
  -> Application Analysis and immutable relation manifest
  -> binding, build, readiness, and activation
  -> ordinary source-document mutation
  -> trusted relation validation and edge maintenance
  -> exact incoming reverse read through the active selection
```

The private relational system proof assembles this path directly. The general
`defineSimulation(...)` runner remains relation-free and does not compose the
relation query system. Therefore the engine is implemented, but a reusable
relational Standard or system-test authoring experience is not.

## Supported Native Relation Profile

The following capabilities exist in the private native core:

- [x] Relations connect tables inside one Flarex Application scope.
- [x] The authoritative relation is one top-level, nonlocalized source field.
- [x] A forward `one` value can be required or optional.
- [x] A forward `many` value carries minimum and maximum item constraints.
- [x] A forward `many` value may preserve declared ordering.
- [x] Duplicate target values are rejected.
- [x] One monomorphic target table is fixed by the relation definition.
- [x] The inverse maximum cardinality is `many` and is virtual/query-backed.
- [x] Every referenced target must be live in the transaction's final material
  state; a target inserted in the same commit may satisfy the relation.
- [x] Target deletion uses `restrict` and races safely with relation insertion.
- [x] Source deletion removes its derived outgoing edges atomically.
- [x] Forward IDs remain available from the authoritative source document.
- [x] One exact bounded incoming reverse read returns logical source identities,
  duplicate ordinal, position, and exhaustion.
- [x] An incoming read returns at most 128 identities and reads at most 129 base
  rows for lookahead; there is no caller-authored cursor.
- [x] Relation reads use the existing scoped snapshot and OCC owners rather than
  a second query engine.
- [x] Relation changes publish typed adjacency children through the existing
  commit feed and retention owners.
- [x] Existing rows are built and validated before a relation-bearing revision
  becomes ready and active.
- [x] One private ordered-many Application vertical proves definition,
  analysis, activation, mutation, edge maintenance, target-delete restriction,
  incoming query, and relation change facts in PGlite and genuine PostgreSQL.

The supported shapes cover common document-reference models:

| Source shape | Effective relationship |
| --- | --- |
| Optional or required `one`, inverse `many` | Many source rows to one target; one target to many sources |
| `many`, inverse `many` | Many-to-many pointer relation |
| Association represented as an ordinary table with relation fields | Many-to-many association with business data such as role, quantity, status, or timestamps |

This profile is sufficient for a first non-reactive Standard relation API. It
is not a general SQL relational API, arbitrary graph API, ORM population API,
or framework-parity claim.

## Standard And System-Test API Status

### Existing private seams

- [x] An exact private Standard relation declaration accepts the admitted
  profile and lowers it into the sole analyzed schema module.
- [x] A private Standard operation, `takeIncomingRelationSources`, resolves an
  authenticated active relation from its logical source table and path.
- [x] The private relational core system test proves real runtime mutation and
  direct Standard incoming read without reproducing persistence logic.

### Missing Standard API surface

- [x] Freeze an unversioned typed relation-definition handle owned by
  `@flarex/application-definition`. It must bind source field, target table,
  cardinality, ordering, bounds, inverse name, and delete policy without
  exposing protocol envelopes or physical identities.
- [x] Integrate relation definitions into the clean `ApplicationDefinition`
  preparation path. The implementation must lower to the existing exact
  relation declaration and must not widen or reinterpret an existing persisted
  or wire V1 contract.
- [ ] Freeze the first relation-aware function database operation. It should
  expose logical references and document IDs only and delegate to the existing
  active-selection snapshot and relation-read owners.
- [ ] Compose the operation into query function `ctx.db`. Mutation writes must
  remain ordinary source-document writes; the API must not expose user-authored
  edge CRUD or a second relation transaction.
- [ ] Define typed Standard errors and logical results without leaking relation
  IDs, edge-definition IDs, SQL cursors, adjacency versions, repositories, or
  persistence handles.
- [ ] Prove function-level authorization, validation, result validation,
  snapshot closure, dependency behavior, and bounded work through the normal
  query runtime.

### Missing system-test surface

- [ ] Make `defineSimulation(...)` accept a relation-bearing clean
  `ApplicationDefinition` through the normal preparation path rather than a
  separate raw relation fixture input.
- [ ] Make the system-test environment compose the same Standard relation-aware
  query runtime used by application code.
- [ ] Prove a realistic application query reads a relation through `ctx.db` and
  is invoked through the existing typed `client.query(...)` surface.
- [ ] Preserve existing `client.mutation(...)` for relation writes; relation
  maintenance remains an internal consequence of validated document writes.
- [ ] Add a separately named test inspection surface only if tests need direct
  edge, adjacency-version, or commit-fact assertions. Inspection must not be
  presented as an application/client relation API.
- [ ] Run the same relation-capable simulation and assertions in PGlite and
  ordinary-role PostgreSQL.

The primary realistic system-test path is deliberately:

```text
typed relation definition
  -> relation-aware query function using ctx.db
  -> ordinary typed function reference
  -> systemTestClient.query(...)
```

A top-level `systemTestClient.relation.read(...)` must not become the primary
application path because it would bypass function visibility, argument and
result validation, identity, authorization, and normal runtime execution.

## Unsupported Or Deferred Capabilities

- [ ] **Nested array, block, or group relation paths.** Ordinary Flarex arrays
  do not establish stable item identity. A nested profile requires a keyed
  item/block identity contract so reordering cannot silently change relation
  occurrence identity.
- [ ] **Localized relation occurrences.** Locale presence and spelling affect
  occurrence and read identity. A localized profile must freeze canonical
  missing-versus-empty locale semantics before storage or DDL changes.
- [ ] **Polymorphic targets.** This requires an explicit stable target tag,
  admitted target set, and schema-compatibility rules for target-set changes.
- [ ] **Repeated target values in one source field.** The admitted occurrence
  contract fixes the duplicate ordinal to zero. Repetition needs a separately
  accepted duplicate-occurrence identity and update contract.
- [ ] **Reverse-one or one-to-one relations.** This requires an exact incoming
  uniqueness claim plus build, contention, OCC, and schema-evolution behavior.
- [ ] **Cross-scope or cross-owner targets.** Current correctness relies on one
  scope clock, active definition, transaction, and commit authority. Cross-owner
  references require explicit coordination and failure semantics.
- [ ] **Detach on target delete.** Detach must patch every authoritative source
  row and regenerate sidecars; it cannot be implemented by deleting edge rows.
- [ ] **Cascade source deletion.** Potentially unbounded source deletion needs a
  fenced, retryable workflow with progress, visibility, idempotency, and partial
  failure contracts rather than hidden work in one bounded transaction.
- [ ] **Populated relation results.** The current relation operation returns
  identities. Population must compose authorized point reads and preserve their
  individual snapshot, dependency, validation, and budget behavior.
- [ ] **Caller-authored cursors and general pagination.** Stable cursor
  representation, snapshot continuation, stale-cursor behavior, authorization,
  and dependency semantics require a separate gate.
- [ ] **Relation filters, arbitrary ordering, joins, aggregates, or graph
  traversal.** These require predicate/range dependency evidence, bounded work,
  query planning, OCC semantics, and explicit authorization. They must not be
  inferred from the existence of an edge table.
- [ ] **Reactive relation queries, subscriptions, delivery, and reconnect.**
  Typed adjacency change facts exist, but fenced registration, contiguous
  catch-up, invalidation, generation-checked rerun, delivery, reset, and
  reconnect remain gated by `R03-B` and `SV-R Live`.
- [ ] **Payload or Medusa relation parity.** Framework adapters own their
  lifecycle, population, localization, link, workflow, transaction, and
  compatibility behavior while reusing native relation foundations.
- [ ] **SQL/PGQ or a generic relational transaction API.** These are separate,
  capability-gated query or trusted-adapter concerns and are not the Standard
  Application relation API.
- [ ] **Public SDK and production routing.** Public non-reactive ergonomics
  require their own accepted API preflight; reactive public claims additionally
  require `SV-R Live`. Production activation remains separately gated.

## Invariants And Trust Boundaries

- Source application rows remain authoritative; current edges are derived and
  rebuildable.
- Standard relation intent contains no stable numeric IDs, physical names, SQL,
  readiness state, or execution authority.
- Application Analysis remains the sole semantic acceptance authority for the
  executable schema module.
- The existing commit compiler and outer transaction remain the only relation
  validation, OCC, idempotency, sequence, result, publication, and wake owners.
- User code never receives persistence handles, physical relation identities,
  raw commit facts, or edge mutation authority.
- Relation-bearing activation fails closed until binding, build, readiness,
  exact read, and target-delete evidence agree.
- The Standard and system-test APIs must not create a second declaration,
  storage, query, cursor, transaction, or change-stream authority.
- Unsupported shapes must fail during definition analysis or strict operation
  decoding; reserved fields are not executable compatibility fallbacks.
- A system test must exercise the real Standard/runtime owners. It must not
  write relation catalogs or edge tables directly or reproduce relation logic
  in the test package.

## Decisions And Rationale

### The current profile is enough for the first API

The first Standard surface should expose the implemented non-reactive subset
instead of waiting for every advanced relational feature. That subset already
provides useful optional/required references, bounded collections, ordered
collections, many-to-many pointer relationships, association tables,
referential integrity, reverse lookup, OCC, readiness, and change facts.

The API and documentation must describe it as a bounded native document
relation capability. It must not imply arbitrary joins, full ORM behavior,
framework parity, or a general relational database.

### Standard owns semantics before system-test owns ergonomics

`@flarex/system-test` should compose the same definition and runtime operations
used by normal Application code. It must not become the owner of a parallel raw
relation DSL or a direct persistence-backed relation client.

### Function queries are the primary application boundary

Application workloads should read relations inside query functions and invoke
those functions through existing typed references. A direct relation inspector
may exist for assertions, but it is test authority and must remain visibly
separate from application behavior.

### Broader semantics remain fail-closed

Each deferred capability changes identity, uniqueness, transaction bounds,
snapshot/OCC behavior, authorization, recovery, or lifecycle semantics. It is
therefore safer to reject unsupported shapes than to approximate them with
fallback queries, silent edge behavior, or test-only logic.

## Convex Compatibility And Flarex Divergences

Flarex retains the Convex-like model in which application functions operate on
typed document IDs and application callers invoke typed query and mutation
references. Relation-aware system tests should preserve that function boundary.

Native declared relations are a deliberate FlarexDB extension. They add stable
relation metadata, referential policy, derived reverse adjacency, readiness,
and relation-specific OCC needed by Flarex framework-adapter goals. This record
does not claim that these declarations or a future `ctx.db` relation syntax are
existing Convex APIs.

## Known Gaps And Limitations

- The private relation declaration is raw protocol-shaped input rather than a
  typed clean Application definition handle.
- The private incoming operation bypasses a relation-aware function Worker and
  therefore is not yet a developer `ctx.db` capability.
- The general system simulation path is explicitly relation-free.
- The full private system vertical proves one ordered-many relationship; other
  admitted shapes have lower-level analysis, commit, and read evidence but need
  representative Standard function/system-test coverage.
- The bounded incoming result cannot enumerate an arbitrarily large reverse set
  because it exposes no continuation cursor.
- No live/reactive relation behavior may be claimed before `R03-B` and
  `SV-R Live` complete.

## Target Direction

Expose one small, typed, non-reactive relation slice through the clean Standard
Application API:

1. Relation definition handles lower to the existing exact Standard relation
   contract.
2. Query `ctx.db` receives one bounded logical incoming relation read backed by
   the existing active-selection snapshot owner.
3. Relation writes remain ordinary validated source-document mutations.
4. `@flarex/system-test` prepares relation-bearing applications and proves the
   runtime API through ordinary typed function invocation.
5. Test-only structural inspection, if required, remains a separate authority.

Only after that private Standard/system-test slice is complete should the SDK
roadmap decide public relation syntax, generated references, packaging, and
compatibility. Reactive APIs remain separately gated.

## Accepted Private Standard API Preflight

The clean definition API is `defineRelation(schema, input)`. It returns an
opaque relation handle bound to that exact schema; `defineApplication(...)`
owns a frozen `relations` collection beside its schema and modules. The input
names one top-level source table and field, one target table, a `one` or `many`
value shape, the inverse name, and `onTargetDelete: "restrict"`. Requiredness
for `one` agrees with the source validator; `many` carries minimum, maximum,
and ordering. Protocol format/version, localization, duplicate policy, stable
catalog IDs, edge IDs, and physical storage are not exposed.

The first runtime operation will be
`ctx.db.takeIncomingRelationSources(input)`. Its input contains only the
logical source table/field, target document ID, and a limit no greater than
128. Its result contains source document IDs, positions, and exhaustion. It
will execute on the ordinary query snapshot and RPC capability, use the
existing relation read port, share the query read gate and lifecycle, and add
the logical incoming relation dependency to evaluation capture. It will not
open a second snapshot, populate documents, accept a cursor, mutate edges, or
be available from mutation/action contexts in this slice.

Definition/preparation errors remain owned by the clean definition package and
the existing Standard relation preparation errors. Runtime boundary validation
will reuse the existing strict incoming-operation decoder, while persistence
and activation failures retain their current typed owners. Worker transport
must not serialize or reveal those internal failures as part of a successful
logical result.

## Next Correctness Gates

- [x] **RSA-P — Standard relation API preflight.** Freeze the relation handle,
  logical read operation, result, typed failures, function-runtime placement,
  package ownership, budgets, and explicit non-goals. Confirm that no existing
  wire or persisted contract changes meaning.
- [x] **RSA-A — Typed definition composition.** Add the clean relation handle
  and integrate it with `ApplicationDefinition` preparation while lowering to
  the existing exact internal contract. Prove one, many, invalid-field,
  duplicate-definition, and unsupported-profile cases.
- [ ] **RSA-B — Function-runtime incoming read.** Compose the existing exact
  incoming operation into query `ctx.db` with logical references only. Prove
  authorization, active-selection correlation, result validation, bounded
  reads, snapshot conflicts, and zero write-bearing state change.
- [ ] **RSA-C — Relation-capable system simulation.** Remove the relation-free
  limitation from the general simulation runner, compose the relation runtime,
  and prove a realistic typed query and mutation workload in both database
  lanes without importing private persistence fixtures into the simulation.
- [ ] **RSA-D — Representative admitted-profile matrix.** Prove optional one,
  required one, unordered many, ordered many, association-table composition,
  target-delete restriction, source-delete cleanup, and over-limit incoming
  behavior through the Standard/system-test surface.
- [ ] **RSA-E — Private API closure.** Run owning typechecks, focused suites,
  PGlite and ordinary-role PostgreSQL acceptance, lint gates, package-boundary
  checks, and required reviews before considering public SDK preflight.

Completion of these gates does not authorize Payload parity, reactive
relations, public package publication, or production routing.
