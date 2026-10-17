# Native Shipping Option Type deletion preflight (130)

Status: bounded private native Type deletion and retained restore are implemented
with PGlite and ordinary-role PostgreSQL proofs. Hosted activation and
populated-schema upgrades remain outside this slice.

## Source and complete native graph

Medusa 2.13.4 is pinned at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f` by
`third_party/medusa/SOURCE.json`. Native paths below are relative to
`third_party/medusa/upstream`; executing packages are named explicitly.

The native root and step are
`packages/core/core-flows/src/shipping-options/workflows/delete-shipping-option-types.ts`
and `shipping-options/steps/delete-shipping-option-types.ts`. Their executing
copies are under `packages/medusa-core-flows/src/`. They export
`deleteShippingOptionTypesWorkflow` and `deleteShippingOptionTypesStep`, both
with ID `delete-shipping-option-types`.

The complete native root retains these operations in order:

1. `useQueryGraphStep`, named `get-shipping-options`, queries `shipping_option`
   with `{shipping_option_type_id: input.ids}`, fields `["id"]` and
   pagination `{take: 1}`.
2. The native transform projects `shippingOptionsQuery.data`. The pure
   `validate-delete-shipping-option-types` step rejects a nonempty result with
   `MedusaError.Types.INVALID_DATA` and the unchanged message
   `Cannot delete shipping option type because some shipping options are using it.`
3. The real Type step calls `softDeleteShippingOptionTypes(input.ids)` and
   returns `StepResponse(void 0, ids)`.
4. `shippingOptionTypesDeleted` receives the raw requested `{ids}`. The root
   maps those same requested IDs to workflow-event payloads.
5. Native `parallelize` executes both `removeRemoteLinkStep` with
   `{fulfillment: {shipping_option_type_id: input.ids}}` and
   `emitEventStep(ShippingOptionTypeWorkflowEvents.DELETED)`.
6. `WorkflowResponse` exposes the hook and returns the step's void result. The
   existing portable host represents this root result as null.

The new step has the existing transaction-covered compensation metadata; its
genuine restore callback remains intact. Full emitted-program and original
public-input guards admit only direct import relocation and that metadata.
There is no provider call, child workflow, external effect, file, lock or pause.

## Active Option guard and paginated query authority

The guard is workflow business behavior. Fulfillment inherits generated Type
soft-delete/restore; it has no module-level active-Option guard on this path.
Direct admitted lifecycle calls therefore remain broader than this root. Do not
copy the root's business guard into the repository or shared persistence.

The query selects active Options by their scalar Type FK, independently of the
Type's lifecycle. An active Option blocks even an already-deleted requested
Type. Historical Options are ignored. Do not join/filter active Type roots first.

Use genuine generated `listAndCountShippingOptions` and the checked native
`ShippingOption` graph alias. This method uses native internal read/count and
base serialization without provider/context handling. Only Option find/count
authority is admitted; no Option mutation or provider method is exposed.

The root requests one ID row and the actual matching count. Two matching Options
must return one row and count two. The existing query owner permits partial
pages for explicit pagination; returned rows need not equal total. Preserve the
native page, actual count, ordering and selected fields under existing query
ceilings. Do not invent count 0/1, an arbitrary Option-cohort limit, or a complete
scan requirement. Each repository validates its full selected native rows before
projection; an Option projection cannot pass through a Type creation decoder.

The actual read/count observations, including empty selection, retain shared
query dependencies and conflict validation. This workflow guard does not create
a permanent database invariant forbidding later Option insertion or restoration.
The native find and count methods execute the same prepared paginated read:
each relational-read receipt records the one-row page and its actual
pre-pagination total. Count does not introduce a separate unbounded read shape.
The adapter receipt authenticates both observations against the existing query
owner, correlates the ID projection and actual count, and refuses skipped or
partial evidence. This is a receipt correction, not a change to native query
business behavior or shared count semantics.
Indexed dependency candidates can include physical Option tombstones before the
final active-row predicate. Validate every candidate body and requested FK, then
derive the native count/page only from active matches. Historical candidates are
read evidence, not active guard results; they neither block deletion nor justify
discarding their authenticated dependency observations.

## Type lifecycle and broader native inverse

Executing owners are generated methods in
`packages/medusa-utils/src/modules-sdk/medusa-service.ts`, native internal service
lifecycle methods and the pinned Drizzle DAL at
`packages/database/drizzle/src/medusa.ts`. The adapter reuses shared lifecycle,
reference, row-contract, receipt and event owners without direct SQL.

Soft deletion affects active matches only. Missing and already-deleted IDs
produce no new Type write/module deletion event. Native generated output is the
actual linkable-key map, such as `{shipping_option_type_id: [ids]}`, or `{}`.
The Type key is derived from DML and merged by native joiner construction;
absence from the shorter explicit joiner list does not make it unmapped.
Validate full lifecycle evidence and generated maps before the step discards
the forward result.

Type has no outbound FK or declared cascade delete. Its inverse `shipping_options`
relationship does not cascade this lifecycle. Active and historical Option rows,
their required Type FK, Rules, parent records and unrelated Types stay intact.
Unlike creation's physical inverse, soft deletion does not detach a required
Option FK.

The step retains the raw requested IDs, including duplicates, missing IDs and
previously deleted Types. Its inverse skips absent/empty IDs before resolving
Fulfillment; otherwise it calls genuine `restoreShippingOptionTypes(prevIds)`.
Preserve these native behaviors:

- Duplicate IDs yield unique actual lifecycle rows/module messages, while root
  workflow messages preserve raw duplicates and request order.
- The inverse can revive a Type deleted before the forward root. It is not
  restricted to IDs changed by that forward call.
- Native restore also writes already-active physical matches, advances their
  update timestamp and emits `restored` under its original-deletion convention.
- The inverse does not rerun the Option guard. Direct lifecycle/restore commands
  are bounded capabilities, without hidden prior-delete identity ledgers.

Native compensation is distinct from exact failed-root atomic rollback. Do not
repair its selection, timestamp or event behavior. Type creation, update,
upsert and physical deletion are not granted by this profile.

### Explicit shared active-restore updates

The existing shared logical restore owner authenticates an already-active row
but intentionally performs no write. That default remains required by existing
profiles; using it unchanged for the native Type branch would lose its managed
timestamp update. The correction belongs to the shared owner, not an adapter
timestamp patch, direct SQL, fabricated clock or additional transaction.

The [explicit active-restore admission](../../shared-logical-storage/66-active-restore-updates.md)
adds trusted logical participant selection `allowActiveRestoreUpdate: true`.
It accepts only the optional literal true, requires logical call or aggregate
receipt validation, refuses physical participants and captures the selection in
prepared execution identity. This Type deletion profile selects it; existing
profiles omit it and retain their authenticated active-restore no-op behavior.
The public `restore` operation, ordinary deletion restoration, schemas, limits,
settlement and Application OCC contracts remain unchanged.

For a selected already-active row, the shared owner performs ordinary managed
normalization with transaction time and a correlated real restore patch attempt.
It preserves business fields, identities, creation time and deletion value.
The Type scalar lifecycle receipt separately selects `activeRestoreUpdates: true`
and requires that real attempt rather than accepting the former null-attempt
evidence. Native Type selectors, output maps and restored-event classification
stay unchanged. This neutral core capability is not a native business correction;
both its neutral owner and connected consumer retain their database validation
gates.

## Genuine empty Link resource and bootstrap boundary

No pinned default Link definition mentions `shipping_option_type_id`; Option's
Type FK is module-local. There is no installed stored Type Link family and no
new Link table. Product-ShippingProfile Link storage is not reused for Type IDs.

`packages/medusa-adapter/src/links/shipping-option-type-deletion.ts` supplies the
named resource with exact grouped `fulfillment.shipping_option_type_id` grammar,
empty services/dependencies and both delete and restore methods. It invokes the
genuine portable `new Link([])` router and validates its full result as exactly
`[null, {}]`. Handwritten empty router responses and custom service maps are
outside admission.

The portable Link constructor already uses only explicitly supplied services;
the original process-global fallback for an empty supplied list is an existing
bootstrap divergence. This slice adds no global module registry and makes no
claim for custom/nonempty stored Type Links.

The common native Link step groups raw endpoints. Even `ids: []` yields a truthy
grouped endpoint object, so both its forward delete and retained restore resolve
and invoke Link. Preserve these callbacks and existing common-step source guards.

## Hook, events and mandatory empty execution

The hook exposes exactly `{ids}` with no additional_data. Existing own-property
registration, captured input, resource-bound callbacks and lifetime checks
apply. Only named Type lifecycle, read-only Option graph, Link and event methods
are borrowed; raw storage/settlement and sibling/provider methods remain denied.

Module messages describe actual lifecycle mutations:
`fulfillment.shipping-option-type.deleted` and
`fulfillment.shipping-option-type.restored`. The separate workflow family is
`shipping-option-type.deleted`, once per raw requested ID, including missing,
already-deleted and repeated IDs. Reuse the native module aggregator, existing
event bus and ordered workflow-ID correlation. Preserve native parallel sibling
execution, failure, cancellation and whole-root publication rollback.

Empty input still resolves Query, performs the real Option read/count, runs the
guard, resolves Fulfillment and calls real soft deletion, invokes the hook and
calls real Link delete. The native event step resolves the event bus for its
truthy empty array and emits zero messages. Type inverse skips empty IDs; Link
inverse still restores its truthy grouped endpoint. Do not short-circuit these
different dependency paths.

## Installed source, limits and acceptance boundary

Reuse the installed six-table `medusa.shippingProfile` source/write profile and
`commerce.shipping-profile` lineage through
`captureShippingProfileDeletionMetadata` and
`fulfillment-module.ts` / `defineFulfillmentPersistenceModule`. Type, Option,
ShippingProfile, ServiceZone, FulfillmentSet and FulfillmentProvider retain all
five native Option FKs. No duplicate inventory, source owner, migration, reset or
populated upgrade is introduced. The four sibling tables supply checked FK
closure without granting their mutation/provider authority.

Raw Type and Link endpoint arrays admit zero to four IDs and preserve duplicates,
request order and absent/deleted identities. The Option query takes one row with
actual count under existing query ceilings. Use the existing optimistic atomic
profile, default 64 calls/events and unchanged other resource limits. Root and
retained-inverse bounds do not grant arbitrary hook methods or weaken receipts.

Acceptance requires both PGlite and ordinary-role real PostgreSQL behavior for
the full four-ID graph, paginated guard/count, active/historical Option handling,
unchanged child/FK state, actual lifecycle maps, raw hook/workflow events,
broader native inverses and all empty dependencies. Query negative selection
must retain actual concurrency dependencies. Hook/sibling failures, caught
denials, cancellation, replay and closed/cross-scope resources must preserve
exact whole-root rollback and publication rules. Existing Profile/Type/Link
consumers, native/adapter types, source/portability guards, lint and required
read-only reviews remain validation gates.

No native business correction is proposed. Ignoring active Options, including
historical Options in the guard, suppressing requested-ID events, changing raw
restore selection or skipping mandatory Query/Link/event dependencies would
require an explicit business decision. Necessary shared-owner corrections use
their existing authorization and preserve a failing witness in the correct owner.

Arbitrary Shipping Option workflows, provider execution, custom Type Links,
populated schema evolution, hosted activation and durable external compensation
remain unadmitted. Chunked Product file import and Product export remain deferred.
