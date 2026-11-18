# Native Shipping Option Type update preflight (129)

Status: bounded private native selector updates and genuine retained upserts are
implemented. Production activation and populated-schema upgrades remain outside
this slice.

## Source and complete native root

Pinned source is Medusa 2.13.4, commit
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, identified by
`third_party/medusa/SOURCE.json`. Paths below are source-root relative unless an
executing package path is explicitly given. Verify source hashes and executing
promoted copies when implementing.

- `packages/core/core-flows/src/shipping-options/workflows/update-shipping-option-types.ts`
  exports `updateShippingOptionTypesWorkflow`, ID `update-shipping-option-types`.
- `packages/core/core-flows/src/shipping-options/steps/update-shipping-option-types.ts`
  exports `updateShippingOptionTypesStep`, the same step ID.

The root accepts an object with `selector`, `update` and optional
`additional_data`. It calls the genuine step with the whole root input, creates
`shippingOptionTypesUpdated` with the actual result and additional data, maps
the actual result IDs through the native array/scalar normalization, executes
`emitEventStep(ShippingOptionTypeWorkflowEvents.UPDATED)` and returns the unchanged
result in `WorkflowResponse`, exposing the hook.

The step always resolves Fulfillment first. It derives selects/relations from
`[data.update]` using native `getSelectsAndRelationsFromObjectArray`, lists
preimages with the original selector and that projection, then calls genuine
`updateShippingOptionTypes(selector, update)`. It retains the list result as its
inverse input. The inverse returns before resolving Fulfillment for absent/empty
preimages; otherwise it calls genuine `upsertShippingOptionTypes(prevData)`.

There is no Query-container, Module Link, provider invocation, Locking resource,
child workflow, file handling, pause or external effect in this root. Fulfillment
performs native internal repository reads; these do not imply a Query resource.
Use `graph: false` and the existing native event resource. Include the mandatory
preimage list, service selector list, internal update list, hook and event step;
do not replace the root with a direct patch facade.

## Native service path: selector and string ID are different overloads

The executing `packages/medusa-fulfillment/src/services/fulfillment-module-service.ts`
already contains the original Type business methods:

- Lines 1520-1577: `updateShippingOptionTypes(idOrSelector, data, context)` has
  manager/event decorators. A string ID first calls internal `retrieve` and
  returns one DTO. An object selector calls internal `list`, maps selected rows
  to `{ id: type.id, ...data }`, calls internal `update` and returns an array.
- Lines 1472-1515: `upsertShippingOptionTypes` delegates to transaction-decorated
  `updateShippingOptionTypes_`, which calls **internal `upsert`**, then serializes
  and preserves scalar/array input shape.

The workflow/step public input is the object-selector branch. An ID string is
supported as `selector.id`; it is not a string selector argument to this workflow.
Do not silently expose the direct string-ID service overload or claim its
missing-ID error behavior from the workflow's empty-match behavior.

Generated list machinery is in executing
`packages/medusa-utils/src/modules-sdk/medusa-service.ts` and
`medusa-internal-service.ts:212`. Internal list applies default primary-key ASC
ordering and native filter conversion through `buildQuery`, then repository
find. `build-query.ts` deduplicates ID arrays without changing first-occurrence
order and preserves logical selector structure. Pinned Drizzle then applies
`preservePrimaryKeyOrFilterOrder` for compatible default/ID ordering, so native
raw ID-array/OR filter order must be retained rather than imposing a new sort.
Missing and deleted selected roots are excluded by ordinary active reads.

Internal update (`medusa-internal-service.ts:301-441`) registers mutation events,
builds a last-entry-wins Map keyed by actual normalized primary key, and builds
OR identity selectors. It lists those targets, pairs full entities with the
last update for each ID, throws for missing data-only targets, and delegates the
pairs to DAL update. Do not bypass this genuine lookup, Map collapse or error
precedence in an adapter planner.

## The public update ID can retarget the mutation

`UpdateShippingOptionTypeDTO` explicitly declares `id?: string`. The service's
`{ id: selected.id, ...data }` spread order means a supplied `update.id` replaces
the selected row ID. It does not mutate the stored primary key; it changes which
existing entity the subsequent internal update looks up.

For a nonempty original selection:

- Retarget to another active ID B: the internal update looks up B and updates B;
  the original selected rows A/C/etc. are not patched. Multiple selected rows
  all normalize to B, collapse through the internal Map and return B once.
- Retarget to a missing or soft-deleted B: the target internal active list has no
  B. Native update throws `MedusaError` of type `NOT_FOUND`, with the internal
  missing-data identity message `ShippingOptionType with id "B" not found`.
  This occurs after the step's original-selector preimage read and the service's
  original-selector list; it is not the direct-string retrieve error.
- Retarget with an empty/no-match original selection: normalized input remains
  empty, so no B lookup occurs and the result is `[]`, even if B does not exist.
- `update: { id: B }` with active B: DAL removes the primary key from the patch,
  so it returns B without a root write/module update event. The root still
  emits its workflow update event for the returned B.

The retained inverse remains the projection of the **original selector rows**,
not B's old data. An ordinary inverse can therefore leave B's patch in place
while upserting the original rows when B is outside that original cohort. If B
was selected originally, its projected preimage participates in the inverse.
Preserve this native distinction. Do not exclude
`update.id`, rewrite spread order, filter B to the original selection, fabricate
B's preimage or call this exact business undo. No native correction is proposed.
The TEMP native characterization below executes the genuine service and retained
step callbacks and confirms this distinction. It establishes native behavior;
it does not authorize or propose a native business correction.

## DML contracts, nullability and distinct return shapes

Reuse the real Type model at
`packages/modules/fulfillment/src/models/shipping-option-type.ts`: `sotype` ID,
required label/code strings, nullable description, managed timestamps and inverse
`shipping_options` mapped by Option `type`. No Type metadata column, unique-code
constraint, outbound FK or declared cascade is added. Empty strings, case and
same values retain native behavior; there is no Type normalization/merge rule.

The native mutation DTO permits optional label/code/description and ID, but its
description type omits null. DML permits null. Preserve DML null clearing through
the existing narrow compile-time adapter boundary, with no runtime DTO casting
used as validation. The common output DTO is also stale: it declares singular
`shipping_option_id` / `shipping_option` and nonnullable description. Decode
actual persistence output from checked metadata instead.

Do **not** blindly reuse 128's creation output decoder:

- Native Drizzle create calls generic `fillEmptyToManyRelations`, so a scalar
  fresh create contains `shipping_options: []`.
- Native list/find does not call that initializer. The step's explicit-field
  preimage list returns only actual selected scalar columns plus primary keys.
- Native update (`database/drizzle/src/medusa.ts:465-586`) returns full scalar
  rows for the admitted scalar patch. It loads only explicitly supplied relation
  input and fills null to-one values, but does not initialize empty to-many
  fields. Therefore no `shipping_options` field is invented on scalar update.
- Native upsert (`medusa.ts:632-682`) returns the stored scalar SQL rows directly,
  with no to-many initialization or population. An existing tombstone can be a
  legitimate inverse/upsert result and must not be rejected by a creation-only
  active-row decoder.

Validate full current/storage rows before any requested projection. Compile a
separate exact preimage projection contract with required ID; an ID-only row is
not a complete Type DTO. Reuse `compileCompleteRow`, `compileRowProjection`,
`nativePreimageSelection`, scalar query/order/result owners and metadata capture
instead of cloning validators or adding fake relation values.

Call-local receipts also require the existing shared relational-read evidence,
using the query owner's complete-set shape. An empty observed cohort alone
cannot establish that a nonempty original selector was read. The projected list,
forward original-selector lookup, normalized target lookup and sequential
physical upsert pre-reads retain their actual read order and complete counts.
Skipped or partial reads must fail before an empty or truncated result can be
accepted. Empty selectors preserve their genuine native execution and logical
query observations without requiring row probes for an impossible predicate.

## Empty patch, preimage projection and event differences

Native `getSelectsAndRelationsFromObjectArray` derives selects in object-entry
order. For supported scalar Type fields, relations is empty; null description
selects the actual description column. Empty `{}` produces selects `[]`.
Pinned find's `expandSelectedFields` retains ID even for this empty explicit
selection. No complete row may be manufactured as the retained inverse.

DAL update removes ID and tests whether any scalar fields remain. Empty patch
or ID-only normalized patch returns the existing full scalar row without
changing timestamps or emitting a module event. A nonempty same-value patch
still writes, updates timestamps and emits a module update event. Workflow
events follow returned IDs even for such no-op forward calls. A missing or
empty selector result is `[]`, still reaching the hook and event dependency.

The inverse differs critically from Shipping Profile update (126):

- Profile's native upsert implementation partitions existing IDs into internal
  update. Type's native inverse calls real DAL **upsert** instead.
- Type upsert looks up physical existing rows without an active-only predicate,
  merges them with input, applies model defaults/managed update time and executes
  INSERT ON CONFLICT UPDATE. It does this even for an ID-only preimage.
- Consequently ID-only Type inverses update timestamps and emit a module update
  event. Do not reuse 126's no-op inverse expectation or existing-only admission.
- An existing tombstone retains its deleted_at value and receives an update;
  native event classification is `updated`, not a fabricated restore.
- If the row was physically removed, a projected preimage containing required
  label and code can recreate it with native defaults and a module created event.
  A projection lacking either required column fails native required-field
  validation; do not fill lost fields or convert it into unconditional refusal.
- Upsert of a missing row is not necessarily a successful workflow undo, even
  though it is native behavior. Broader native business inverse behavior and
  precise root-failure rollback are separate claims.

The inverse command/resource is a bounded real upsert capability, not a hidden
prior-read identity ledger. Require the ID supplied by native retained preimages
and at most four entries; admit native partial/full scalar data needed by those
preimages, including creation when missing data is complete. Preserve duplicates
and their native sequential upsert behavior for direct admitted calls rather
than imposing a universal uniqueness rule. No ordinary delete/soft-delete/restore
or nested Option write authority is implied.

### Shared lifecycle-preserving insert-or-update

The existing shared logical `upsert` clears `deleted_at` on conflict and
preserves the managed update timestamp. Those semantics remain required by its
existing admitted consumers, but differ from the pinned Type DAL branch above.
Using that operation for Type compensation would silently restore tombstones
and lose native ID-only timestamp writes.

The shared row owner therefore admits a distinct neutral
`upsertPreservingDeletion` operation. It merges physical prior rows, preserves
their deletion marker and creation timestamp, and advances managed update time;
missing rows use the existing defaults and complete-row validation. This
operation requires strict trusted `allowPreservingDeletionUpsert: true`
admission, complete call/aggregate validation and identity binding. Ordinary
profiles and physical storage do not acquire it implicitly. Existing `upsert`,
lifecycle operations, resource limits and final settlement remain unchanged.
The adapter invokes rows sequentially to retain native repeated-ID behavior;
this does not relax the shared batch's duplicate-key rule.

The neutral Folio/Entry fixture owns this core contract and both database lanes.
Its pre-correction witness requires retained deletion and advanced update time
from the original operation, exposing the mismatch without duplicating native
business logic. The connected Type inverse remains separate consumer evidence.

## Events, hook and mandatory empty closure

Use the existing module mutation subscriber, native event aggregator and
`commerceModuleEventBus`. Forward writes emit
`fulfillment.shipping-option-type.updated`. Genuine inverse upsert may emit
that family or `fulfillment.shipping-option-type.created`, depending on the
physical preimage. Correlate actual mutations and invocation-local results;
no-op forward calls emit no module update event, while ID-only inverse upsert
does. Preserve native deduplication/order and failed-root publication rollback.

The root separately emits `shipping-option-type.updated`
(`utils/src/core-flows/events.ts:838`) once per actual returned ID. Reuse
`orderedWorkflowIdEvents` directly. Correlate B rather than original A when
retargeting. Preserve the native array/scalar normalization in the promoted root
even though this named selector profile returns arrays.

Admit only `shippingOptionTypesUpdated` through existing own-property hook
registration, resource-bound callback and DML-derived result decoder. Preserve
omitted/additional_data value, callback order, error/cancellation and closed
resource lifetime. Expose only named selected methods; no raw manager,
settlement, Query, Link or provider capability.

For `selector: { id: [] }` or no matches, Fulfillment resolution, projected
preimage list, real selector update call and its internal selector list still
occur. Native internal update then returns early for normalized `[]`. Hook sees
`shipping_option_types: []`. Native emit step still resolves the event bus for a
truthy empty array, then returns before emitting zero messages. Inverse skips
absent/empty preimages before Fulfillment resolution. Do not short-circuit these
dependencies in the facade.

## Minimum connected implementation and resource plan

Reuse the six-table fresh installed source already selected in 127/128:
`medusa.shippingProfile`, write profile of the same name, lineage
`commerce.shipping-profile`. The exact native Type table already exists there.
Reuse `captureShippingProfileDeletionMetadata` and the installed binding; do not
add duplicate inventory, a one-table alternate owner, schema upgrade or reset.
The shared twelve-model construction is now `fulfillment-module.ts` /
`defineFulfillmentPersistenceModule`; reuse it directly without another rename.
Keep siblings/provider repositories denied. Native Type scalar update and
upsert do not write Option rows or require provider setup.

Named boundary:

- Object selector `{ id: string | raw string[] }`, raw array length 0-4, preserving
  duplicates/order until native conversion. Other native filter families require
  their own complete-cohort admission and are not silently claimed.
- Patch with optional ID, label, nullable description and code. Preserve ID
  retargeting fully. Managed timestamps, nested Option data and unknown fields
  fail closed; no metadata field is fabricated.
- At most four original-selector rows, plus one possible distinct retarget
  identity: **five distinct Type identities** may require read/inverse evidence
  in a full four-selector forward/inverse graph. Do not impose a four-identity
  transaction cap that rejects genuine retarget behavior. Per-call inverse
  upsert entries remain bounded at four, with native sequential duplicate IDs.
- Use unchanged default 64 calls/events and existing byte/query limits with the
  ordinary optimistic atomic profile. The complete four-selector root, hook/event
  path and retained inverse, including outside retargeting, fit this profile.
  A hook's admitted additional calls remain governed by existing authority and
  per-call/resource limits; the root input bound is not a hidden identity ledger.

Promote the exact pinned root and step with narrow exports and direct portable
imports; retain full source body, original public input types, conditional event
array handling and inverse. Register existing transaction-covered step metadata
only. No business rewrite or void-output adaptation is needed.

Reuse shared keyed update mechanics where native pairs already identify their
actual target, and native order/projection/scalar read owners. Extend the proper
upsert owner to retain actual insert-or-update behavior, missing required-field
failures, tombstone values, timestamps and event families. Do not reuse Profile's
existing-only inverse as a substitute. Keep creation/update result contracts
distinct while reusing checked Type metadata/full-row scalar decoding where its
semantics actually match; remove any displaced duplicate assembly in scope.

## Validation and decision gates

### Executable native characterization

`%TEMP%/flarex-129-native-witness/report.json` records fifteen passing native
characterization cases over real node:sqlite using the pinned native Drizzle
test harness. The runner authenticates 133 executed source files and the source
manifest, uses the full genuine Fulfillment module constructor and all twelve
genuine model/internal-service bindings (including the real native provider
service), and executes unchanged extracted native step callback expressions with
the real native StepResponse and an Awilix container. All storage, service
normalization, error mapping, transaction handling and event generation are
native. Only broad utility-barrel resolution is narrowed to authenticated native
exports. TEMP-only emitted files, hashes, relocation list and the runner are
preserved beside the report; no source island or repository runtime was edited.

The executable evidence confirms:

- Raw `C,A,C,unknown` selector order yields unique `C,A`; a projected label
  preimage contains exactly ID/label. Scalar update returns no shipping_options.
- An empty forward patch retains ID-only preimages, preserves updated_at and
  emits no module event. Its genuine inverse updates the timestamp and emits
  `fulfillment.shipping-option-type.updated`.
- Retargeting C/A to outside B returns B once and retains C/A preimages. The
  genuine inverse leaves B's changed label in place. When B was originally
  selected, its own retained preimage restores its label instead.
- Missing and tombstoned retargets both produce native `MedusaError`, type
  `not_found`, message `ShippingOptionType with id "<target>" not found`.
  An empty original selection avoids lookup and returns []; ID-only active
  retarget returns B without a write/module event. The direct missing string
  overload instead says `ShippingOptionType with id: missing was not found`.
- Existing partial upsert preserves required scalar fields. A tombstoned row
  stays deleted and emits updated; output has no empty to-many field.
- Missing `{id,label}` upsert fails with plain `Error`:
  `Value for ShippingOptionType.code is required, 'undefined' found`.
  Missing ID-only upsert similarly fails on label. Complete missing input
  recreates the row, defaults description/deleted_at to null, emits created and
  returns no shipping_options field.
- Sequential same-ID upserts return both intermediate row versions in order;
  native module aggregation deduplicates the identical updated event to one.
- A later required-field failure in a real native upsert batch rolls back an
  earlier actual upsert and publishes no module messages.

This characterization does not execute the full root workflow host, hook or
workflow event step and does not prove the Flarex adapter or PostgreSQL lane.
Those remain required implementation gates; no native bug correction is claimed.

### Implementation acceptance

Required targeted cases in both PGlite and ordinary-role real PostgreSQL include:

1. Four-root label/code/description update and actual row/hook/event order;
   missing/deleted/raw duplicate/empty IDs and full original-to-retarget identity
   graph. Preserve first-occurrence selector behavior and native Map collapse.
2. Null/omitted/empty-string description, native empty/case-sensitive strings,
   same-value nonempty writes, empty patch timestamps/no module events, root
   workflow events for no-op results and correct absence of shipping_options.
3. Active retarget inside/outside original cohort, multiple selected roots to
   one B, retarget ID-only patch, active/deleted/missing B and no-match-original
   precedence. Preserve native ordinary-inverse failure to restore an outside
   B's value, and contrast that with originally selected B's retained preimage.
4. Exact projected retained preimages, ID-only inverse timestamp/event write,
   normal scalar restoration, tombstoned physical row upsert, missing-row full
   recreation and partial required-field refusal, duplicate inverse entries,
   created versus updated module events and no invented to-many output.
5. Empty dependency resolution/hook/event-bus behavior; hook failure, caught
   denial/rollback-only, cancellation, cross-scope and closed resources, replay,
   publication rollback, real concurrent conflicts and prior Profile/Type create
   consumers. Seed active/historical Option references through the existing
   fixture owner and prove their rows/Type FKs remain unchanged by scalar Type
   update/upsert. Distinguish native inverse from exact failed-root rollback.

Connected skipped-query refusals retain the existing root's `rollbackOnly`
envelope and original `receiptMismatch` cause. This sticky-failure projection
does not replace the direct receipt validator's typed refusal or permit an empty
result without authenticated read evidence.

Add exact source promotion entries, complete emitted root/step guards, original
public-type preservation checks and mutation counterexamples covering selector,
preimage fields, operation order, retarget semantics, hook, event IDs/family,
output and retained upsert. Refresh final source/build provenance after edits.
Run affected native/adapter types/builds, source pin/island/portable/browser
guards, core/diff/staged lint and both required read-only reviews before one
scoped commit. Main owns heavy checks and Git. Stop owned resources.

No native business alteration is needed to implement the recorded behavior.
Fixing ID retargeting or changing its inverse, restricting real upsert to
existing active rows, changing no-op inverse events, or filling projected
preimages to guarantee business undo would require a separate explicit native
business decision with an executable witness. Necessary shared-core corrections
remain user-authorized; preserve failing evidence and correct their real owner
instead of an adapter workaround.

Later native Type deletion has its own ShippingOption Query guard and grouped
Link branch. This update slice does not establish it, arbitrary Fulfillment/Option
CRUD, providers, populated source evolution, hosted/production activation or
external persisted-saga compensation. Chunked Product file import and Product
export remain deferred.
