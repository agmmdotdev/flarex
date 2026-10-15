# Native Product Collection Workflows

## Status And Authority

Status: implemented private finite native Collection workflow profile under the
continuing Product integration goal. The named admission below preserves native
ordering, results, hooks, events and lifecycle through one settlement owner.
General restoration, larger graphs, custom Links and hosted activation remain
separate gates.

Authority is the accepted Flarex design, package boundaries, Medusa adoption
roadmap and Medusa 2.13.4 at pinned fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. The source island stays read-only.
Record 39 admits Collection service behavior; it does not establish execution of
these native composers. This slice selects `createCollectionsWorkflow`,
`updateCollectionsWorkflow` and `deleteCollectionsWorkflow` as separate atomic
roots. Existing Product, Type, relationship and batch profiles retain their
contracts. General restoration, custom Collection Links, arbitrary membership
graphs, distributed execution and hosted activation remain separate gates.

## Pinned Execution

Primary source paths are relative to `third_party/medusa/upstream/`:

- `packages/core/core-flows/src/product/workflows/create-collections.ts`,
  `update-collections.ts` and `delete-collections.ts`.
- Their corresponding files under
  `packages/core/core-flows/src/product/steps/`.
- `packages/core/core-flows/src/common/steps/emit-event.ts` and
  `remove-remote-links.ts`.
- `packages/modules/product/src/services/product-module-service.ts`, especially
  `createCollections_`, selector `updateProductCollections`,
  `updateCollections_`, `normalizeCreateProductCollectionInput` and
  `normalizeUpdateProductCollectionInput`.
- `packages/modules/product/src/models/product-collection.ts`,
  `models/product.ts` and `joiner-config.ts`.
- `packages/core/utils/src/modules-sdk/medusa-service.ts`,
  `medusa-internal-service.ts`, `build-query.ts`,
  `common/get-selects-and-relations-from-object-array.ts`,
  `common/merge-metadata.ts` and `core-flows/events.ts`.
- `packages/database/drizzle/src/medusa.ts`, especially explicit-field
  selection, relation loading and relation projection.
- `packages/core/modules-sdk/src/link.ts`, especially `delete` and
  `executeCascade`.

Creation passes `input.collections` to `createCollectionsStep`, which invokes
`createProductCollections(data)` and returns the actual DTO array. The parent
emits `product-collection.created` for returned IDs, then invokes
`collectionsCreated({ collections, additional_data })`, and returns that array.
Preserve native array order, empty input and optional additional data.

Update passes its input to `updateCollectionsStep`. The step derives selects and
relations from `[data.update]`, reads native preimages through
`listProductCollections(data.selector, { select: selects, relations })`, then
calls `updateProductCollections(data.selector, data.update)`. The parent emits
`product-collection.updated` for actual returned IDs before invoking
`collectionsUpdated({ additional_data, collections })`. Its result is the native
DTO array.

Deletion invokes `softDeleteProductCollections(input.ids)` first. It then runs
genuine parallel siblings: `removeRemoteLinkStep({ product: {
product_collection_id: input.ids } })` and emission of
`product-collection.deleted` for the original requested IDs. Only after that
region completes does it invoke `collectionsDeleted({ ids: input.ids })`.
Requested duplicates and missing IDs retain their workflow-event order; module
events identify actual transitions. The native step returns void, normalized to
null at the existing completed-workflow boundary.

Creation and update each have three executable nodes; deletion has four.
Transforms are references, not extra executable nodes. Unlike the Type
composers, Collection hooks follow workflow-event capture. Hook failure must
roll back those already captured intents as well as row changes. Preserve this
ordering through the existing SDK and one atomic root. Deletion selects queued
operations for its sibling region, without additional hosts, transactions or
settlement owners.

## Native Collection Semantics

Creation normalizes `product_ids` to `products: [{ id }]` and uses the existing
native `upsertWithReplace(..., { relations: ["products"] })` path. These Products
are existing references, not owned children to create or delete. An omitted or
falsy creation handle is derived from title through native `kebabCase`. A title
update does not regenerate the handle.

`updateProductCollections` has distinct string-ID and object-selector overloads.
The workflow uses the selector overload, which lists matching Collections and
returns an array; an empty selection returns an empty array. Do not substitute
the keyed command's missing-ID error or scalar result. Admit only checked
Collection DML fields, irrespective of extra fields present in a TypeScript DTO
interface.

The native internal service merges nonempty metadata objects before the DAL
write: absent top-level keys survive, incoming empty-string values remove keys,
and incoming nested values replace rather than recursively merge. Omitted
metadata remains unchanged; null and an empty object replace it. Reuse the
existing native metadata helper and authenticate expected values against the
first mutation preimage, rather than framework-owned entity objects already
mutated by native normalization.

Membership omission preserves stored Product associations. An explicit
`product_ids` array requests replacement, including clearing through `[]`.
Creation rejects missing Product references through the existing graph owner.
Membership updates ignore Products absent from the active scope, while the
returned Collection DTO still contains the requested `products: [{ id }]`
stubs, including missing IDs. Omitted membership returns `products: []` without
claiming that the stored association set is empty. Keep this native result
separate from an authenticated graph read of actual membership.

The existing Product Collection integration has an explicit sealed membership
replacement capability. Its issuer accepts one target, and the native service
uses that capability when provided; otherwise it uses its inclusion/exclusion
Product updates. The new finite workflow uses the genuine ordinary native Product update branch
without selecting that optional capability; the existing sealed profile retains
one target and its original purpose for larger replacement sets.
Pinned internal-service selectors all read the initial membership snapshot before
one ordered repository update. Last selected Collection wins overlapping desired
Products; per-target outside members clear. Module messages deduplicate identical
Product updates in first-touch order. Preserve caller ID-array Collection order
through the pinned Drizzle filter-order helper. Existing refusals for
repeated Product references in Collection creation remain intact.

ProductCollection has an active-row unique index on `handle`. Its `products`
hasMany relation declares no cascade. Native soft deletion changes Collection
rows and preserves every stored `Product.collection_id`, without Product update
events. The physical Collection-delete command deliberately detaches references
and must not implement this workflow. Reusing a deleted Collection's handle
creates a distinct identity and does not retarget old Product references.

Soft deletion has no Product backreference bound: it neither reads nor mutates
those Products. Four referring Products are a preservation-test fixture, not a
global support restriction. Characterize active relation projection separately
from preservation of the stored scalar reference.

## Owner Changes And Connected Boundaries

Extend the existing Product owner under
`packages/medusa-adapter/src/modules/product/`. Reuse Collection creation,
listing, DML/value validation, graph association, metadata handling and module
events. Add authentic selector-update and soft-delete tokens, plus a narrow
Collection workflow view exposing create/list/update/soft-delete methods and
bounded graph reads. Older workflow views must not acquire these capabilities
implicitly.

The named repository admission must check the complete native selector result
before writes and refuse a fifth selected Collection. Do not set a four-row
page limit and update its prefix. For membership-bearing updates, admit up to four selected Collections, check
complete prior active membership for each through the existing module-owned
indexed read, then retain the native internal service's ordered Product update pairs. The
named DAL translates each pair to a singleton write under the existing working
set, matching pinned Drizzle's ordered pair loop, including repeated identities.
Every selector uses the initial snapshot; normal publication coalesces final row
afterimages, while the genuine native aggregator deduplicates Product events in
first-touch order. Hooks can read the final pending membership through the same
working set. Shared admissions, indexed dependencies, OCC, confinement and atomic
publication remain unchanged; no new core replacement capability is needed. No facade selection algorithm, invented final membership DTO or second
membership implementation is authorized.

Native preimage selection retains a regression witness for DTO-only paths.
`getSelectsAndRelationsFromObjectArray` treats `product_ids` arrays as
DTO-only selection/relation paths. Pinned Drizzle retains primary keys, filters
explicit scalar fields to actual columns and skips unknown relation descriptors.
The named `nativePreimageSelection` owner now accepts a trusted exact DTO-only
relation selection; this Collection view passes `["product_ids"]`. It removes
those exact transient paths while preserving every other relation, including
declared but unadmitted paths, for ordinary strict DAL refusal. Existing
two-argument callers retain their behavior. Empty updates and metadata paths
reuse this same preimage owner; the facade and repository add no parallel
normalization.

Selector receipts bind the complete selected active preimages, requested
fields, native returned rows, actual mutations and events. Root ordering is
independently derived from initial rows using native binary text order and the
pinned direct-ID-array filter-order helper, including last-duplicate ranking.
Product cohorts retain exact native binary ID order before pending-preimage
and first-touch event checks. Coordinated result/mutation/event permutations
cannot redefine the final membership owner. Preserve scalar and
membership result differences. Membership receipts authenticate the complete native ordered mutations
and their requested identities, including the native distinction
between missing requested stubs and actual affected Products. Reuse the existing
Collection receipt and normal module-event owners; do not replay a
selector operation as several independent keyed calls or fabricate per-call
evidence.

Soft-delete receipts must cover exactly every eligible active requested
Collection using observed rows and first mutation preimages. Coalesce missing,
duplicate and already-deleted requests for actual transitions while preserving
original workflow-event IDs. Bind the native mapped `product_collection_id`
result, lifecycle entries, mutations and module messages. Reject unrelated
effects, set-null work, reference replacements and Product mutations. Reuse
`medusaLifecycle` and the existing exact lifecycle receipt owner, rather than
introducing another traversal algorithm or weakening successful no-op coverage.

No stored Collection Link family is selected. Admit only the native deletion
selector `{ product: { product_collection_id: ids } }` with at most four input
entries through the authentic composed-resource issuer. Bind the real
`new Link([]).delete`, which returns the full `[null, {}]` cascade tuple when no
route matches. Do not replace it with a fabricated no-op callback or claim
custom Link support.

Each facade selects exactly one native write method invocation per root,
including empty calls. The update preimage list and bounded hook reads remain
reads. Hooks must not add another mutation through the selected method or
another alias. Authenticate this restriction using successful command/method
receipts and correlate workflow events with that actual write. Creation/update
workflow IDs come from native results; deletion workflow IDs come from the
original request. Hook failure, caught refusals and escaped continuations retain
the existing sticky failure and revocation behavior.

Promote the six native files with established portable imports and explicit
transaction-covered compensation declarations. Creation's compensator physically
deletes created Collection IDs; update's compensator upserts captured preimages;
deletion's compensator restores requested Collections. Common Link removal
declares Link restoration. These declarations do not admit forward inverse
methods or independent compensation writes: the outer owner rolls back failure.

## Private Finite Envelope

- Creation: at most four Collection entries and four total existing Product
  references across them, retaining the existing duplicate-reference refusals.
- Scalar selector update: at most four completely selected Collections. Admit
  optional exact `id` as a scalar or at most four entries, optional exact `title`
  and optional exact `handle`; an empty selector remains meaningful. Operator
  and search forms outside this profile fail explicitly.
- Membership-bearing update: up to four selected Collections, at most four
  requested Product entries and four prior active members per Collection, with
  a maximum union of twenty Products. Missing requested IDs retain native update
  semantics. Native selection is ordered and snapshot-based; older sealed
  replacement profiles retain their single-target authority and limits. The
  maximum has 32 Product attempts plus four Collection attempts, coalescing at
  most twenty Product identities and four Collection identities.
- Deletion: at most four input entries, preserving duplicates and missing IDs.
  There is no Product backreference traversal or mutation.
- Preserve bounded metadata, additional data and hook reads. No hook may add a
  second write invocation. General Collection relations and larger membership
  graphs retain separate admission.

Creation and deletion select 64 calls; Collection updates select a separate
128-call profile for the native ordered membership branch. Each retains 64
events, existing byte/node limits and the ordinary 128-identity participant
working set under default OCC. Deletion explicitly queues its native sibling
operations. No mixed-publication permission or larger participant
allowance is presently justified. Validate complete maximum creation,
membership replacement, metadata, preparation, hook reads, derived Product
events and workflow events before acceptance. Preserve an actual refusal and
full rollback witness before any necessary named budget correction; do not
widen defaults, deadlines or storage limits to make the profile pass.

## Completion Gates

Prove empty and maximum creation, native generated/explicit handles, requested
array order, missing Product creation references, disjoint reference admission
and active unique-handle conflicts with full rollback.

Prove ID/title/handle/empty/missing selector behavior, complete fifth-root
refusal before writes, empty updates, shallow metadata merge/removal, null and
empty-object replacement, and title updates that preserve an existing handle.
Prove omitted, empty and nonempty membership requests; movement of existing
Products; missing-ID stubs; complete prior-member refusal beyond four; and
four-target replacement with overlapping requested IDs, preserved target order,
last-write membership and unique first-touch Product events.
The native preimage regression must exercise genuine `product_ids` paths and
retain ordinary DAL refusal for unsupported selections/relations.

Prove empty, missing, duplicate and already-deleted deletion requests with exact
requested workflow events and coalesced module transitions. Four referring
Products must retain their scalar Collection IDs without Product update events,
including after handle reuse. Verify the native empty Link tuple and confinement
of the selected resource.

Prove hooks observe the native ordering after workflow-event capture, including
rollback after hook failure. Refuse a second write through hook-visible methods
or aliases while permitting bounded reads. Cover forged resources, caught
refusals, escaped callbacks, cancellation/drainage, late dispatch,
replay/revision conflicts, uncertain acknowledgement, two-shop confinement and
focused PostgreSQL competing roots.

Run affected Product owner/Collection/relationship regressions, connected
workflows in PGlite and ordinary-role PostgreSQL, affected types/builds,
promotion/portability/source guards, required lint and both read-only project
reviews. Completion establishes only this private finite Collection workflow
profile; general restoration, custom Links and hosted activation retain their
separate gates.
