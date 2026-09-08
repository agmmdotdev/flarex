# Remaining Product Integration Suites

## Status And Decision

Preflight completed on 2026-09-08 against Flarex `747e1c4c` and pinned Medusa
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. This record inventories the next work;
it does not admit new methods, copy source, modify assertions or claim new test
passes. Implementation of the recommended slice is the next approval boundary.

The recommended next slice is the **complete 13-case Product Types module-service
file**. Add its three read commands and its tested scalar `value` filter, retaining
the existing create/update/delete paths and their Medusa behavior. No shared
transaction, committer, publisher, schema or resource change is indicated by this
preflight. Finish that whole file on both drivers before taking another family.

[Record 35](./35-medusa-product-scale.md) remains the executed baseline: 56 original
Product cases pass per driver, with one original performance skip. Currency's live
lane has 20 PGlite passes and 19 PostgreSQL passes plus one driver-specific skip.
These are existing receipts, not reruns in this documentation-only preflight.

## Exact Inventory

[The machine-readable inventory](./product-remaining-test-inventory.json) records
all 149 declarations across the eight files: 95 public module-service cases and
54 internal-service cases. Each file has its source SHA-256; each case has its
source line, enclosing suite/title, assertion matchers, direct methods, inherited
setup methods, local fixture-helper calls, missing module methods and gap IDs.
Extraction used the installed TypeScript 6 AST, followed by source inspection.
The lexical method inventory is not a complete dynamic service call graph.

None of these eight files is promoted into `packages/medusa-product` or registered
in the current adapter gate. All remain unadmitted. The ten-file source inventory
contains 206 declarations total: 56 previously passing originals, one upstream
skip, and these 149 unregistered declarations. Counts are not parity evidence.

All paths in the table are relative to
`third_party/medusa/upstream/packages/modules/product/integration-tests/__tests__/`.

| File | Cases | Concrete requirements beyond source admission |
| --- | ---: | --- |
| `product-module-service/product-types.spec.ts` | 13 | List/count/retrieve commands; scalar value filtering; exact projection, paging/count and not-found behavior |
| `product-module-service/product-tags.spec.ts` | 15 | Related reads; Product create accepts the original `tags: [{ id }]` fixture; inverse Product relations, nested projection/nulls; full read DTO in upsert input |
| `product-module-service/product-collections.spec.ts` | 18 | Related reads; create/upsert with `product_ids`; inverse Product projection; full replacement and empty-list dissociation |
| `product-module-service/product-options.spec.ts` | 13 | Related reads and title filter; Product relation/projection; standalone option deletion with complete child/pivot facts |
| `product-module-service/product-variants.spec.ts` | 15 | Related reads/projection; variant image selection/removal; standalone variant soft deletion preserving shared option values |
| `product-module-service/product-categories.spec.ts` | 21 | Category-to-Product input in every setup; related reads; actual category service behavior, tree inclusion, parent changes, sibling ranks and deletion errors |
| `product.spec.ts` | 23 | Internal service fixture; actual internal update/result/error contracts, free-text search, relation reads, lifecycle tuple results and static linkable metadata |
| `product-category.spec.ts` | 31 | Internal category fixture and actual category service; ancestor/descendant transforms, scoped children, tree moves/mpath updates and sibling ranking |

Some variant creation/error cases already use admitted module methods. That makes
them candidates for diagnosis, not established passes or a reason to bypass their
unchanged shared setup. The internal Product linkable test is statically oriented,
but its enclosing beforeEach still reads both protected internal service fields.
It cannot simply run through the present proxy unchanged.

## Source-Grounded Gaps

These IDs are referenced by the inventory. File gaps apply to every case in that
file; case gaps identify additional specific requirements. They describe known
barriers, not an exhaustive prediction of every future failure.

- **source-admission:** only the two prior files are imported by
  [`product-upstream.test.ts`](../../../packages/medusa-adapter/test/product-upstream.test.ts).
  Promote each selected source file byte-for-byte with its required fixture/import
  closure, provenance hashes and test-utils boundary mapping. Do not import the
  source island directly or bulk-promote all eight files.
- **module-command-admission:** the private
  [`command set`](../../../packages/medusa-adapter/src/product-service.ts) and
  [`runner`](../../../packages/medusa-adapter/test/support/product-runner.ts)
  expose Product root reads, but no related-entity list/count/retrieve methods.
  Each of the six public suites needs its own three related read entry points.
  Options additionally need `deleteProductOptions`; variants need
  `removeImageFromVariant` and `softDeleteProductVariants`.
- **related-scalar-filter:**
  [`findProductRelated`](../../../packages/medusa-adapter/src/product-related.ts)
  currently admits ID/FK selectors and a bounded ID-only `$or`. It refuses the
  original Type/Tag `value`, Collection `title`/`handle` and Option `title` filters.
  These are deliberate capability limits, not observed database defects.
- **related-projection-review:** that reader accepts only scalar field names and
  directly registered relation names. It does not implement dotted selected fields
  or nested related paths. The current
  [`relation catalog`](../../../packages/medusa-adapter/src/product-runtime-metadata.ts)
  contains root Product paths plus option.values and variant.options, not reverse
  tag/collection/category.products, option/variant.product or image.variants.
  Reuse pinned Medusa relation descriptors, grouping and projection mechanics;
  do not invent new graph semantics in tests. Preserve automatic primary/FK fields,
  empty arrays and exact null to-one results. Tag line 107 explicitly asserts
  `products.collection` together with `collection_id: null`.
- **product-tags-input:** every Tag case first calls createProducts with
  `tags: [{ id }]` (source lines 15-41). The current
  [`value profile`](../../../packages/medusa-adapter/src/product-value-profile.ts)
  accepts `tag_ids` on creation and rejects `tags` there. This needs an adapter
  input admission following the pinned service, not a fixture rewrite.
- **tag-upsert-dto:** Tag line 319 spreads a list result into upsert input. Current
  related input policy excludes managed timestamps/deleted_at. Inspect the pinned
  upsert's handling of those returned fields before defining compatibility capture;
  do not make them caller-authoritative or silently strip them in the runner.
- **collection-products-input:** all 18 Collection cases set up collections using
  `product_ids` (lines 16-43), currently excluded by related input policy. The
  repository's collection replacement seam only inserts rows today. Lines 286,
  349, 387 and 432 require attaching existing products, replacing membership,
  clearing it with `[]` and creation with products. Preserve Product row ownership,
  complete before/after facts and atomic FK updates using the existing core owner.
- **option-delete:** standalone option deletion is absent from the command set and
  refused by the adapter lifecycle's root allowlist. The existing trusted profile
  already declares keyed removal; an adapter plan must retain FK/cascade semantics,
  option values, variant/value pivots and exact events. No new generic deletion
  capability is justified by this one test.
- **variant-images:** original Variant line 75 exercises the real module service's
  `listProductVariants`, which also reads product.images and image.variants and
  applies its shared-versus-assigned image policy. Preserve that implementation.
  Root Product image-ordering success does not prove this different path.
- **assignment-removal:** the same case calls `removeImageFromVariant`; the pinned
  service selects assignment rows with `$or` over variant/image pairs and deletes
  their IDs. Current related `$or` accepts ID-only members and the lifecycle root
  allowlist excludes assignments. Admit only the needed pair-selection/deletion
  semantics, including the existing nested manager/event boundaries.
- **variant-lifecycle:** Variant line 698 asserts soft deletion of the variant
  while related shared option values remain active. Related repositories currently
  refuse softDelete/restore even though the trusted profile has managed lifecycle
  capacity. Select the variant as the root in an adapter-owned plan; do not reuse
  Product-root cascading blindly or change the shared committer.
- **category-products-input:** every public Category case creates categories with
  `products: [{ id }]` before its assertion. The standalone category input excludes
  that relation; category/parent ranks and mpath are also intentionally restricted.
- **category-service-tree:** current composition uses a generic MedusaInternalService
  for ProductCategory. The pinned
  [`ProductCategoryService`](../../../third_party/medusa/upstream/packages/modules/product/src/services/product-category.ts)
  owns descendant/ancestor transforms, parent moves, mpath changes and ranking.
  It includes portable mutation paths but still has static MikroORM imports.
  Its promotion and repository/context contract need a separate bounded design
  before these suites can run. Preserve that service's algorithms and assertions;
  do not build a second category service in Flarex or expose Node/ORM imports in
  portable bundles. Current adapter behavior covers roots only.
- **internal-service-fixture:** the two internal files access `productService_`
  and/or `productCategoryService_` before tests. The current proxy refuses these
  properties and the promoted service barrel exposes only ProductModuleService.
  Design a test-owned command boundary for actual internal operations; never leak
  an authenticated manager/repository or substitute public methods with different
  signatures. Include the original createProductFixtures helper in setup analysis.
- **internal-product-update:** internal update accepts arrays/single objects and
  selector/data pairs; the current Product repository's plain update is refused.
  Line 321 asserts rollback of an earlier valid update after a missing-ID member,
  including exact error text. Public upsertWithReplace proof is not this contract.
- **product-free-text:** internal Product line 369 requires `q` behavior. The
  current root query profile admits a narrower filter set. Inspect the pinned
  free-text translation and shared query capabilities before implementation.
- **internal-lifecycle-result:** internal Product restore returns a tuple whose
  restored entities are asserted; the public test wrapper's null result is not an
  equivalent implementation. Preserve the actual internal service result shape.

## Next Bounded Slice: Product Types

The exact target is every declaration in
[`product-types.spec.ts`](../../../third_party/medusa/upstream/packages/modules/product/integration-tests/__tests__/product-module-service/product-types.spec.ts):
three list cases, three list/count cases, three retrieve cases, one deletion,
two updates and one creation. Its only shared setup creates two Type rows.

1. Promote this one unchanged file and register it through the existing owned
   fixture. Extend provenance and the original-source compatibility typecheck.
2. Add private, authenticated listProductTypes, listAndCountProductTypes and
   retrieveProductType command facades calling the existing ProductModuleService
   and its Type internal service. The runner only forwards arguments/results.
   Capture filters/configuration under the existing command boundary; do not let
   callers choose arbitrary tables or obtain the raw composed service/manager.
3. Extend the existing related reader's Type policy for the tested `value`
   equality filter. Reuse checked DML metadata and existing store predicates;
   retain unsupported-field/operator rejection for other capabilities. Count the
   complete match set before pagination, preserve deterministic existing ordering
   and exact selected-field results, and let Medusa own not-found messages.
4. Add focused adapter checks for scope isolation and unsupported inputs around
   the new read boundary. Exercise missing IDs and existing Type writes through
   the unchanged original assertions; no new shared-core write implementation.
5. Run all 13 originals on PGlite and ordinary-role PostgreSQL, then the existing
   56 Product originals and Currency live regressions on both drivers. If combined,
   expected Product coverage is 69 passes plus the one original upstream skip.
   That is a target, not today's achieved count.

Owned implementation files should remain within `packages/medusa-adapter`, the
single promoted test/required source closure in `packages/medusa-product`, and
these adoption records/manifests. Use the repo-local Effect skill and overlay
when implementing the new operations. Preserve existing profile hashes/resources,
transaction deadlines, publication, recovery and domain mutation authority.

The current upstream config filters by title suffix and verifies full names
later. New suites reuse suffixes, so simply appending imports is insufficient.
Prefer a dedicated complete Types-file gate without a name filter and an explicit
13-case receipt, or a complete expanded-file gate whose expected names/multiplicity
are checked. Future partial admissions must select exact suite/file identities.
The internal category file even repeats one full title at lines 110 and 275;
record source positions or expected multiplicity rather than assuming titles are
unique. Do not increase timeouts or discard original cases to meet the count.

Validation includes strict adapter/compatibility typechecks, promotion/source and
browser-boundary guards, focused lint and both standing reviewers before the
implementation commit. Run heavy database suites and typechecks serially on this
Windows host; prior overlapping checks exhausted memory. Report PGlite and real
PostgreSQL receipts separately.

## Later Slices And Closure

After Types, take Tags (15), Collections (18), Options (13), Variants (15),
public Categories (21), then the two internal suites (54), each with its own
bounded admission decision and complete original-file proof where feasible.
Shared related-read mechanics may be reused once semantics are exact; this order
does not authorize all domains or broaden supported filters merely for reuse.

A failure exposing a shared system owner must be recorded with its reproduction,
expected/actual result and owner in the appropriate design record, then receive
separate correction approval under AGENTS.md. This preflight's findings are
static capability gaps; no new shared-owner runtime defect was reproduced.

Stored Module Links, durable event dispatch, full Medusa workflows, HTTP/API,
general Payload integration and deployed Cloudflare compatibility remain outside
this Product-file sequence. The shared transaction foundation supports those
later slices; passing these files alone would not establish their parity.

## Preflight Validation

Validated the inventory's eight source hashes, AST declaration counts, case
locations, helper/setup references and known gap IDs against the checkout.
All preflight file links and 17 gap IDs resolve. Verification receipts:

- `node third_party/medusa/scripts/verify-source.mjs`: 8496 files, zero symlinks,
  exact pinned source commit verified.
- `node scripts/check-medusa-currency-promotion.mjs`: 320 promoted files across
  ten private packages verified.
- Inventory check: eight source hashes, 149 distinct declaration positions,
  95 module-service declarations and inherited hook/local-helper references.
- `git diff --check`: passed.

No new original suite was executed and no runtime code, test registration or
source-island file was changed by this preflight.
