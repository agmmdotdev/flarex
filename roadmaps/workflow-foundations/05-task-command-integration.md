# Task Command Integration

Status: preflight pending. This is a general capability outline; the
[folder index](./README.md) owns scope and the one-capability-at-a-time process.

## Purpose

Let durable execution invoke admitted command owners, including commerce,
without exposing raw persistence or changing the commands' transaction profiles.
Product can provide the first commerce example without defining the native API.

## Questions For Preflight

- Which existing Task callback, invocation, and outcome contracts can be reused?
- What additional commerce participation is required, and who owns its adapter?
- How are command selection, principal, scope, installation, execution lease,
  and operation identity authenticated?
- How are deadlines, cancellation, fresh scoped services, and cleanup composed?
- How do exact replay, uncertain settlement, unavailable outcomes, and binding
  changes propagate to the workflow?
- Which shared mechanics justify reuse, and which differences require separate
  Application and commerce contracts?

## Starting Sources

- [Identity](./01-execution-identity-and-replay.md) and [recovery](./02-durable-operations-and-recovery.md)
- [Existing Application Task mutation authority](../../packages/standard-application-invocation/src/ApplicationTaskMutationAuthority.ts)
- [Commerce command contract](../../packages/persistence-postgres/src/commerceTransaction/commands.ts)
- [Commerce host](../../packages/persistence-postgres/src/commerceTransaction/host.ts)
- [Shared transaction ownership](../shared-transaction-core/README.md)

## Outcome To Establish

A scoped command integration contract with no competing commit authority.
Choose a small real command proof for success, rollback, lost response, stale
execution, and contradictory replay before importing a complete Medusa workflow.
Generalization must preserve each command owner's actual guarantees.
