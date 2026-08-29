# DTE07 listed Task-run reference

Status: implementation checkpoint completed privately on 2026-08-30.

Depends on the clean production-inert `listTaskRuns()` facade completed by
`b960668c` and the clean scope-authorized `inspectTask(run)` operation completed
under preflight 52. This checkpoint composes those two accepted owners. It adds
no query service, persistence operation, SQL, route, deployment, attempt,
event, result-body, wait, or command authority.

## Decision

Each item returned by `listTaskRuns()` contains:

```ts
interface ListedTaskRun {
  readonly ref: TaskRunRef;
  readonly status: TaskRunStatus;
}
```

`TaskRunRef` is a frozen process-local opaque identity. `inspectTask()` accepts
either an admitted typed `TaskRun<Output>` or an issued `TaskRunRef`. Both forms
resolve to the existing scope-captured point-query owner. Issuance captures the
exact point-query service installed beside the list service, and inspection
requires that identical service capability. Arbitrary run-ID strings,
structural lookalikes, and a genuine reference moved into another captured
scope remain inadmissible.

## Authority Boundary

A listed reference grants only authority to refresh the redacted status already
available through the captured list scope. It is not a `TaskRun<Output>` and
does not capture a Task definition, output validator, creation receipt, or
command admission. Consequently it cannot be passed to `readTaskResult()`,
`awaitTask()`, or `cancelTask()`.

The reference has no enumerable runtime fields. Its run ID and exact query
capability are held in a private WeakMap and can be recovered only by the
Application invocation owner. Its runtime constructor requires an inaccessible
module-owned issuance token, so escaping that constructor through the handle's
prototype does not create a second issuance path. Consequently
`listTaskRuns()` now requires the point-query service beside its existing list
service. It is not a wire, durable, HTTP, SDK, serializable, or cross-process
contract.

The listed status remains the exact existing frozen/redacted projection by
identity. Only the containing listed-item object and its opaque reference are
new allocations.

## Failures And Effect Boundary

Authenticity and exact service identity are invariant checks before query I/O.
A forged typed handle, forged listed reference, or genuine reference presented
under a different point-query scope defects with the existing `TypeError`
rather than entering the typed query failure channel. A genuine reference
delegates once to the existing `StandardApplicationTaskRunQuery`; its typed
failures, interruption, scope authorization, projection, and redaction remain
unchanged.

No new service or Layer is introduced. Reference issuance and inspection are
pure package-owned capability mechanics around the existing Effect operation.

## Proof Gate

Focused tests must prove that list items preserve status identity, references
are frozen and fieldless, a genuine listed reference refreshes the exact run
through `inspectTask()`, a forgery defects before query I/O, a genuine reference
cannot cross into another query scope even when the run ID is identical, and
the runtime constructor cannot issue an alternate reference. TypeScript rejects
listed references at result, await, and cancellation operations. The package
typecheck, full package tests, boundary checker, lint gates, and both standing
reviews must pass before commit.

## Stop

Stop after this read-only identity composition, tests, roadmap receipts,
validation, review, and commit. Attempt history and lifecycle events may use
this reference in a later separately approved read-only gate. Do not add those
queries now, and do not add result-body, waiting, cancellation, serialization,
routes, deployment, live invalidation, public SDK, or production activation.
