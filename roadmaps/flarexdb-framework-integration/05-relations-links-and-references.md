# Relations, Links, And Cross-Domain References

## Status And Scope

Status: accepted authority profiles; framework implementations pending

This plan owns the boundary between application/Payload document relations,
relational foreign keys, Medusa Module Links, derived adjacency projections,
and cross-domain references.

It does not redefine the implemented native application-relation contract in
[`../flarexdb-foundation/04-payload-relational-contract.md`](../flarexdb-foundation/04-payload-relational-contract.md).

## Shared And Separate Concepts

These concepts may be shared when their exact representation is proven:

- stable relation or link definition identity;
- owner-qualified endpoint identity;
- deterministic endpoint ordering;
- outgoing and incoming indexes;
- adjacency versions and bounded traversal;
- typed change facts; and
- atomic commit participation.

Authority, lifecycle, storage, and deletion policy remain profile-owned.

## Document Relations

Application and ordinary Payload content store relation values in the
authoritative document row. The authoritative Application lane or Payload
request transaction host lowers its owned mutation through the same trusted
row, index, unique, edge, and finalization machinery. Payload commands do not
enter the Dynamic Worker logical journal. That shared machinery derives edge
occurrences and adjacency versions from the final row value.

```text
source document field = authority
current edge rows      = derived projection
adjacency versions     = derived OCC/invalidation evidence
```

No framework adapter may independently create or delete these edge rows.

## Relational Foreign-Key Relations

Intra-module normalized relationships may lower to physical columns, foreign
keys, unique constraints, or pivot tables. The relational row or pivot is
authoritative.

Physical foreign keys are used only when endpoints share compatible local
scope, installation, migration, and deletion lifecycles. The schema compiler
must not manufacture a foreign key to an external or independently owned
service merely because Joiner metadata connects the entities logically.

## Commerce Links

Every non-read-only Medusa Module Link is an authoritative stored commerce
entity. Its admitted row preserves the link identity, endpoints, metadata,
timestamps, soft-deletion state, lifecycle events, and cascade behavior
required by the pinned Medusa contract.

Required storage behavior includes:

- stable link-table and endpoint identities;
- atomic endpoint-pair uniqueness;
- atomic one-side cardinality where the link is not a list;
- extra link data;
- attach, dismiss, soft delete, restore, and the exact duplicate/retry outcomes
  required by the pinned Medusa behavior;
- bounded filtered and paginated lookup;
- declared `deleteCascade`, dismiss, and owning soft-delete behavior; and
- typed commerce-link commit facts.

Application-level read-before-insert checks do not prove uniqueness under
concurrency. Constraints or equivalent transaction-safe enforcement are
mandatory.

A read-only Module Link is query/join metadata and creates no authoritative
link table.

## Adjacency Projection

An optional derived adjacency projection may accelerate reverse lookup,
bounded traversal, invalidation, Query integration, or sync. It is rebuilt from
the authoritative document field, foreign-key row, pivot, or commerce-link row.

The current application edge tables are fixed around application row identity,
source-document occurrences, and document deletion semantics. Do not widen
their identifiers or storage contract before a real commerce link proves an
exact reusable subset.

If a commerce link table's own indexes supply all required queries and change
facts, the adapter may omit a redundant adjacency projection. There must never
be two independently writable authorities for the same relationship.

## Cross-Domain References

An application or CMS extension may reference a stable commerce identity. That
reference is neither a Payload reverse join nor a Medusa Module Link.

A `CrossDomainReference` binds:

- source semantic owner and stable endpoint;
- target semantic owner and stable endpoint;
- exact compatible artifact bindings;
- cardinality;
- resolver and authorization policy;
- existence and staleness validation;
- delete, soft-delete, and visibility behavior; and
- whether validation is transactional or deferred.

The source owner may change its reference value. Only the target owner may
mutate target state.

Logical validation is the initial default. A physical foreign key requires
both endpoints to be local relational tables with deliberately coupled
lifecycles. Document-to-commerce references normally use stable logical target
identity plus committed change facts rather than a cross-owner physical key.

## Delete And Lifecycle Policy

Delete behavior belongs to the authoritative profile:

- application document relations use the native declared relation policy;
- Payload draft/version visibility may require distinct derived projections
  and cannot inherit published-row behavior silently;
- relational foreign keys follow their compiled constraint policy;
- Medusa links follow Medusa detach, cascade, soft-delete, restore, and
  workflow semantics; and
- cross-domain references use an explicit owner contract and cannot invent a
  cascade across semantic lanes.

Deletion and restore must update authoritative state, projections, typed facts,
and outbox evidence in the same owning transaction. During a data migration,
each authoritative mutation step or bounded page must atomically update its
row/link state and any required projections, facts, and outbox evidence.
Schema-only steps instead publish fenced migration receipts and readiness
evidence; an entire multi-step migration is not one long transaction.

## First Commerce-Link Proof

After Currency and Product relational storage work:

1. choose one real non-read-only Module Link with bounded fields, known
   cardinality, and two exact endpoint modules;
2. compile and install both endpoint modules plus the resolved Joiner/Link
   configuration as one complete configured candidate;
3. install its table, indexes, and constraints through the migration owner and
   limit pre-admission endpoint proofs to schema, startup, and read-only
   behavior;
4. complete the commerce-link commit-owner preflight and admit its
   transaction-bound receipt, typed fact, and every exact Link/endpoint event-
   intent contract exercised by the proof;
5. prove any required endpoint mutations, then adapt unchanged attach/dismiss
   behavior;
6. prove concurrent duplicate and cardinality enforcement in genuine
   PostgreSQL;
7. prove soft delete/restore and declared cascade behavior; and
8. measure whether a separate adjacency projection is necessary.

## Exit Criteria

- Each relationship has one authoritative representation.
- Read-only links create no stored authority.
- Constraints close concurrency races for claimed cardinality.
- Cross-owner references do not grant target mutation authority.
- Delete, restore, and migration behavior is explicit for every profile.
- Derived adjacency is rebuildable and cannot be written independently.
- Current application edge identity and ordering proofs remain intact.
- PGlite covers deterministic behavior and genuine PostgreSQL proves
  constraints, locking, and concurrent link operations.
