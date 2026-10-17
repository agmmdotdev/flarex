# Native Shipping Profile Update Workflow

## Status And Authority

Status: bounded private native Shipping Profile update is implemented over
shared logical storage. No new shared-core capability is required.

Authority is the accepted architecture, owning Medusa adoption roadmap, and
pinned Medusa 2.13.4 fork `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.
Native sources are `core/core-flows/src/fulfillment/workflows/update-shipping-profiles.ts`,
its matching step, the executing Fulfillment module service, internal service
and pinned Drizzle DAL. Shipping Profile creation/read remains a separate
admission. Wider Fulfillment, hosted activation and schema evolution retain
their own gates.

## Native Closure

`updateShippingProfilesWorkflow`, ID `update-shipping-profiles-workflow`, runs
one `update-shipping-profiles` step. It derives native selects and relations,
lists projected active preimages, then calls the selector overload of
`updateShippingProfiles` even for an empty result. It returns the native array.
The retained inverse skips absent/empty preimages and otherwise passes them
unchanged to `upsertShippingProfiles`.

Only `Modules.FULFILLMENT` is resolved. There is no child workflow, hook,
Link/Query/Locking resource, provider invocation, remote effect or pause.
The existing genuine twelve-model constructor can be shared while each profile
keeps sibling repositories denied and exposes only its admitted native methods.
Shipping Options and Product links remain untouched; their relationship
metadata does not authorize hydration or mutation.

## Native Update And Inverse Semantics

The selector service lists actual roots again, maps the shared patch to their
IDs and invokes the real internal update. Name/type strings are not trimmed,
lowercased or defaulted. The internal service retains its ID-keyed last-entry
Map. Workflow selector absence returns `[]`; the direct string-ID overload's
retrieve behavior is outside this admission.

The native internal service merges nonempty metadata through `mergeMetadata`:
existing keys remain, incoming values replace one level, and empty-string values
remove keys. An empty object reaches the DAL unchanged and clears metadata;
null also clears it. Detached native entities may be mutated without changing
the authentic captured storage evidence.

The DAL updates only when a scalar field other than ID is supplied. An empty
patch and an ID-only inverse preserve timestamps and emit no update event.
A nonempty scalar patch still writes/emits when its value equals the old value.
This differs from Store's always-touch graph replacement behavior.

The preimage helper retains ID and selected real columns. Dotted metadata paths
are discarded by the pinned DAL; an empty explicit selection becomes ID-only.
Use the existing named `nativePreimageSelection` boundary without weakening
ordinary projection. Nonempty metadata patches and `{}` commonly retain only
ID, so their inverse does nothing. Null captures the prior metadata column and
passes it unchanged; a captured nonempty object is merged again by the native
inverse. Exact metadata undo is not claimed. Failed-root rollback remains exact
through the accepting owner; external saga compensation is outside this slice.

The native workflow input type omits metadata, although the real step DTO and
Admin route consume it. A narrow erased type correction admits that existing
behavior. Runtime decoding comes from checked DML shapes, not HTTP validation.
Unpopulated scalar rows have canonical string timestamps and no invented
`shipping_options` field; wider native DTO declarations remain unchanged.

## Bounded Admission And Implementation

1. Admit an explicit ID string or raw array of zero to four IDs, including
   missing/duplicate selectors, and shared name/type/metadata patches. Preserve
   native query ordering and actual selected membership. Bound the complete
   selected cohort and result to four roots before mutation.
   The shared preimage configuration retains its 256-derived-select limit;
   metadata shapes that produce more native selected paths remain outside this
   bounded profile even when their encoded bytes fit the command allowance.
2. Add a distinct Shipping Profile update profile exposing exactly
   `listShippingProfiles`, `updateShippingProfiles` and `upsertShippingProfiles`.
   Inverse entries require existing IDs; creation, lifecycle, managed-field
   inputs and sibling Fulfillment operations remain denied.
3. Extract and migrate the existing native construction once. Reuse scalar
   query/keyed update/no-op, metadata-derived complete/projection contracts,
   native metadata merge and exact logical-call receipts. Add no SQL, graph
   replacement or managed-child reconstitution path.
4. Promote the genuine root/step with existing portable imports and explicit
   transaction-covered compensation. Guard the complete emitted runtime and
   narrow type seam against the pinned source.
5. Keep ordinary resource limits, including 64 calls, and the existing
   optimistic atomic profile. The complete four-root forward and retained-inverse
   graphs fit this allowance. The native closure establishes no requirement for
   Store's explicit pre-callback exclusion profile.

## Connected Correctness Contract

Prove maximum four-root updates and retained scalar inverses; raw duplicate,
missing and empty selectors; no-op timestamps/events; same-value nonempty
updates; complete result fields/order; native metadata merge, empty-string
deletion, empty/null clearing and projected inverse limitations. A shared name
across multiple active roots must retain native active-name uniqueness refusal,
with exact root rollback. Existing duplicate-message parity gates remain.

Authenticate actual observations, writes, native performed actions and events.
Refuse forged membership/order/fields/events, wrong profiles, managed fields,
missing inverse identities, excess bounds and sibling access. Exercise sticky
caught refusal, cancellation/revocation, replay and scopes through existing
owners, and real ordinary-role PostgreSQL optimistic competitors without
claiming pre-callback exclusion.
At the Effect boundary retain the complete Cause, including both the initiating
refusal and rollback-only failure; a first-error projection does not describe
the full failed-root outcome.

Validate PGlite and PostgreSQL separately. Regress existing Shipping Profile
creation/reads and Product profile composition after construction extraction.
Run affected types/builds, source provenance/guards, browser portability and
configured core/diff/staged lint, obtain both read-only reviews and commit the
complete connected slice. Production, Shipping Profile deletion, Shipping
Option/provider execution and destructive schema changes remain separate.
