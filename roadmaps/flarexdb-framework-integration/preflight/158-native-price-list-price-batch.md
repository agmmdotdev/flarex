# Native Price List Price batch preflight

## Status and source

Status: bounded native preflight and combined private adapter admission complete.
The scoped Pricing replacement mismatch is corrected. The approved named
256-call profile retains 64 events and all other default resource limits. Its
[removal child](./157-native-price-list-price-removal.md) now has bounded private
admission with its explicitly approved portable lifecycle order. Product chunked file
import and Product export remain deferred.

Authority remains the accepted [Medusa boundary](../../../design-notes/flarex-db-accepted-design.md#medusa-boundary),
[source promotion contract](./04-medusa-fork-source-island-and-package-convergence.md)
and Medusa 2.13.4 at `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, recorded
in `third_party/medusa/SOURCE.json`.

The original `batchPriceListPricesWorkflow` is in
`third_party/medusa/upstream/packages/core/core-flows/src/price-list/workflows/batch-price-list-prices.ts`.
It constructs one List entry each for creation and update, then invokes
`createPriceListPricesWorkflow`, `updatePriceListPricesWorkflow` and
`removePriceListPricesWorkflow` through native `parallelize` and `runAsStep`.
It returns the three child results as `{ created, updated, deleted }`.
It introduces no new Pricing normalization or matching algorithm.

The [creation](./155-native-price-list-price-creation.md) and
[update](./156-native-price-list-price-update.md) children are admitted separately.
The approved update compensation correction belongs to the executing private
fork; the original callback defect and its native evidence remain separate.
A parent witness must identify which child and DAL sources actually execute.

## Native branches and resources

The root forwards `data.id`, `data.create`, `data.update` and `data.delete`
without inserting defaults. Empty creation/update arrays still become
`[{ id, prices: [] }]`; these are different from the children's outer
`data: []` branch. Both validators still validate that List and issue genuine
stored Variant-PriceSet Link queries with empty Variant selectors. Creation
then skips its add operation. The corrected update still calls the snapshot
and public update methods for its one empty entry. Empty removal skips its
Pricing resolution.

The removal selector remains raw Price IDs. The parent does not restrict it
to Prices belonging to `data.id`; preserve base and cross-List selection.
Native result positions retain the named child slots. Parameter order does
not establish a total mutation, event or compensation order for concurrent
siblings.

Native SDK value resolution materializes arrays and objects through
`parse-stringify-if-necessary.ts` and `resolve-value.ts`. Root result arrays
need not share a JavaScript reference with retained child results. Preserve
complete slot values and Price identities; do not substitute a root/child
reference-equality requirement for the native contract.

The commerce closure is Pricing and the existing read-only stored
Variant-PriceSet Link Query. No Product hydration, Region, File, provider,
Locking or Link mutation resource is introduced. The actual native SDK also
uses EventBus and optional Workflow Engine infrastructure. Its child
`runAsStep` path retains child cancellation and defers event release to the
parent; these infrastructure roles do not broaden commerce authority.

## Combined admission requirements

One outer workflow host must bind a named combined Pricing admission and the
existing genuine Link query. The three independent host preparers must not be
nested to simulate one root. Keep module identity, sticky refusal, logical
resource accounting, queued borrowed operations and settlement with their
existing owners.

The current Pricing repository chooses candidate semantics from its selected
creation or update profile. Enabling both contract flags is insufficient:

- Creation candidate reads require active PriceSet membership and Rule ID
  order. Its retained inverse physically removes actual returned Price IDs,
  including a reused Price.
- Update forward candidate Rules use the approved storage insertion order;
  complete historical snapshots retain ID order. Update restoration replays
  affected old graphs and removes only genuinely created Prices.
- Removal requires its distinct active Price/PriceSet read with nullable
  PriceList presentation, followed by Price/Rule soft deletion and current-graph
  restoration.

Creation and update also have different replacement policies for managed fields
and mutable foreign keys. Combined admission must preserve the operation's
trusted semantics through the existing module/repository owners. A global
update mode must not silently alter a creation call.

## Scoped compatibility disposition and resources

The complete native parent exceeds the default 64-call allowance in the bounded
single-child cases with a two-Rule Price, even when only creation, update or
removal performs mutations. PGlite and
ordinary-role PostgreSQL both refuse these bounded inputs at the existing
shared call limit. The two validators, two genuine stored Link queries and the
empty update calls still belong to the parent when sibling arrays are empty.
The all-empty branch does not establish capacity for a nonempty parent.

A separate external calls256 candidate exposed a compatibility mismatch after
137 observed `BoundedRequest.enter` calls on both database lanes. The unchanged
native maximum succeeds with two creation inputs, two update inputs overlapping
eight selected removal roots, and sixteen removed Rules. The adapter instead
reported that an existing historical Price did not exist when a removal
sibling made the Price historical before update wrote its Rules. This failed
witness remains separate from the default64 capacity failure.

The correction is in Pricing's existing replacement policy in
`packages/medusa-adapter/src/modules/pricing/price-list-price-repository.ts`:
update Rule writes accept an existing historical `price_id` parent, while
creation retains its active-parent requirement. Keep actual parent existence,
same-owner enforcement, immutable Rule ownership and the remaining foreign-key
visibility rules. The native parent, callbacks, sibling scheduling and shared
settlement owner retain their current responsibilities. This disposition does
not add a Rule lifecycle capability or change shared replacement defaults.

The bounded production profile covers the native maximum forward graph and
retained child inverses on PGlite and ordinary-role PostgreSQL. The separate
aggregate inverse probe invokes genuinely retained child callbacks in an
explicit probe order; it does not establish native SDK cancellation order or
one coherent parent-wide preimage.

The independently approved named batch profile selects 256 calls, 64 events and
all other shared defaults through the existing identity-bound resource API.
The original default64 refusal and the initial historical-parent mismatch stay
preserved witnesses. Hosted activation, restart, arbitrary inputs and scale
retain their separate gates.

The private batch factory selects the original creation, update and removal
command families into one Pricing participant. Its nine method tokens retain
their original repository closures; receipt validation dispatches by exact
command identity to the corresponding child validator. Existing stored Link
Query remains read-only. This composition adds no transaction owner, request
lifetime or global repository mode. The parent decoder requires all three
arrays and update IDs, and reuses complete child output contracts for its named
result slots.

## Parent behavior requiring native evidence

An update snapshot and its forward update are separate native public calls.
Another sibling can change candidates between them. Serializing individual
borrowed operations does not make that pair indivisible. Creation can reuse a
Price later affected by update or removal, and the three inverse strategies
can interact. Independent child success therefore does not establish parent
cancellation behavior for overlapping selectors or matching keys.

The native creation inverse physically deletes every returned Price ID,
including reused preexisting Prices. The parent witness confirms this loss
after cancellation of a reuse-only batch. It also confirms a same-ID
creation/update batch can finish cancellation with that Price absent even when
the approved update inverse executes. A `reverted` SDK state with no errors
does not establish restoration of the original graph. Preserve these native
outcomes; no parent business correction has been selected.

The approved update snapshot uses `@InjectManager()` and separate root and Rule
reads. Under the native parent's concurrent removal, the witness captures an
active old root alongside Rules already tombstoned by that sibling. Capturing
every persisted field therefore does not establish one coherent parent-wide
preimage. Current-graph removal restoration and recorded update restoration
can also leave different final values and Rule identities. Any stronger
compensation or snapshot guarantee needs a correction at its native owner and
an explicit compatibility disposition before admission; adapter ordering,
extra snapshots or whole-root rollback must not silently stand in for it.

Rule-array order participates in native Price matching. The original
Rule-bearing cases intended to exercise reuse actually returned fresh Price
IDs and remain valid nonreuse observations. A separate zero-Rule fixture proves
actual existing-ID reuse and same-ID creation/update overlap. The mixed
maximum separately proves two creation inputs and two update inputs with two
Rule attributes each, together with eight genuinely selected removal roots.
Its final selected graph has eight historical Prices, twelve surviving
historical original Rules and four active replacement Rules under the two
updated Prices. Four previous Rules are physically removed. Its event multiset
contains two Price creates, eight Rule creates, eight Price deletions, twenty
Rule deletions and two Price updates. Current membership and event counts must
preserve that overlap outcome; they do not establish a sibling total order.
These observations establish the bounded native inputs, not adapter resource
capacity or a guaranteed sibling schedule.

Characterize the actual parent with original callbacks and, separately, the
approved update callback. Preserve genuine native failure states, actual
retained child data, complete persisted snapshots, grouped events and observed
call intervals. Do not impose a scheduler order or infer restoration from SDK
state alone. A failure observed only in the parent needs its own owner and
disposition; earlier child approvals do not approve a new business correction.

Existing finite child frames and nested parallel regions cover this graph
shape. Transaction-covered whole-root rollback remains distinct from executing
the independently retained native child compensators. Both proof obligations
must remain explicit in the eventual adapter tests.

## Connected implementation plan

1. Retain the admitted removal child profile. Independently characterize the native
   batch parent, including all-empty and missing-List cases, each nonempty
   child, absent resources, disjoint mixed operations, duplicate and cross-List
   deletion, reused/matching Prices, overlapping update/delete IDs, child
   failure, explicit cancellation, late-parent cancellation and replay.
2. Resolve any demonstrated native parent compensation or matching issue with
   a separately preserved witness and explicit disposition. Select the narrow
   combined module/repository routing that preserves each existing child's
   semantics without copying native algorithms or adding settlement owners.
3. Promote the original parent with exact source/provenance guards and expose
   only the union of its required native methods and existing Link Query.
   Native batch update types require IDs, while the approved private update
   child supports omitted IDs; document the selected parent contract explicitly.
4. Begin with the native one-List shape, the existing per-entry bounds of two
   creation and two update inputs, and at most eight raw removal IDs. Prove
   aggregate forward/inverse capacity and complete descendant traversal.
   Preserve the measured default64 refusal and the independently approved named
   calls256 profile, with events64 and other defaults unchanged. The children's
   allowances and ordering decisions do not grant a sibling total order.
5. Validate full native outputs, preimages, actual retained inverses, protected
   rows, events, failure rollback, cancellation, replay and committed cycles on
   PGlite and ordinary-role PostgreSQL. Complete affected typechecks, source and
   portability guards, lint, both required reviews and resource cleanup before
   one scoped implementation commit. Hosted activation, arbitrary input sizes,
   restart and scale remain separately gated.
