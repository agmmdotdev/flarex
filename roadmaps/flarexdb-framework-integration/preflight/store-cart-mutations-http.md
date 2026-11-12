# Store Cart updates and line-item HTTP

Status: bounded private HTTP promotion implemented and validated. Hosted
production activation, mixed deployment and capacity acceptance remain separate.

## Scope and challenged owners

Promote pinned `POST /store/carts/:id`, `POST /store/carts/:id/line-items`,
and `POST`/`DELETE /store/carts/:id/line-items/:line_id` in the existing private
Cart HTTP host. Preserve creation and retrieval. Reuse the genuine native
`update-cart`, `add-to-cart`, `update-line-item-in-cart` and `delete-line-items`
workflows and their complete refresh children. Pricing, Inventory, Tax,
Promotions and Payment remain with their existing native owners.

Two independent readers challenged the executing Core, accepted direction and
Convex `db914cf06e2b06ee985646611b9e12ed7a770318`, then exchanged counterexamples.
Convex transaction nesting and atomic session outcomes support the existing
native root's recover-before-body, claim, abort and sole settlement. No new Core
algorithm, physical schema or durable-data reset is selected.

Invoke native workflows as genuine children of a trusted wrapper. The SDK
supplies the actual parent step identity, so pinned lock steps skip before
resolving Locking. The existing outer scope exclusion and queued operations
remain authoritative; no replacement Locking provider is introduced. No SQL
transaction spans native callbacks. The accepted finite atomic profile retains
source compensation callbacks with explicit `transactionCovered` declarations:
the runner aborts pending work once and does not schedule those callbacks.
Retained inverse correctness needs separate direct native witnesses; rollback
alone does not establish it. Rollback-only failure, same-key outcome recovery
and atomic event publication remain required. The existing
[native composition contract](../../workflow-foundations/15-native-workflow-composition.md)
owns this deliberate execution difference.

## Lifecycle history admission

Status: owner correction implemented and validated for the bounded private profile.

Repeated Promotion refresh retains Adjustment tombstones. Line deletion must
visit that complete history, but the Cart mutation repository and receipt used
the four-item authoring bound for every descendant table. The connected witness
therefore returned HTTP 400 with `limitExceeded` after otherwise supported code
changes. Native deletion must succeed when its complete closure fits the
existing shared resource budgets.

Correct the Cart lifecycle owner and its full event/receipt capture chain.
Requested Line Item roots and ordinary authoring, reads and updates keep their
existing bounds. Declared Line Item cascade descendants use the existing
query-row, write-batch and event-ID capacity for complete historical cohorts.
The per-family ceiling is their minimum, currently 256; aggregate Core identity
accounting includes the parents and other observations, so that ceiling does
not establish that 256 descendants fit one operation.
Admit the whole plan before applying it; retain exact descendant membership,
native updated/deleted event classification, full native restore behavior and
the physical-delete proof. Core aggregate identities, remaining request calls,
bytes, facts and deadlines still bound the complete operation. No partial
history, extra transaction, Core resource increase or new settlement is selected.

Physical-delete receipt construction uses the complete root-reachable FK
cascade family, verified against the native Line Item descendants. The full Cart
catalog also contains unrelated Cart-root protocol and business relationships;
passing those to the Line Item receipt made its family contract inconsistent.
Runtime traversal still uses the full checked catalog, while receipt correlation
admits only the verified Line Item, Tax and Adjustment family and rejects
additional observations or mutations.

## Native behavior

Cart updates retain native null/omission handling, Customer and Sales Channel
resolution, Region/address normalization and conditional refresh. Adding an item
uses native Variant/metadata matching, quantity merging and Inventory confirmation.
Item updates require membership in the fetched Cart; quantity zero executes the
genuine nested deletion workflow, including its native event multiplicity.
The pinned update HTTP schema admits primitive Address references, while its
native update step applies `in` to truthy entries; a nonempty string therefore
fails before the module update. Preserve the failure/rollback witness rather
than normalizing that input in the HTTP adapter.

Deletion is intentionally asymmetric in the pinned source: it selects Line Item
IDs without a Cart selector, then refreshes and emits `cart.updated` for the Cart
in the request. A Cart-A/line-B witness must preserve this behavior. Adding a
membership restriction requires a separate native behavior decision. Completed
Cart deletion can fail after pending deletion when the shipping refresh validates
the Cart; the root abort must preserve committed state. Native restoration is
validated separately through the retained callback and real module owner.
Deleting a Line Item also visits descendants already marked deleted. Native
event classification reports those repeated descendant changes as `updated`.
The retained restore callback revives the entire cascade, including children
deleted before the parent callback; it does not restore every prior lifecycle
state. The atomic root remains the rollback owner.
Deleting a missing Cart retains the native validation TypeError and HTTP 500,
with no committed business changes.

Admit the complete HTTP response projection before every mutation, including
DELETE. The native refresh graph requires a separate admission witness beyond
the Store default projection. Reuse corrected executable native field lists;
do not fabricate nonexistent Cart fields or broaden unknown-field filtering.
Refetch remains an independently protected read after settlement.

## Construction and boundaries

The genuine `add-to-cart` graph exposed a shared SDK construction mismatch:
native `when` permits the `fetch-variants` condition label beside its concrete
graph step of the same name. The current SDK rejected construction with
`duplicateStep`, because synthetic conditions and real steps shared an ordering
key. The selected correction belongs to SDK construction: separate synthetic
ordering keys while preserving native labels, genuine step/hook duplicate
refusals and neutral true/false branch coverage. The Cart adapter must not rename
the native graph to avoid this mismatch. No Core transaction change is selected.

Extend the existing genuine twelve-model Cart constructor and repository/receipt
owners with the mutation methods. Preserve existing creation and completion
consumers and exact read/write evidence. Native source promotion owns business
algorithms; adapters supply checked DAL lowering and command/resource bindings.
Native object selectors can contain JSON paths such as `metadata.edited`.
The Cart projection policy derives JSON scalar columns from DML and discards
their descendant selectors, matching the native DAL column selection. It never
adds a whole JSON parent; unknown fields and non-JSON descendants still refuse.
The native metadata walker also infers relationship population from selected
fields before Cart path admission. A bare Address relation selects its bounded
population without becoming a fabricated storage column.

Native mutations require singleton `take: 1` Cart reads, which the existing Cart
read grammar omitted. Admit that exact window without increasing its complete
cohort limits. Native metadata updates also emit JSON descendant selections such
as `metadata.edited`; pinned Drizzle discards those storage selectors and retains
the whole JSON column only when separately selected. The shared projection owner
now supports that explicit policy, enabled from Cart's DML JSON columns. Unknown
fields, non-JSON descendants and unselected parents remain refused or omitted.
Line creation receipts use the same genuine empty-relation presentation as their
DAL result before comparing evidence.

The item-update Variant context retains native own-undefined Region/Customer
members until the Query boundary. The common graph step forwards intermediate
context to the existing bound Query owner, which captures omission and admits
the tagged calculation through the actual Pricing graph. Persisted JSON and the
post-capture query schema remain unchanged; the step adds no data authority.

Forced mutation refresh supplies the selected complete Customer/Groups and
Region rather than creation's smaller context. The original creation Pricing
profile refuses that context at its seventeen-attribute bound. The HTTP catalog
therefore selects the separate `pricing-cart-mutations` read profile, bounded to
sixty-four flattened non-control attributes and the existing candidate/read
cohorts, command bytes and nodes. The ordinary ten-attribute and creation
seventeen-attribute profiles remain unchanged. Both direct native calculation
and Variant `calculated_price` traversal use the existing Pricing service,
calculation algorithm, calculated-result validator and computed-object projection.
The real ProductVariant-PriceSet Link owns argument forwarding and identity.
No adapter synthesizes prices or drops native context to fit the creation bound.
This profile changes no physical model, table or commit owner.

Measure full recursive workflow construction, including inactive branches and
the trusted wrapper. Preserve ordinary authoring's 64-node limit and the issued
creation profile's 73-node limit. Any necessary mutation construction allowance
must be source-counted and selected by an issued finite SDK profile.
The native finite SDK entry points consume source files. Its package build owns
only `dist/durable`; promotion inventory retains that build surface. Utils tests
remain source tests and are excluded from the Utils package build.
The selected native closures contain 130 nodes for Cart update, 132 for add-item,
242 for item update, 113 for deletion and 108 for refresh. The trusted wrapper
adds one node; the issued mutation profile therefore admits at most 243.
The same prepared resolution graphs bound SDK control operations at 297 for
Cart update, 316 for add-item, 553 for item update and 260 for deletion. Each
ordinary node contributes at most two captures, each condition one, each unique
frame-local transform two, and branch results none. The root adds its final
checkpoint and completion capture. Inactive branches and repeated child frames
remain included. The mutation root selects one shared 1,065-operation allowance:
the existing 512-operation envelope plus the largest 553-operation control bound.
The creation root and Cart participant retain 512; all participant resource
selections and row, byte, event and lifetime limits retain their existing owners.
Children borrow the same shared root allowance, with no reset or separate child
allowance.

The connected request witness then exposed a framework identity-encoding limit:
the item-update definition contains 82,569 raw identity bytes at depth 24 and
hits the existing 64 KiB policy capture. Workflow preparation therefore returned
`limitExceeded` before any HTTP business work.
The correction belongs to workflow preparation, not the Cart adapter or Core
value limits. Two independent readers converged on the explicit
`resourceAndDefinitionDigest` encoding. It authenticates every prepared SDK
frame, preserves node order, references, guards, results, parallel regions,
hook bindings and declarations, then replaces only genuine nested identities
with versioned, domain-separated child digests. Each frame and the final policy
retain the canonical 64 KiB/depth-64 limits. Aggregate traversal is bounded by the
issued recursive node allowance; memoization is local to one preparation and
retains repeated occurrences in parent frames. Trusted code revision remains
bound separately. Existing raw/resource-only encodings retain their identities;
Core storage and request outcomes are unchanged. Neutral and genuine native
preparation witnesses cover this owner correction before connected acceptance.

The bounded profile retains four-item/four-promotion-code cohorts, local
SystemTax and existing Payment bounds. Empty shipping branches must skip through
the genuine native graph; populated shipping and remote providers remain outside
this slice unless their real dependency branch is admitted. Checkout HTTP,
transport-loss retry, capacity and mixed deployment retain separate gates.

Acceptance requires both PGlite and ordinary-role PostgreSQL, actual Workerd
mutation/refetch across recreation, separate native inverse and late-failure witnesses,
same-key replay, event counts and durable inventory observation after draining.
