# Task Command Integration

Status: the trusted workflow Task binding, run creation and lifecycle prerequisite
is implemented privately. Commerce invocation, execution-subject issuance and
continuation admission below remain pending. This
is a general capability outline; the
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
- [Commerce command contract](../../packages/persistence-postgres/src/frameworks/commerceTransaction/commands.ts)
- [Commerce host](../../packages/persistence-postgres/src/frameworks/commerceTransaction/host.ts)
- [Shared transaction ownership](../shared-transaction-core/README.md)

## Outcome To Establish

A scoped command integration contract with no competing commit authority.
Choose a small real command proof for success, rollback, lost response, stale
execution, and contradictory replay before importing a complete Medusa workflow.
Generalization must preserve each command owner's actual guarantees.

## Selected Inline Import Contract

The [inline import preflight](../flarexdb-framework-integration/preflight/109-native-inline-product-import-workflow.md)
requires a trusted workflow definition reference in the existing Task owner.
It binds immutable workflow and adapter revisions, execution profile and policy,
and scoped principal evidence. It has no fabricated Application runtime or
artifact identity. Existing Application and retained definition generations keep
their own codecs and meaning. Run creation, replay, attempts, leases and fences
continue through the existing Task owners.

The implemented binding uses the closed `trusted_workflow` definition-reference
generation and a scoped immutable binding digest. It pins one authenticated-user
principal digest. Current-reference persistence and lifecycle decisions preserve
the retained Application and legacy codecs. The
[Task storage owner](../durable-task-engine/preflight/20-task-system-storage-and-schema-contract.md#trusted-workflow-binding-prerequisite)
owns its additive storage contract. Existing compute and due-discovery profiles
refuse this generation until an authentic execution adapter is admitted.

A separately admitted `child_commerce` external effect must bind the actual
prepared commerce command, policy, captured arguments and stable run/occurrence
identity. It must not fill an Application mutation function-path field with a
synthetic target. Commerce owns its request evidence and exact committed outcome
lookup; an expired or uncertain result never permits a fresh operation key.

The actual child transaction checks the authenticated parent attempt after its
established scope entry, and again immediately before settlement. Preserve scope
authority/clock, run, then effect lock ordering. Use database wall time for the
live lease check and bound the finite child by the remaining lease and settlement
budget. A dispatch-time check alone grants no settlement authority.

This binding milestone does not admit suspension, confirmations, provider calls,
arbitrary workflows or a new scheduler. Those need their own explicit lifecycle
and eligibility contracts. The framework interpreter remains framework-owned;
Task owns durable authority rather than the native business graph.
