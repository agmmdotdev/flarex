# Execution Identity And Replay

Status: preflight pending. This is a general capability outline; the
[folder index](./README.md) owns scope and the one-capability-at-a-time process.

## Purpose

Make resumed work distinguish the same logical operation from a new operation,
without tying native identities to Product or Medusa.

## Questions For Preflight

- What identities already exist for runs, attempts, callbacks, and commands?
- How should operation occurrences remain stable across retries, branches,
  repeated steps, nested workflows, and any admitted parallel execution?
- How are stable identity and exact-request equivalence kept distinct?
- Which code, definition, installation, and authorization bindings must remain
  compatible when a run resumes?
- Which inputs, read results, or decisions need to be retained for replay?
- What bounds, retention, and cleanup obligations follow from those choices?

## Starting Sources

- [Task identity and scope](../durable-task-engine/02-task-definition-identity-and-scope.md)
- [Existing Task mutation replay](../durable-task-engine/preflight/44-dte06-task-mutation-callback-and-replay.md)
- [Task mutation identity protocol](../../packages/flarex-protocol/src/application-task-mutation-callback-v1.ts)

## Outcome To Establish

A recommended identity and replay contract, its owner, and focused examples of
exact replay, contradictory reuse, repeated operations, and revision changes.
Decide how it relates to existing ordinals before selecting API or storage
changes. The scenarios should be testable without importing Medusa.
