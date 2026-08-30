# DTE07 clean Task read errors

Status: implemented privately on 2026-08-30.

This checkpoint cleans only the typed failure boundary of the existing Task
read primitives. It does not change query execution, persistence, scope
authorization, lifecycle projection, retries, routes, deployment, or
production activation.

## Decision

All authoritative Task reads expose one application-owned error vocabulary:

```ts
type TaskReadError<Operation> = {
  readonly _tag: "TaskReadError";
  readonly operation: Operation;
  readonly runId: TaskRunId | null;
  readonly reason: TaskReadErrorReason;
  readonly cause: unknown;
};
```

The operation is one of `inspectTask`, `listTaskRuns`, `listTaskAttempts`, or
`listTaskEvents`. Point and history reads retain the clean run ID. The
scope-wide run list uses `null` because no single run owns that request.

Reasons use stable camel-case application vocabulary: `runNotFound`,
`unavailable`, `corruptData`, `staleScopeAuthority`, `transient`, `terminal`,
or `unsupported`. Internal store-contract failures become `corruptData`.
Point-query terminal integration failures become `terminal` rather than
publishing their persistence reason union. The opaque `cause` retains the
exact owner failure for diagnostics without adding its private type to the
clean API contract.

Each operation keeps its specific exported alias:

- `InspectTaskError` is `TaskReadError<"inspectTask">`;
- `ListTaskAttemptsError` is `TaskReadError<"listTaskAttempts">`;
- `ListTaskEventsError` is `TaskReadError<"listTaskEvents">`; and
- `ListTaskRunsError` remains the union of caller-owned
  `ListTaskRunsOptionsError` and `TaskReadError<"listTaskRuns">`.

`awaitTask()` continues to include `InspectTaskError` in its own union and
forwards the already-clean error without another mapping. Invalid list options
remain separate because they are caller input failures that occur before read
authority is exercised.

## Ownership And Failure Semantics

The Standard and durable services remain the source of failure truth. The
clean facade performs one exhaustive translation at its public boundary. It
does not retry, log, recover, convert defects or interruption into typed
failures, or infer a missing run from a generic point-query unavailability.

Runtime-authentication failures for forged handles, forged references, or
cross-scope references remain defects before query I/O. This checkpoint does
not weaken those capability checks into ordinary read errors.

## Proof Gate

Focused tests prove each operation crosses the clean error boundary, retains
the clean operation and run identity, preserves the exact owner failure as the
opaque cause, does not retry, and keeps list-option failures distinct. The
await test proves the clean inspection failure is forwarded once. Exhaustive
source-tag and reason switches make new owner variants a compile-time failure.

Package and system-test typechecks, focused tests, boundary checks, Oxlint
gates, and both standing reviews must pass before commit.

## Stop

Stop after Task read failures are clean. Do not clean Task admission, result,
or cancellation-command errors in this checkpoint, and do not fold Query,
Mutation, or Action errors into this Task-specific contract.
