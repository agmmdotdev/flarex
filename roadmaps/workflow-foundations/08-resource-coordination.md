# Resource Coordination

Status: general coordination preflight pending; selected private native Delivery
coordination is implemented. The [folder index](./README.md) owns scope and the
one-capability-at-a-time process.

The [native Fulfillment delivery preflight](../flarexdb-framework-integration/preflight/145-native-fulfillment-delivery.md)
owns the implemented bounded consumer. Its genuine acquire/release steps,
two-second retry wait, ten-second soft-expiry behavior and retained release
compensation use the real native Locking module and static in-memory provider.
The explicitly approved transaction-derived owner preserves a newer owner's
key when an older Delivery compensates. The unchanged ownerless native hazard
and separate correction witnesses remain preserved. This selected profile is
distinct from Inventory scope-exclusive `execute` and introduces no universal
coordination API.

The native parent and stored synchronous update child run outside SQL. Existing
Task subjects, CAS compound checkpoints, callback journals and short commerce
children retain their separate authority. Contention waits borrow no SQL
transaction, and confirmed business settlement precedes native release. The
host binding owns provider lifecycle and close. Native compensation remains
the original stored child inverse, admitted through its exact control command.

Ordinary database work requires an acquisition observation from the same host
and subject with conservative monotonic age below ten seconds. A stored callback
result is not a live claim; a fresh ordinary subject refuses in-flight work
after acquisition loss. Cold terminal recovery and genuine current control
compensation are supported. In-flight reacquisition, full host/provider restart,
distributed providers, cross-process exclusion and resource fencing remain
outside this profile. Task attempt fencing does not supply those guarantees. The Delivery
preflight owns its module and business contract; this roadmap retains the
general coordination and lifecycle questions below.

## Purpose

Determine when different workflow executions need coordination over the same
resource, and whether existing transaction protection or an additional native
capability supplies the required guarantee.

## Questions For General Coordination Preflight

- What concrete conflicting operation cannot be handled by existing constraints
  or bounded transaction protection?
- Is the need execution ownership, exclusion across commits, a reservation, or
  another domain invariant?
- What scope, resource identity, owner, expiry, renewal, and release rules apply?
- How must protected operations reject an expired or superseded owner?
- Which writers must participate for the coordination guarantee to hold?
- How should multiple resources, ordering, contention, cancellation, and crash
  recovery behave?
- Which existing Task lease or persistence mechanics are reusable without
  changing their authority, and what differs from the Medusa locking contract?

## Starting Sources

- [Task lifecycle](../durable-task-engine/03-run-attempt-engine.md)
- [Shared transaction core](../shared-transaction-core/README.md)
- [Selected native Delivery profile](../flarexdb-framework-integration/preflight/145-native-fulfillment-delivery.md)
- [Selected native Locking lifecycle](../../packages/medusa-adapter/src/workflow/durable-locking.ts)
- [Pinned Medusa lock step](../../third_party/medusa/upstream/packages/core/core-flows/src/locking/steps/acquire-lock.ts)
- [Pinned PostgreSQL locking provider](../../third_party/medusa/upstream/packages/modules/providers/locking-postgres/src/services/advisory-lock.ts)

## Outcome To Establish

Decide whether another workflow needs an additional capability at all.
If it does, define its observable guarantee and concurrency/recovery proof before
selecting an API or storage design. Task attempt leases and resource locks must
not be treated as interchangeable, and database locks must not span workflow
pauses or external effects.
