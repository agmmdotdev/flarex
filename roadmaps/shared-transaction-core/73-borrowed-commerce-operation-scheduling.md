# Borrowed Commerce Operation Scheduling

## Status And Scope

Status: implemented private profile with neutral and native connected consumers.
This owns concurrent DAL work inside one admitted Commerce command. The existing
root queue owns complete participant commands. Neither owns a transaction, lock,
clock or settlement. Default profiles retain their contracts.

## Current Sources Of Truth

The accepted Flarex design and framework execution profiles govern authority.
`commerceTransaction/operations.ts` owns the reused FIFO mechanics;
`commerceTransaction/context.ts` owns borrowed context construction;
`atomicCommerce/configuration.ts` owns selection and identity; and
`atomicCommerce/execution.ts` owns command closure. The unchanged
`execution/preparation/boundedRequestLifetime.ts` authenticates actual operations
and rejects overlap. The generic Medusa repository bridge consumes the selected
capability without owning another queue.

The neutral `atomic-commerce-queued-operations.test.ts` and
`atomicCommerceOperations.test.ts` cover the owner. The connected consumer is
[Stock Location update](../flarexdb-framework-integration/preflight/113-native-stock-location-update-workflow.md).

## Current Architecture

Existing `operationScheduling: "queued"` serializes whole participant commands.
It does not schedule DAL fanout inside a command. Native Address upsert starts
create and update through `promiseAll`; its mixed witness consequently reaches
`overlappingOperation` with only the root queue. This missing profile does not
justify weakening the default overlap refusal.

The separate trusted `borrowedOperationScheduling: "queued"` selection is
identity-bound and requires the root queue. Each command and borrowed child
context receives its own bounded FIFO. Its optional `enqueue` capability accepts
input preparation and work over captured JSON. Preparation, owned snapshot
capture and byte charging precede queued waiting. Actual work still enters the
existing authenticated lifetime operations.

A native transaction callback stays outside its descendants' FIFO. A child
borrow creates a separate scheduler, then seals and closes it before revoking
the child manager. Scheduling the whole callback on that same queue would
deadlock its descendants and is not admitted.

## Invariants And Trust Boundaries

- Omission preserves earlier identity and immediate DAL dispatch. Root queue
  selection alone keeps its existing behavior.
- Opaque managers remain bound to their exact request and live lineage. Parent
  use during a child borrow still refuses.
- Call, byte, mode, authority and original deadline checks remain. No resource
  allowance, isolation or settlement change is implied.
- Failure and interruption retain the complete first Cause, poison the attempt
  and prevent later queued work from starting.
- Seal rejects escaped work without implicit draining. Close revokes admission,
  interrupts and joins owned work before child or outer transaction exit.
- Native normalization, Promise fanout and event construction remain native.
  The generic adapter bridge supplies its existing undefined-omitting capture.

## Decisions And Compatibility

Relocate and reuse the existing Commerce FIFO rather than add an adapter queue
or alter native business code. Root and borrowed queues have different scopes,
so the new selection has distinct identity. There is no durable schema change.
This private framework profile does not change the portable Convex developer
model, native Application OCC or public transaction APIs.

## Capability Boundary

The bounded profile covers FIFO writes and one outcome, replay/identity conflict,
default refusal, captured inputs, swallowed failure, cancellation, escaped work
and foreign/expired/nested/parent contexts. The mixed Address workflow consumes
the same capability without adapter serialization. General framework fanout,
remote effects and hosted activation remain separate admissions.
