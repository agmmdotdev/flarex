# Native Product Option Workflows

## Status And Authority

Status: implemented and validated for the finite private creation,
selector-update and soft-deletion profile on PGlite and ordinary-role
PostgreSQL. This record does not admit hosted or arbitrary graphs.

The continuing Medusa integration goal authorizes the next connected Product
Option slice, including necessary corrections in its existing owners. Authority
is the accepted design, package boundaries, Medusa adoption roadmap and pinned
Medusa 2.13.4 at `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. The source island
remains read-only. Existing public/internal Option compatibility remains supported.

The existing portable Option service/replacement path was admitted by
[the Option profile](./40-medusa-product-options.md). That executing fork is the
selected contract. Fresh MikroORM witnesses are recorded separately: its
selector results use ID-ascending order, update DTOs can be partial, creation
Value DTOs can omit `option_id`, and an unchanged matched Value can still emit
an update. The portable path retains native fork filter ordering, complete
stored DTO projection and performed actions, without facade enrichment or
replacement messages.

## Pinned Native Execution

Promote the six actual files under upstream
`packages/core/core-flows/src/product/{steps,workflows}/`, named
`{create,update,delete}-product-options.ts`. Retain genuine compensator bodies
under the existing transaction-covered workflow profile.

Creation calls `createProductOptions(input.product_options)`, invokes
`productOptionsCreated({ product_options, additional_data })`, captures ordered
`product-option.created` workflow events and returns the complete DTO array.
The executing native module requires `product_id` and converts incoming Value
strings to native `{ value }` creation entries.

Update derives preimage selects and relations from `[input.update]`, calls
`listProductOptions(input.selector, config)`, then the selector overload of
`updateProductOptions`. It invokes `productOptionsUpdated` before capturing
ordered `product-option.updated` workflow events and returns complete DTOs.
The genuine compensator converts preimage Values back to strings and removes
the populated Product before upsert.

Deletion accepts `{ ids: string[] }` and passes its raw ID array to
`softDeleteProductOptions`, invokes `productOptionsDeleted({ ids })`, then runs genuine native Link deletion and
requested-ID workflow events as parallel siblings. The native void result
becomes null at the existing completed-workflow boundary. Hooks precede workflow
events in all three composers; deletion's hook also precedes both siblings.
Do not reuse Category's event-before-hook barrier.

## Selection, Replacement And Lifecycle Ownership

Native `buildQuery` deduplicates direct ID arrays by first occurrence. The
pinned fork's `preservePrimaryKeyOrFilterOrder` preserves that order for the
default/id-ascending query. Bind the existing helper to the named Option
workflow repository profile rather than imposing Category's binary-ID order.
Selector updates with no matches return `[]`; the workflow does not invoke the
separate keyed-update overload that throws for a missing root.

The existing portable `ProductModuleService.createOptions_` and `updateOptions_`
already own normalization and replacement. Reuse them. Matching Value strings
retain existing identities. Omitted `values` preserves Values; an empty array
clears them. Native replacement physically removes omitted Values and their
Variant-Value pivots, preserving Variants and Products. Metadata replaces its
whole value. This slice retains the existing refusal of Product reassignment.

Option soft deletion uses the native generic lifecycle and its declared owned
Value cascade. Missing/already-deleted IDs are no-ops and duplicate IDs cause
one actual transition per active identity. Values are soft-deleted; Variants,
Variant-Value pivots and Products survive. Module messages cover actual changed
entities, while deletion hooks, Link selectors and workflow events preserve raw
requested IDs, including duplicates and missing IDs. Authenticate the genuine
public mapped cascade result with the existing joiner linkable keys.

Owned Values that were already deleted are included and retimestamped when an
active Option is deleted. Their actual old deletion timestamp classifies their
callback as an update; newly deleted Values produce deletion messages. Core's
managed lifecycle already owns that transition. The Option repository passes
the authenticated operation preimages to the native mutation dispatcher.
Missing/already-deleted Option roots remain no-ops.

Use the genuine `Link([])` delete route with exactly
`{ product: { product_option_id: ids } }`. It returns `[null, {}]`, including
empty/missing/duplicate requests. No stored Option Link family is admitted.

Strengthen the existing Option receipt and lifecycle owners rather than adding
a permissive facade validator. Bind results and messages to complete selector
cohorts, requested fields, native Value identity reuse, exact replacement
removals and preserved endpoints. Use existing projection contracts for native
preimages; retain complete write DTO validation.

## Finite Profile And Evidence Gates

Start with at most four Option roots, four existing and four incoming Values per
Option, two Variant-Value pivots per removed Value and four existing Product
parents. Bound complete native selections before writes, including cascades and
replacement removals. A fifth selected root must not become a paginated prefix.
Empty arrays retain native behavior. General reassignment, restoration, custom
Option Links and hosted activation remain separate gates.

The shared replacement planner presents its actual complete indexed selections
to module-owned pure admission before writes. It adds no query, lifetime or
settlement. Preserved Value pivots and soft-deletion pivots remain untouched;
the profile does not add reads or count limits to those unrelated references.
Its existing complete Value projection read moves into preparation and is
reused after writes, so omitted-relation bounds also fail before writes.

Default relation presentation hides soft-deleted Values while retaining their
persisted rows and pivots when `values` is omitted. Explicit replacement includes
all persisted old Values in removal planning, including deleted ones. Repeating
a deleted Value's text creates a new identity and removes the old row/pivots;
it does not resurrect or transfer those pivots. The existing module projection
owner filters deleted presentation rows without dropping replacement state or
receipt evidence.

The source-derived maximum replacement union contains four Options, sixteen old
Values, sixteen entirely new Values and thirty-two removed pivots: sixty-eight
identities before parent/endpoint observations. Including thirty-two distinct
Variant endpoints and four parents yields 104 identities. This is a graph
calculation, not an executed resource receipt. Complete creation exceeds the
initial 64-call allowance and selects a named 128-call allowance. Complete
replacement also refuses 64 calls and selects a named 128-call allowance.
The complete replacement witness fits at 111 bounded entries and 40 events,
including all thirty-two distinct Variant endpoints. Native discriminator
Options and their Variant links remain unchanged. Deletion retains 64 calls.
Each retains 64 events, ordinary 128-identity working sets and default OCC.
Shared defaults remain unchanged; this finite fit does not admit arbitrary
graphs or unbounded hook work.

Prove empty, missing, duplicate and selector-order behavior; native preimage
selection; Value reuse, replacement and clear-versus-omitted behavior; metadata
replacement; exact hook/event order; and genuine Link/mapped cascade ABI.
Retain public/internal Option originals and storage regressions. Include complete
maximum graphs, refused over-bound graphs, unchanged endpoint/pivot witnesses,
forged receipts, rollback, caught refusal, extra hook writes, cancellation,
replay, acknowledgement recovery, scope confinement and competing PostgreSQL
roots. Native ORM witnesses must identify the actual executing service; the
PGlite comparison adapter alone does not establish ORM behavior.

Validate PGlite and ordinary-role PostgreSQL separately, then affected types,
builds, source/provenance/browser guards and configured lint. Both required
read-only reviewers and exact-index checks precede the scoped commit. Update
the implementation status only after these gates pass.
