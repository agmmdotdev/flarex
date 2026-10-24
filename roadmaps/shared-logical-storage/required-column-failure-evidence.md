# Required Column Failure Evidence

## Status And Scope

Status: implemented private diagnostic support for existing logical
missing-required-column and explicit nonnullable NULL failures. Neutral owner
and atomic-host controls cover the bounded contract; native error presentation
and Tax Region workflow admission remain separate.

This domain owns storage-issued failure facts and their exact-error transfer.
It does not own native error classes, message rendering, framework entities or
workflow admission. The native Tax Region creation profile's approved portable
required-field diagnostic remains a separate, unimplemented consumer contract.

## Current Sources Of Truth

The [accepted database design](../../design-notes/flarex-db-accepted-design.md)
and [shared logical storage design](../../design-notes/flarexdb-shared-logical-storage.md)
own the storage and framework boundaries. The executing owners are
[relational row mechanics](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/relationalRows.ts),
the [private evidence registry](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/relationalFailure.ts)
and inspection through the
[internal Commerce facade](../../packages/persistence-postgres/src/frameworks/commerceTransaction/commerceAdapter.ts).
The existing protocol
[row validator](../../packages/flarex-protocol/src/relational-schema/values.ts)
continues to decide complete-row validity.

[Registry controls](../../packages/persistence-postgres/test/storage/documents/logicalRelationalFailure.test.ts),
[row-owner controls](../../packages/persistence-postgres/test/storage/documents/logicalRequiredColumnFailure.test.ts)
and the
[actual atomic-host scenario](../../packages/persistence-postgres/test/frameworks/commerceTransaction/requiredColumnFailureScenario.ts)
with its [PGlite](../../packages/persistence-postgres/test/frameworks/commerceTransaction/requiredColumnFailure.test.ts)
and [ordinary-role PostgreSQL](../../packages/persistence-postgres/test/frameworks/commerceTransaction/requiredColumnFailure.postgres.test.ts)
entries define bounded conformance obligations. The shared
[durable inventory inspector](../../packages/persistence-postgres/test/frameworks/commerceTransaction/logicalCommerceInventory.ts)
only reads existing storage families.

[Reference validation checkpoints](./reference-validation-checkpoints.md) own
missing-target evidence and reference timing. [SQL REAL scalar mechanics](./72-sql-real-scalar-mechanics.md)
own conversion and canonical row verdicts. Neither contract supplies this
required-column diagnostic or a native entity renderer.

## Current Architecture

The logical row owner issues evidence at an existing rejection. Supplied nonnullable
NULL is rejected by input-column validation and receives origin `input`, kind
`null`. A protocol `missingColumn` issue for a nonnullable column receives
origin `row`, kind `missing`, only when reported as `documentInvalid`.
The ordinary complete-row path and the existing REAL check before SQL conversion
use that same issue. No additional required-field validation is performed.

Evidence contains the genuine `RelationalTableIdentity` from schema mechanics,
the failed column, origin and verdict. This schema identity is not a Catalog
table ID. The optional candidate is the exact immutable JSON tree already
owned by the private capture issuer. Normalization can therefore retain the
actual fields after defaults, while input rejection retains supplied fields
before defaults. Origin `row` identifies the complete-row validation boundary;
it does not assert that a rejected candidate is a complete accepted row.

An unowned candidate is omitted without recapture or inspection of its members.
A readonly type or frozen foreign wrapper cannot grant private JSON ownership.
The registry freezes its evidence and copied table identity, and preserves the
capture owner's immutable candidate tree. It does not complete absent fields,
create an ORM entity or synthesize database exception details.

`bindPreparedLogicalRelationalRows` already projects internal mechanics errors
through the accepting owner's failure factory. The binding transfers evidence
from the exact issued internal error to the resulting error by registry lookup.
The projection retains its existing reason and cause. The internal Commerce
facade exposes inspection only; issuance remains with storage.

## Invariants And Trust Boundaries

- The exact error object is the lookup key. Matching public fields, copied
  objects, serialization and arbitrary `.cause` wrappers confer no provenance.
- The first issuance wins when a failure factory reuses an error identity.
  Frozen errors need no mutation; primitives receive no registry entry.
- Inspection grants read-only diagnostic facts, never row mutation, transaction,
  clock, finalizer or settlement authority.
- Required-value validation, default normalization, rejection order, accepted
  rows and failure classification remain unchanged. Unrelated type, unknown-field
  and stored-corruption failures gain no required-column label.

## Decisions And Rationale

Failure facts belong at the existing rejection because a later adapter cannot
safely infer the failed field from public causes or reconstruct the candidate.
Exact-error transfer preserves provenance through the existing mechanics
projection without changing its error contract. Reusing private JSON ownership
avoids executing foreign getters or introducing another capture verdict while
reporting an already selected failure.

## Convex Compatibility And Flarex Divergences

This is private diagnostic support for admitted logical relational mechanics,
not a new Convex document validation or mutation API. Native Application OCC,
physical compatibility failure owners and framework business validation retain
their existing contracts. No driver exception or physical NOT NULL behavior is
emulated for logical storage.

## Implemented Capabilities

The implementation provides storage-private issuance, immutable exact-error
inspection and prepared-error transfer. Neutral atomic-host and existing REAL
and checkpoint consumers cover the bounded contract. The native presenter and
Tax Region workflow remain unimplemented and unadmitted.

## Known Gaps And Limitations

A candidate record is available only when the existing JSON capture owner
already owns that exact tree; absence is explicit.

Logical candidate fields and schema identity do not establish native entity
construction order, relation collections, ORM instance identity or rendering.
The approved portable native diagnostic still needs its own presentation owner,
detached `entity`/`getEntity()` contract and connected workflow proof. This
capability adds no physical-owner support, durable encoding, deployment or hosted
activation claim.

## Target Direction

Connect the separately approved native presentation contract without
repeating validation or admitting incomplete stored rows. Keep required-column
facts separate from reference evidence and framework presentation.

## Next Correctness Gates

- Implement and prove the approved portable native diagnostic and
  native Tax Region workflow. Preserve original native witnesses and distinct
  candidate validation; core evidence alone does not admit either consumer.
