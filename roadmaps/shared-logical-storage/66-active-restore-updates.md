# Explicit Active Restore Updates

## Status And Scope

Status: implemented private admission with bounded PGlite and ordinary-role
PostgreSQL proofs. A trusted logical Commerce participant may explicitly select
managed update-time writes when restoring already-active rows. Existing profiles
retain active restore as an authenticated no-op. This does not alter schemas,
durable encodings, resource limits, settlement authority or hosted activation.

## Current Sources Of Truth

The [accepted shared logical storage design](../../design-notes/flarexdb-shared-logical-storage.md)
and package boundaries govern authority. Executing owners are trusted participant
capture, configuration and execution under `atomicCommerce/`,
`commerceTransaction/logicalParticipant.ts`, and `logicalDocuments/workingSet.ts`
with its input model. The neutral `logicalActiveRestoreUpdateScenario.ts` and its
connected driver runner own storage proof. The first consumer is
[Shipping Option Type deletion](../flarexdb-framework-integration/preflight/130-native-shipping-option-type-delete-workflow.md).

## Failure And Correct Owner

Pinned native Fulfillment restore writes `updated_at` and emits restored module
events even when the selected Type is already active. The connected genuine
Type restore through the shared logical row owner instead retained identical
before/after timestamps. Its active-row fast path intentionally records a
null-attempt lifecycle observation and returns the unchanged row. Other admitted
consumers require that behavior, so a global change would replace their contract.

The correction belongs to the shared row owner. The native adapter cannot repair
it with a second timestamp update, fabricated clock, direct SQL, additional
transaction, local storage imitation or weakened receipt expectation. The native
business selector, result and restored event behavior remain adapter-owned.

## Current Architecture And Trust Boundaries

Trusted logical participant selection `allowActiveRestoreUpdate: true` requires
logical call or aggregate receipt validation. Synchronous capture accepts only
the optional literal `true`, detaches it from later caller mutation and refuses
the selection for physical participants. Selected participant names enter the
prepared execution identity, preventing a recorded outcome from replaying under
a profile that omitted this selection. Omission preserves previous identities.

The existing `restore` lifecycle operation is unchanged. Under the explicit
selection, an already-active row follows ordinary managed normalization and
records a real patch attempt, with the accepting transaction timestamp,
unchanged deletion value and a correlated restore lifecycle observation. It
preserves native identity, internal document identity, creation time, business
fields and source-local key/reference validation. It does not invent a lifecycle
observation for a missing row. Restoring a deleted row, soft deletion, batch
duplicate refusal and ordinary table writes keep their previous behavior.

Without selection, active restore still authenticates use of the selected row,
records its null-attempt observation with the operation-time row and performs no
write. Direct Commerce and physical profiles retain their existing contracts.
Receipt validation in a selected adapter must require the actual active-row
attempt rather than accepting the former no-op evidence.

The existing owner retains call and byte accounting, exact dependencies,
revision/index/reference history, atomic publication, idempotency, rollback-only
state, cancellation, capability revocation and uncertain-outcome recovery.
Application OCC and Convex document operations gain no new public API or native
framework capability. No lock or settlement owner changes.

## Validation Boundary

The neutral PGlite and ordinary-role PostgreSQL scenario covers default atomic
and direct no-op behavior; explicitly selected active/deleted/missing restores;
mixed, empty, repeated and soft-delete/restore calls; timestamps and correlated
attempt evidence; preserved identities and unique/reference data; captured caller
mutation; replay and identity mismatch; malformed inputs; rollback, caught
refusal, cancellation and escaped capabilities. The connected native consumer
owns actual Type results and module/workflow events, root guard behavior and
retained native inverse caveats. These bounded proofs do not establish arbitrary
framework lifecycles, durable external compensation or hosted activation.
