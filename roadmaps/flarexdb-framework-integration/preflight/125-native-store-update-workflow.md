# Native Store Update Workflow

## Status And Authority

Status: bounded private native Store update and its neutral core correction are
implemented over shared logical storage.
The standing approval for necessary core corrections applies; it does not
authorize changing native business behavior.
Store creation and deletion retain their separate implemented admissions.
Chunked File Product import and Product export remain deferred.

Authority is the accepted architecture and pinned Medusa 2.13.4 fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. Native sources are
`packages/core/core-flows/src/store/workflows/update-stores.ts`,
`store/steps/update-stores.ts`, and the already-promoted
`pricing/steps/update-price-preferences-as-array.ts`. The executing Store service
and pinned Drizzle DAL own the semantics below; MikroORM compatibility does not
define this admission.

## Native Closure And Ordering

`updateStoresWorkflow`, ID `update-stores`, accepts a selector and one shared
update object. For nonempty supported currencies it passes only code/default
fields to Store, then passes the ORIGINAL RAW entries to Pricing. There is no
Map deduplication, unlike Store creation. Empty or omitted currencies skip the
Pricing branch and its service resolution entirely.

The Store step derives selects/relations from the update object, lists actual
projected preimages, then calls `updateStores(selector, update)`. The native
service performs another selection, associates the patch with each actual ID,
normalizes and validates, and invokes `upsertWithReplace` with both supported
child relations. No match means an empty Store validation cohort. A nonempty
currency patch still executes Pricing, including when that patch would fail
Store's default or duplicate validation if a Store matched. Keep validation in
the executing native service rather than moving it into the facade.

There are no child workflows, hooks, Query, Link, Locking provider, remote effects
or pauses. Default Region, Sales Channel and Location IDs remain Store scalar
values; they grant no endpoint mutation or corresponding module authority.

## Replacement And Preimages

Pinned Drizzle `upsertWithReplace` and `replaceHasManyRelation` own replacement.
Omitted relations remain unchanged. Explicit arrays replace children physically,
including omitted historical tombstones. Existing root updates remain native
even for empty scalar patches, and both configured relations hydrate fully.
Public workflow child inputs omit IDs, so forward replacement generates new
child identities even for unchanged codes. Retained preimages keep child IDs
and owner references so an inverse can reinsert those original identities.

Preimage projection must follow the pinned DAL precisely. Nonempty relation
patches select requested nested fields plus child IDs and owner references.
An empty relation array yields no nested selects; the native DAL then selects
the WHOLE populated child relation, including managed timestamps. Existing
`nativePreimageSelection` cannot be applied unchanged if it converts this case
into an ID-only selection. Native active visibility excludes older tombstones,
so the inverse does not restore historical children removed by replacement.

Object metadata patches produce dotted selects such as `metadata.foo`. The
pinned DAL filters these out as non-column paths. A narrow native-query
translation must retain that behavior; generic projection refusal must not be
weakened, nor may the adapter silently capture the full prior metadata instead.

## Retained Inverse And Owner Gap

Absent/empty Store capture skips resolution. Otherwise the genuine inverse calls
`upsertStores` with projected preimages and `metadata: row.metadata || undefined`.
Native normalization removes undefined fields. Together with the projection
behavior above, this means metadata patches do not generally have an exact
native inverse, including prior null metadata. Preserve that caveat rather than
changing the step. The finite runtime uses transaction-covered root rollback;
external saga exact-undo safety is not claimed.

Clearing a child relation exposes a separate owner mismatch. After physical
removal, native inverse DTOs contain original child IDs and managed fields.
Pinned `applyModelDefaults` preserves supplied `created_at` and refreshes
`updated_at`. The shared Medusa graph replacement owner currently refuses
supplied managed fields for absent children, and neutral core owns actual
managed timestamps. The neutral shared-graph witness clears a child successfully,
then fails the intended full-child inverse with `invalidInput` before any inverse
write. A never-stored child carrying timestamps remains correctly refused.
This scripted fixture establishes the graph mismatch, not authentic history
admission. The disposition must authenticate prior-row identity, ownership,
lifecycle and timestamps before reconstitution. Stripping unchecked fields,
accepting arbitrary caller timestamps or weakening ordinary creation is not an
equivalent correction. Preserve the failing witness and rerun graph-owner and
consumer regressions after the scoped correction. The selected
[same-root reconstitution owner](../../shared-logical-storage/63-same-root-row-reconstitution.md)
exposes an optional checked operation only to explicitly admitted logical
participants with receipt validation, binding that selection into execution
identity. It verifies the complete canonical preimage of the latest physical
deletion, active lifecycle, unoccupied key and same accepting root, preserving
the original internal/native identity and creation time. Existing table
mechanics refresh update time. No history or timestamp capability reaches the
adapter, and ordinary creation remains unchanged.

The Pricing participant uses the shared `pricing-price-preferences` profile
from [native preference creation](149-native-price-preference-creation.md), including its
existing complete-row contracts, RAW attribute/value matching, tax-flag behavior,
created-before-updated results and full prior-DTO inverse. Its inverse calls
both upsert and physical deletion, including empty arrays. No new Pricing
mutation family or business algorithm is needed.

## Bounded Admission

1. Admit an explicit ID selector of zero to four raw Store IDs and the native
   update fields, with at most two currencies and two locales in the shared
   patch. Preserve missing/duplicate raw selectors and native normalization.
   The single patch contributes at most two RAW Pricing entries; retain their
   order and duplicates rather than introducing Store creation's Map behavior.
2. Bound the complete selected historical graph before writes: at most four
   roots, eight Currency rows and eight Locale rows in total. Bound final active
   children to two of each family per Store and eight of each family overall.
   Authenticate the aggregate cohort, rather than only each per-parent load.
3. Reuse authenticated managed-child reconstitution at its actual owner and shared
   scalar/query, replacement, exact projection, lifecycle and receipt mechanisms;
   add no adapter SQL, alternate transaction, fallback or migration engine.
4. Add a distinct Store update profile exposing exactly `listStores`,
   `updateStores` and `upsertStores`. Reuse Store construction and genuinely
   common graph metadata while retaining separate creation/update authority.
   Authenticate projected preimages, complete final DTOs, replacement removals,
   retained/generated identities and native performed-action events.
5. The genuine root/step uses the existing portable wrapper and transaction-
   covered metadata seams. Its trusted profile selects scope exclusion,
   root/borrowed FIFO scheduling and a named 128-call allowance covering the
   complete forward and same-root retained-inverse graphs. Other limits retain
   their defaults.

## Connected Correctness Contract

Cover omitted, empty and nonempty relations; no-match Pricing effects and skipped
Store validation; RAW-case preferences without Map deduplication; native error
order; null scalar clearing; generated/reinserted child identities; complete
history removal; full versus projected preimages; both metadata caveats; maximum
and historical overflow; native events; and untouched neighboring families.

Exercise genuine retained callbacks, including clear-to-inverse managed DTOs,
separately from exact failed-root rollback across Store and Pricing. Reject forged
owners, IDs, managed fields, output membership/order, performed actions and
events. Prove replay, revision conflicts, scopes, caught denial, cancellation,
revoked callbacks and uncertain acknowledgement through their existing owners.
Ordinary-role PostgreSQL must demonstrate exclusion against overlapping Store
update/delete and relevant preference roots. Regress Store creation/deletion,
Pricing preferences and shared graph behavior on both drivers, plus affected
types/builds, exact native source guards, provenance, portability and lint.
