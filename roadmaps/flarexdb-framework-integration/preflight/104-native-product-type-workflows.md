# Native Product Type Workflows

## Status And Authority

Status: implemented as a private, bounded native Product Type workflow
capability over one atomic root.

The continuing Product integration goal authorizes the actual
`createProductTypesWorkflow`, `updateProductTypesWorkflow` and
`deleteProductTypesWorkflow`, including necessary corrections at their existing
owners. Each facade selects one atomic root. Implementation is a separate slice
from Product and Variant batches.

Authority is the accepted Flarex design, package boundaries, Medusa adoption
roadmap and Medusa 2.13.4 at pinned fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. The source island stays read-only.
General deletion, restoration, custom Type Link families, distributed workflows,
remote effects, durable-data destruction and hosted activation remain separate
gates. Existing Product profiles retain their supported contracts.

## Pinned Execution

Primary source paths are relative to `third_party/medusa/upstream/`:

- `packages/core/core-flows/src/product/workflows/create-product-types.ts`
- `packages/core/core-flows/src/product/workflows/update-product-types.ts`
- `packages/core/core-flows/src/product/workflows/delete-product-types.ts`
- Their corresponding files under `packages/core/core-flows/src/product/steps/`.
- `packages/core/core-flows/src/common/steps/remove-remote-links.ts` and
  `emit-event.ts`.
- `packages/modules/product/src/services/product-module-service.ts:864-919`.
- `packages/modules/product/src/models/product-type.ts` and `joiner-config.ts`.
- `packages/core/utils/src/modules-sdk/medusa-service.ts`,
  `medusa-internal-service.ts`, `common/merge-metadata.ts` and
  `core-flows/events.ts`.
- `packages/core/modules-sdk/src/link.ts`, especially `executeCascade` and
  `delete`.

Creation passes `input.product_types` directly to `createProductTypesStep`,
which calls `service.createProductTypes(data)` and returns the actual DTO array.
The parent invokes `productTypesCreated({ product_types, additional_data })`
before emitting `product-type.created` for returned IDs, then returns that DTO
array. Preserve native array order, empty input and optional additional data.

Update passes its input to `updateProductTypesStep`. That step derives selects
and relations from `[data.update]`, calls
`listProductTypes(data.selector, { select: selects, relations })` for the native
preimage, then calls `updateProductTypes(data.selector, data.update)`. The parent
invokes `productTypesUpdated({ product_types, additional_data })` before
`product-type.updated`, whose IDs come from the actual returned DTOs. The result
is the native DTO array.

Deletion calls `softDeleteProductTypes(input.ids)` first. It then invokes
`productTypesDeleted({ ids: input.ids })` before genuinely parallel sibling
steps: `removeRemoteLinkStep({ product: { product_type_id: input.ids } })` and
`emitEventStep` for `product-type.deleted`. Workflow events describe original
requested IDs, including missing IDs and duplicates, in request order. Module
events describe actual native transitions. The step returns void, normalized
to null at the existing completed-workflow boundary.

Creation and update each have three executable nodes; deletion has four.
Transforms are references, rather than additional executable nodes. Preserve
native hook timing, sibling grouping and callback failure semantics through
the existing SDK and one queued atomic root, without nested hosts or additional
settlement owners.

## Native Type Semantics

`ProductModuleService.updateProductTypes` has distinct overloads. A string ID
first retrieves that Type and returns a scalar DTO. An object selector lists
matching Types, maps them to keyed internal updates, and returns a DTO array.
The workflow uses the object-selector overload. Missing selection returns an
empty array; a keyed update's missing-ID behavior is not interchangeable.

The internal service performs native metadata merging before the repository
write when incoming metadata is present and nonempty. That merge preserves
absent top-level keys, removes keys whose incoming value is the empty string,
and replaces incoming nested values without recursive merging. Omitted
metadata preserves the old value; explicit `{}` and null pass through and
replace it. Reuse this implementation; Variant upsert replacement semantics do
not describe Type updates. Preserve the native behavior of empty updates
rather than introducing facade defaults.

ProductType has an active-row unique index on `value`. Its `products` hasMany
relation has no cascade declaration. Native soft deletion therefore changes
Type rows and retains every existing `Product.type_id`; it does not detach
Products or emit Product update events. The existing adapter physical Type
delete deliberately detaches nullable Product references and must not implement
this workflow. Reusing a deleted Type's value creates a distinct identity and
does not retarget existing Product references.

There is no bound on existing Product backreferences in this admission.
Deletion does not read or traverse them, and their number does not enlarge its
mutation graph. Four referring Products are a connected preservation-test
fixture, not a global support restriction or a reason to add a count query.

## Module And Resource Ownership

The existing Product owner already provides Type creation, listing, keyed
update, upsert, physical deletion, metadata-derived values and module events.
Extend that owner with selector update and soft-delete command tokens invoking
the actual native methods. Prepare a narrow Type workflow view with genuine
create/list/update/soft-delete methods and existing bounded graph reads for
hooks. Do not broaden older workflow selections merely to assemble this view.

Relevant current owners are under
`packages/medusa-adapter/src/modules/product/`: `commands/mutations.ts`,
`commands/reads.ts`, `repository.ts`, `lifecycle.ts`, runtime/value metadata and
`events/`. Admit Type soft deletion through the existing `medusaLifecycle`
mechanics, not a second cascade algorithm. Derive Type update admission from
its own DML fields; Tag-only input validation is not a Type contract.

Selector receipts must bind the complete native selection, returned rows,
mutations and events at the authentic command boundary. Soft-delete receipts
must require exact coverage of eligible active requested Type roots using
observed rows and mutation preimages, coalesce duplicate and missing requests,
and reject unrelated mutations, lifecycle entries, reference replacements or
set-null effects. Reuse existing receipt owners where their contracts match;
do not weaken root coverage for successful no-op calls.

The Link capability accepts only the native deletion selector
`{ product: { product_type_id: ids } }` with at most four input entries. Bind it
through the existing authentic composed-resource issuer to the portable native
`Link` with an explicit empty selected routing set. Current
`packages/medusa-modules-sdk/src/link.ts` already requires an explicit loaded
module array and has no process-global fallback. Thus `new Link([])` is the
existing correct owner construction; no framework constructor correction is
needed. Genuine `executeCascade` returns the full `[null, {}]` tuple when no
registered routing matches. Do not replace it with a fabricated no-op callback
or claim support for custom Type Links.

The composed-resource issuer currently rejects an empty dependency array,
preventing that genuine empty router from being issued. Its owner must admit
an empty authenticated dependency set while retaining descriptor capture,
method and identity validation, resource authenticity and callback lifetime
confinement. No fabricated dependency or additional source is appropriate.
The continuing goal authorizes this connected correction; neutral resource
coverage and native Type deletion must establish the resulting scope.

Promote the three native composers and three Type steps with established
portable imports and transaction-covered compensation declarations. Creation's
compensator physically deletes created IDs; update's compensator upserts its
captured preimages; deletion's compensator restores requested Types; common
Link removal declares Link restoration. These declarations do not authorize
forward inverse methods or independent compensation writes. The outer owner
rolls back failure atomically.

## Finite Envelope And Resource Candidates

- At most four creation entries, four deletion entries and four selected update
  roots per corresponding workflow. Keep delete request duplicates and missing
  IDs; they count as input entries without inventing extra transitions.
- Admit object selectors with optional `id` as a scalar or at most four entries
  and optional `value`. An empty object remains a selector. The complete
  selection must refuse a fifth matching row rather than update a page prefix.
  Search/operator forms outside this profile fail explicitly.
- Preserve Type DML and existing bounded metadata/value contracts, optional
  additional data and bounded hook reads. Do not add Product backreference
  admission or facade-side selection algorithms.
- At most four Type transitions and four workflow event IDs per root. There
  are no Link, Product, Inventory or Pricing mutations from the admitted empty
  Type Link routing.
- Named allowance: 64 calls and 64 events, existing byte/node limits
  and ordinary 128-row working set, with default OCC. The complete four-Type
  creation graph with nested metadata and a bounded hook graph read uses
  26 calls and eight events.
  No mixed publication or larger participant limit is presently justified.

Source JSON byte/node limits and the root's total lifetime budgets remain
independent refusal boundaries; finite graph cardinalities do not guarantee
simultaneous maxima for every metadata value or hook call. Preserve an actual
refusal and full rollback witness before any necessary named budget adjustment.
Shared defaults, deadlines and storage limits remain unchanged.

The named Type roots admit one authentic native write command each; hook
callbacks may use bounded reads, but additional native Type writes are outside
this slice. Per-call four-row limits and event correlation alone are
insufficient: an update hook can update the same roots again and emit matching
workflow events. The PostgreSQL witness updated the same three roots twice and
published six module and six workflow events, exceeding the root's transition
and event-ID bound. The Type facade authenticates exactly one successful native
write call before publication. This is a root admission rule, not a shared method restriction or
an additional transaction. A native hook witness must retain the refusal and
full rollback proof.

## Completion Gates

Prove empty and maximum creation; selector ID/value/empty/missing behavior;
complete-selection refusal beyond four roots; native metadata merge and key
removal; and unique-value conflict with full rollback. Updating several Types
to one unique value must retain native conflict behavior, rather than being
used as a successful maximum witness.

Prove empty, missing, duplicate and already-deleted deletion requests with exact
requested workflow events and coalesced actual module transitions. Verify four
referring Products retain their scalar Type IDs without Product update events,
including after the old Type value is reused. Characterize ordinary active
relation projection separately from preservation of the stored reference.

Prove native empty Link routing and the full result tuple, authentic resource
selection, forged capabilities, caught refusals and escaped callbacks. Cover
hook failure before workflow events, cancellation and drainage, late dispatch,
replay/revision conflicts, uncertain acknowledgement, two-shop confinement and
focused PostgreSQL competing roots. Bind workflow event correlation to actual
successful method tokens and returned or requested IDs as appropriate.

Run affected Product owner and consumer regressions, the connected workflows
in PGlite and ordinary-role PostgreSQL, affected types/builds, source promotion
and portability guards, and required lint. Both read-only project reviewers
inspect the final checkpoint. Completion establishes this private finite Type
workflow profile; general restoration/deletion, custom Link cascades, arbitrary
graph size, distributed execution and hosted activation retain separate gates.
