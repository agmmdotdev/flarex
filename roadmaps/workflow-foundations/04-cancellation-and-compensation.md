# Cancellation And Compensation

Status: preflight pending. This is a general capability outline; the
[folder index](./README.md) owns scope and the one-capability-at-a-time process.

## Purpose

Clarify how a workflow stops forward work, handles already-committed operations,
and reports or resumes incomplete cleanup. Keep business-specific undo policy
separate from native execution and database settlement.

## Questions For Preflight

- What should cancellation, permanent failure, and interrupted execution mean
  for the selected workflow contract?
- Which work has rolled back and which may require a later compensating action?
- Who determines compensation dependencies, order, and eligibility?
- How can cleanup continue under valid authority after forward work stops?
- What progress is needed to resume compensation after a crash or lost response?
- How are failed compensation, exhausted retries, unresolved outcomes, and
  operator intervention represented and observed?
- Which mechanics can serve non-Medusa workflows with the same semantics?

## Starting Sources

- [Durable operations](./02-durable-operations-and-recovery.md)
- [Task cancellation and lease races](../durable-task-engine/preflight/15-cancellation-heartbeat-lease-and-race-tables.md)
- [Pinned Medusa orchestration](../../third_party/medusa/upstream/packages/core/orchestration/src/transaction/transaction-orchestrator.ts)
- [Atomic composition discussion](./09-atomic-composition.md)

## Outcome To Establish

An explicit relationship between workflow cleanup and native Task terminal
outcomes, backed by failure and restart examples. Choose what belongs in native
capabilities and what remains workflow policy; neither automatic compensation
for every operation nor a new general saga engine is selected here.
