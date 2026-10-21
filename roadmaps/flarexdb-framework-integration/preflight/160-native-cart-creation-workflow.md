# Native Cart creation preflight

## Status and authority

Status: the selected original-native cohort is characterized after the bounded
[Variant and item pricing workflow](./159-native-variant-item-price-calculation.md).
The module-owner plan is prepared. Native compensation corrections remain
proposals requiring an explicit business decision. Maximum-graph evidence,
remaining call-detail coverage, concurrency proofs, resource measurement and
adapter admission remain pending.

The executing reference is Medusa 2.13.4, commit
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, recorded by
`third_party/medusa/SOURCE.json`. The root is `createCartWorkflow` in
`third_party/medusa/upstream/packages/core/core-flows/src/cart/workflows/create-carts.ts`.
The accepted Medusa boundary, shared logical storage and existing workflow
transaction owners remain authoritative. This plan admits no Cart writes or
new resource allowance. Product export and chunked file import remain deferred.

## Connected native closure

The native root selects Sales Channel, Region and Customer in parallel. It
invokes the pricing-context hook, the existing Variant/item pricing child and
inventory confirmation, derives addresses and Customer/currency defaults,
optionally translates data, invokes validation, and creates the Cart. It then
refreshes taxes and promotions, runs payment refresh and `cart.created`
emission in parallel, invokes `cartCreated`, and returns the original created
Cart value. Do not assume that value equals a subsequent persisted Cart read.

| Owner | Existing reuse and required work |
| --- | --- |
| Product and Pricing | Reuse 159's genuine native calculation and complete graph. |
| Inventory | Reuse stored owners; admit native confirmation, its Location projection, Channel and required/available quantity checks, and backorder behavior. |
| Store, Sales Channel and Region | Extend named reads for default-channel selection, native channel retrieval, wildcard fields and Countries. |
| Cart | Add its nine native models, persistence, line items, tax lines, adjustments, totals and raw decimal presentation. |
| Customer | Add the native owner, guest/account/email selection, creation and genuine compensating deletion. |
| Tax | Add native persistence, service and provider registration, including genuine local SystemTax calculation. |
| Promotion | Add native automatic/manual calculation, adjustment writes and Cart-Promotion Link traversal. |
| Payment | Prove the Cart-PaymentCollection graph and conditional service/provider resolution; never fabricate a skipped or successful call. |

Empty Cart input still reaches connected owners. Tax refresh resolves Tax
before its no-context exit and invokes both Cart tax-line setters, including
empty arrays. Promotion refresh invokes `computeActions`; no supplied code
does not exclude automatic promotions. Cart-Promotion queries its real Link
family without codes. Some empty adjustment compensators still resolve Cart.

## Native observations required before implementation

Construct the fixture from genuine native module services, repositories,
Query, stored Links and SDK execution. Freeze source and emitted dependencies,
and execute through ordinary-role PostgreSQL. Reuse existing fixture owners;
do not replace missing modules with canned Query rows or success callbacks.

Characterize these connected cases:

- Empty and populated Carts, supplied/default Channel and Region, addresses,
  currency defaults and native returned values versus final stored state.
- Existing Customers and guest creation, email/account selection, late
  validation failure after Customer creation, and genuine Customer compensation.
- Complete Variant pricing, inventory rejection, required quantities,
  available quantities, Channel membership and backorders.
- Genuine SystemTax calculation with a usable address and TaxRegion,
  automatic and supplied promotions, and complete adjustment/tax-line results.
- Native events, hooks, cancellation, late failure and retained compensation,
  including concurrent payment refresh and event emission.

SystemTax is an actual local native provider; configured external providers may
perform remote effects. Characterized fresh Cart creation leaves
`payment_collection` absent and skips Payment service calls while still running
the real payment-refresh child and Cart-PaymentCollection graph. This does not
establish arbitrary Payment support. A reachable provider/session path must
retain its genuine behavior or remain explicitly outside the admitted profile.

Verify the actual nested SDK context: acquire/release steps can skip before
Locking resolution when a parent idempotency key exists. Record actual
translation flags, hook registrations and optional Caching resolution. Do not
remove these paths from the native fixture to simplify the dependency graph.

## Confirmed native behavior

The genuine empty root selects Store/Region/Channel defaults, creates the native
US address, reaches both empty tax-line setters, computes automatic promotions
and queries Cart-Promotion and Cart-PaymentCollection Links. The populated case
creates a guest Customer, checks both rich Inventory Links and persists a native
10-percent SystemTax line. Fresh creation leaves PaymentCollection absent.

The native root returns its original created-Cart value. In the populated
witness, that value has an empty `items` array while a subsequent stored Cart
contains its line item and computed totals. Preserve that distinction; a final
Cart reread is not an equivalent native return contract.

Genuine cancellation exposes native residuals: an active Cart
address remains after Cart removal, and promotion cases retain an active
Cart-Promotion Link pointing at the removed Cart. Preserve those original
witnesses separately from any corrected candidate.
Atomic outer rollback does not establish retained native inverse correctness.

Defaults do not always create an Address: multiple or absent selected Countries
leave that path empty. Native Customer selection applies primary-key ascending
ordering; a shared email does not imply an account-preference rule. An explicit
account can remain unchanged while the Cart uses a supplied email override.
The guest-selection path filters `has_account: false`, and compensation removes
only the Customer actually created by that invocation.

Native `failed` state alone does not mean compensation failed. The Inventory
refusal can remove a newly created guest and restore setup while the throwing
child has no retained StepResponse. Preserve actual child state, errors and rows
rather than inventing a retained inverse for that child. Missing-price native
defects retain the failure classification owned by the Promise/Cause boundary.

The stronger bounded capture covers selected root/child values, genuine Query,
Pricing, Tax and Promotion decisions, emitted and delivered events, and selected
retained leaf inputs. Generic method details can still saturate; this does not
establish every call's argument/result parity or a Flarex allowance. Complete
the remaining targeted call-detail and maximum-graph evidence before admission.
No post-Promotion calculated total is established by a Cart read that preceded
the adjustment writes.

Native events can be delivered before root failure: ungrouped Customer creation
and compensation events remain observable. Grouped `cart.created` and Link
events may be cleared instead of released after a late hook fails. Preserve the
actual native calls and distinguish that delivery behavior from the accepted
atomic profile's committed event authority.

## Proposed native inverse corrections

These business changes are unapproved. Preserve the original native residual
witnesses and separately bind every correction candidate to its source.

1. **Cart-owned Address cleanup.** Retain exact created Cart and newly created
   inline Address identities. One native Cart transaction removes owned Carts
   and only their still-owned, unshared Addresses; reused or superseded identities
   and references from active or soft-deleted Carts remain protected. The proposed
   PostgreSQL mechanism locks exact Cart/Address rows in a fixed order with strong
   row locks, then checks both Address reference columns in a fresh statement.
   Existing FK cooperation, actual isolation, both writer orders, rollback and
   retry must be proved. The adapter must implement the semantic operation through
   its trusted logical/reference owner, without adapter SQL or a second lifetime.
2. **Cart-Promotion preimage compensation.** Preserve native forward validation,
   selection and create/upsert behavior, including existing-pair ID replacement.
   Capture complete prior and resulting identities/content/membership at the
   real Link owner's write serialization point, including absent-pair creation.
   A prior read alone cannot establish that preimage. Include original managed
   timestamps through a scoped native restoration operation; ordinary forward
   timestamp hooks retain their behavior. The inverse restores the original
   preimage only while its resulting generation remains current; exact
   already-restored state is an
   idempotent result, while another generation causes a protected conflict.
   Genuinely created Links use native soft-delete/history behavior. Collect only
   events corresponding to actual mutations, preserve native scalar/batched ID
   payloads, and preserve event-failure limits.
   Present-row locks and absent-pair races, existing ADD, REPLACE, supersession,
   retries and native event sequences require separate genuine witnesses.

A workflow-level precheck followed by independent deletes is insufficient for
Address safety or partial-inverse recovery. Pair-only Link dismissal cannot
protect a later generation. No generic DAL redesign, create-if-absent forward
change, arbitrary-writer guarantee or concurrency success is established here.

## Implementation sequence after the native decision

1. Prove the scoped inverse contracts at the genuine native owners before
   applying business corrections. Retain typed failures, conflicts, complete
   Causes, rollback and uncertain post-commit event outcomes.
2. Promote the pinned Cart, Customer, Tax, Promotion and conditional Payment
   module closure and native totals/provider helpers. Keep repositories,
   commands, inputs, receipts and services in the organized module owners.
3. Extend named Region/Country, Store, Sales Channel and Inventory confirmation
   reads; bind actual Cart-Promotion and Cart-PaymentCollection Links and readonly
   native graph metadata. Reuse the existing DML/read/write/receipt owners and
   Variant/item pricing graph; do not fabricate empty business results.
4. Compose the original root and its five children under the existing outer
   transaction. Prove trusted local hooks, genuine SystemTax and the empty Payment
   branch. Translation, remote providers, arbitrary hooks and provider/session
   work retain separate lifecycle gates rather than being silently skipped.
5. Measure the complete forward and retained-inverse graph, select authenticated
   bounds, validate both database lanes and affected consumers, run types/builds,
   provenance/portability/lint and both required reviews, then commit the slice.

## Admission and implementation gates

Measure the complete participant cohort, calls, events and stored/read graph
before selecting bounds. The cohort may exceed 159's named nine-logical-owner
allowance; no larger allowance is established by this static trace. Default
profiles and physical limits retain their current contracts.

Use the existing trusted outer transaction and publication owners. Untrusted
hooks, workflow pauses and remote provider effects cannot execute inside a
held database transaction. Establish a genuine local execution profile from
the native witness, or address that lifecycle at its owner; do not silently
split the root or introduce another settlement lifetime.

The [Promise/Cause boundary](./161-native-promise-cause-preservation.md) is now
implemented at its existing owners. Reuse its typed native failures, defects,
interruption and complete authenticated Causes. It does not repair native Cart
business compensation or establish Cart admission.

After the native baseline, implement the complete admitted closure, then
validate PGlite and ordinary-role PostgreSQL separately, affected owner and
consumer regressions, types, builds, source/promotion/portability checks and
lint. Obtain both required read-only reviews and commit the completed slice.
Bounded private admission will not establish hosted activation, arbitrary
providers/hooks or general Cart workflow support.
