# DTE07 Clean Action Invocation Errors

Status: bounded implementation checkpoint completed privately on 2026-08-30.
The user approved the next clean-API slice after Task cancellation failures:
clean the remaining `runAction()` owner failures without entering Query or
Mutation cleanup.

## Decision

Replace the direct Standard Action System error union in the clean root
signature:

```ts
type RunActionError =
  | ApplicationRequestKeyError<"runAction">
  | ApplicationActionResultContractError
  | ActionInvocationError;
```

The first two errors retain their existing narrow ownership:

- `ApplicationRequestKeyError<"runAction">` rejects a caller-invalid request
  key before Action I/O; and
- `ApplicationActionResultContractError` rejects a completed value that does
  not satisfy the local typed reference after the owner reports completion.

The authoritative Action System failure channel becomes one unversioned
Application-owned error:

```ts
type ActionInvocationError = {
  readonly _tag: "ActionInvocationError";
  readonly operation: "runAction";
  readonly reason: ActionInvocationErrorReason;
  readonly cause: unknown;
};
```

Its reasons are `invalidInput`, `actionNotFound`, `applicationUnavailable`,
`idempotencyConflict`, `invalidConfiguration`, `incompatibleRuntime`,
`applicationError`, `executionFailed`, `unavailable`, `corruptData`,
`staleScopeAuthority`, `transient`, `terminal`, and `settlementUncertain`.
The exact Standard, persistence, host, protocol, or evidence error remains the
opaque `cause`.

## Invocation Boundary

The operation order remains exact:

```text
authenticate the typed Action reference
  -> normalize the request key
  -> invoke the Action System once
  -> translate only its typed failure channel
  -> preserve a non-completed outcome as success
  -> validate and return a completed value
```

The translation does not inspect status first, retry, log, recover, repeat the
external effect, convert defects or interruption into typed failure, or alter
Scope ownership.

`status: "notCompleted"` remains a successful `ActionResult`. Its failed,
uncertain, or cancelled lifecycle is authoritative Action outcome data and is
not an `ActionInvocationError`. A completed result that disagrees with the
local reference remains the separate result-contract error.

## Mapping

| Owner condition | Clean reason |
| --- | --- |
| invalid caller or protocol input, including bounds | `invalidInput` |
| selected Action missing | `actionNotFound` |
| no ready active Application | `applicationUnavailable` |
| request-key replay conflict | `idempotencyConflict` |
| invalid composition, host policy, or configuration | `invalidConfiguration` |
| runtime host or compatibility mismatch | `incompatibleRuntime` |
| explicit application error | `applicationError` |
| user Action code failure | `executionFailed` |
| unavailable persistence, host, evidence, or source owner | `unavailable` |
| corrupt stored state, evidence, request, result, or composition data | `corruptData` |
| changed scope, execution, subject, or readiness authority | `staleScopeAuthority` |
| retry-classified resource, readiness transaction, or lifecycle conflict | `transient` |
| timeout or terminal execution failure | `terminal` |
| decision-uncertain readiness transaction, evidence publication, callback cleanup, or settlement | `settlementUncertain` |

The projector is exhaustive over the exact `InvokeApplicationActionError`
contract. A future owner variant or reason fails compilation until this clean
boundary makes an explicit classification decision.

## Ownership

- `@flarex/application-invocation` owns typed-reference admission, caller
  request-key validation, completed-result validation, the clean error, and the
  single facade translation;
- `@flarex/standard-application-invocation` retains foreground Action
  admission, replay, execution, settlement, and uncertainty orchestration;
- persistence retains active selection, scope, idempotency, and durable
  invocation authority;
- the backend host retains Worker execution, callback, outbound effect, and
  capability-session authority; and
- protocol and evidence owners retain canonical encoding and immutable body
  storage contracts.

No new execution authority, fallback, dual path, retry policy, generic
`invoke()`, Task capability, route, public SDK, deployment, or production
activation is added.

## Proof Gate

Focused projection tables cover every nested reason family whose meaning
changes the clean classification, every clean reason, exact cause identity,
and all transaction settlement outcomes. The live facade test proves one
translation and no retry. Existing tests continue to prove request-key
short-circuiting, completed and non-completed result preservation, and local
completed-result validation.

Package and system-test typechecks, the full application-invocation suite,
boundary checks, Oxlint gates, and both standing reviews must pass before
commit.

## Stop

Stop after foreground Action owner failures are clean. Do not add Action
delivery, nested Action calls, retries, waiting, cancellation, public or
production Action surfaces, or clean Query/Mutation errors in this checkpoint.
