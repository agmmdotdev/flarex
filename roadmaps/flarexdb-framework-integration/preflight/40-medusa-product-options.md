# Product Options Compatibility

## Approved Slice And Preflight

Continue from committed Collections baseline `086226aa`. Admit all 13 unchanged
cases in the pinned Product Options module-service file, keeping source revision
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f` and the existing private execution profile.

The source requires list/count/retrieve by ID and title, paging/count, selected
Option and nested Product fields, standalone deletion, existing upsert/update
and creation. Reuse the original Medusa service and internal-service behavior:
Option updates retrieve existing values before normalization and replacement;
the existing adapter already implements that flow.

- Add three Option read commands with strict bounded ID/title/product_id filters.
  Derive Option -> Product metadata from checked DML and retain selected Option
  primary keys, the populated Product FK, and nested Product primary keys.
  Reuse the pinned projectRowFields helper and current scoped relation loader.
  Keep existing internal values population; deeper paths remain unadmitted.
- Admit Option physical deletion through the current DML cascade planner. Core
  already admits declared-key removal for Option, Value and pivot tables. Keep
  complete facts, preserve parent Products and Variants, and retain the pinned
  internal service's root-only delete event contract. Local event policy accounts
  for Value deletion only under the trusted Option-delete command.
- No core, profile/hash, timestamp, transaction, publication, resource or deadline
  change is proposed. A diagnostic exposing a shared-owner defect must be recorded
  and separately approved before correction.
- Promote the full original file byte-for-byte, preserve the existing compiler
  policy, and extend exact wrapper/source admission and coverage multiplicity.

Validate all 13 originals and focused scope, projection, cascade facts/events,
rollback and refusal checks on PGlite and ordinary-role PostgreSQL. Then run the
115-case combined gate plus its retained upstream skip, Currency regressions,
unit/compiler/source/lint gates and both required reviewers. The remaining
inventory becomes 90 declarations across four files; Variants (15) is next.

## Implementation And Review

The Option reader uses the existing scoped relation loader and pinned
projectRowFields helper. Checked DML establishes the Option/Product relationship
and FK; missing relationship metadata is refused. Selected Option and Product
keys are retained without exposing unrequested Product fields or relations.
The related-reader projection closure also preserves existing Tag, Collection,
Type and internal Value behavior. Internal values population remains available
for Medusa's existing update normalization.

Standalone Option deletion reuses the existing child-first lifecycle planner.
Value and pivot rows are explicitly removed for complete core facts; the parent
Product, shared Variants and unrelated Options/Values remain intact. The local
event policy admits the pinned root-only deletion event convention for this
trusted command. It does not activate durable delivery or change publication.

Focused tests install a deliberate final-parent-delete failure. A nontransactional
sequence proves the parent statement was reached; the complete row/history and
publication inventory remains unchanged after failure. Removing the trigger then
proves complete cascade facts, the exact root event, and replay without another
publication. Other tests cover overlapping foreign Option/Product keys, parent
projection, no-query-write behavior, foreign deletion isolation, mixed-upsert
rollback and unsupported input refusal using an existing valid parent.

Both required reviewers cleared the final source and test changes. The TypeScript
review included Effect applicability, request-owned composition, decoder boundaries
and pinned projection/deletion semantics. The systems review checked scope,
atomicity, dependency survival, facts and events. No shared-core fix was needed.

## Validation Receipts

Executed on 2026-09-09. Heavy database and compiler lanes ran serially.

- Final focused Options gate: 17 passed on each driver (13 unchanged originals
  plus four boundary checks). Vitest durations: PGlite 96.55 seconds and
  PostgreSQL 68.07 seconds.
- Strict adapter typecheck: all three projects passed. Original Product files
  retain the runtime/source-hash compiler policy; authored code is compiled.
- Query, value-profile and runtime-metadata unit suites: 50 passed.
- Source-boundary guards: 38 passed; 340 promotion files across ten private
  packages authenticated.
- Options source and target SHA-256:
  `eb095c9ebcc8247e17ebd33ec607855af37186c50ca1b6701649c80cbe23320a`.
- PostgreSQL 18.3 uses an ordinary role without superuser, createdb, createrole or
  bypassrls privileges.
- Main lint:core, lint:diff and diff whitespace checks passed; the TypeScript
  reviewer independently passed both read-only lint gates.

- Final combined Product gate: 115 original passes plus the one retained upstream
  skip on each driver, including the unchanged 1000-image case. Vitest durations:
  PGlite 153.35 seconds; PostgreSQL 122.59 seconds.
- Currency live regressions: PGlite 20 passed (48.35 seconds); PostgreSQL 19
  passed plus its existing driver-specific skip (37.39 seconds).
- Source-guard JavaScript typecheck and source-island import gate passed.
- Currency/Product browser bundles: 636 inputs, with no Node, ORM, database or
  source-island runtime imports.
- The owned PostgreSQL fixture was stopped after database validation; pg_ctl
  confirms no server running.
- Pinned source verification: 8,496 files and zero symlinks, unchanged revision.

After Options, the historical 149-case remaining inventory has 90 unregistered
declarations across four files: Variants 15, public Categories 21 and internal
Product/Category 54. The admitted-case inventory now includes six complete files.
Variants is the next bounded slice. Workflow, Module Link, durable event
providers, public serving, broad Payload integration and production activation
remain separately gated.
