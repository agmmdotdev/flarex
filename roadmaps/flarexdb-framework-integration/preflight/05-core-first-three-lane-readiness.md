# Core-First Three-Lane Readiness

Status: accepted execution-sequencing preflight; consumer contract extraction
and shared-core implementation pending

Last reviewed: 2026-09-01

## Decision

Prepare the private Flarex mechanisms needed by Application, Payload, and
Medusa before promoting an active Medusa package or building either framework
adapter. The core is consumer-informed, not framework-shaped: exact Payload
and Medusa contract audits may run first and in parallel, but they authorize no
adapter, package promotion, runtime import, write path, or production binding.

The proof order is:

1. extract exact Payload and Medusa constraints from pinned source;
2. implement and prove only the framework-neutral storage mechanisms those
   constraints require;
3. prove the existing Flarex Application document and relation path still works
   end to end;
4. prove Payload scalar content and request-transaction behavior on that
   Application path;
5. prove Payload's first non-reactive one/many relation behavior on the existing
   native Application relation path; and
6. only then promote the first connected Medusa package closure and proceed
   Currency, Product, and one real stored Module Link in that order.

"Core first" does not mean one universal database, schema, transaction,
migration, relation, or query API. It means implementing exact shared
mechanisms once while leaving each semantic language and lifecycle with its
owner.

## Current Proven Baseline

The repository already proves two separate foundations:

- the private owner-qualified framework-artifact value, repository, DDL,
  admission, read/list, control-session, concurrency, settlement, recovery,
  interruption, and PostgreSQL evidence are complete; and
- private `SV-R Core` proves Application definition, analysis, binding,
  readiness, activation, document rows, OCC, native relation edges, mutation,
  authoritative source-document relation values, bounded incoming/reverse
  identity reads, commit publication, and PGlite plus genuine PostgreSQL
  behavior for the admitted non-reactive profile.

Those are real foundations, but they are not a framework-neutral relational
kernel. The following remain absent:

- `RelationalSchema`;
- installation, readiness, availability, and binding repositories for
  framework-owned relational installations;
- a framework migration plan coordinator and durable execution ledger;
- an owner-scoped relational transaction/store capability;
- transaction-bound relational mutation receipts and typed finalization;
- Payload configuration/content overlays and adapter behavior; and
- promoted Medusa packages or a Flarex-backed Medusa adapter.

The existing scoped-execution host is a useful seed, but its hidden transaction
is still Application-row-shaped. The current Application relation system is
complete for its admitted profile; it is not evidence that the absent reserved-
relational operations already exist.

## Semantic Ownership

| Lane | Retained semantic authority | Shared mechanisms it may consume |
| --- | --- | --- |
| Application | document manifest, rows, validation, OCC, native document relations, Application schema publication, and current command/query contracts | scope placement, existing managed-schema mechanics, transaction fencing, and common commit publication |
| Payload | collection/global configuration, access, hooks, validation, drafts, versions, localization, population, request nesting, lifecycle state, and Payload-compatible results/errors | Application document storage and native relations, framework artifacts/bindings, fenced request transaction mechanics, migration execution, and typed finalization |
| Medusa | DML, modules, repositories, Query, Joiner/Links, workflows, locks, idempotency, commerce migrations, events, and compatibility behavior | reserved relational installation, fenced relational transaction/store operations, migration execution, and typed finalization |

Application content and Payload content do not compile into
`RelationalSchema`. Payload content continues through the authenticated
Application definition, analysis, publication, managed-schema, document-row,
OCC, and native-relation path. A Payload content overlay references that exact
Application authority and adds Payload-owned policy and lifecycle identity; it
does not install a second content schema.

Medusa reserved relational storage does compile through `RelationalSchema`, but
Medusa DML, repository behavior, Query, Module Links, workflows, and lifecycle
semantics do not move into Flarex core.

Application document relations, Payload population behavior, and Medusa Module
Links remain three different contracts. Sharing identity, transaction, storage,
or publication mechanics does not merge them.

## Consumer Constraint Gate

Two source-backed audits may proceed in parallel before behavior code.

### Medusa source and capability map

Use only the admitted `third_party/medusa` fork pin as the integration source.
Map the exact mature DML grammar, DAL and repository contracts, static module
manifests, transaction propagation, Query, Joiner/Link, migration, workflow,
lock, idempotency, event, and unchanged-test closures. Classify each selected
capability as supported, deferred, or rejected and as unchanged, seam-adapted,
adapter-translated, or discarded.

This audit may produce fixtures and source maps. It may not promote a root
`@medusajs/*` package, import the island from Flarex, or create an adapter.

### Exact Payload contract preflight

Pin one exact Payload release and source revision. Map the database-adapter
contract, query/result/error behavior, request transaction nesting, migrations,
internal collections, hooks, access, enabled API surfaces, and the first scalar
and relation fixtures. Record supported, deferred, and rejected behavior.

This audit may constrain shared transaction, migration, binding, and receipt
contracts. It must not make Payload content a reserved relational schema, add a
Payload dependency or adapter, or authorize a write path.

Both audits must identify concrete consumers for every proposed shared
capability. A feature appearing in either framework is not enough by itself to
make the feature generic.

## Shared-Core Implementation Gates

### Relational schema value

The first behavior slice after the audits is the private value-only
`RelationalSchema` contract:

- owner-qualified stable identities;
- deterministic ordering and canonical encoding;
- digest and provenance;
- an exact admitted column, key, index, constraint, relationship, and
  persistence-capability vocabulary; and
- fail-closed unsupported-capability admission against source-audited fixtures.

This slice performs no DDL, installs no schema, compiles no live Medusa
candidate, exports no public DSL, and accepts no ORM object or raw SQL.

### Installation, readiness, binding, and migration coordination

After the value contract is proven, add the separately preflighted private
installation, readiness, availability, binding, plan, lease, ledger, receipt,
and recovery owners. Domain plans remain separate; only fenced execution and
evidence mechanics are shared.

The first execution proof uses a synthetic reserved-relational schema and must
cover fresh install, deterministic plan, replay, interruption and exact resume,
concurrent claimant fencing, lease loss, validation failure, readiness
publication, activation refusal before readiness, activation after readiness,
and retention of the previous installation.

### Transaction-owner admission

Before transaction/store implementation, complete the mandatory transaction-
owner preflight from
[`../04-transactions-and-commit-publication.md`](../04-transactions-and-commit-publication.md).
It must freeze the exact semantic owner and table capability, transaction
acquisition and lifetime, scope/generation/installation/binding revalidation,
isolation, nesting or savepoint policy, timeout, interruption, lock order,
settlement, and recovery boundary. This sequencing preflight does not authorize
that owner change.

### Owner-scoped relational transaction and store

Add a narrow private transaction host pinned to scope, placement, generation,
schema digest, installation, binding, and owner capability. It exposes only
typed operations admitted for one owner. It does not expose Drizzle, a `pg`
client, raw SQL, physical locators, the commit allocator, or an unrestricted
generic transaction.

Application retains its current row/OCC transaction path. Shared extraction is
allowed only for mechanics proven exactly identical; this preflight does not
authorize rerouting or rewriting the working Application path.

### Commit-owner admission

Before receipt or finalizer implementation, complete the mandatory commit-owner
preflight from
[`../04-transactions-and-commit-publication.md`](../04-transactions-and-commit-publication.md).
It must freeze every exact receipt/fact family, semantic issuer, authentication
rule, final-publication lock order, commit-dependency revalidation, replay
behavior, and feed/outbox projection. This sequencing preflight does not
authorize a new fact family.

### Mutation receipts and typed finalization

Every admitted write operation returns a transaction-bound receipt. Only the
common finalizer may validate receipts, allocate commit order, publish typed
facts, persist admitted event intents, and write the common outbox wake.

Receipt-family and finalizer changes require their separate transaction-owner
and commit-owner preflights. No adapter may publish directly, construct
arbitrary facts, or create a second feed or outbox.

The synthetic reserved-relational fixture does not create a semantic owner for
an authoritative change fact. Do not invent a generic relational-row fact or
mislabel the fixture as Application or commerce data. The shared-core proof may
prepare and authenticate a transaction-bound mutation receipt, but without an
admitted fact family finalization must reject it and the transaction must roll
back. The first committed reserved-relational runtime mutation waits for an
exact domain fact family under its own commit-owner preflight.

### Synthetic lifecycle and transaction proof

Before a framework adapter exists, prove one synthetic reserved-relational
vertical through artifact admission, installation, readiness, binding,
owner-scoped transaction, typed store operation, transaction-local read,
authenticated receipt preparation, fail-closed finalization rejection, and
rollback. Separately prove successful read-only transaction settlement and the
migration coordinator's committed lifecycle/readiness receipts. PGlite is the
fast lane; genuine PostgreSQL is mandatory for DDL, locks, fencing,
concurrency, settlement, rollback, and constraint claims.

Passing this gate proves only the shared reserved-relational mechanism. It does
not prove an authoritative reserved-relational runtime commit, Medusa
compatibility, or Payload behavior.

## Three-Lane Proof Order

### Flarex Application preservation

Run the complete existing Application document, OCC, native relation, commit,
and read path after the shared-core slice. Add only focused regression coverage
needed to prove no ownership, transaction, fact, ordering, or activation
behavior changed. Do not migrate Application rows or relations into the new
reserved-relational store merely to share code.

### Payload scalar and request transaction

After the exact Payload preflight, a separately accepted CMS request-transaction
host and Application commit-participation/finalization preflight, and a
separately accepted Application write-policy admission change:

- compile one scalar-only Payload collection through the existing authenticated
  Application schema path;
- bind one Payload content overlay to the exact active Application head,
  readiness, placement, stable table identity, and admitted policy/configuration
  digests;
- reject ordinary `ctx.db` writes to the newly Payload-managed table;
- route one private Payload command pipeline through a single request
  transaction;
- prove nested rollback, transaction-local reads, uniqueness, and exactly one
  Flarex commit/change/outbox publication; and
- keep public `ctx.cms`, dashboard routing, and production activation closed.

The CMS host may share transaction acquisition, fencing, settlement, and
finalization mechanics, but it composes only authenticated Application row and
relation capabilities for this content proof. It does not use the reserved-
relational host or the Dynamic Worker logical journal. Scalar content changes
reuse the exact admitted Application-row fact family; any new Payload lifecycle
sidecar fact requires its own later commit-owner preflight.

### Payload native one/many relations

First capture a new independently digestible relation-bearing Payload
configuration/provenance artifact. Its stable policy ID and ordinary write-
owner mode may remain unchanged, but its configuration digest must differ from
the scalar candidate. Compile that exact configuration through the existing
authenticated Application analysis/publication path and record the new digest
in the new Application artifact's per-table write-policy evidence. Build and
activate managed-schema readiness, then atomically rebind the Payload overlay to
that exact active Application head, schema/readiness/placement reference,
stable table/relation identities, stable policy ID/write-owner mode, and new
configuration digest. The previous overlay must stop serving after head
movement; no second content schema or dual-writer interval is allowed.

Then enable only top-level, nonlocalized, monomorphic one/many relations from
the completed non-reactive Application relation profile. Prove target liveness,
duplicate rejection, cleanup, restrict deletion, retarget, reorder, removal,
bounded forward population, bounded reverse identity behavior, authorization,
and Payload-compatible result shaping in PGlite and genuine PostgreSQL.

Repeated relation targets and every reactive, reconnect, resnapshot, or live-
invalidation claim remain deferred. `R03-B` and `SV-R Live` gate those reactive
claims only; they do not block this non-reactive proof.

### Medusa package convergence

Only after the synthetic shared-core, Application-preservation, Payload-scalar,
and Payload-relation gates pass may the first source-map-admitted, private,
test-only Medusa closure enter the active root workspace. The internal order
then remains:

1. connected Currency portability closure and unchanged compatibility baseline;
2. module-scoped preparation, Medusa transaction propagation, typed commerce-
   row/event-intent admission, and the Currency baseline;
3. Product plus its intra-module relationships and event-intent expansion;
4. both endpoint modules and typed link/event admission for one real stored
   non-read-only Module Link; and
5. custom repositories, Query, workflows, locks, idempotency, events, and
   broader modules only through later bounded gates.

Source mapping and fixture extraction may happen earlier. Package promotion,
adapter composition, schema installation, and writes may not.

## Required Evidence

| Gate | Required evidence |
| --- | --- |
| Consumer constraints | exact pins, source/package maps, capability matrices, dependency direction, retained test inventory |
| Relational schema | deterministic cross-process encoding/digest, stable identities, provenance, unsupported-capability rejection |
| Migration coordination | PGlite functional matrix plus genuine-PostgreSQL DDL, lease, lock, concurrency, rollback, and recovery receipts |
| Relational transaction/store | scope and binding revalidation, capability denial, transaction-local reads, timeout/interruption, fail-closed unadmitted-receipt rejection, rollback, read-only settlement, constraint and concurrency proofs |
| Typed finalization | receipt authenticity, explicit fact-family admission, no generic relational fact, one commit order, one feed/outbox path, replay and rollback behavior through an authorized lane |
| Flarex Application | full current document/OCC/relation/commit system regression without authority rerouting |
| Payload scalar | pinned behavior matrix, admitted CMS transaction/commit host, write-owner enforcement, nested request atomicity, exact result/error behavior, one publication |
| Payload relations | relation-bearing Application candidate/readiness and exact overlay rebinding, pinned one/many conformance, native edge reuse, no second relation authority, PGlite and PostgreSQL evidence |
| Medusa promotion | source-map closure, no island runtime dependency, unchanged tests, Worker bundle boundary, later Flarex adapter evidence |

## Stop Conditions

Stop and open the owning preflight if a slice would:

- invent a shared semantic grammar before an exact consumer requires it;
- route Application content through `RelationalSchema` or the reserved commerce
  store;
- give an adapter raw SQL, ORM, physical connection, migration-role, commit, or
  outbox authority;
- invent a generic or test-only relational change fact merely to make the
  synthetic proof commit;
- let one table have two ordinary write owners;
- merge native Application relations, Payload population, or Medusa Module Link
  semantics;
- promote or execute Medusa code before the named prerequisites pass;
- add Payload behavior before its exact release contract and Application write-
  policy gate are accepted;
- claim reactive relation behavior before `R03-B` and `SV-R Live` pass;
- change the current Application transaction, OCC, migration, or commit owner as
  an incidental framework step; or
- expose public, hosted, or production behavior.

## Next Authorized Slice

The exact Medusa package/capability source map and exact Payload contract
preflight are the next bounded source-analysis slices and may proceed in
parallel. They are read-only with respect to active runtime/package graphs and
may add only accepted design records, machine-readable maps, source-backed
fixtures, and inert verification tooling.

After both constraint records are accepted, the first behavior implementation
is the private value-only `RelationalSchema` contract. That slice stops before
DDL, installation, binding, transaction/store code, package promotion, or any
Payload or Medusa adapter.
