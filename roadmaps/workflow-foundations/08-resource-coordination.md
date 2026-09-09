# Resource Coordination

Status: preflight pending. This is a general capability outline; the
[folder index](./README.md) owns scope and the one-capability-at-a-time process.

## Purpose

Determine when different workflow executions need coordination over the same
resource, and whether existing transaction protection or an additional native
capability supplies the required guarantee.

## Questions For Preflight

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
- [Pinned Medusa lock step](../../third_party/medusa/upstream/packages/core/core-flows/src/locking/steps/acquire-lock.ts)
- [Pinned PostgreSQL locking provider](../../third_party/medusa/upstream/packages/modules/providers/locking-postgres/src/services/advisory-lock.ts)

## Outcome To Establish

Decide whether the selected workflow needs an additional capability at all.
If it does, define its observable guarantee and concurrency/recovery proof before
selecting an API or storage design. Task attempt leases and resource locks must
not be treated as interchangeable, and database locks must not span workflow
pauses or external effects.
