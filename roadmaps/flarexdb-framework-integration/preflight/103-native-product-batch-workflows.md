# Native Product Batch Workflows

## Status And Authority

Status: implemented as a private, bounded native Product and Variant batch
capability over one atomic root.

The continuing integration goal authorizes necessary framework, adapter and
shared-owner corrections, review and scoped commits. The connected outcome is
the actual `batchProductsWorkflow` and `batchProductVariantsWorkflow`, using
their genuine create/update/delete children under one atomic settlement.

Authority is the accepted Flarex design, package boundaries, Medusa adoption
roadmap and pinned Medusa 2.13.4 fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. The source island stays read-only.
Existing independent facades retain their contracts. General distributed
workflows, remote effects, hosted activation and destructive durable-data
changes remain separate gates.

## Pinned Execution

Primary source paths are relative to `third_party/medusa/upstream/`:

- `packages/core/core-flows/src/product/workflows/batch-products.ts`
- `packages/core/core-flows/src/product/workflows/batch-product-variants.ts`
- Their create/update/delete Product and Variant children, Inventory children,
  Pricing children, native Link router and canonical module joiners.
- `packages/core/workflows-sdk/src/utils/composer/parallelize.ts` and `when.ts`
  own native construction behavior; inspect their actual paths/exports before
  promotion or API changes.

Product batch conditionally reaches each nonempty create/update/delete branch.
It passes the original branch arrays to the corresponding native children,
then returns `{ created, updated, deleted }`, substituting empty result arrays
for skipped create/update branches. `deleted` is the original requested delete
array, including missing and duplicate IDs, rather than a changed-row list.

Variant batch normalizes omitted arrays to `[]` and invokes all three children,
including empty branches. It returns their actual created/updated arrays and
the original requested delete IDs. Neither wrapper introduces events or hooks;
native children retain their own event and hook behavior. This pin has no
standalone Product or Variant upsert workflow: admitted native update steps
already invoke the service upsert behavior.

The full dependency union includes Product, Pricing, Inventory, Stock Location,
Sales Channel, Shipping Profile and both existing logical Link sources.
Empty-input module/query dependencies remain real, selected capabilities.
Prepared child hosts cannot be nested as separate settlement owners.

## SDK Correction

The private SDK supports ordered declarations and explicit independent sibling
regions. Native two-argument `when` and existing named three-argument conditions
share the same composer owner. Batch admission uses the real SDK scheduling
contract rather than an adapter helper or serialized branch execution.

The SDK captures authentic, finite sibling regions and executes independent
regions concurrently through the same root execution port. A direct child is
one region; a conditional child region includes its predicate, guarded child
and branch result. Preparation rejects overlapping regions and dependencies
between siblings. Every region retains its local ordering, conditions and
child evaluation frames. Shared parent transform references resolve once
per frame even when reached concurrently.

Structured failure/interruption cancels and joins siblings, retaining the
initiating failure and full Cause, and borrow the existing callback/runner
owner for bounded foreign-work drainage. A callback abort currently revokes
that shared owner's capabilities and aborts its DAL runners; sibling `closed`
failures must not replace the initiating domain failure. There is no second
Promise owner, transaction, retry, child outcome store or compensation commit.

Native two-argument `when` receives deterministic composer-local naming.
Existing named conditions and ordered workflows preserve their preparation
identity. Explicit parallel-region structure participates in the existing
workflow identity and trusted revision contract; no behavior-changing grouping
may replay an old ordered result.

The native empty Product witness exposes a private capture mismatch: skipped
children leave positional `undefined` values in the tuple passed to the native
result transform, and both native deletion children return void. Existing
workflow capture preserves omitted object members but rejects these genuine
array slots. The private value owner now uses explicit intermediate capture
and owned omission metadata, retaining descriptor safety and all resource
accounting. It restores only genuine own undefined slots for reached transforms;
ordinary input, final output and stored/wire JSON retain their strict contracts.
The source wrapper retains its existing byte/node/depth bounds. The omission
sidecar independently retains the same byte/node caps before accumulation; the
complete JSON envelope consumes the existing root byte budget. These are
separate source and metadata node bounds, rather than a combined node ceiling.
The continuing goal authorizes this connected owner correction. Native batch
transforms must remain unchanged; bypassing capture or replacing their tuple
with an adapter record would hide the defect.

A caught native refusal also exposes byte-accounting failure masking: the
bounded lifetime previously reported `closed` when an admitted capture resumed
after the request became rollback-only. The lifetime owner retains the original
complete Cause in its rollback-only accounting refusal, as it already does for
operation checkpoints. Closing/closed lifetimes retain their existing refusal
and cause-confinement behavior. Neutral lifetime and native database witnesses
exercise this connected correction; adapter error replacement would hide the
owner defect.

Keep the existing 64 expanded-node ceiling, counting repeated and skipped
children. Actual prepared graphs have 57 Product-batch nodes and 32 Variant-batch
nodes. A larger graph must refuse, rather than silently raise the default or substitute an
easier workflow.

## Module And Resource Ownership

Product prepares one named batch view from its authentic existing creation,
update and deletion methods. Exact update-command tokens retain their existing
graph reconciliation receipt policy; other commands retain their genuine
ordinary lifecycle/value/event policies. Deletion's complete bounded Product
and Variant reads support the ownership query. Shared input-schema construction
belongs with the existing Product input owners, rather than copied facade
schemas.
The combined Product view selects the authentic Variant graph-read command
token as `countProductVariantsForBatch` so existing native Query observations
participate in the root transcript. Native results bound incoming Variants.
Title-only native Product reads omit retained Variants, so Product's aggregate
receipt policy reconstructs the request-initial graph from authenticated
observed rows and reverse mutation replay. It counts active old Variants only
for selected existing Product roots, excluding sibling-created roots and
foreign inverse owners. The per-call graph validator shares that projection.
No read, mutable cross-run cache or second graph policy is added.

Native Link uniqueness probes exposed a shared physical-selection defect. The
relational compiler correctly selected each endpoint predicate, but execution
could choose the broad `deleted_at` index on an equal-prefix tie instead of the
selected scalar column. The bounded current read then requested 50 identities
with 46 remaining. A neutral source with 144 background rows preserves the
failing witness independently of Medusa. The shared relational executor now
carries every selected scalar column and conditional null membership through the
existing internal index-prefix contract, as it already does for composite
points. Existing single-column prefix facets support this selection; public
predicate grammar, resource limits and the intentional bounded full-set path
remain unchanged. Native and neutral read/write regressions cover this owner
correction independently.

The trusted Medusa module policy forwards the core's existing closed aggregate
validator alongside immediate call validation. Both validators are conjunctive:
each successful call must pass its immediate policy and the completed participant
must pass its aggregate policy before settlement. Core preparation admits this
combination while retaining both original validation modes and resource limits.
The conjunction's presence participates in the existing atomic policy identity,
so adding the aggregate guard cannot replay a result admitted by immediate-only
validation. Existing single-validator identities remain byte-stable; validator
implementation changes remain subject to their trusted policy/revision contract.
Borrowed workflow attempts retain their existing immediate-validation scope and
explicitly refuse an aggregate policy before admitting that source or
constructing a working set or lifetime;
this extension adds no borrowed aggregate execution capability.

Inventory prepares a named `product-batches` admission, preserving Item creation,
native empty Level creation, computed reserved reads and Item deletion through
one authentic participant. It reuses existing creation/deletion policies and
lifecycle mechanics, with no try-decoder fallback. Existing admissions retain
their exposed methods and refusals.

Link prepares one authentic create/list/dismiss/delete resource over the four
existing deletion-family services and canonical Pricing cascade. It preserves
their source identities, native routing, full tuples and concurrency. Reuse
the existing creation decoder, including its homogeneous per-call families
and empty arrays. Both Inventory and Pricing list operations are needed for
the Variant update child. The resource authenticates every selected method;
no callback receives raw storage or an independently executable host.

The outer host selects the full method, graph and event union, correlates each
native workflow family with authentic successful call results/requested IDs,
and alone publishes. Native branch concurrency does not grant parallel SQL
operations: the existing explicit queued atomic profile owns those callbacks.

The named batch admission excludes any Item ID both returned by a successful
native Inventory-link attachment and requested by a successful Item deletion
within the root, for both Product and Variant batches. A controlled interleaving
showed why: deletion can snapshot the old Variant's sole ownership, then a
create sibling attaches a surviving Variant before deletion applies that stale
snapshot. Native children can otherwise succeed while deleting the newly shared
Item. The root refuses this combination with `unsupportedProfile` before
settlement, using authentic method tokens, receipts and existing owner decoders;
it adds no query or alternative lifecycle. This conservative, order-independent
restriction also excludes intersections whose link is later deleted or whose
requested deletion is a no-op. It is a composition support boundary, not a
general active-reference integrity contract or a repair to native ownership.
Supporting these intersections requires a separately designed cross-module
final-state/liveness contract. Other same-ID sibling combinations require their
own characterization; this restriction alone does not establish their safety.

## Finite Envelope And Resource Admission

- At most four total create/update/delete entries in a batch.
- At most four prior Variants across update/deletion and four incoming/result
  Variants across creation/update, with the existing bounded Product graph.
- Retain two Inventory links per selected Variant, eight deletion-candidate
  Items, four inverse owners per Item and 32 inverse edges. Each candidate Item
  retains the two-Level/one-Reservation persisted-history closure.
- Retain two base and two stored PriceList prices per old PriceSet, one rule per
  Price, and the existing Sales Channel/Shipping Profile cardinalities.
- Named root: 1,024 calls, 256 events and 2 MiB; Product working set 256,
  other participants 128. Combined maximum graphs exercise this admission.
  Keep existing defaults, deadlines, packet limits and default atomic OCC.

The complete mixed Product witness exceeds the initial 512-call candidate at
the bounded lifetime's call counter. Preserve that finite-root refusal and full
rollback witness. The batch root alone selects the existing trusted,
identity-bound 1,024-call allowance; all earlier workflow profiles retain their
limits. The continuing integration goal authorizes this measured admission
adjustment. The complete unshared Product graph consumes 726 calls and 142
events; the shared-inverse graph consumes 554 calls and 93 events. These are
finite graph witnesses, not arbitrary batch-size or performance guarantees.

Mixed create/update/delete publication uses the existing explicit participant
selection for Product, Pricing and Inventory. Existing participant identities
and source confinement remain intact. No adapter SQL,
fallback lifetime or weaker completeness check may compensate for a defect.

## Completion Gates

Preserve native optional/empty branch behavior, output ordering, requested
delete IDs and child event families. Prove simultaneous branch entry rather
than an array-returning shim; single-flight shared transforms; skipped lazy
work; foreign references/group overlap/cross-sibling dependency refusal;
definition bounds; and stable ordered identities with distinct parallel ones.

Prove real Product and Variant batches with mixed branches, maximum combined
graphs, old/created endpoint interactions, shared Inventory retention and
reservation refusal after actual sibling mutation. Include full rollback,
caught refusal, cancellation and late callbacks, replay/revision conflict,
uncertain acknowledgement, two-shop confinement and PostgreSQL competing roots.
Use neutral SDK fixtures and another supported module for reusable scheduling
claims, separately from the native commerce graph.

Run affected owner/consumer regressions in PGlite and ordinary-role PostgreSQL,
affected builds/types, source/promotion/portability guards and required lint.
Both read-only project reviewers inspect the final checkpoint before one scoped
commit. Bounded completion does not establish arbitrary batch size, general
native graph scheduling, suspension or hosted support.
