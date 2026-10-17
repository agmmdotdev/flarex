# Native Shipping Option Type Creation Workflow

Status: bounded private native creation and retained physical inverse are
implemented. Production activation and populated-schema upgrades remain outside
this slice.

## Native source and executing closure

The source island is Medusa 2.13.4 at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, authenticated by
`third_party/medusa/SOURCE.json` and its source manifest. The implementation promotes these pinned root and step entries:

- `packages/core/core-flows/src/shipping-options/workflows/create-shipping-option-types.ts`
  exports `createShippingOptionTypesWorkflow`, ID `create-shipping-option-types`.
- `packages/core/core-flows/src/shipping-options/steps/create-shipping-option-types.ts`
  exports `createShippingOptionTypesStep`, the same step ID.

Paths in this list are relative to `third_party/medusa/upstream`. Executing
Fulfillment service, native generated service machinery, models, static manifest,
workflow SDK, common event step and adapter mechanics already live in their
respective `packages/medusa-*` packages. Verify those copies and guards again when
implementing; never edit the pinned source island or comparison snapshots.

The complete native root is:

1. Genuine `createShippingOptionTypesStep(input.shipping_option_types)`.
2. `shippingOptionTypesCreated` hook, with `shipping_option_types` containing the
   actual created result and `additional_data` from root input.
3. Native transform mapping each returned row, in order, to `{ id }`.
4. Genuine `emitEventStep` with `ShippingOptionTypeWorkflowEvents.CREATED`.
5. Unchanged created array in `WorkflowResponse`, exposing the native hook.

The step resolves `Modules.FULFILLMENT` before calling genuine
`createShippingOptionTypes(data)`. Its retained inverse input is the actual
returned IDs. The inverse returns before resolving Fulfillment for absent or
empty IDs; otherwise it calls genuine physical `deleteShippingOptionTypes(ids)`.
There is no Query, Module Link, Locking resource, provider invocation, child
workflow, external effect, workflow pause or file handling on this root.

## Native service and persistence behavior

`packages/medusa-fulfillment/src/services/fulfillment-module-service.ts:82`
inherits generated create/delete methods; neither Type creation nor physical
Type deletion has a Fulfillment business override. The relevant executing
machinery is:

- `packages/medusa-utils/src/modules-sdk/medusa-service.ts:186`: generated create
  calls the internal service and base serialization; array input retains array
  output. The default omitted service input is `[]`.
- `packages/medusa-utils/src/modules-sdk/medusa-internal-service.ts:256`: the
  transaction-decorated create returns early for undefined/empty input, otherwise
  registers native mutation events and delegates the unchanged normalized array
  to the selected repository.
- Generated physical delete at `medusa-service.ts:249` normalizes scalar IDs to an
  array and returns void. Internal delete at `medusa-internal-service.ts:456`
  handles raw IDs/selectors, builds `$or` criteria, calls repository delete and
  dispatches native deletion events for actual returned IDs.

Pinned Drizzle `packages/database/drizzle/src/medusa.ts:416` creates entries in
input order. `createEntityGraph` at line 984 uses scalar field data, model defaults,
required-field validation and an ordinary INSERT at line 1047. It is not upsert:
a supplied new ID is preserved; an existing or tombstoned ID fails the primary
key constraint. Duplicate IDs in one batch must fail and leave no prefix writes.
Generated ID prefix is `sotype`. No label/code trimming, case conversion,
application default description or unique-code policy is present.

The actual model is
`packages/medusa-fulfillment/src/models/shipping-option-type.ts:5`: ID; required
searchable/translatable label; nullable searchable/translatable description;
required searchable code; managed created/updated/deleted timestamps; and inverse
hasMany `shipping_options`, mapped by Option `type`. The Type root has no outbound
FK, metadata column, declared unique code or cascade delete. Decode accepted
business input and full stored rows from this checked metadata. Refuse managed
fields, unrelated fields and nested Option writes under this named profile.
Optional supplied IDs are persistence-supported even though the public native
create DTO omits an ID member. Nullable description follows DML. Public DTOs are
not runtime decoders: the pinned Type DTO misleadingly declares singular
`shipping_option_id` / `shipping_option` and a nonnullable description.
Canonical string timestamps follow the existing portable adapter boundary.

## Exact creation result and native zero-to-many initialization

Full pinned Drizzle creation returns more than scalar columns. In
`packages/database/drizzle/src/medusa.ts`, create calls relation loading around
line 439, `fillNullToOneRelations` at 446 and `fillEmptyToManyRelations` at 447,
then returns those records. Base serialization at 221 is identity; generated
service creation, the step, hook and root do not project this result.

`fillEmptyToManyRelations` at 2190-2206 is generic native behavior: for every
missing hasMany or manyToMany descriptor it assigns an empty array. It is not a
Type-specific business rule. With only the admitted scalar Type create input,
the actual fresh Type result therefore contains `shipping_options: []`.

Existing scalar Profile admission deliberately omits unpopulated inverse fields
(preflight 126, lines 63-64). Preserve that existing profile and its tests. It does
not establish complete native Drizzle creation-result parity for the new Type
root. For 128, extract and reuse the pinned storage-independent generic
zero-to-many initialization in the existing Medusa Drizzle relation owner. Keep
the original algorithm and authenticate it against pinned source; only erase or
narrow SQL-specific descriptor types to the structural relationship data actually
read. Do not import the SQLite manager, copy a Type-only empty-array algorithm,
fabricate relation DTOs or rewrite older Profile output contracts.

The Type repository will validate complete native scalar rows, run the authentic
initialization over a detached native result using checked Type relationship
metadata, then validate the complete result before workflow/hook projection.
Its sole allowed inverse initialization is the checked empty `shipping_options`
array for creation without nested relation input. This grants no Option query,
CRUD or provider capability. A source guard and tests must prove the extraction
is the native generic helper and rejects changed relation/default/output logic.

## Ordinary inverse and linked-row refusal

Native step compensation physically deletes returned IDs; it is not soft delete,
restore, a changed-row diff or preimage restoration. Test the genuine retained
callback separately from whole-root rollback. The transaction-covered execution
profile still uses one outer settlement; callback preservation does not claim
persisted-saga/external inverse execution.

The admitted physical deletion command/resource is a bounded capability accepting
at most four raw Type IDs. Reuse the existing Store creation authority model
(`modules/store/create-service.ts`, `create-receipt.ts`, preflight 124): admission
does not require proof that a preceding create call produced those IDs. The
genuine retained native inverse supplies actual newly created IDs, but that
callback behavior is distinct from the command's broader bounded authority.
Do not add a prior-create identity ledger, hidden bookkeeping or a core extension
to claim an enforced newly-created-only restriction. Test direct bounded-ID
deletion as well as the genuine retained inverse, with ordinary scope, reference,
receipt and event validation in both cases.

Pinned Drizzle delete at `medusa.ts:590` first loads matching rows, invokes
`detachDeletedRelations` and inbound-owned relation handling, then physically
removes roots. `detachDeletedRelations` at 1977 attempts nulling the child FK for
a noncascade hasMany relation. ShippingOption `type` is a required belongsTo FK
named `shipping_option_type_id`; Type has no cascade-delete policy. An existing
referencing Option, including a tombstoned Option, prevents this physical inverse.
Do not delete Options, silently detach required relationships, drop FKs, omit
historical references or add a business guard that claims native behavior.

The native SQLite DAL surfaces a `DrizzleQueryError` caused by
`NOT NULL constraint failed: shipping_option.shipping_option_type_id`
(`ERR_SQLITE_ERROR`, 1299). Its detach update has no `deleted_at` predicate;
both active and soft-deleted Options retain the required reference. The native
atomic transaction rolls back preceding mutations when this update fails.
These are backend storage errors, not a separate Fulfillment business guard.

The adapter must refuse the same linked physical operation through the shared
reference owner without durable partial changes. Authenticate its actual typed
storage failure; the SQLite wrapper and SQL text are not the Flarex storage
error contract. Distinguish that refusal from the successful unreferenced
create/inverse roundtrip. If translation reveals a shared invariant or native
error-contract gap, identify and fix its actual owner under existing core-change
authorization; a native business alteration requires a separate explicit decision.
The native create profile cannot silently upsert an existing Type to make inverse
handling easier.

## Schema and construction ownership

Type alone has a one-table FK closure. Nevertheless 127's explicit fresh
six-table composition already installs this same native Type table, alongside
ShippingProfile, ShippingOption, ServiceZone, FulfillmentSet and
FulfillmentProvider. Reuse that installed schema/source and table binding:
`packages/medusa-adapter/src/composition/schema.ts:159` selects
`compileShippingProfileDeletionDefinition`, source key and write profile
`medusa.shippingProfile`, lineage `commerce.shipping-profile`.

Do not install a second Type inventory/source or create a second authority for
the same model. Reuse the existing selected `shippingProfileDefinition` fixture
property and the explicit fresh composition flags. Old one-table scalar Profile
installations stay unchanged. This slice claims no populated source upgrade,
ownership transfer, migration/reset or generic schema evolution.

The shared genuine twelve-model Fulfillment constructor is
`modules/fulfillment/fulfillment-module.ts`,
`defineFulfillmentPersistenceModule`. Profile create/read, update and deletion
and Type creation share this assembly. The former Profile-named constructor and
model union are removed, and all existing consumers use the Fulfillment owner.
Profile identities remain unchanged. Do not introduce a second constructor,
compatibility wrapper, model registry or unrelated renames.
Preserve the explicit replacement FulfillmentProvider service and denied sibling
repositories. The new profile exposes genuine Type create and bounded physical
deletion of up to four raw Type IDs, which also serves the retained native
inverse. It does not enforce a prior-create restriction; sibling/provider
business operations remain denied.

## Events, hook and empty input

Use the existing `commerceModuleEventBus`, native mutation subscriber and message
aggregator for module events. Type module creation is
`fulfillment.shipping-option-type.created`, physical inverse is
`fulfillment.shipping-option-type.deleted`. Native naming follows generated
`interceptEntityMutationEvents` and `moduleEventBuilderFactory`; duplicate internal
physical-delete notifications remain subject to native dispatch/aggregation.
Correlate event identities and actual changed rows with the new command receipts.

The root's separate workflow family is `shipping-option-type.created`
(`packages/medusa-utils/src/core-flows/events.ts:852`). Reuse
`workflow/events.ts` `orderedWorkflowIdEvents` directly, correlated with genuine
created result IDs in order. Do not extend a Product-only wrapper for this owner.
Retain the existing trusted workflow event bus and publication/subscriber owners;
module-local capture and root workflow events have distinct issuers/contracts.

Prepare resources with `graph: false`, genuine Type creation and the native event
bus. Do not admit Query merely because an older Product example uses graph reads.
Admit the one named hook through existing own-property registration checks,
resource-bound callback and captured DML-derived result contract. Preserve
additional_data omission/value, actual empty/full created rows, sequential
create-before-hook-before-event order, failure/cancellation and closed lifetime.
No raw manager, settlement or unselected service leaks to the hook.

For `shipping_option_types: []`, the root still resolves Fulfillment and calls
its genuine create method. The internal transaction-decorated service returns
`[]` without repository creation/events; serialization and the hook remain.
Native `emitEventStep` sees a truthy array, resolves `Modules.EVENT_BUS`, builds
an empty message array and returns before `emit`. Test required resolution and
hook execution even though no module/workflow messages are published. The
retained create inverse skips empty IDs before Fulfillment resolution. Do not
short-circuit the root as an adapter optimization.

The trusted atomic host requires an event contract and event bus when admitting
these selected eventful module methods. Missing-bus composition is refused at
admission, before calling the service or hook. Separately, the exact native empty
event callback still resolves the event bus and emits no messages; missing
resolution fails there. This callback observation does not bypass host admission.

## Bounded implementation and validation plan

1. Promote the exact pinned root and step with direct portable imports; retain
   original public DTO declarations and all callbacks. Register only the existing
   transaction-covered step metadata needed by the atomic host. No runtime
   business rewrites or void-result seam are necessary for this array root.
2. Extract/authenticate native generic zero-to-many initialization as above.
   Reuse existing schema, generated service construction, repository context,
   scalar create mechanics, metadata decoding, mutation/event mechanics and
   physical lifecycle owner; extend only where the actual native branch needs it.
3. Build one named Type create profile and facade for 0-4 root inputs. Support
   supplied fresh IDs, generated IDs, omitted/null description and unrestricted
   native string values within existing byte limits. The native root array and
   row order remain unchanged. Reject oversized, unknown/managed/nested inputs
   before storage and preserve rollback-only behavior when denial is caught.
4. Retain default 64 calls and 64 events, existing byte/query bounds and ordinary
   optimistic execution. The full four-root forward path, mandatory hook/event
   path and genuine retained inverse fit this profile. Do not lower the graph,
   drop events/inverse work or increase budgets merely to obtain passing tests.
5. Add source/compatibility evidence for the full promoted root and step, helper
   extraction and native public-type preservation. Update package exports,
   promotion manifest and executing source inventory; refresh generated hashes
   after final source edits/builds. Expand complete emitted-program comparison
   guards and meaningful mutation counterexamples for create call, hook payload,
   transform/event/result order, retained inverse and helper relation logic.
6. Validate PGlite and focused ordinary-role real PostgreSQL separately: full
   four-root result/defaults and both event families; duplicate/existing/tombstone
   ID failures and prefix rollback; empty resolution/hook/no-message behavior;
   hook view/order/failure and additional_data; ordinary inverse and referenced
   inverse refusal; cross-scope denial, caught denial, cancellation/replay,
   competing calls and unchanged Profile/Link/schema consumers. Native Option
   rows needed for inverse refusal are explicit canonical fixture seeds, not
   evidence of native ShippingOption creation or provider support.
7. Run affected adapter/native types and builds, pin/provenance/native program,
   source-island/portable/browser guards, core/diff lint, both required read-only
   reviewers and affected reruns. Stage only owned files/hunks, verify staged
   lint and exact index, stop owned database/runtime resources, then create one
   scoped imperative commit after 127 is committed.

Update owning roadmap status only when durable support truth changes. Validation
and review receipts belong in the commit/response, not a chronology appended to
roadmaps. Keep chunked Product file import, Product export, hosted/production
activation and destructive durable-data changes deferred/separately scoped.

## Remaining decisions and boundaries

No native business change is proposed. Preserve native insert semantics,
nullable description, generic empty inverse output initialization, physical
inverse restrictions, hook and both event families. Linked physical deletion
fails with the shared commerce owner's typed `invalidInput` and rolls back the
complete root, including preceding deletions. The backend-specific native SQLite
error wrapper is not the adapter's error contract. The complete admitted graph
retains the existing resource limits. Necessary shared-core corrections are
already user-authorized, but cannot justify an adapter workaround or unapproved
native business alteration.

Type update/delete roots are later connected slices. In particular the native
Type deletion workflow has its own ShippingOption query guard and grouped Link
path; creation admission does not establish those workflows, arbitrary
Fulfillment/Option CRUD, broad relation hydration, providers, populated schema
upgrades, external compensation or production activation.
