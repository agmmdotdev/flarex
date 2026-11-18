# Continuations, Waits, And Signals

Status: general preflight pending. A narrow private trusted-workflow
continuation/checkpoint contract is implemented for the
[inline Product import](../flarexdb-framework-integration/preflight/109-native-inline-product-import-workflow.md),
whose bounded private connected profile is implemented and validated. This is a
general capability outline; the
[folder index](./README.md) owns scope and the one-capability-at-a-time process.

## Purpose

Assess native support for work that must stop executing and resume later, after
a time condition or an external signal, without retaining a worker or database
transaction for the wait.

## Selected Private Continuation

The trusted Task generation now has `continuation_waiting` and
`continuation_ready`. `makeTrustedWorkflowContinuationStore` exposes authenticated
`register`, `inspect`, `confirm`, `expire` and `cancel` operations over the
existing Task run and ledger owner. Registration atomically commits the prepared
checkpoint revision and continuation decision, preserves the suspended attempt
and acceptance anchor, and retires its lease wake. There is no executing lease,
database transaction, connection or retained worker for the wait.

The framework owns its checkpoint codec and graph. The shared
`makeTrustedWorkflowCheckpointStore` prepares copied opaque bytes, loads them
under live interpreter authority, and saves with revision CAS. The private
descriptor binds revision, SHA-256 and byte length up to 1 MiB; stored scope,
run and workflow binding must agree. Continuation inspection verifies the
stored checkpoint against its retained descriptor before returning cold state.
A missing or contradictory anchor fails closed rather than restarting work.

The inline native confirmation retains its original start/deadline and the
first accepted resolution receipt. Timeout processing requires database time
strictly greater than the deadline. Native confirmation can win after that
deadline while timeout has not yet been processed; duplicate accepted decisions
replay, and an opposing later resolution cannot replace the winner. Resolution
does not grant execution: the existing Task start/heartbeat decisions issue a
fresh attempt and authentic ordinary or control subject.

This facade binds the current authenticated principal, exact immutable workflow
binding and scope. It is not a public signal endpoint. The selected consumer uses
explicit bounded `advance`; no autonomous scheduler, hosted wake route, general
sleep API, retention policy or checkpoint garbage collector is admitted. Existing
Application and retained legacy lifecycle codecs keep their meaning.

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
polling. Select restart and wake-race proofs for further consumers; the private
states and confirmation rule above do not select a universal public sleep or
signal API.
