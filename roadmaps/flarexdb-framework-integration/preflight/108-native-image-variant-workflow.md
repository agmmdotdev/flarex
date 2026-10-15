# Native Image Variant Workflow

## Status And Authority

Status: implemented for the finite profile below through the actual native
composer. Connected PGlite and ordinary-role PostgreSQL execution establishes
the selected resource fit. Arbitrary graphs, durable workflow execution and
hosted activation remain separate admissions.

The continuing Medusa integration goal authorizes this next connected Product
slice and necessary corrections in its existing owners. Authority is the
accepted design, package boundaries, [Medusa adoption](../06-medusa-adoption.md)
and pinned Medusa 2.13.4 at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. The source island stays read-only.
Existing Variant-to-Images and Product/Variant update consumers remain supported.

The composer is `batchImageVariantsWorkflow`: one existing Image associated
with several existing Variants. It is the inverse entry point of the already
promoted `batchVariantImagesWorkflow`, not a new Module Link family. Actual
VariantProductImage rows remain module-local Product storage.

## Exact Pinned Execution

These three actual files are promoted from
`third_party/medusa/upstream/packages/core/core-flows/src/product/`:

- `workflows/batch-image-variants.ts`
- `steps/add-image-to-variants.ts`
- `steps/remove-image-from-variants.ts`

Reuse the already promoted `steps/update-product-variants.ts` and
`common/steps/use-query-graph.ts` from their actual owners. Preserve genuine
compensator bodies under the existing transaction-covered workflow profile.

The composer normalizes omitted `add` and `remove` to empty arrays, then invokes
the add and remove steps through native `parallelize`. Each empty step returns
an empty result and compensation record without resolving Product. Nonempty
steps map requested Variant IDs to `{ image_id, variant_id }` pairs and call
native `addImageToVariant` or `removeImageFromVariant`. Their step results are
the raw requested ID arrays, rather than returned assignment identities or
actual affected-row lists. Compensation removes the originally requested
additions or re-adds the originally requested removals. Whole-root rollback must
not execute those inverse callbacks against pre-existing assignments.

When the requested removal array is nonempty, preserve both genuine queries:

- `variants`, fields `id,thumbnail`, filter `{ id: remove }`, named
  `get-variants-for-thumbnail-check`.
- `product_image`, fields `id,url`, filter `{ id: image_id }`,
  `options: { isList: false }`, named `get-image-for-thumbnail-check`.

The first query's result is supplied to the transform but is not inspected by
its callback. It remains an executed dependency, not permission to eliminate
the query or substitute facade selection. The transform accepts only a truthy
string Image URL; otherwise it returns null. An empty URL exercises the native
stored-data branch. A synthetic null-URL query result characterizes only that
callback branch: Image's native DML does not admit a null URL.

For a truthy URL, the exact update input is
`{ selector: { id: remove, thumbnail: imageUrl }, update: { thumbnail: null } }`.
This runs even when no Variant matches the selector. The existing native update
step derives selects/relations from `[update]`, lists preimages using the same
selector, then invokes the selector overload of `updateProductVariants`.
Its compensation upserts the genuine preimages. The composer returns
`{ added: addStepResult ?? [], removed: removeStepResult ?? [] }` and declares
no hook or explicit workflow event emission. Do not add Category/Option event
barriers, Link routing or custom workflow messages.

## Native Module And Preparation Closure

`packages/medusa-product/src/services/product-module-service.ts` already owns the
native behavior. `addImageToVariant_` delegates to the assignment internal
service's create and projects returned identities. `removeImageFromVariant_`
lists assignment rows with `$or: pairs` and physically deletes the returned
identities. Neither entry point declares a new workflow event family; the
current admitted assignment receipt treats those writes as silent.

Native `updateProductVariants(selector, update)` first lists matching Variants,
builds keyed update inputs and enters `updateVariants_`. Even for the thumbnail
change, this method then reads the selected IDs, all sibling Variants belonging
to their Products with `relations: ["options"]`, and all Options for those
Products with `relations: ["values"]`. It runs native assignment/normalization
and `upsertWithReplace` with `relations: ["options"]`, then serializes the result.
The absence of incoming `options` skips duplicate-option validation; it does
not remove those preparation reads. Preserve complete cohorts and existing
option/pivot identities instead of bypassing the native method.

The native assignment service has an explicit TODO for validating that Image
and Variant belong to the same Product. Native execution accepts otherwise
valid cross-Product pairs. The Image's parent need not be a thumbnail-preparation
parent; do not introduce same-Product enforcement or count an unread Image
parent as a native preparation dependency.

Native additions preserve duplicate pairs and already-present pairs by creating
distinct assignment identities. Removal selects the complete requested-pair
cohort and deletes all matching identities once. Raw result arrays preserve
requested order, duplicates and missing IDs rather than describing affected
rows. The raw module's empty removal selector can remove all assignments; the
genuine workflow's empty step short-circuits before that call. Retain genuine
parallel add/remove nodes, including intersections. Borrowed operations use
the explicit queued atomic profile described below. The retained
Variant-to-Images facade's separate duplicate/intersection admission remains
unchanged.

Native `parallelize` merges sibling actions and preserves result positions;
the native orchestrator starts their promises without awaiting the preceding
sibling's completion. It establishes no add-before-remove ordering. A removal
deletes its actual complete selection; an intersecting new assignment may
survive when creation follows that selection. Repeated native runs that remove
the new row characterize one interleaving, not a remove-wins guarantee. Preserve
assignment identities and complete deletion receipts for the executed ordering.

Fresh native characterization distinguishes generated ORM schema from the
actual assignment migration. Generated ORM assignment DDL has no endpoint FKs.
`packages/modules/product/src/migrations/Migration20250929204438.ts` declares
only the Image FK, with no pair uniqueness or Variant FK. Under that exact
migration, a missing Image maps to native `not_found`; a missing Variant can
produce a dangling native assignment. The selected portable DML/core retains
both declared endpoint FKs and its missing-Variant refusal. Do not weaken that
existing storage contract to imitate a missing upstream constraint. Native
soft-deleted endpoint additions retain their rows because physical FKs still
resolve; the connected boundary retains those inactive-endpoint additions.

Native ORM full-row assignment removal joins both Image and Variant with
`deleted_at IS NULL`; a missing or inactive endpoint hides the assignment.
The native ORM's partial-select auto-join rules differ, so this is a selected
query shape rather than universal FK visibility. A connected PostgreSQL witness
exposed the portable removal deleting an assignment to a deleted Image. The
scoped correction belongs to the query owner: the named inverse-workflow profile
now declares both endpoint predicates through checked DML relations. Retained
portable profiles keep their separate selection. Connected verification of this
correction remains required. Query characterization
executes the actual native composer/SDK, steps and Product services through a
query port backed by native list calls. It does not establish a fully bootstrapped
native remote-joiner installation.

## Existing Owners And Necessary Extension

`src/workflows/product/variant-images.ts` owns genuine composer preparation
and the existing atomic host/resource construction. Product is the only module
participant. The local graph already derives native `variants` aliases and
Image reads from checked metadata; preserve exact query names, fields,
cardinality and scope behavior.

The named `public.product-image-variant-workflows` module view selects actual
add/remove, list and thumbnail-update methods. `commands/image-variants.ts`
and `variant-workflow-input.ts` admit bounded ID-array selection plus exact
thumbnail equality. The retained scalar image-workflow contract remains
separate. Do not grant arbitrary mutable fields, filter matching Variants in
the facade or widen the general Product/Variant update profile.

`events/variant.ts` owns the named assignment/thumbnail receipt. It authenticates
the complete matching cohort, original thumbnails, unchanged non-thumbnail
fields, full portable native result, ordered mutations and actual Variant module
messages. No-match updates retain the executed list/update calls and prove no
mutations or events. Removal receipts bind the complete pair selection; create
receipts bind all returned assignment identities. The named portable repository
retains `preservePrimaryKeyOrFilterOrder` over native `buildQuery` normalization;
this established fork behavior must not be described as the fresh ORM's
ID-ascending result ordering.

`query/relations.ts` exposes an optional module-owned `admitSelection(table,
rows)` verdict. `query/read.ts` and `relation-filter.ts` propagate it through
root database/page reads, complete catalog reads and raw population/filter
selections before presentation. It sees hidden pivot rows as well as displayed
entities. The named related-read profile refuses explicit paging before store
execution. `image-variant-profile.ts` owns command-local identity sets derived
from DML keys, including composite pivot identities, so repeated selections do
not consume the graph allowance twice. Existing profiles omit this callback.

`relation-filter.ts` resolves a belongs-to filter to the source FK predicate
over the complete target selection. It uses the same manager and bounded reads,
without a second root scan. Existing to-many traversal retains its source-PK
predicate. The named full-row assignment selection constrains the target reads
to the requested Image and Variant IDs, then applies their native active-row
predicates. Deletion receipts bind the visible pair cohort to those authenticated
endpoint observations; an old assignment observation alone grants no visibility.

The SDK owns a separate reference-resolution correction. The native transform
in `batch-image-variants.ts` returns `selector.id: normalizedInput.remove` from
its definition closure. Native SDK `utils/composer/helpers/resolve-value.ts`
`unwrapInput` resolves such nested WorkflowData; the portable interpreter
previously attempted value capture while the reference was still a Proxy.
`medusa-workflows-sdk/src/resolution.ts` now snapshots reached transform-returned
data descriptors and resolves authentic references before ordinary capture.
Arrays retain the existing capture owner's ordinary prototype and dense index
order requirements; reconstruction cannot normalize a refused array.
`runtime.ts` performs foreign descriptor inspection through the same existing
`port.invoke` boundary, preserving typed foreign failures and full Causes.
No composer rewrite, facade unwrapping, alternate identity or extra lifetime is
introduced. Same-owner authentication, reached guards, completed-step checks,
ordinary/reference cycles and cross-parallel pending cycles remain enforced.
Dynamic returned-data compilation admits at most 4096 visited items and 64
levels, using the existing SDK definition bounds. Cumulative returned-reference
depth is at most 64 and a frame admits at most 4096 transform cells. Final
capture still owns value resources; these inspection bounds do not replace its
byte/node/depth accounting. Each resolving traversal also bounds expanded visits
to 4096, counting repeated aliases and retaining its counter across suspension.
A small shared source graph cannot expand exponentially before final capture.
The existing 64 workflow-node cap remains unchanged.

Any shared selection, replacement or receipt defect belongs to its existing
owner. Preserve a failing witness, correct that owner within the continuing
authorized scope and rerun retained consumers. No adapter SQL, second lifetime,
fallback path, synthetic event or weakened assertion is an acceptable repair.

## Finite Profile And Resource Proof

The selected finite profile admits one Image, at most four raw requested
additions and four raw requested removals, and at most eight existing identities
in the complete assignment-deletion cohort. Native thumbnail preparation admits
at most sixteen total sibling Variants, four actually read Product parents,
four total Options including owners discovered through Values, four Value rows
per Option owner in native selections and four Variant-Value pivots per Variant. These are
complete preparation-cohort bounds, not four Options per Product. Partial
preimage projections may omit a parent; the later full native preparation binds
its actual parent cohort. Preserve relevant inactive rows selected by that
preparation. Unrelated assignment families gain no mutation authority.

The prepared connected boundary witnesses extend the characterized native
preparation graphs. One uses one Product, sixteen sibling Variants
with distinct four-Option combinations, four Options with four Values each,
sixty-four Variant-Value pivots, up to twelve old/new assignment identities
(eight old removals and four disjoint additions) and one Image: 114 modeled
identities before additional native projections, endpoint observations or
owner-specific accounting. Four addition endpoints sit outside that sibling
cohort on independent Products, exercising twenty Variants and five Products
in total.
The four-parent witness has
thirteen Variants on one Product sharing its four Options, sixteen Values and
fifty-two pivots, plus one Variant on each of three other Products without
Options. Four removals select one Variant per parent; four distinct additions
complete the selected old/new assignment union of twelve. Including one Image
gives 105 modeled identities before those separate addition endpoints. The
connected witness preserves twenty Variants and eight Products in total.
Both complete database maximum witnesses preserve these endpoints and their
Option/pivot graphs under the ordinary 128-identity working set. They charge
78 and 81 bounded entries respectively, with four actual module events and
sixteen revisions (eight assignment deletions, four additions and four thumbnail
updates).

Summing independent maxima for four Products, sixteen sibling Variants, four
Options, sixteen Values, sixty-four pivots, twelve assignments and one Image
gives a conservative modeled union of 117 identities. This does not claim those
independent maxima form a simultaneously legal graph or cover unmeasured
endpoint observations outside the preparation examples. None of these
calculations establishes actual charged identities. The executing maximum
witnesses, rather than this modeled sum, establish fit within the ordinary
128-identity working set for their admitted graph. Recalculate from executing
reads and mutation receipts when expanding the profile.
Profile changes require explicit admission, never pagination, omitted native
preparation or silent result truncation.

Default OCC and event/byte/working-set limits remain unchanged. Native thumbnail
preparation exceeds the ordinary 64-call allowance. Only the authenticated
Image-to-Variants facade selects a named 128-call allowance through the existing
trusted composition API. Its complete maximum witnesses fit that allowance.
The named workflow selects the existing queued operation profile for genuine
sibling execution within one outer lifetime. A facade bound
alone does not prove preparation bounds. The complete selected cohort must be
observed and refused at its existing owner before mutation when it exceeds the
named profile. If a later native preparation exceeds a bound after earlier
assignment writes, prove sticky refusal and whole-root rollback. No global
resource increase follows from this profile.

## Coverage And Remaining Admissions

Native characterization identifies actual pinned SDK, Product service and ORM
repository execution, including exact assignment-migration behavior. Retain
those source-backed assertions for empty/omitted arrays, requested order and
duplicates, intersections, existing/absent assignments, endpoint distinctions,
cross-Product pairs, URL branches, mixed thumbnails and no-match calls. Keep
native ORM, query-port-only branches and the portable service contract distinct.

The connected boundary retains those assertions on PGlite and
ordinary-role PostgreSQL separately, including authentic native step calls,
preimage queries, raw output arrays, silent assignment writes and actual module
events. Coverage includes full maximum and over-bound preparation graphs, forged receipt
witnesses, failure after assignment mutation, original-assignment restoration,
caught refusal, escaped callbacks, cancellation, replay, acknowledgement
recovery, scope confinement and competing PostgreSQL roots. Retained
Variant-to-Images and Product/Variant update/replacement consumers remain
regression obligations.

Changes require affected types/builds, source and promotion provenance, browser
guards and configured lint. Both required read-only reviewers and exact-index
checks precede a significant scoped commit. Arbitrary graphs, generalized restoration, File,
Region, Notifications, import/export confirmation/background execution, hosted
activation and durable workflow/event delivery remain separate admissions.
