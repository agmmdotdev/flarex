# Explicit Preserving-Deletion Upsert

## Status And Scope

Status: implemented private admission. This owner defines an
explicit logical relational conflict merge for trusted synchronous Commerce
participants. It retains omitted deletion fields and advances managed update
time, including an identity-only conflict. Ordinary `upsert` retains its existing
reactivation and managed-time behavior. No schema, durable encoding, data reset,
new transaction owner or hosted activation is included.

## Current Sources Of Truth

The accepted [shared logical storage design](../../design-notes/flarexdb-shared-logical-storage.md)
and package boundaries govern authority. The executing owners are
`logicalDocuments/workingSet.ts`, its `model.ts`, and trusted participant capture,
configuration and execution under `atomicCommerce/`. The neutral
`logicalPreservingDeletionUpsertScenario.ts` and its connected both-driver runner
own the storage witness. The first consumer is
[Shipping Option Type updates](../flarexdb-framework-integration/preflight/129-native-shipping-option-type-update-workflow.md).

## Failure And Correct Owner

The pinned native Shipping Option Type inverse calls real internal upsert. On a
physical tombstone it merges supplied fields without implicitly clearing
`deleted_at`, refreshes `updated_at` even for an identity-only input, and leaves
the row deleted. A complete absent input creates a row; an incomplete absent
input fails required-field validation. Existing shared `upsert` instead clears
deletion on conflict and preserves the old managed update time. Its existing
consumers require that behavior, so changing that operation globally would not
preserve the admitted contracts.

The shared row owner accepts the distinct `upsertPreservingDeletion` write mode.
Adapters retain native input, selection, result and event semantics. They cannot
repair deletion or timestamps with direct SQL, a second write, extra transaction,
forged clock or local row-store emulation.

## Current Architecture And Trust Boundaries

The trusted logical participant explicitly selects
`allowPreservingDeletionUpsert: true` and supplies logical call or aggregate
receipt validation. Capture also accepts the explicit `"preserveTimestamps"`
selection for native business merges that retain existing managed fields.
Physical participants refuse it. Selected participant names enter the prepared
execution identity, preventing reuse of outcomes under a profile that omits the
selection. Profiles without the selection retain their existing identity and
fail authority checks when invoking the new operation.

The operation uses the admitted table, source key, scoped candidate view and
existing row normalization. For an existing row, supplied fields merge into its
physical preimage; omitted deletion and creation fields remain intact, while
managed update columns use the accepting transaction timestamp. Explicitly
supplied deletion fields keep their normal table-value semantics under `true`.
The `"preserveTimestamps"` selection keeps all existing capability-declared
creation, update and deletion fields. Supplied managed values must equal the
actual existing preimage; a missing row cannot supply managed values and uses
the ordinary server defaults. This selection enters a distinct execution
identity while existing `true` profile identities remain unchanged. For a missing
row, existing defaults and complete required-field checks apply. It does not
authenticate a prior deletion or reconstruct committed history; the separate
[same-root reconstitution](./63-same-root-row-reconstitution.md) contract remains
unchanged.

Each write batch still refuses duplicate native identities. Consumers requiring
native sequential duplicate behavior use separate calls in the same borrowed
root. Calls retain ordinary ordered attempts, root dependency evidence,
byte/call/identity limits, unique and foreign-key validation, cancellation,
rollback-only behavior, replay and singular settlement. No lifecycle observation
is invented for a scalar conflict merge.

## Convex Compatibility And Limits

This is private framework relational execution. It does not change Application
OCC, Convex document mutation semantics or expose storage, clock, transaction or
settlement capabilities to untrusted code. Ordinary `insert`, `update`, `upsert`,
deletion, lifecycle and reconstitution operations retain their admitted behavior.
Arbitrary native upsert support, durable saga compensation and populated-source
schema evolution remain separately scoped.

## Validation Boundary

The neutral PGlite and ordinary-role PostgreSQL witness exercises committed
active and deleted rows, identity-only conflicts, missing complete and partial
inputs, timestamp/default semantics, sequential duplicates, source/key refusal,
unchanged ordinary upsert, omitted and malformed admission, identity-bound replay,
failed/caught/cancelled roots and exact unchanged durable inventories on refusal.
The native consumer validates actual inverse results and events and preserves
its native projected-input and retarget caveats. These bounded proofs do not
establish arbitrary framework upserts, external compensation or hosted activation.
