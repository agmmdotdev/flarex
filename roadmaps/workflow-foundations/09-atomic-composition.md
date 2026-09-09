# Atomic Composition

Status: preflight pending. This is a general capability outline; the
[folder index](./README.md) owns scope and the one-capability-at-a-time process.

## Purpose

Assess when several bounded local operations can use one existing Flarex
transaction and what that means within a larger durable workflow.

## Questions For Preflight

- Which operations are already able to share an admitted transaction owner?
- What validation, hooks, reads, events, and side effects constrain grouping?
- How does one atomic group relate to recorded workflow operations and replay?
- Which failures require rollback and which already-committed work may require
  compensation? How is duplicate cleanup avoided?
- How are pending-write visibility, resource bounds, interruption, and uncertain
  settlement preserved?
- Would grouping change retained Medusa behavior, and how should any intended
  difference be selected and tested?

## Starting Sources

- [Framework transaction profiles](../flarexdb-framework-integration/preflight/14-transaction-execution-profiles.md)
- [Shared transaction core](../shared-transaction-core/README.md)
- [Commerce nested command contract](../../packages/persistence-postgres/src/commerceTransaction/commands.ts)
- [Cancellation and compensation](./04-cancellation-and-compensation.md)

## Outcome To Establish

Decide whether the first integration needs new composition support or can reuse
an existing command boundary. Any accepted grouping needs explicit guarantees
and compatibility evidence. Local module placement alone does not make an
arbitrary workflow atomic; no universal transaction API or mixed OCC execution
model is selected by this topic.
