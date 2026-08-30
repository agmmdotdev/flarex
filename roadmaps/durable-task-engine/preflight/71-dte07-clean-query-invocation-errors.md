# DTE07 Clean Query Invocation Errors

Status: bounded implementation checkpoint completed privately on 2026-08-31.
The user approved the next clean-API slice after foreground Action failures:
clean the `runQuery()` owner failure channel without entering Mutation or
query-sync work.

## Decision

Replace the direct Standard Query System error union in the clean root
signature:

```ts
type RunQueryError =
  | QueryInvocationError
  | ApplicationQueryResultContractError;
```

`ApplicationQueryResultContractError` remains the separate local failure for a
successful owner value that disagrees with the typed reference. The
authoritative Query System channel becomes one unversioned Application-owned
error:

```ts
type QueryInvocationError = {
  readonly _tag: "QueryInvocationError";
  readonly operation: "runQuery";
  readonly reason: QueryInvocationErrorReason;
  readonly cause: unknown;
};
```

Its reasons are `invalidInput`, `invalidIdentity`, `queryNotFound`,
`applicationUnavailable`, `invalidConfiguration`, `incompatibleRuntime`,
`indexUnavailable`, `historyUnavailable`, `budgetExceeded`,
`applicationError`, `executionFailed`, `unavailable`, `corruptData`,
`staleScopeAuthority`, `transient`, `terminal`, and `settlementUncertain`.
The exact Standard, persistence, host, protocol, or transaction failure remains
the opaque `cause`.

## Invocation Boundary

The operation order remains exact:

```text
authenticate the typed Query reference
  -> invoke the Query System once with typed arguments and optional identity
  -> translate only its typed failure channel
  -> validate and return the successful value
```

The facade does not normalize or manufacture identity authority. It forwards
the optional identity unchanged so the existing owner remains the sole
validator. The translation does not pre-read status, retry, recover, log,
convert defects or interruption into typed failure, or alter request Scope.

The result-contract failure remains separate because it describes disagreement
between a successful authoritative result and the caller's opaque local
reference, not a Query System execution failure.

## Mapping

| Owner condition | Clean reason |
| --- | --- |
| invalid function, arguments, or protocol input | `invalidInput` |
| invalid execution identity | `invalidIdentity` |
| selected Query missing | `queryNotFound` |
| no ready active Application | `applicationUnavailable` |
| invalid composition, target, port, or configuration | `invalidConfiguration` |
| unsupported target or function/runtime mismatch | `incompatibleRuntime` |
| required index missing or unavailable | `indexUnavailable` |
| required historical state unavailable | `historyUnavailable` |
| Query snapshot budget exceeded | `budgetExceeded` |
| explicit application error | `applicationError` |
| user code or callback execution failure | `executionFailed` |
| unavailable persistence, source, host, or catalog owner | `unavailable` |
| corrupt stored state, schema, request, result, or composition data | `corruptData` |
| changed scope, execution, schema, or readiness authority | `staleScopeAuthority` |
| retry-classified resource, activation, readiness, or definition conflict | `transient` |
| timeout or terminal execution failure | `terminal` |
| decision-uncertain transaction or callback cleanup | `settlementUncertain` |

The projector is exhaustive over the exact `InvokeApplicationQueryError`
contract. A future top-level owner variant, or a future reason in a nested
family that the projector interprets, fails compilation until this clean
boundary makes an explicit classification decision. Direct owner tags whose
internal fields do not affect classification are covered as an exhaustive tag
record instead of duplicating irrelevant nested policy.

## Ownership

- `@flarex/application-invocation` owns typed-reference admission,
  completed-result validation, the clean error, and the single facade
  translation;
- `@flarex/standard-application-invocation` retains Query composition,
  snapshot, active-selection, Worker execution, and read orchestration;
- persistence retains scope, transaction, schema, index, history, and catalog
  authority; and
- the backend host retains Worker execution and callback boundaries.

No new read, transaction, synchronization, recovery, fallback, dual path,
route, public SDK, deployment, or production authority is added.

## Proof Gate

Focused projection tables cover every current top-level owner variant, every
nested reason family interpreted by the projector, retry and
transaction-decision branches, every clean reason, and exact cause identity.
The live facade test proves one translation and no retry. Existing tests
continue to prove typed arguments, optional identity forwarding, request Scope
ownership, and local result validation.

Package and system-test typechecks, the full application-invocation suite,
boundary checks, Oxlint gates, and both standing reviews must pass before
commit.

## Stop

Stop after read-only Query owner failures are clean. Do not add Mutation error
projection, query synchronization, subscriptions, live invalidation, retries,
public or production Query surfaces, or another invocation authority in this
checkpoint.
