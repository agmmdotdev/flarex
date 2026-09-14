# Relations, Links, And Cross-Domain References

## Shared Logical Storage Authority

The accepted [shared logical storage decision](../../design-notes/flarexdb-shared-logical-storage.md)
and [redesign roadmap](../shared-logical-storage/README.md)
replace the former deployment-owned commerce physical-table destination.
Application, Payload and Medusa target generic physical families with logical
tables, indexes, constraints and relations. Core and integration flows may be
redesigned cleanly during development; adapters must not compensate for missing
core contracts. Framework semantic ownership and singular settlement remain.

Descriptions below of current generated commerce tables, SQL indexes/FKs,
installation receipts and completed tests are baseline evidence. They do not
override the replacement target or prove its implementation. Physical lifecycle
work with retained system consumers must be inventoried before removal.

## Status And Scope

Status: accepted authority profiles and cross-framework relationship target.
Private Payload relation and Medusa Link implementations provide baseline
evidence; the connected shared-logical Application/Payload/Medusa contract and
coordinated schema evolution remain unimplemented.

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

Semantic authority and lifecycle/deletion policy remain with the owning profile.
Shared core owns storage, declared constraint enforcement and derived indexes.

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

Native many-valued relations require a present array, including when their
minimum item count is zero. Optional Payload input does not make an absent
Application property valid. The [many-transition and population proposal](./preflight/21-payload-many-transition-and-bounded-population.md)
separates authoritative content conversion from derived edge backfill, and
implements bounded forward population over the optional-one relation.
Population shares the admitted CMS read request; native reverse
identity windows do not by themselves implement Payload join totals or paging.

## Logical Relational Constraints

The current physical-table baseline lowers intra-module relationships to columns,
foreign keys, unique constraints or pivots. The target retains authoritative
logical fields/pivot records and their declared guarantees over shared storage.

Core must prove equivalent atomic target existence, uniqueness and deletion
semantics. Generic physical foreign keys may protect storage identities; they
cannot directly enforce arbitrary encoded logical fields. Joiner metadata alone
does not admit a strong relation to a remote or independently owned service.

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

The current application edge tables use application row identity, source-document
occurrences and document deletion semantics. Redesign those contracts when the
early three-consumer proof identifies a mismatch; do not freeze them and add a
parallel commerce relation engine. Preserve intended native relation behavior.

If a commerce link table's own indexes supply all required queries and change
facts, the adapter may omit a redundant adjacency projection. There must never
be two independently writable authorities for the same relationship.

## Cross-Domain References

Application, Payload and admitted Medusa-owned extensions may declare references
to one another's logical records, including indexed traversal in both directions.
The [shared cross-framework contract](../../design-notes/flarexdb-shared-logical-storage.md#cross-framework-relationship-contract)
owns endpoint identity, authorization, integrity and schema dependencies. A
declaration does not automatically implement Payload reverse-join semantics or
Medusa Module Link behavior; prove the native operation being exposed.

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

Strong local references require atomic shared-core enforcement, including
concurrent insertion/deletion. Committed change facts or a prior existence read
alone do not supply that guarantee. Weak or external references require a
separate explicit contract. Shared logical schema evolution must validate
dependent endpoint revisions and block incompatible activation across owners.

Use the [early cross-framework proof](../shared-logical-storage/README.md#early-cross-framework-proof)
before completing isolated integrations. Retain one authoritative field or Link
record; reverse traversal uses derived indexes and preserves target access and
lifecycle visibility. A relationship does not grant target mutation authority.

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

## Historical Physical Commerce-Link Proof

The sequence below describes the generated-table baseline. New storage work
follows the shared logical gates and early cross-framework proof above.

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
- Intended Application identity and ordering behavior remains proved after any
  approved core representation change.
- PGlite covers deterministic behavior and genuine PostgreSQL proves
  constraints, locking, and concurrent link operations.
