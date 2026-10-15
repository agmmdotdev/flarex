# Native Product Category Workflows

## Status And Authority

Status: implemented for the private bounded Category workflow profile. This
record does not activate hosted or arbitrary Category graphs.

The continuing Medusa integration goal authorizes the native
`createProductCategoriesWorkflow`, `updateProductCategoriesWorkflow` and
`deleteProductCategoriesWorkflow`, including their portable fork and adapter
corrections. Authority is the accepted Flarex design, package boundaries, Medusa
adoption roadmap and pinned Medusa 2.13.4 at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. The source island remains read-only.

Existing public and internal Category compatibility remains supported. General
restoration, custom Category Link families, distributed workflows, schema/data
migration and hosted activation remain separate gates.

## Pinned Native Execution

The six composers and steps live under upstream
`packages/core/core-flows/src/product-category/{workflows,steps}/`, with filenames
`{create,update,delete}-product-categories.ts`.

Creation passes `input.product_categories` to the actual module service and
returns its complete DTO array. The composer captures `product-category.created`
for returned IDs before `categoriesCreated({ categories, additional_data })`.
Empty input still calls the service, event resource and hook.

Update derives selects and relations from `[input.update]`, reads native
preimages with `listProductCategories`, then calls the selector overload of
`updateProductCategories`. Returned DTOs feed `product-category.updated` before
`categoriesUpdated({ categories, additional_data })`. Empty updates and missing
selections retain their native behavior.

Deletion takes a bare `string[]`, rather than `{ ids }`. It calls
`softDeleteProductCategories`, then genuinely parallel siblings remove native
Links using `{ product: { product_category_id: ids } }` and capture requested
`product-category.deleted` IDs. Both siblings finish before
`categoriesDeleted({ ids })`. The native void result is normalized to null at
the existing completed-workflow boundary. Requested duplicate IDs remain in
workflow-event order.

Creation/update have three executable nodes each; deletion has four. Native
compensators retain physical deletion, preimage upsert and restoration
declarations under transaction-covered compensation. These do not grant forward
inverse methods or independent settlements. The genuine `Link([])` empty route
returns `[null, {}]`; it is not replaced by a fabricated no-op callback.

## Category Semantics And Portable Ownership

The existing portable `ProductCategoryService`, admitted in the
[public Category profile](./42-medusa-product-categories.md), owns handle defaults, complete
tree validation, parent-before-child creation, rank clamping, sibling movement,
descendant paths and deletion preparation. Preserve that owner. Public creation
uses nullish handle defaulting: an explicit empty handle is retained. Supplied
Category metadata replaces the whole value, including nonempty objects; the
Type/Collection metadata merge does not apply.

Category list defaults to `{ id: "ASC", rank: "ASC" }`. Native `buildQuery`
deduplicates direct ID arrays, but the DAL filter-order helper does not override
this two-column order. Do not copy the Type/Collection ID-array ordering rule.

The specialized ORM Category repository validates every requested root and its
active children and prepares sibling reranking before marking any root deleted.
It deletes leaves only. A parent and its active child selected together are
refused in either order. Missing and already-deleted roots fail `NOT_FOUND`.
Empty internal deletion returns `[[], {}]`; the generated public method returns
`{}`. The actual repository tuple preserves requested duplicate entries and
their shared ORM identity.

The real pinned repository was executed with PostgreSQL, real MikroORM,
ordinary-role schema isolation and fresh-reader snapshots. Duplicate deletion of
rank-zero `a` from ranks `a=0,b=1,c=2,d=3` yields active ranks `b=-1,c=0,d=1`;
deleting distinct `a,b` in either order yields active `c=0,d=1`. The duplicate
result contains the same `a` entity twice. These are native behaviors, not a
reason to deduplicate requests, clamp managed ranks, or re-filter a later cohort
against earlier pending rank writes.

Portable deletion preparation therefore gathers the native initial root,
child and sibling selections before ordered rank writes. Each initial cohort
uses pending rank values when its write executes. Reuse this preparation for
physical and soft deletion, preserving physical deletion's existing callbacks.
External requested ranks remain nonnegative safe integers. Native-generated and
stored ranks are signed safe integers; no fixed lower bound follows from the
four-entry request limit across successive calls.

Generic pinned Drizzle `softDelete` is not the specialized Category business
operation: its custom-repository substitution bypasses leaf validation and
reranking and follows generic DML cascades. The portable Category service needs
an explicit soft-delete branch, with Category-bound DAL managed lifecycle writes
and the actual `[rows, {}]` tuple. Do not enable generic child traversal. Product
rows and Category/Product pivots remain untouched, with no bound or count query
on unrelated existing Product references.

Physical deletion remains a separate supported operation. Removing a parent
after its leaf descendants have been soft-deleted also removes those retained
descendants through native Category cascade metadata. Category receipts
authenticate the complete already soft-deleted descendant closure and its
pivots, retain active-child refusal and reject unrelated removals. The shared
Medusa lifecycle owner returns only initially selected roots while retaining
complete changes in its cascade map. Category restores requested root order at
its native DAL boundary. Genuine callbacks and module deletion messages cover
requested roots only, as confirmed by the real ORM child/grandchild proof.

## Events And Projection Boundaries

Retain the existing public portable Category callback contract: real rank writes
dispatch `afterUpdate`; managed root deletion dispatches `afterUpdate` with
original `deleted_at: null`. The pinned Drizzle conventional dispatcher forwards
those actual changes into the existing public aggregator, yielding sibling
update and root deletion messages. Reuse its native deduplication. Do not
register an extra subscriber or construct replacement module messages.

The fresh ORM comparison has no Category subscriber on this specialized method
and emits no module messages. Explicit native subscriber registration produces
rank messages and later root-deletion messages. That transport distinction is
recorded separately from specialized leaf/rank parity; this profile preserves
the already admitted portable Category callback path, rather than claiming
fresh-ORM event parity. Direct internal Category calls retain their existing
silent context and are not broadened by this public workflow profile.

Native preimages can distinguish absent fields from own `undefined` parent
fields. Reuse `captureCategoryProjection`/`decodeCategoryProjection`. A new named
repository profile validates and restores native serialized arrays before the
module's own manual event builders consume them. The outer command alone
encodes the private JSON projection envelope. Existing read-only projection
profiles remain unchanged. Full write DTOs remain subject to the JSON workflow
output contract; do not silently strip native preimage fields or relations.

## Finite Profile And Completion Gates

The private profile admits at most four create entries, selected update
roots or requested delete entries, and four total existing Product references
on creation. It bounds the complete Category identities actually read by native
tree preparation before writes to sixteen, with at most twenty after creation,
and materialized-path depth to four. These are complete touched selections,
not pagination prefixes or a new traversal of unrelated Categories. Ordinary
128-identity working sets and default OCC remain. Additional identities are
granted only for actual newly inserted Categories; updates retain sixteen
throughout later cohort discovery, including after earlier writes. Hook reads retain their
existing bounded graph capability.

Creation, update and deletion each select a named 128-call/64-event allowance.
Their maximum connected graphs exceed the initial 64-call allowance and roll
back completely. Diagnostics observe 64 bounded call entries and 24 events for
four rank-zero inserts over sixteen existing siblings, 109 entries and 19 events
for four selected subtrees across sixteen Categories, and 71 entries and 20
events for four repeated leaf requests across sixteen siblings. These include
pending graph reads in hooks; workflow submissions also retain their own call
admission. Source byte/node limits, deadlines, ordinary profiles and shared
defaults remain independent boundaries.

Prove complete native results, ordering, empty dependencies, preimage relation
selection, undefined representation, metadata replacement, handle defaulting,
and exact event/hook barriers. Bind receipts to complete initial selections,
selected roots, requested fields, actual rank/path maintenance and event order;
coordinated transcript permutations must not redefine root ownership.
The shared creation receipt reuses the executing native identity predicate and
creation field calculation, validates complete ordered sibling shifts, and binds
each complete DTO to its own insertion before later roots can rerank it. Dotted
and reserved identities, forged paths/ranks, unrelated maintenance and stale
intermediate results cannot authenticate a successful native operation.

Run leaf/missing/already-deleted/duplicate/parent-child deletion witnesses,
multiple leaves in both orders, signed managed ranks and reference preservation.
Retain all public and internal Category originals, physical deletion contrast,
bounded membership regressions and owner failure cases. Cover rollback, caught
refusal, extra hook writes, cancellation, replay, acknowledgement recovery,
scope confinement and competing PostgreSQL roots. Both PGlite and ordinary-role
PostgreSQL must validate the portable implementation separately. The installed
PGlite comparison adapter is not MikroORM and cannot establish native ORM
identity-map scheduling.

Affected typechecks/builds, source/provenance/browser guards, configured lint,
both required read-only reviewers and exact-index validation precede each scoped
commit. These gates also apply to later extensions of this profile.
