# Native Price Preference deletion preflight

## Status and complete closure

Status: implemented for connected bounded private execution. Product chunked
file import and Product export remain deferred.

Authority is Medusa 2.13.4 at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, recorded in
`third_party/medusa/SOURCE.json`. Native paths below are relative to
`third_party/medusa/upstream/`:

- `packages/core/core-flows/src/pricing/workflows/delete-price-preferences.ts`
  owns the complete root and returns the Pricing step's undefined result.
- `packages/core/core-flows/src/pricing/steps/delete-price-preferences.ts`
  always resolves Pricing and calls `softDeletePricePreferences` with the
  original IDs. It retains those raw IDs and restores them on cancellation
  unless the array is empty.
- `packages/core/core-flows/src/common/steps/remove-remote-links.ts` groups
  the original IDs under `pricing.price_preference_id`, calls native
  `Link.delete` even for empty IDs, retains the grouped input, and compensates
  with native `Link.restore`.
- The generated Medusa service, original internal service, default MikroORM
  repository and Price Preference DML own selection, dirty detection, managed
  timestamps, active uniqueness and event collection.

The actual original SDK graph is linear: Pricing deletion completes before
Link deletion. Cancellation runs Link restoration before Pricing restoration.
Both source statements consume the original input; that source shape does not
establish parallel execution. Preserve the genuine compiled workflow graph.

The closure requires the existing Pricing participant and an authentic native
empty-family Link resource. No current installed Link definition references
Price Preference. Required Link calls remain observable even without matching
families. No Query, Region, provider, File, new model, Link table, remote effect
or additional persistence participant is required.

## Original native evidence and behavior

The immutable external packet is
`%TEMP%/flarex-151-native-price-preference-delete-witness`. Its 43-case baseline
executes the original workflow and retained callbacks, generated Pricing and
internal services, default MikroORM, ordinary-role PostgreSQL, actual
LocalEventBus and genuine native `Link([])`. Empty native module registration
and routing maps are checked before exercising that Link resource. Native
source and emitted bodies, arguments, DTOs, all six Pricing tables, SQL, event
delivery, SDK graph/state and cleanup are preserved separately from adapter
validation. Runtime null/scalar probes outside the declared `string[]` input
are labeled separately and do not widen the private input contract.

The public input is a raw string array. The bounded profile accepts zero to
four IDs, each at most 256 characters, including empty strings, duplicate IDs
and arbitrary missing IDs. Raw order and duplicates remain in native calls and
retained compensation. Stored-row identity validation remains unchanged.

Soft deletion selects active existing rows only. Matched IDs are deduplicated
and returned in native database order. It changes only `deleted_at` and
`updated_at`, with one `pricing.price-preference.deleted` event per changed
active row. Empty, missing, empty-string and already-deleted selections produce
no mutations or events. Empty input still calls Pricing and Link; cancellation
skips empty Pricing IDs but still invokes the retained Link restoration.

Native restore includes deleted history and emits no events. Its internal
service does not register the event subscriber used by soft deletion. Changed
rows clear `deleted_at` and advance `updated_at`; already-active rows retain
their timestamps and cause no UPDATE. Restore result maps still include all
selected IDs, including already-active no-ops. Missing or physically removed
IDs contribute no rows. Result maps are not dirty-row lists.

The original step retains raw requested IDs rather than the deleted result map.
Consequently, cancellation can resurrect a requested row that was already
deleted before forward execution. This native behavior is preserved explicitly;
this slice does not introduce a business correction. A restore can fail the
active partial unique index after a conflicting row is present. The native
restore transaction then rolls back wholly, while the prior empty-family Link
restore has already completed. Successful repeated SDK cancellation performs
no new public or Link calls; repeating permanent failed cancellation rejects
without retrying the callbacks. Late-parent failure retains its original error
and any actual compensation failure.

These observations establish the bounded native contract, not arbitrary
collations, hosted activation, durable external event delivery, cold workflow
recovery, destructive durable-data migration or scale.

## Portable SDK mismatch and disposition

The original native composer returns its staged Pricing step directly. The
native baseline accepts that shape and resolves its undefined public result.
The former portable SDK required a `WorkflowResponse` in both its authoring
signature and runtime composer guard, so the unchanged native workflow failed
the portable typecheck before its consumer could execute.

This mismatch belongs to the portable workflow SDK. The failing typecheck and
original native packet remain preserved. The SDK now normalizes authentic
current-composer regular-step or child-workflow returns through its existing
response capture. Synchronous construction, ownership, reference, hook and node
bounds remain enforced; arbitrary objects and other raw references remain
refused. The original native workflow body is unchanged.

A separate original-SDK control packet,
`%TEMP%/flarex-151-native-sdk-return-contract-witness`, compares direct and wrapped
scalar, object, undefined and null returns, with retained compensation and
repeated cancellation. Literal composer-void controls are characterized
separately; they do not widen the admitted direct-step profile. The SDK owner
and complete native consumer retain separate regression coverage.
Existing approval for necessary core changes covers this connected correction;
native business behavior is unchanged.

## Private implementation and ownership

The existing Pricing constructor has one explicit deletion admission. It
exposes native soft-delete and restore methods, with graph access off.
An explicit internal Store/update/deletion preference mode owns this choice.
Creation, update, Store, Product and Shipping admissions retain their current
contracts and capabilities.

The profile reuses complete DML-derived Price Preference rows,
`medusaLifecycle` and `scalarLifecycleReceipt`, with active-restore updates
disabled. The shared
owner already supports no-op active restoration with selected result IDs;
no shared-core correction is indicated. Native event collection remains with
the adapter owner: soft deletion uses its actual subscriber, and restoration
requires no subscriber and emits no events.

The private transaction boundary retains its existing failure classification:
shared uniqueness violations surface as `invalidInput`, with sticky
`rollbackOnly` causes preserved. Native MikroORM's separate `invalid_data`
mapper is not an executing adapter repository and is not copied into this
profile. Restore collisions must still refuse and roll back the complete
inverse. The accepted atomic request contract retains committed successes
only: a rejected inverse has no cached error outcome, so the same key can run
a fresh attempt. Committed-success replay makes no additional native calls.
This differs from cancelling the same permanently failed native SDK
transaction; post-completion scheduler cancellation remains outside the finite
atomic profile, with its original behavior preserved in the native packet.

Receipts authenticate exact requested-history reads, full rows, lifecycle
observations, managed transitions, selected result maps and dirty deleted-event
membership. They protect unrelated preferences and every other Pricing table
without inferring selection from dirty rows or adding a JavaScript predicate
engine.

The original Pricing workflow and step use existing portable imports and
transaction-covered metadata alongside the promoted common Link step.
A narrow facade borrows the existing Pricing participant and a
named composed native Link resource, preserves the actual SDK graph and uses
the existing queued-operation owner and resource limits. It returns normalized
null for the original undefined public result. Link owns its genuine traversal
and return values; the empty-family resource adds no endpoint reads, synthetic
family, independent settlement or storage writes.

PGlite and ordinary-role PostgreSQL coverage exercises genuine retained
callbacks, empty calls, raw-ID preservation, historical resurrection, active
restore no-ops and maps, nullable keys, collisions, repeated cancellation,
late-parent rollback, replay, revocation, refusal and protected data. Production
activation remains separate.
