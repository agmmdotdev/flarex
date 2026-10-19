# Native Price Preference creation preflight

Status: native preflight complete; private bounded native workflow implemented.
Product chunked file import and Product export remain deferred.

## Native authority and complete closure

Authority is Medusa 2.13.4 at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, recorded in
`third_party/medusa/SOURCE.json`. Native paths below are relative to
`third_party/medusa/upstream/`.

- `packages/core/core-flows/src/pricing/workflows/create-price-preferences.ts`
  owns `create-price-preferences` and returns the genuine creation step result.
- `packages/core/core-flows/src/pricing/steps/create-price-preferences.ts`
  always resolves Pricing and calls `createPricePreferences`, including `[]`.
  It retains the actual returned IDs. Its inverse skips Pricing for empty IDs
  and otherwise calls native physical `deletePricePreferences`.
- `packages/modules/pricing/src/services/pricing-module.ts` owns scalar/array
  service results and `is_tax_inclusive ?? false` normalization. The original
  internal services, PricingRepository and default repository own persistence.
- `packages/modules/pricing/src/models/price-preference.ts` requires text
  `attribute`, permits nullable text `value`, defaults the Boolean flag to false
  and defines the active partial unique `(attribute, value)` index.
- `packages/core/types/src/workflow/pricing/index.ts` and
  `packages/core/types/src/pricing/common/price-preference.ts` declare optional
  string attribute/value and optional Boolean tax flag. These TypeScript
  declarations do not validate persistence or describe every runtime null case.

The complete root requires one existing Pricing participant and only its
preference creation/physical-deletion methods plus internal event handling.
There is no Region lookup, Link, Query, provider, File, Locking, remote effect,
new table or separate preference module. Native fixture bootstrap constructs
all six Pricing models; this does not grant the root unrelated Pricing methods.

## Immutable native proof

The packet is
`%TEMP%/flarex-149-native-price-preference-create-witness`. Executed v1 runner
SHA256 is `38466fcd82dcaeac5689bbfbde94745a96f8f3e6d407a8f1c43e5026ef6a3035`.
Its complete report is
`unchanged-native-price-preference-create-postgres-runs/2026-10-19T18-13-59.276Z-6104/report.json`,
SHA256 `a783a966b48aa1e814bf6da11b6ec7f161d4d4dff3c7a5e985684fffeb04d7a6`.

All 40 original artifacts, 280 source/emitted pairs, owned schema removals and
actual LocalEventBus cleanups are authenticated. One harness expectation was
wrong: a duplicate creation failure inside `runAsStep` leaves the parent
`failed`, before the later injected fault runs. Original child `throwOnError`
propagates native `invalid_data` from `dbErrorMapper`; no successful child
StepResponse exists to retain. Original v1 evidence remains unchanged.

The separate v2 harness changes only that expected native outcome. It requires
the exact parent state/error/action, native failed unique INSERT and ROLLBACK,
no late-fault execution, no successful child retention, no deletion/event, and
unchanged complete raw rows. Other late-parent cases still require `reverted`.
It applies no native business correction. Executed v2 runner SHA256 is
`64d79e5787a81600b7087f2421c2e9f8cb1fbc3e60b6380765acfb5e2ecefcca`.
The complete v2 report is
`unchanged-native-price-preference-create-v2-postgres-runs/2026-10-19T18-16-21.181Z-17176/report.json`,
SHA256 `f600cc8020bb86ba9bfbc2e36119ceb0c14bdd6c7fb43390314cd19bbedcdf32`.
All 40 artifacts, 280 source/emitted pairs, 40 schema absence proofs and 40 bus
cleanups hold with no cohort failures. A focused case-29 run is also retained.

Observed native behavior:

- Empty creation still calls Pricing and returns `[]`; its retained inverse
  performs no Pricing call. Empty attribute/value strings remain unchanged.
- Omitted/undefined value becomes stored and serialized `null`. Explicit null
  value does the same. Omitted/null tax flags become false through native code.
- Arbitrary attribute/Region-like strings and raw currency case remain intact;
  case-distinct currency strings remain distinct preference keys.
- Active duplicate non-null pairs and duplicates in one batch fail native
  uniqueness. Multiple same-attribute null-valued rows succeed with distinct IDs.
- An earlier tombstone permits a new active pair. Original cancellation deletes
  only the actual returned IDs, preserving prior tombstones and protected rows.
  A row soft-deleted after forward creation is still physically deleted by the
  original inverse. Repeated SDK cancellation performs no additional calls.
- The maximum four-row creation result, retained IDs and creation event messages
  preserve input order. Complete seven-column DTOs and every Pricing table are captured;
  unrelated preference and PriceSet rows remain unchanged.

The inverse passes retained IDs unchanged. Native MikroORM deletion uses
unordered `DELETE RETURNING id`; its observed PostgreSQL row/event sequence is
not an input-order contract. The existing adapter physical lifecycle selects
deleted rows in canonical native ID order, separately from raw callback input.

The proof uses the original SDK, genuine PricingModuleService, default MikroORM,
ordinary-role PostgreSQL and actual LocalEventBus lifecycle. Event emission and
subscriber observations do not prove durable external delivery. Independent
native calls and in-process cancellation do not prove Flarex atomicity, cold
recovery, a durable scheduler, hosted activation or scale.

## Connected bounded implementation

The existing Pricing factory promotes its Store preference branch to the
named `price-preferences` admission, with source profile
`pricing-price-preferences`; Store consumers use the same owner. It supplies
create/list/upsert/physical-delete methods while each root selects its own
resources. Store-specific pair filtering/upsert grammar remains explicit.

One canonical creation contract admits zero to four rows, required raw attribute
text and optional nullable value/tax flag, with bounded text lengths. Managed
caller fields remain unadmitted despite separate native runtime probes.
Preserve original native public TypeScript declarations; the checked command
crosses the narrower DTO typing once at the actual foreign callable boundary.
Native service code retains normalization and defaults.

The complete-DML preference contracts, repository and receipt also own ordinary
Pricing preference creation, sharing its existing bridge and event lifecycle.
They replace the weaker duplicate scalar creation/result validation. Complete rows, input order, generated IDs,
defaults, every mutation and exact native events remain authenticated. Store
and ordinary Pricing consumers migrate together without another participant,
factory, subscriber, transaction or compatibility alias.

The private native facade selects only create/physical-delete with graph access
off and retains the normal 64-call/64-event, byte and deadline limits. Its
validation contract covers both database lanes, protected rows, nullable
uniqueness, retained callbacks, failure rollback, replay, cancellation,
concurrency and affected Store, Pricing and Product consumers. Existing shared
nulls-distinct uniqueness supplies the required storage behavior; no core schema
change or new execution profile is introduced.
