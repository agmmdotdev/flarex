# Historical Medusa And Payload Storage Research

Status: archived research summary; superseded for current architecture and
implementation decisions

Last condensed: 2026-08-30

This file previously accumulated the full architecture discussion that led to
the FlarexDB, Payload, and Medusa boundaries. It mixed early InstantDB-inspired
storage ideas, a universal session proposal, Payload field experiments,
Medusa source observations, rejected alternatives, and later corrections in
one long document.

The chronological detail remains available in Git. Do not append new accepted
decisions here.

## Current Sources Of Truth

Use these documents instead:

1. [`flarex-db-accepted-design.md`](./flarex-db-accepted-design.md) for general
   Postgres, transaction, commit, sync, Payload, and Medusa authority.
2. [`flarexdb-framework-storage-architecture.md`](./flarexdb-framework-storage-architecture.md)
   for shared artifact, installation, binding, migration, transaction,
   relation-profile, and commit-participation boundaries.
3. [`flarexdb-native-relational-system.md`](./flarexdb-native-relational-system.md)
   for application relation identity, physical edge storage, OCC,
   build/readiness, bounded queries, and current implementation status.
4. [`flarexdb-payload-relational-adapter.md`](./flarexdb-payload-relational-adapter.md)
   for CMS exposure, Payload lifecycle, write authority, and relation mapping.
5. [`flarexdb-medusa-commerce-adapter.md`](./flarexdb-medusa-commerce-adapter.md)
   for reserved commerce tables, DML/schema compilation, Module Link mapping,
   transactions, CMS interaction, scalability, and admission gates.
6. [`flarex-internal-db-schema.md`](./flarex-internal-db-schema.md) for the
   long-form logical schema inventory.
7. [`../roadmaps/flarexdb-foundation/README.md`](../roadmaps/flarexdb-foundation/README.md)
   for application-foundation execution and status.
8. [`../roadmaps/flarexdb-framework-integration/README.md`](../roadmaps/flarexdb-framework-integration/README.md)
   for shared-mechanism and framework-adapter execution order and status.

When any historical statement conflicts with those owners, the current owner
controls.

## Research Question

The original question was whether Flarex could provide one shared data plane
for document-first application data, Payload CMS behavior, and Medusa commerce
without maintaining separate independently authoritative databases.

The useful answer remains yes, with separate semantic and transaction lanes:

```text
document-first application API
  -> authoritative app rows + derived relational sidecars

Payload CMS
  -> Payload lifecycle/command adapter
  -> shared app rows or reserved Payload lifecycle stores

Medusa commerce
  -> Medusa modules/services/workflows/repositories
  -> reserved relational commerce tables and link entities

all accepted writes
  -> one Flarex-owned Postgres authority
  -> scope commit/change/outbox finalization
```

Sharing a physical authority does not make `ctx.db`, Payload Local API, and
Medusa repositories interchangeable.

## Durable Findings Preserved From The Research

- Postgres is authoritative for committed application, CMS, and commerce data.
- Application and simple Payload content are document-first typed rows with
  trusted derived indexes, uniqueness records, and materialized relation edges.
- Payload remains the owner of hooks, access, validation, drafts, versions,
  uploads, request transactions, and CMS-managed write behavior.
- Medusa remains the owner of modules, repositories, Query, Link, workflows,
  locks, soft deletion, and commerce invariants.
- Medusa can use Flarex-owned storage without exposing its reserved tables to
  application developers.
- Medusa DML is only one schema input. Link/Joiner definitions, migrations,
  custom repositories, Query capabilities, workflows, and locks also matter.
- A Medusa module link may be an authoritative reserved link entity. It is not
  equivalent to an ID array in a public document.
- Native Flarex edge identity, adjacency, OCC, traversal, and fact algorithms
  may be reused when semantics match. The current application edge table and
  row-identity codec are not automatically a Medusa Link store.
- An app or CMS table may reference a stable commerce ID without gaining the
  authority to mutate the commerce target.
- Flarex commits and outbox evidence must be joined atomically to the owning
  framework transaction before post-commit events are released.
- Query-sync and cache layers consume committed facts. They are not database
  authority and cannot repair a split write after the fact.
- Compatibility must be demonstrated with unchanged framework behavior and
  representative real-Postgres workloads, not inferred from table generation.

## Historical Proposals Rejected

The following ideas appeared during exploration and are not accepted:

- one universal SessionDO transaction engine for application, Payload, and
  Medusa operations;
- automatic atomic transactions spanning arbitrary `ctx.db` and
  `ctx.commerce` calls;
- rewriting Medusa business behavior as public document mutations;
- treating Medusa DML alone as its complete persistence contract;
- exposing Medusa Link as a public Flarex schema language;
- allowing Payload or `ctx.db` to write reserved commerce rows directly;
- treating embedded relation IDs as sufficient without trusted edge and
  integrity enforcement;
- keeping both a link row and a separately writable edge as authorities for
  the same relationship;
- holding SQL transactions or locks across remote work or workflow pauses;
- using cache freshness as the correctness boundary; and
- requiring VersionDO, DocCacheDO, or QueryCacheDO before authoritative
  Postgres and commit-feed semantics are correct.

## Proven And Unproven Boundaries

The private native application-relation vertical is implemented through
definition, analysis, publication, readiness, activation, commit lowering,
materialized edges, adjacency facts, OCC, and one bounded reverse query. It is
real relational infrastructure, but its first semantic profile deliberately
does not include every Payload or Medusa relationship shape.

A current Medusa source audit and a substantial Drizzle/SQLite static-module
proof now exist, but neither is a Flarex-backed persistence adapter or a
production migration lifecycle. A clean source pin, module-scoped persistence
preparation, value-only schema compiler boundary, repository and transaction-
manager adapter, Module Link constraints, migration activation, workflow/lock
proofs, unchanged module tests, representative scale evidence, and separate
production activation remain required.

The old research used physical names and implementation sketches that may no
longer match the current migrations. Current code and focused roadmaps are the
only source for implemented behavior.

## Provenance Rule

Use Git history when a discarded alternative, old source audit, or detailed
reasoning chain is needed. Promote a finding into an owning design note only
after rechecking it against the current repository and dependency versions.
This archive is a map to the decisions, not an implementation specification.
