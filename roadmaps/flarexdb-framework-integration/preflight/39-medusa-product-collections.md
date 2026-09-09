# Product Collections Compatibility

## Approved Slice And Preflight

Continue Record 37 after committed Tags baseline `706ac5c0`. Admit the complete
unchanged 18-case Collections file from pinned Medusa
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, with both-driver proof.

The pinned service creates Collections through upsertWithReplace with normalized
products ID references. Updates use its existing Collection internal update,
then Product internal update with ID inclusion/exclusion selectors. Preserve
that service algorithm: the adapter provides the missing table operations,
not a replacement module service. Product collection_id reference updates are
already admitted by the existing trusted profile; no core change is proposed.

- Admit bounded product_ids on Collection create/update/upsert, exact title and
  handle filters, three read commands and inverse products projection derived
  from checked DML. Reuse the existing owned projection mechanics, retaining
  has-many owner FK selection; keep Tag-only products.collection traversal gated.
- Collection creation uses the existing adapter mutation planner, attaching
  existing scoped Products and returning complete performed actions. Missing
  references fail atomically; no new Product creation or child deletion is allowed.
- Only Collection mutation composition receives the internal Product membership
  repository. It accepts the service's exact inclusion/exclusion selectors and
  collection_id-only update pairs. Exclusion reads filter a complete bounded
  scoped catalog, never a partial default page. The normal Product command query
  and update boundary stays unchanged.
- Preserve Medusa's normalized scalar updates, metadata merge, missing-ID errors,
  collection return values and event dispatch. Keep complete row facts in core.
- Original source stays byte-identical and runtime-tested under Record 37's
  compiler policy; authored code remains strict.

Validate 18 originals plus focused scope, atomicity, replacement and event/fact
checks on PGlite and ordinary-role PostgreSQL, then 102 combined originals plus
one upstream skip and Currency live regressions on both drivers. Run source,
compiler and lint gates plus both reviewers. Shared-owner defects require a
separate recorded correction approval. Options (13 cases) remains the next slice.

## Implementation Boundaries

Collection products are existing-identity references, not owned child entities.
The planner records Product FK updates and Medusa performed actions; it never
creates or deletes Products to reconcile membership. Repeated Product references
in one Collection creation batch and duplicate Product update pairs across a
single multi-Collection upsert are refused by this bounded profile. Missing
creation references fail; membership-update selectors intentionally ignore IDs
absent from the active scope, matching the pinned internal service.

The Collection-only repository validates inclusion/exclusion selectors, empty
population and the internal service's default ID-ascending ordering. It refuses
paging, projections and deleted-row visibility rather than silently ignoring
those options. Its complete catalog read reuses the adapter's existing relation
reader and propagates core resource overflow. General Product commands do not
receive this membership repository.

The shared inverse projection retains the existing Tag behavior and separately
admits Collection -> Products. Has-many projections retain the Product primary
key and collection_id FK, without exposing unrelated nested relations. Product
IDs are decoded only on Collection command input; scalar DAL writes and nested
Product collection updates cannot carry product_ids.

Two initial local validation defects were corrected: the new test fixture used
an invalid underscored Product handle, and the narrow internal options decoder
initially omitted Medusa's default id ASC ordering. Original assertions and
shared-core code were unchanged.

## Validation Receipts

Executed on 2026-09-09. Database and compiler lanes ran serially.

- Final focused Collections gate: 22 passed on each driver, comprising all 18
  unchanged originals and four additional boundary checks. Vitest durations:
  PGlite 96.73 seconds and PostgreSQL 74.06 seconds.
- The membership check covers 20 Products, complete facts and local events,
  request-key replay without republication, omitted membership, last-page
  replacement, movement to another Collection and clearing without deletion.
- Other focused checks prove inverse-projection scope isolation with colliding
  physical keys, rejection of foreign creation references, scoped selector
  update behavior, exact rollback of rows/history/publication, and unsupported
  query/input refusal without publication.
- Collections source and promoted target SHA-256:
  `4b955556a5a86efc74e546f57328a7c953ce3dd5b860e5abb417723ab0e3dd04`.
- Pinned source verification: 8,496 files, zero symlinks, unchanged fork revision.
- Source-boundary guards: 38 passed; promotion verifies 335 files across ten
  private packages.
- PostgreSQL fixture is 18.3; the test role has no superuser, createdb, createrole
  or bypassrls privilege.
- Both required reviewers cleared the final code. The test-only event assertion
  was corrected to use the pinned ProductEvents export from its existing
  product/events subpath, then re-reviewed and rerun successfully.
- Final combined Product gate: 102 original passes plus one retained upstream
  skip on each driver, including the unchanged 1000-image case. Vitest durations:
  PGlite 153.52 seconds; PostgreSQL 115.48 seconds.
- Query, value-profile and runtime-metadata unit suites: 48 passed, including
  the complete-catalog selector and command-versus-normalized-write boundaries.
- Currency live regressions: PGlite 20 passed (58.24 seconds); PostgreSQL 19
  passed plus its existing driver-specific skip (37.61 seconds).
- Adapter strict typecheck: all three projects passed. Authored adapter,
  configuration and support code is compiled; unchanged Product originals retain
  the runtime/source-hash compiler policy from Record 37.
- Source-guard JavaScript typecheck and source-island import gate passed.
- Currency/Product browser bundles: 635 inputs, with no Node, ORM, database or
  source-island runtime imports.
- Main lint:core and lint:diff passed; both final reviewers cleared the code,
  and the TypeScript reviewer independently passed both read-only lint gates.
- The owned PostgreSQL fixture was stopped after the final database lane;
  pg_ctl confirms no server running.

After this admission, 103 declarations remain unregistered across five files:
Options 13, Variants 15, public Categories 21 and internal Product/Category 54.
The historical remaining-suite inventory keeps its original 149-case baseline;
the admitted-case inventory now records five complete files. The next separately
bounded work is Options. Workflow, Module Link, public serving, durable event
providers, broad Payload integration and production support remain separate gates.
