# FlarexDB Medusa Commerce Adapter And Link Semantics

Status: accepted adapter-boundary correction; no Flarex-backed Medusa adapter
is implemented or production-authorized by this note

Last reviewed: 2026-08-30

This note owns the intended mapping from Medusa's persistence, repository,
module-link, transaction, workflow, and locking contracts onto FlarexDB. It
does not redefine Medusa commerce behavior or the native FlarexDB application
relation contract.

Use these documents with it:

- [`flarex-db-accepted-design.md`](./flarex-db-accepted-design.md) owns the
  general database, transaction, commit, and framework-authority decision;
- [`flarexdb-native-relational-system.md`](./flarexdb-native-relational-system.md)
  owns the implemented application-relation kernel and its current limits;
- [`flarexdb-payload-relational-adapter.md`](./flarexdb-payload-relational-adapter.md)
  owns CMS exposure and Payload lifecycle authority; and
- focused roadmaps and code own implementation status.

## Decision

Medusa may use FlarexDB as its physical persistence substrate without turning
Medusa tables into public application tables and without replacing Medusa's
semantic layer.

```text
Medusa APIs, modules, services, workflows, Query, and Link
  -> Medusa-owned semantic and transaction lane
  -> Flarex-backed Medusa persistence adapter
  -> reserved scope-bound commerce tables and commerce-link entities
  -> shared Flarex transaction, commit, feed, outbox, and relation primitives
  -> authoritative Postgres storage
```

This is one data-plane authority with several semantic lanes, not a universal
database API and not two independently committing transactional cores.

The public application API remains document-first. Application developers use
`ctx.db` and declared Flarex relations. They do not receive Medusa repository,
Link, ORM, transaction-manager, migration, or raw SQL authority.

## What "Part Of FlarexDB" Means

Medusa tables can be part of a Flarex application scope while remaining
reserved system-owned commerce tables. In particular:

- the Flarex schema/catalog identifies their scope, generation, visibility,
  ownership, and current Medusa compatibility profile;
- Postgres stores their authoritative relational rows;
- the Medusa adapter supplies the repository and transaction behavior expected
  by unchanged Medusa modules;
- accepted writes join the Flarex scope clock, commit/change feed, and outbox in
  the same Postgres transaction; and
- app, CMS, sync, backup, migration, and operator surfaces see only the
  capabilities their owner grants.

It does **not** mean:

- serializing every Medusa row as a public JSON document;
- translating every Medusa query into public `ctx.db` calls;
- removing relational columns, indexes, unique constraints, or useful physical
  foreign keys merely because Flarex also has an edge kernel;
- exposing `fx_medusa_*` tables through the developer schema; or
- making Flarex core own prices, carts, fulfillment, inventory, orders, or
  other commerce invariants.

Physical storage is an implementation of the Flarex-owned database authority.
It is not itself the product API or semantic owner.

## Schema Inputs And Compilation

Medusa DML is necessary but not sufficient. The schema compiler must consume a
pinned, source-audited input set:

```text
DML model definitions
+ module and service ownership
+ ModuleJoinerConfig and Link definitions
+ index, unique, nullable, default, and soft-delete behavior
+ migration history, backfills, triggers, and compatibility transforms
+ custom repositories and database-specific query capabilities
+ workflow and locking persistence requirements
  -> immutable Flarex Medusa schema artifact
```

The preferred integration reuses or extracts Medusa's DML semantic model and
compiles it into a Flarex-owned intermediate representation. It must not
manually duplicate all Medusa table declarations in a second schema language.
The compiled artifact records provenance and fails closed when a module uses an
unsupported persistence capability.

Schema generation does not erase migration history. Some Medusa migrations
express data transformations or compatibility behavior that cannot be inferred
from a final DML shape. Runtime and migration capabilities therefore remain
separate trusted roles.

## Three Relation Profiles

Flarex should not force application relations, Medusa links, and cross-domain
references into one semantic shape merely because all three connect IDs.

### 1. Application-derived relation

An authoritative application or Payload row stores a declared scalar or list
of target IDs. The trusted Flarex compiler compares prior and final values and
derives materialized current edge rows plus adjacency versions.

This profile owns application relation semantics such as target liveness,
duplicate rejection, bounded reverse reads, OCC dependencies, and the selected
delete policy. The source row remains authoritative; the edge sidecar is
derived and rebuildable.

### 2. Commerce-owned link entity

A Medusa module link is an explicit commerce entity with Medusa-owned identity,
lifecycle, module boundaries, delete/restore behavior, query shape, and
possibly additional data. Its authoritative representation is the reserved
commerce link row, not an ID array embedded in a public application document.

```text
commerce link command
  -> authoritative reserved link row
  -> optional derived outgoing/incoming edge occurrences
  -> adjacency versions, OCC/change facts, and bounded reverse lookup
```

The native edge machinery is reusable for endpoint indexing, adjacency OCC,
change facts, and bounded traversal. It does not replace an authoritative link
row when the link has metadata or an independent lifecycle.

An adapter may omit a redundant edge projection when the reserved link table's
own indexes and transaction semantics already provide the complete required
behavior. That choice must be made by a measured commerce-link profile, not by
creating two competing authorities or dual write paths.

### 3. Application-to-commerce reference

An application or CMS extension normally stores a typed Flarex-owned reference
to a stable commerce identity. That reference can use an application relation
profile after the cross-owner target and lifecycle contract is designed. It
does not automatically become a Medusa Module Link.

The owning app or CMS command may change its reference. It may not mutate the
referenced product, cart, order, price, inventory item, or other commerce state.
Commerce changes flow through stable IDs and transactional change/outbox
events.

## Relation Kernel Reuse And Required Extensions

The current native Flarex relation kernel is a credible substrate: it has
physical current-edge rows, incoming and outgoing access paths, adjacency
versions, atomic commit lowering, target-liveness validation, restrict delete,
source cleanup, bounded reads, and Postgres concurrency evidence.

It is not yet a complete Medusa Link implementation. A commerce proof must
define or add, where Medusa requires them:

- explicit attach, dismiss, and idempotent replay semantics;
- link-owned fields and authoritative link identity;
- soft delete, restore, and visibility rules;
- reverse-one or other uniqueness/cardinality constraints;
- detach, cascade, restrict, or workflow-owned cleanup policy;
- cross-module and cross-owner endpoint authorization;
- composite or non-Flarex application row identities;
- polymorphic endpoint definitions;
- module query filtering, ordering, pagination, and batch behavior;
- migration/backfill and relation-readiness behavior; and
- relation/link change facts needed by Query, workflows, sync, and projections.

These additions must be capability profiles over shared primitives. They must
not silently widen the first public application-relation contract.

## Transaction And Workflow Authority

Medusa retains a bounded commerce transaction lane behind its repository,
transaction-manager, module, Link, Query, workflow, and locking boundaries.

```text
resolve authenticated Flarex scope and Medusa generation
  -> open one scope-pinned Postgres transaction
  -> run one bounded Medusa-owned repository/workflow step
  -> validate commerce and adapter invariants
  -> Flarex finalizer records commit/change/outbox evidence
  -> commit once
  -> release post-commit events and wakes
```

The adapter may author accepted commerce rows and links. It may not mint scope
commit sequences, edit the scope clock, fabricate application OCC evidence, or
publish events before the database transaction commits.

Long-running workflows remain a sequence of durable Medusa workflow steps and
bounded transactions. A database transaction or lock must not remain open
across arbitrary user code, remote APIs, delays, or workflow suspension.

There is no generic atomic `ctx.db + ctx.commerce` transaction. If application
extension state is part of a commerce invariant, a Medusa-owned facade or
workflow must own the complete operation. Ordinary display, search, analytics,
or customization state follows commerce events idempotently.

## CMS And Dashboard Interaction

CMS exposure and commerce ownership remain independent:

- reserved commerce tables are hidden from ordinary `ctx.db` and `.cms()`;
- commerce editing uses Medusa APIs, workflows, and commerce-oriented dashboard
  experiences;
- Payload may manage a separate content/extension table that references a
  stable commerce ID;
- Payload hooks and dashboard writes may change the CMS-managed extension row,
  but cannot directly change the referenced commerce row; and
- a combined dashboard may compose Medusa and Payload views while commands are
  still routed to their owning semantic lane.

Directly marking a Medusa product, order, cart, price, or inventory table as
Payload-managed would create two lifecycle authorities and is rejected. If a
future product requires shared editing of one logical concept, it needs an
explicit facade and conformance contract, not parallel `ctx.cms`, `ctx.db`, and
`ctx.commerce` writers.

## Query And Read Models

Medusa repositories and Query must preserve the behavior expected by unchanged
module code, including filters, nested predicates, ordering, pagination,
soft-delete visibility, relation/link expansion, and transaction-local reads.

The adapter may compile those operations to relational SQL over reserved
tables, typed Flarex persistence operations, or a combination. It does not need
to force Medusa through the public document query API.

Derived search, storefront, analytics, and CMS projections are read models.
They follow committed commerce facts and can be rebuilt. They must not become a
second commerce write authority.

## Scalability And Evidence Standard

The existing application edge proof is useful evidence, not Medusa scalability
admission. It currently demonstrates bounded indexed pages, a 20,000-source hot
endpoint profile, adjacency OCC, and concurrent Postgres writers. Medusa adds
different link shapes, query breadth, soft-delete behavior, and workflow
contention.

A Medusa-backed profile must measure at least:

- representative Product, Variant, Price, Sales Channel, Inventory, Cart, and
  Order row and link distributions;
- high-fanout and hot-link attach/dismiss workloads;
- module query plans and bounded page work;
- concurrent repository transactions and lock behavior;
- soft-delete, restore, unique-key, and link-cleanup races;
- commit/feed/outbox write amplification;
- migration and backfill time; and
- per-scope contention introduced by the shared scope clock.

Current application-edge limits such as page size, fanout profile, and
transaction occurrence ceilings do not automatically become correct commerce
limits. Exceeding a measured profile requires a new design receipt rather than
silently removing bounds.

## Admission Sequence

This note does not authorize implementation. A future roadmap should use a
bounded sequence:

1. Pin the Medusa source revision and inventory DML, Link/Joiner, migration,
   repository, Query, workflow, and lock contracts.
2. Freeze a provenance-bearing Medusa schema intermediate representation and
   prove deterministic compilation for one small module.
3. Prove Currency or another relation-light module with unchanged integration
   assertions and a real Postgres transaction manager.
4. Prove Product read/list/query behavior and one real cross-module link.
5. Add attach/dismiss, soft-delete/restore, uniqueness, and concurrency proofs.
6. Prove Cart, Pricing, Inventory, Order, workflow, and lock behavior in
   success, rollback, retry, and crash-recovery scenarios.
7. Join accepted commerce commits to the Flarex commit/feed/outbox authority
   without a second publisher.
8. Prove one app/CMS extension reference without granting app or Payload code
   commerce-write authority.
9. Measure representative scale and only then consider production activation.

Passing a small adapter test means private compatibility progress. It does not
mean full Medusa parity, public availability, migration readiness, or
production routing.

## Rejected Designs

The following remain rejected:

- rewriting Medusa business behavior as generic Flarex document mutations;
- publishing Medusa Link as a developer schema language;
- treating link IDs embedded in JSON as sufficient Medusa relationship
  enforcement;
- maintaining an authoritative Medusa table and an independently authoritative
  Flarex edge record for the same link;
- exposing raw Postgres, ORM, migration, or transaction-manager capabilities to
  application code;
- letting `ctx.db` or Payload write reserved commerce tables;
- a universal transaction API spanning arbitrary app, CMS, and commerce code;
- holding SQL transactions or commerce locks across long workflows; and
- claiming compatibility merely because Medusa DML can produce tables.

## Current Verdict

The native relation core should be retained and reused. It is a real
transactional edge kernel, not a virtual-ID convention. Medusa can run on
Flarex-owned storage, but its tables remain reserved commerce schema and its
module links remain explicit commerce entities. The adapter should reuse the
edge/OCC/feed machinery where the semantics match and introduce narrow
commerce-owned profiles where they do not.

That gives Flarex one authoritative data plane without confusing one physical
database with one universal semantic API.
