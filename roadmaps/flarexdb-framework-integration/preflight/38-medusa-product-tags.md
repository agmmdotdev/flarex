# Product Tags Compatibility

## Status

Implemented: all 15 unchanged Tag cases join the previous 69 originals. The
combined 84-case gate passes on both drivers, retaining the upstream performance
skip. The focused lane passes all 18 checks on each driver.

## Approved Slice

Continue Record 37 after committed Product Types baseline `5f98c673`. The target
is the complete unchanged 15-case Product Tags module-service file from pinned
Medusa `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, on PGlite and ordinary-role
PostgreSQL. This is an adapter admission, with no shared-core changes.

## Source-Grounded Decisions

- The original setup passes `tags: [{ id }]` to Product creation. The pinned
  ProductModuleService normalizes that input, fetches existing tags, and the
  admitted graph already writes the DML-owned pivot. Admit only bounded ID
  references; keep unknown tag members and simultaneous tags/tag_ids refused.
- Add authenticated list/count/retrieve Tag commands and scalar value filtering.
  Derive the inverse products relation from the actual DML using the existing
  Medusa relation descriptor and grouping helpers. Admit products and
  products.collection paths only; preserve primary keys, selected Product fields,
  collection_id and null collection projection following pinned medusa.ts
  projectLoadedRelationsFromTree. Do not expose general relation traversal.
- The original upsert spreads a returned Tag DTO. The pinned service partitions
  create/update inputs and passes the DTO to its internal update. Keep that
  service path. At the private adapter boundary, accept managed timestamp echoes
  only as a complete trio on an existing scoped ID, exactly matching its stored
  values; remove those authenticated echoes before invoking the service. They
  are not writable fields. New/stale/forged managed values remain refused.
  This conservative capability limit is narrower than the general fork DAL.
- Keep the original source byte-identical and runtime-tested, using the existing
  Product compiler policy documented in Record 37. Authored code remains strict.

## Validation Target

Run all 15 originals and focused isolation/refusal/managed-value/atomicity checks
on both drivers, then the combined 84 original Product cases (one upstream
skip) and Currency live regressions on both drivers. Run adapter/compiler,
source-hash/import/browser guards, focused lint and both required reviewers.
Implementation and validation receipts will be recorded below.

Collections (18 cases), other Product families, stored Module Links, workflow
and general Payload integration remain separate slices. Any shared-owner
defect requires its own recorded reproduction and correction approval.

## Implementation And Review

The complete original Tag file is promoted byte-for-byte, with exact wrapper
admission in the source guard and full-name/multiplicity coverage in both the
focused and combined runners. The combined gate contains four complete files
and expects 84 originals plus the one retained upstream performance skip.

The adapter reuses the Type read-envelope mechanics for named Tag/Type commands,
while retaining their distinct Medusa FindConfig DTO types. Tag projection is a
small adapter-local policy around the pinned grouping/projectRowFields helpers;
its only nested path is products.collection. Core schema, resource hashes,
transaction ownership, publication, deadlines and mutation authority are unchanged.

Review found and corrected an unrequested collection:null field on Products-only
reads. Two exact unit regressions cover default Product fields and explicit
collection_id selection without nested Collection population. Requested nested
Collection nulls continue to come from the existing relation loader. Both required
reviewers cleared the final code after that correction.

The focused boundary checks include overlapping foreign Tag, Product, pivot and
Collection identities, non-null Collection and empty Products projections,
full-inventory read/refusal checks, caller input preservation, authenticated
DTO timestamp echoes, stale/forged echoes, and rollback with no local events
when a new Tag precedes a missing update member.

The unchanged Product originals retain the runtime/source-hash compiler policy
from Record 37. Authored adapter, test support and configuration code pass the
strict adapter compiler; the existing Currency original and composite projects
also pass. This does not claim that the original Tag source was typechecked.

## Validation Receipts

Executed on 2026-09-09. Heavy database/compiler commands ran serially.
The following receipts are from the final code snapshot.

- Combined Product gate: 84 passed plus the original upstream skip on each
  driver, including the unchanged 1000-image case. Vitest durations: PGlite
  136.12 s and PostgreSQL 109.37 s. Original defaults/deadlines remain unchanged.
- Final focused Tag lane, after the review correction: 18 passed per driver
  (15 unchanged originals and three boundary checks). Vitest durations: PGlite
  94.58 s and PostgreSQL 73.07 s.
- Promoted Tag SHA-256: `6ecf1cd00d41809bef1f8ce8f9df1e302502b62dda7f8c64ddb5968eff88e810`;
  source and target bytes match exactly.
- Query, value-profile and metadata unit suites: 46 passed, including both exact
  projection regressions.
- Currency live regressions: PGlite 20 passed (47.06 s); PostgreSQL 19 passed
  plus the existing driver-specific skip (38.83 s).
- Promotion/source-boundary unit guards: 38 passed.
- Promotion manifest: 330 files across ten private packages verified.
- Adapter typecheck: all three projects passed.
- Source-guard JavaScript typecheck and source-island import gate passed.
- Portable Currency/Product browser bundles: 634 inputs, with no Node, ORM,
  database or source-island runtime imports.
- PostgreSQL fixture: version 18.3; test role has no superuser, createdb,
  createrole or bypassrls privilege.
- Both final-diff reviewers: no remaining findings; lint:core and lint:diff passed
  in the main task and independently in the TypeScript review.

After this admission, the historical 149-case inventory has 121 unregistered
declarations across six files: Collections 18, Options 13, Variants 15, public
Categories 21 and the two internal suites 54. The admitted-case inventory
records the current four-file gate; the old inventory retains its baseline.
