# DTE07 Clean Task Cancellation Errors

Status: bounded implementation checkpoint completed privately on 2026-08-30.
The user approved cleaning the remaining `cancelTask()` command failures after
Task admission errors were completed.

## Decision

Replace the direct Standard lifecycle error union in the clean root signature:

```ts
type CancelTaskError =
  | CancelTaskOptionsError
  | TaskCancellationError;
```

`CancelTaskOptionsError` continues to own caller-provided reason validation,
with the clean camel-case reason `invalidMessage`. The authoritative command
channel becomes one unversioned Application-owned error:

```ts
type TaskCancellationError = {
  readonly _tag: "TaskCancellationError";
  readonly operation: "cancelTask";
  readonly runId: TaskRunId;
  readonly reason: TaskCancellationErrorReason;
  readonly cause: unknown;
};
```

Its reasons are `invalidCommand`, `invalidState`, `unavailable`,
`corruptData`, `staleScopeAuthority`, `transient`, and `terminal`.
The exact Standard/durable owner error remains the opaque `cause`.

## Command Boundary

The existing operation order remains exact:

```text
authenticate TaskRun handle
  -> decode optional reason
  -> submit one Standard cancellation command
  -> translate only the typed command failure
  -> project a successful receipt
```

The translation uses the already-authenticated clean run ID. It does not trust
the run ID carried by a lower failure, inspect status first, retry, log,
recover, call a provider, or convert defects and interruption into typed
failures.

Already-requested and already-terminal lifecycle observations remain successful
`CancelTaskResult` values. They are not invalid-state errors.

## Mapping

| Durable owner condition | Clean reason |
| --- | --- |
| invalid lifecycle command | `invalidCommand` |
| invalid transition, conflicting completion/acknowledgement, or policy | `invalidState` |
| stale run version or execution fence | `transient` |
| exhausted lifecycle counter | `terminal` |
| unavailable run-attempt store | `unavailable` |
| invalid stored aggregate or evidence | `corruptData` |
| changed scope authority | `staleScopeAuthority` |
| retry-classified store failure | `transient` |
| unsupported or exhausted store integration | `terminal` |

The broad lifecycle union includes variants used by other lifecycle commands.
The clean projector remains exhaustive across that exact owner contract so a
future added variant fails compilation and requires an explicit decision.

## Ownership

- `@flarex/application-invocation` owns handle authentication, caller option
  validation, the clean cancellation error, and the one facade translation;
- `@flarex/standard-application-invocation` retains the scope-captured command
  service;
- `@flarex/durable-task` retains lifecycle decisions, idempotency, cancellation
  generations, requested effects, receipts, and lower failure authority; and
- persistence and delivery owners remain unchanged.

No new command authority, fallback, dual path, timeout, retry policy, route,
subscription, provider behavior, deployment, or production activation is
added.

## Proof Gate

Focused projection tests cover every current lifecycle/store error tag, clean
reason, authenticated run ID, and exact cause identity. The live facade test
proves one translation and no retry. Existing tests continue to prove handle
authentication before option decoding, invalid reason short-circuiting, all
four successful statuses, and frozen result projection.

Package and system-test typechecks, the full application-invocation suite,
boundary checks, Oxlint gates, and both standing reviews must pass before
commit.

## Stop

Stop after cancellation-command failures are clean. Do not add provider
delivery, cancellation waiting, bulk cancellation, public/production Task
surfaces, or clean Query/Mutation errors in this checkpoint. Foreground Action
invocation failures were cleaned later under preflight 70.
