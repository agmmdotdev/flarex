# DTE07 clean Task result-read errors

Status: implemented privately on 2026-08-30.

This checkpoint extends the clean Task read-error boundary completed under
preflight 66 to `readTaskResult()`. It changes no lifecycle authorization,
result-object lookup, decoding, output validation, retry, route, deployment,
or production behavior.

## Decision

`readTaskResult()` now exposes:

```ts
type ReadTaskResultError =
  | TaskReadError<"readTaskResult">
  | ApplicationTaskResultContractError;
```

The first member translates the private Standard result-query union once into
the shared clean `TaskReadError` shape. The second remains distinct because it
means the authoritative result body was successfully read but disagreed with
the local typed Task reference. That mismatch continues to retain the body and
validator issue so completed durable work is not hidden.

The clean result-read reasons are:

- run-attempt store errors reuse `unavailable`, `corruptData`,
  `staleScopeAuthority`, `transient`, and `terminal`;
- lifecycle authorization maps `run_incomplete`, `run_not_succeeded`, and
  `result_absent` to `runIncomplete`, `runNotSucceeded`, and `resultAbsent`;
- a missing object for an existing commitment is `resultNotFound`, kept
  distinct from a run whose lifecycle record has no commitment;
- result-store resource failure is `unavailable`;
- invalid internal commitment or stored-body corruption is `corruptData`; and
- immutable-store settlement uncertainty is `settlementUncertain`.

Every clean error retains the exact owner failure by identity as its opaque
`cause`. It carries the clean run ID from the authenticated `TaskRun` handle;
no result commitment, object key, digest, bucket, or locator becomes part of
the clean typed contract.

## Ownership And Effect Semantics

The durable result query still owns lifecycle readability. The backend result
store still owns content-addressed object integrity and availability. The
Application facade owns only the clean translation and output-contract check.

The translation is an `Effect.mapError` at the facade boundary. It does not
retry, log, recover, or convert defects and interruption into typed failures.
`awaitTask()` receives the already-clean `ReadTaskResultError` after a
succeeded status observation and forwards it without another translation.

An authenticated handle remains mandatory. A forged `TaskRun` still defects
before result service lookup, option handling, or I/O.

## Proof Gate

Focused proofs cover all five run-attempt store tags, all three lifecycle
availability reasons, and all five result-store tags. Each case pins operation,
clean run ID, reason, and exact cause identity. Integration tests prove
`readTaskResult()` maps once without retry and `awaitTask()` forwards that clean
failure once. Existing output-contract mismatch and forged-handle proofs remain
green.

Package and system-test typechecks, focused tests, boundary checks, Oxlint
gates, and both standing reviews must pass before commit.

## Stop

Stop after result-read failures are clean. Task admission errors were cleaned
later under preflight 68; cancellation-command errors remain a separate slice.
Those command families have different authority and uncertainty semantics.
