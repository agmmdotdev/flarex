# Complete Product Variants compatibility slice

Status: complete as a private compatibility slice on PGlite and ordinary-role
PostgreSQL. Executed 2026-09-09.
Baseline: `d95d97dc` (complete Options), pinned Medusa
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.

## Scope and source findings

Admit the complete unchanged 15-case module-service `product-variants.spec.ts`.
The pinned cases cover list/count/paging, parent projection, missing IDs,
create/update/upsert and option uniqueness, general and assigned image selection,
image assignment removal, and Variant soft deletion while shared values survive.
The original service owns image assembly and option normalization. Its removal
method queries assignment pairs with `$or`, then deletes their IDs. Its managed
Variant deletion has no cascadeDelete relationships to shared option values.

## Bounded adapter plan

Reuse the checked-DML relation descriptors and pinned pure projection/grouping.
Share Option/Variant parent projection locally; admit only Variant product,
product.images, images and options paths. Add assignment-pair filtering and
assignment deletion through the existing scoped table capability. Bind the
existing managed lifecycle adapter to Variant soft deletion and authenticate its
local events against the existing core observations. Preserve Product restore
and all existing deletion semantics. Keep command input and test proxy narrow.

No persistence, transaction owner, commit compiler, resource profile, deadline,
publication or public API change is authorized. Any shared owner defect must be
recorded here with a reproduction and separately approved before correction.

## Validation and completion gate

Keep the original file byte-identical, register exact case multiplicity and
promotion provenance. Add boundary proofs for scope, assignment deletion
atomicity/replay, shared-value survival and unsupported-input refusal. Run focused
and combined suites on PGlite and ordinary-role PostgreSQL, strict authored-code
checks, source guards, portable bundles, Currency regressions and lint gates.
Run both required read-only reviewers before committing explicit owned files.
Stop the owned PostgreSQL fixture after validation.

Expected combined result: 130 original passes plus one retained upstream skip.
Remaining after this slice: 75 declarations in three files (public Categories 21,
internal Product/Category 54). Categories is next. Workflows, Module Link,
durable events, public serving, broader Payload and production remain gated.

## Implementation and review

The adapter now exposes Variant list/count/retrieve, exact assignment-pair
removal and Variant-only managed soft deletion through the original service.
Option and Variant share the package-local parent projection. Checked DML adds
Variant/Product, Variant/Image and Image/Variant relation descriptors. The
existing scoped relation reader and lifecycle capability own all database work.
The assignment query translates each pair to an AND predicate, joining pairs
with OR, so cross-pairs remain untouched. Assignment removals emit complete
relational facts without business events. Variant soft deletion emits its
original authenticated event while shared values and pivots remain intact.

Four authored boundary checks cover colliding foreign-scope parents, variants,
images and assignments; late assignment-delete failure with a nontransactional
sequence witness, rollback and replay; managed Variant deletion with shared-value
survival and replay; and unsupported-input refusal without publication.
The initial 15 originals and initial 19-case focused PGlite lane passed. Strict
adapter compilation passed all three projects, and 52 unit checks passed.
Review identified a local adapter mismatch: the shared command decoder accepted
Variant title filtering but the scalar reader rejected it. The bounded equality
branch now admits Variant title, and the scope/count guard exercises it. No
shared-core defect or owner correction was required.

## Final validation receipts

Both required reviewers cleared the final production code and authored tests.
Their final rereview includes the corrected Variant title filter and the scope
fixture's model-derived image table name, with explicit image counts before
survival assertions. Main and independent reviewer lint gates passed. All final
both-driver regressions passed. Original Variant SHA-256:
`66a30d18619b2b7032077528a8c8b8d75c05bf958a38e621e97d0cd3264e0a58`.

- Final focused Variants: 19 passed per driver (15 unchanged originals plus four
  boundary checks). Vitest durations: PostgreSQL 84.59 seconds; PGlite 110.00.
- Final authored-code compiler gate: all three strict adapter projects passed.
  The original Product files retain the established runtime/source-hash policy.
- Query, value-profile and runtime-metadata unit suites: 52 passed.
- Combined PostgreSQL: 130 original passes plus one upstream skip, including the
  unchanged 1000-image case; Vitest duration 167.00 seconds.
- PostgreSQL 18.3 role: superuser, createdb, createrole and bypassrls all false.
- Combined PGlite: 130 original passes plus one upstream skip; Vitest duration
  199.11 seconds. Both drivers retain exact execution multiplicity for all cases.
- Currency regressions: PostgreSQL 19 passed plus the existing driver-specific
  skip (54.61 seconds); PGlite 20 passed (53.06 seconds).
- Source-boundary guards: 38 passed; source-guard JavaScript typecheck passed.
- The owned PostgreSQL fixture was stopped after database validation; pg_ctl
  confirms no server running.
- Source-island boundary and browser bundle gates passed: 636 bundle inputs,
  with no Node, ORM, database or source-island runtime imports.
- Promotion provenance: 344 files across ten private packages authenticated.
- Pinned source verification: 8,496 files and zero symlinks at the original fork
  revision. The promoted Variant file remains byte-identical.

The admitted inventory now has seven complete files, 130 original passes and one
retained upstream skip per driver. Of the historical 149 remaining declarations,
75 remain unregistered across three files. Public Categories (21) is the next
bounded slice, followed by the 54 internal Product/Category declarations. This
checkpoint does not activate workflow, Module Link, durable event providers,
public serving, broader Payload integration or production profiles.


Continuation: [Record 42](./42-medusa-product-categories.md) now owns the
implemented public Categories slice and its final receipts. The counts above
remain this Variants checkpoint's historical evidence.
