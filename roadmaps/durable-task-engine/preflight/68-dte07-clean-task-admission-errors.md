# DTE07 Clean Task Admission Errors

Status: bounded implementation checkpoint completed privately on 2026-08-30.
The user approved cleaning the remaining `startTask()` owner failures after
the Task read-error checkpoints. Cancellation-command failures remain a
separate later slice.

## Decision

Keep caller-owned request-key validation separate, and replace the direct
Standard Task System failure union in the clean root signature:

```ts
type StartTaskError =
  | ApplicationRequestKeyError<"startTask">
  | TaskAdmissionError;
```

`TaskAdmissionError` is one unversioned Application-owned tagged failure:

```ts
type TaskAdmissionError = {
  readonly _tag: "TaskAdmissionError";
  readonly operation: "startTask";
  readonly reason: TaskAdmissionErrorReason;
  readonly cause: unknown;
};
```

The clean reasons are `invalidInput`, `invalidIdentity`, `taskNotFound`,
`applicationUnavailable`, `idempotencyConflict`, `invalidConfiguration`,
`incompatibleRuntime`, `unavailable`, `corruptData`,
`staleScopeAuthority`, `transient`, `terminal`, and
`settlementUncertain`.

The exact lower owner error is retained as the opaque `cause`. Standard,
durable, persistence, readiness, principal, and immutable-input-store error
types no longer appear in the public root signature.

## Translation Boundary

The translation occurs once, immediately around
`createStandardApplicationTaskRun()` in `startTask()`. Request-key decoding
still occurs first and prevents admission I/O on failure. The facade does not
retry, log, recover, inspect a full Cause, or convert defects and interruption
into typed failures.

The mapping preserves the distinctions callers need:

| Lower owner condition | Clean reason |
| --- | --- |
| non-canonical payload | `invalidInput` |
| invalid authenticated-user identity | `invalidIdentity` |
| missing selected Task definition | `taskNotFound` |
| no ready active Application | `applicationUnavailable` |
| same request key with different request evidence | `idempotencyConflict` |
| mismatched owner composition | `invalidConfiguration` |
| incompatible runtime host | `incompatibleRuntime` |
| unavailable storage, hashing, or authority port | `unavailable` |
| invalid stored evidence or bindings | `corruptData` |
| changed or mismatched scope authority | `staleScopeAuthority` |
| retry-classified database or selection failure | `transient` |
| unsupported terminal integration | `terminal` |
| uncertain publication or transaction settlement | `settlementUncertain` |

`settlementUncertain` does not claim that a run was or was not created. The
caller may repeat `startTask()` only with the same request key and equivalent
request; the existing durable replay authority decides the outcome.

## Ownership

- `@flarex/application-invocation` owns the clean error vocabulary and its one
  facade translation;
- `@flarex/standard-application-invocation` retains input publication,
  principal issuance, active selection, and run-creation composition;
- `@flarex/durable-task` retains request equivalence, idempotency conflict,
  run creation, and replay semantics;
- persistence owners retain active Application, readiness, scope authority,
  transaction, and durable run authority; and
- immutable object stores retain payload and principal publication semantics.

No lower owner is changed, and no new retry, fallback, dual path, route,
deployment, provider choice, or production activation is added.

## Proof Gate

Focused proofs cover every clean reason, all reason-dependent activation and
selection branches, located transaction uncertainty, exact cause identity,
the live `startTask()` facade translation, no retry, and the existing
request-key short circuit. Exhaustive TypeScript switching makes a newly added
tagged owner error a compile-time failure.

Package and system-test typechecks, the full application-invocation suite,
boundary checks, Oxlint gates, and both standing reviews must pass before
commit.

## Stop

Stop after admission failures are clean. Cancellation-command failures were
cleaned later under preflight 69. Do not clean Action, Query, or Mutation
errors or add public/production Task surfaces in this checkpoint.
