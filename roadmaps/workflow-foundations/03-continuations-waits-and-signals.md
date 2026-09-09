# Continuations, Waits, And Signals

Status: preflight pending. This is a general capability outline; the
[folder index](./README.md) owns scope and the one-capability-at-a-time process.

## Purpose

Assess native support for work that must stop executing and resume later, after
a time condition or an external signal, without retaining a worker or database
transaction for the wait.

## Questions For Preflight

- Which pause/resume behaviors are needed by the first supported use cases?
- How should continuation ownership relate to the current Task run and attempt
  lifecycle, scheduling, and recovery contracts?
- What establishes a durable wake condition and prevents lost or duplicate work?
- How are early signals, duplicate signals, cancellation, and expiry resolved?
- Who may signal a waiting execution, with what scope and payload limits?
- How should waits affect attempt counts, retry policy, execution duration,
  retention, and result observation?

## Starting Sources

- [Durable operations](./02-durable-operations-and-recovery.md)
- [Current Task lifecycle](../durable-task-engine/03-run-attempt-engine.md)
- [Scheduling and repair](../durable-task-engine/05-cloudflare-wake-and-scheduling.md)
- [Existing await operation](../durable-task-engine/preflight/55-dte07-clean-task-await-contract.md)

## Outcome To Establish

Decide the smallest useful continuation contract and any required lifecycle
changes. Distinguish durable suspension from retry delay and caller-side result
polling. Select restart and wake-race proofs; do not assume a public sleep or
signal API, or a particular new Task state, in advance.
