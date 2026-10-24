# Required Column And Constraint Failure Evidence

## Status And Scope

Status: implemented private diagnostic support for existing logical required
column, CHECK and unique failures. Neutral owner and actual atomic-host controls
cover the bounded evidence contract. Native presentation and connected Tax
Region workflow admission remain separate.

This domain owns storage-issued failure facts and their exact-error transfer.
Native error classes, message rendering, framework entities and Tax Region
workflow admission remain separate consumer contracts. This capability does
not admit new checks, keys, indexes, predicates or storage queries.

## Current Sources Of Truth

The [accepted database design](../../design-notes/flarex-db-accepted-design.md)
and [shared logical storage design](../../design-notes/flarexdb-shared-logical-storage.md)
own the storage and framework boundaries. The executing owners are
[relational row mechanics](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/relationalRows.ts),
the [working set](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/workingSet.ts),
the [private evidence registry](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/relationalFailure.ts)
and inspection through the
[internal Commerce facade](../../packages/persistence-postgres/src/frameworks/commerceTransaction/commerceAdapter.ts).
The existing protocol
[row validator](../../packages/flarex-protocol/src/relational-schema/values.ts)
continues to decide complete-row validity.

[Registry controls](../../packages/persistence-postgres/test/storage/documents/logicalRelationalFailure.test.ts),
[required-column owner controls](../../packages/persistence-postgres/test/storage/documents/logicalRequiredColumnFailure.test.ts)
and [CHECK owner controls](../../packages/persistence-postgres/test/storage/documents/logicalConstraintFailure.test.ts)
define the private evidence obligations. The
[required-column atomic-host scenario](../../packages/persistence-postgres/test/frameworks/commerceTransaction/requiredColumnFailureScenario.ts)
and [constraint atomic-host scenario](../../packages/persistence-postgres/test/frameworks/commerceTransaction/relationalConstraintFailureScenario.ts)
exercise real storage and settlement through their PGlite and ordinary-role
PostgreSQL entries. Their cold reads, durable inventory and caught-failure
controls define bounded rollback obligations. The shared
[durable inventory inspector](../../packages/persistence-postgres/test/frameworks/commerceTransaction/logicalCommerceInventory.ts)
only reads existing storage families.

[Reference validation checkpoints](./reference-validation-checkpoints.md) own
missing-target evidence and reference timing. [SQL REAL scalar mechanics](./72-sql-real-scalar-mechanics.md)
own conversion and canonical row verdicts. Neither contract supplies a native
entity renderer.

## Current Architecture

The logical row owner issues evidence at an existing rejection. Supplied
nonnullable NULL receives origin `input`, kind `null`. A selected protocol
`missingColumn` issue for a nonnullable column receives origin `row`, kind
`missing`, only when reported as `documentInvalid`. The ordinary complete-row
path and existing REAL column check before SQL conversion use that same issue.
No additional required-field validation runs.

The CHECK owner adds the actual `RelationalConstraintIdentity` to the
protocol's existing `constraintViolation` error, at the point the ordered
validator already rejects it. Row mechanics retain kind `check`, origin `row`,
the failed column and that identity for `documentInvalid` only. This covers
integer range, text set and null implication verdicts without selecting or
re-evaluating a constraint later. For REAL tables, complete-row constraints
retain the existing validation boundary after actual storage conversion.

The unique owner retains kind `unique` at either existing rejection owner.
An insert colliding with a known relational primary identity retains origin
`input`, the actual normalized `RelationalKeyIdentity`, ordered source columns
and their supplied identity values before defaults. A conflict selected by the
working set's unique interpreter retains origin `row`, the genuine
`CatalogUniqueConstraintDefinitionId`, its ordered source columns and scalar
semantic values from the exact canonical relational row. The latter identity
names the actual catalog definition; it does not claim an authored key or index
descriptor. No descriptor is guessed from matching columns. Failure factories,
ordered conflict selection and existing nullable/history semantics stay with
their current owners.

All kinds carry the genuine `RelationalTableIdentity` from schema mechanics,
which is distinct from a Catalog table ID. An optional candidate is the exact
immutable JSON tree already owned by the private capture issuer. Input rejection
can retain supplied fields before defaults; normalized row rejection can retain
the actual candidate at that boundary. Origin `row` does not assert that a
rejected candidate is a complete accepted row. Unique row evidence borrows the
existing canonical native verdict without repeating validation, defaults,
conversion or unique-key evaluation.

An unowned candidate is omitted without recapture or inspection of its members.
A readonly type or frozen foreign wrapper cannot grant private JSON ownership.
The registry freezes evidence and copies table, constraint and primary-key
identities, ordered columns and scalar values. It preserves the capture owner's
immutable candidate tree. It does not complete absent fields, create an ORM
entity, expose index codec bytes or synthesize database exception details.

`bindPreparedLogicalRelationalRows` projects internal mechanics errors through
the accepting owner's existing failure factory. It transfers evidence from the
exact issued internal error to the resulting error by registry lookup, retaining
the existing reason and cause object. The internal Commerce facade exposes
inspection only; issuance remains with storage.

## Invariants And Trust Boundaries

- The exact error object is the lookup key. Matching public fields, copied
  objects, serialization and arbitrary `.cause` wrappers confer no provenance.
- First issuance wins when a failure factory reuses an error identity. Frozen
  errors need no mutation; primitives receive no registry entry.
- Inspection grants read-only diagnostic facts, never row mutation, transaction,
  clock, finalizer or settlement authority.
- Validation, normalization, rejection order, accepted rows and failure
  classification remain with their existing owners. Unrelated type,
  unknown-field and stored-corruption failures gain no diagnostic kind.
- Candidate evidence does not create a new lifetime, query, SQL exception,
  framework business classification or physical compatibility failure owner.

## Decisions And Rationale

Failure facts belong at the actual rejection because a later adapter cannot
safely infer the selected constraint or reconstruct the candidate. Exact-error
transfer preserves provenance through existing error projection. Reusing
private JSON ownership avoids foreign getters and a second capture verdict.
CHECK identity is retained by its executing validator. Unique evidence retains
the genuine identity available at its executing owner rather than inventing an
authored descriptor that the catalog definition does not carry.

## Convex Compatibility And Flarex Divergences

This is private diagnostic support for admitted logical relational mechanics,
not a new Convex document validation or mutation API. Native Application OCC,
physical compatibility failure owners and framework business validation retain
their existing contracts. Logical evidence does not emulate driver exceptions,
physical row dumps or ORM entity identity.

## Implemented Capabilities

Storage-private issuance, immutable exact-error inspection and prepared-error
transfer cover required-column, CHECK and unique verdicts. Neutral owner and
atomic-host controls cover actual primary, partial and composite unique
rejections, CHECK after REAL conversion, complete rollback inventory, cold reads,
caught-failure poisoning and accepted historical rows. These bounded contracts
do not establish native presentation or connected Tax Region workflow admission.

## Known Gaps And Limitations

A candidate is available only when the existing JSON capture owner already owns
that exact tree; absence is explicit. Logical candidate fields and schema
identity do not establish native entity construction order, relation collections,
ORM instance identity or rendering.

The native portable diagnostics need their own presentation owners and connected
workflow proof. This capability adds no physical-owner support, durable encoding,
deployment, scale or hosted activation claim.

## Target Direction

Connect separately approved native presentation contracts through the read-only
inspector, preserving the validators and conflict interpreters that reject rows.
Keep reference evidence and framework rendering with their existing owners.

## Next Correctness Gates

- Prove the separate native portable diagnostics and Tax Region workflow.
  Preserve original native witnesses and distinct candidate validation; core
  evidence alone does not admit either consumer.