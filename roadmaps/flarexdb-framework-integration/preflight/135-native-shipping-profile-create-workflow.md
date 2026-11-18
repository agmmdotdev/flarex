# Native Shipping Profile creation preflight (135)

Status: bounded portable native root, private adapter and shared
reference-detach correction are implemented. This record admits no public API,
bootstrap host, external saga or populated schema upgrade.

## Complete selected outcome and source

The genuine `createShippingProfilesWorkflow` supports zero to four Profile
inputs, authentic complete creation results, module events and the existing
step's genuine retained physical deletion. The existing private creation-output
omission is corrected at its actual owner with migrated consumers, without a
second output-compatibility profile to preserve private tests.

Native authority is Medusa 2.13.4, commit
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, authenticated by
`third_party/medusa/SOURCE.json` and `SOURCE_SHA256SUMS`. Native paths below are
relative to `third_party/medusa/upstream`.

- `packages/core/core-flows/src/fulfillment/workflows/create-shipping-profiles.ts:35–41`
  exports `createShippingProfilesWorkflow`, ID `create-shipping-profiles-workflow`.
  Its entire composer returns
  `WorkflowResponse(createShippingProfilesStep(input.data))`.
- `fulfillment/steps/create-shipping-profiles.ts:17–47` always resolves Fulfillment
  and awaits genuine `createShippingProfiles(input)`, including an empty array.
  It returns the actual complete created rows and retains their actual IDs.
  The inverse skips absent/empty IDs before resolution; otherwise it awaits
  genuine `deleteShippingProfiles(createdShippingProfiles)`.
- Public workflow declarations are in
  `packages/core/types/src/workflow/fulfillment/shipping-profiles.ts`.
  Public input is `{data:CreateShippingProfile[]}` with name/type strings, and
  output is ShippingProfileDTO[]. The actual unchanged callback forwards the
  whole input array; runtime persistence contracts follow checked DML rather
  than treating a DTO declaration as an unknown-input decoder.

The existing promoted creation step remains unchanged. New executing root is
`packages/medusa-core-flows/src/fulfillment/workflows/create-shipping-profiles.ts`,
with narrow export `@medusajs/core-flows/fulfillment/create-shipping-profiles`.
Only the existing portable SDK/direct-step import seams differ from native.
Its erased FulfillmentWorkflow import matches the existing126 native root.
The existing step's transactionCovered metadata and retained callback remain.
No void-result representation seam is needed because this root returns rows.

There is no root Query, Link, provider, workflow hook, external workflow event,
File, Region, lock or pause. Module subscriber/aggregator and host module-event
policy/resource remain required: use `internalModuleWorkflowEvents` and actual
selected event contracts. Empty creation still invokes Fulfillment, returning
and retaining empty arrays without mutations/events; its inverse skips resolution.

## Genuine creation output and owner correction

The native ShippingProfile model has generated `sp` IDs, required name/type,
nullable metadata, managed timestamps, global active-name uniqueness and inverse
hasMany shipping_options. Generated/internal creation and serialization stay
native; there is no Profile-specific creation override.

Native `packages/database/drizzle/src/medusa.ts:416–464` creates in input order,
loads requested relations, applies null-to-one initialization, then runs generic
fillEmptyToManyRelations before dispatching actual created mutations. The full
scalar creation result therefore includes `shipping_options:[]`, complete
metadata/defaults and managed columns. Reuse the already authenticated native
generic helper in `packages/medusa-drizzle/src/relation-query.ts`; do not invent
a Profile-only empty relation payload or grant Option hydration/write capability
solely to initialize this result.

Native scalar input retains scalar output and array input retains array output.
The workflow uses an array. Omitted metadata becomes null; supplied JSON and
explicit null remain authentic. Generated IDs use the native prefix and supplied
fresh IDs are preserved. Name/type strings are neither trimmed nor supplied
application defaults. Missing/null required fields refuse. Ordinary create is
insert, not upsert: existing active/historical IDs and duplicate IDs in a batch
refuse atomically. Global active-name conflicts also refuse without prefix writes.

Creation initialization is distinct from native list, projected list and update
results: those do not automatically acquire an unpopulated shipping_options
array. Preserve their actual selection/serialization behavior. No inverse
relation field is persisted in the scalar Profile row for this output correction.

### Existing private consumers migrate together

Preflight126 describes unpopulated scalar rows without shipping_options, and128
preserved that bounded scope while implementing Type creation. Neither names a
deployed dataset, live/public API or external identity requiring that creation
omission permanently. `@flarex/medusa-adapter` is private and has no Profile
public export.

The executing authored `workflows/product/shipping-profile.ts` uses created
Profiles only for their IDs, then returns a fresh Query projection of id/name/type.
Its final result does not expose the raw Profile creation row. Full Product
creation/batch use this module graph-only. Correct
`modules/fulfillment/shipping-profile-repository.ts` creation output, its complete
creation decoder/receipt and private fixtures at the same owner. Keep scalar
reads, existing identities/permissions and the Product caller's projected result
where their actual supported contracts require them. Update the older scoped
documentation with the completed correction, without claiming permanent legacy
compatibility from existing tests alone. Any actual stored-outcome obligation
discovered during implementation needs an explicit disposition.

## Physical inverse includes real validation and nullable detachment

Native `packages/modules/fulfillment/src/services/fulfillment-module-service.ts:2018–2083`
overrides physical `deleteShippingProfiles`. It normalizes IDs and invokes
validateShippingProfileDeletion before calling generated physical deletion.
The genuine internal list selects active matching Profiles and hydrates active
`shipping_options.id`. Any reached Profile with an active Option refuses with
native INVALID_DATA. This is a real checked relation read, not an empty fixture
payload or a new Query-container dependency.

Existing127 Profile deletion already owns the narrow validation hydration/read
contract, but its repository exposes softDelete/restore. Reuse/extract that owner
for the physical inverse rather than copying business validation. The new command
also needs native physical repository deletion and its complete reference closure.

The initial required-FK-refusal hypothesis was disproved by actual native
execution. ShippingOption.shipping_profile is explicitly nullable. Native
Drizzle schema.ts269–275 assigns no SQL delete action for this reference;
adapter `schema/lower.ts` correctly retains NO ACTION. Native physical delete
instead calls `detachDeletedRelations` at medusa.ts612. The helper at1977–2014
explicitly updates noncascading hasMany child FK fields to null, before deleting
the root. It applies across child history with no deleted_at predicate, does not
assign updated_at and dispatches no child mutation events.

Consequences that remain visible:

- Active Profile plus active Option refuses through genuine business validation.
- Active Profile plus historical Option can pass the active guard; physical
  deletion removes the Profile and nulls the historical Option's Profile FK.
- Historical Profile is absent from active validation; physical deletion can
  detach active as well as historical Options referencing it.
- Every Option field except shipping_profile_id, including created_at,
  updated_at and deleted_at, is preserved. Options and their other FK targets
  are not deleted. Only actual Profile deleted events are emitted.
- Raw duplicate/missing physical IDs match actual unique rows; absent rows are
  not fabricated. Genuine retained inverse receives actual created IDs; its
  admitted bounded command is not restricted by a hidden prior-create ledger.
- Four Profiles with eight mixed-history referencing Options exercise complete
  detachment and emit four Profile deletion events, not child updates.

This is native imperative DAL behavior, not SQL ON DELETE SET NULL. Do not
change FK DDL, silently delete Options or use normal timestamp-advancing Option
patches to imitate it.126 update and127 soft deletion do not gain physical
detachment behavior from this slice.

## Shared reference-detach owner

Native reference detachment belongs to the existing framework-neutral logical
reference owner. The former `workingSet.planSetNull` contract authenticated
nullable NO ACTION references, but required a committed deleted target and
refused matching observed or pending source rows. Its referencePages lowering
normalized in ordinary managed-update mode, advancing updated_at. Those
boundaries refused native born/delete targets and observed reference coverage
and did not preserve Option timestamps.

The neutral row normalizer already has a preserve mode; that fact alone grants
no new derived-reference capability. The implemented owner API replaces the private
`allowSetNull` flag with explicit identity-bound
`setNullPolicy:{managedUpdate:"advance"|"preserve"}`. Sealed intents and activity
carry the required selected mode; reference-replacement authority remains
independent. Existing Product type/collection consumers select advance while
Profile native detach selects preserve, with no parallel old flag. The selected
extension retains authentic delete-attempt authority even when a target is born
and deleted in one root, and admits matching source rows observed read-only.
Matching source mutation attempts or borrowed source overlays still refuse;
the plan remains terminal for later command reads/writes. Complete indexed
reference coverage, sealed mode/receipt/proof binding, snapshot/OCC, atomic facts
and single final settlement remain core-owned. No adapter SQL, extra transaction,
ignored refusal or native business alteration substitutes for that authority.

The portable inverse uses this selected owner contract. Terminal-read/write and
unsupported pending-source limitations remain explicit profile bounds, not
permission to weaken proof or admit arbitrary pending reference visibility.

## Source composition, bounds and verification

Reuse the existing Fulfillment constructor and owned source lineage. Creation
output correction needs no new table. Physical inverse requires the existing
Option/reference schema closure already present in the six-table selection and
eight-table Fulfillment composition. Do not install duplicate Profile sources or
implicitly upgrade an old populated one-table installation. A distinct workflow
permission/profile is justified by wider actual command/reference authority, not
by preserving an older omission behavior.

Workflow admission selects zero to four Profile creates and requested/selected
physical roots. The existing native validation cohort admits at most eight
Options, and the connected maximum witness contains four Profiles/eight Options.
That validation bound does not impose an eight-child ceiling on complete
historical detachment: its derived reverse range is governed by the actual
shared reference/materialization/resource bounds. IDs and field values retain
existing byte/resource caps. Keep original data order, actual
created IDs, scalar/array shape, managed values and native event families.
Four creates plus genuine retained physical inverse emit four created and four
deleted messages for that witness. The selected profile retains default
64-call/64-event limits. On both drivers, four creates consume twelve calls;
the genuine complete create plus retained inverse consumes thirty-six calls and
eight events. The mixed four-Profile/eight-Option physical inverse consumes
twenty-one calls. These complete bounded compositions fit the existing allowance;
other profiles and resources remain unchanged.

The authenticated native full twelve-model Fulfillment/Drizzle/SQLite comparison
executes genuine methods, exact unchanged step callbacks and the actual root
composer with native WorkflowResponse plus observational registration. It does
not execute the complete native scheduler. A real outer native SQLite late
failure rolls back data while its native event bus may already have received a
created message; portable one-root/outbox atomicity is a separate required proof.

Connected acceptance requires both PGlite and ordinary-role PostgreSQL, genuine
native root and retained inverse, complete maximum creation/reference closure,
resource exhaustion rollback, active guard versus historical detachment,
preserved child timestamps and Profile-only events, same-root born/delete and
admitted observed references, concurrent indexed reference insertion, scope/
identity/replay/cancellation, exact result/read/mutation/derived receipts, and
Product plus126/127 existing-consumer regressions. Authenticate native runtime,
public creation types, exact source pairs and existing step adaptation; test
changed results/IDs/inverse/empty guards/awaits/imports and public declarations.
Affected types/builds, browser portability, lint and both reviews precede commit.

LocationFulfillmentSet installation and native location-based Set creation remain
a later connected migration of new Link creation, Stock Location deletion and
Set deletion. Its expanded event estimate is source-only until a real router
witness executes. General ShippingOption/provider workflows, populated upgrades,
public/hosted activation, chunked Product file import and Product export remain
outside this slice.
