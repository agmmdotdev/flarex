# Durable Operations And Recovery

Status: preflight pending. This is a general capability outline; the
[folder index](./README.md) owns scope and the one-capability-at-a-time process.

## Purpose

Retain enough operation progress and results to resume useful work and reconcile
uncertain side effects without duplicating committed mutations.

## Questions For Preflight

- What does the existing Task and external-effect evidence already establish?
- What additional progress or result information does a workflow require?
- Which owner may record or reconcile an operation, and how is stale execution
  rejected?
- How is a business commit correlated with its recorded operation outcome when
  a response or subsequent checkpoint is lost?
- Where does the chosen contract require atomic recording, and where can an
  existing authoritative outcome be recovered?
- How long must results and deduplication evidence survive, and what happens
  after expiry? How are record counts and payload sizes bounded?

## Starting Sources

- [Identity and replay](./01-execution-identity-and-replay.md)
- [Task system persistence](../durable-task-engine/04-task-system-api-and-postgres.md)
- [Task external-effect authority](../../packages/persistence-postgres/src/taskExternalEffectAuthority.ts)
- [Existing settlement reconciliation](../durable-task-engine/preflight/45-dte06-task-mutation-settlement-reconciliation.md)

## Outcome To Establish

A bounded operation-recording and recovery contract that reuses existing
evidence where appropriate and distinguishes operation progress from Task
lifecycle authority. Select proofs for lost responses, restart, conflicting
replay, concurrent attempts, and expiry before choosing a storage layout.
