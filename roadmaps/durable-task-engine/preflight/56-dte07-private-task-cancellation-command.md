# DTE07 Private Task Cancellation Command Preflight

Status: implementation checkpoint approved on 2026-08-29.

Evidence snapshot: 2026-08-29 current repository state at commit `3ef7cc0d`.

## Decision

Add one private, unversioned Standard Application service that submits an
exact cancellation request to the existing scope-bound Application run-attempt
lifecycle:

```ts
requestStandardApplicationTaskCancellation(runId, reason)
  : Effect<LifecycleReceipt, RunAttemptLifecycleError,
      StandardApplicationTaskCancellation>
```

The service accepts only the authoritative Task run ID and the lifecycle-owned
cancellation reason. Its live Layer captures one
`ApplicationTaskSystemRunAttemptStoreShape`, constructs the existing
`makeApplicationRunAttemptLifecycleV1(store)` capability once, and delegates
exactly one `request_cancellation` command.

This is the command adapter beneath a later clean `cancelTask()` operation. It
is not itself the clean operation and is not a public contract.

## Authority And Atomicity

The adapter does not inspect a run before requesting cancellation. The existing
Application lifecycle and its captured store transaction remain the sole
authority for deciding whether the request:

- records cancellation against an active attempt;
- terminally cancels a run that has no active attempt;
- replays an already accepted request idempotently; or
- observes an already requested or terminal run as current.

The adapter therefore introduces no time-of-check/time-of-use race, state
machine, generation allocator, retry policy, or provider cancellation path.
Requested delivery effects remain outputs of the authoritative lifecycle
transaction and are processed by their existing owners.

## Contract

The private service:

- accepts `TaskRunIdV1` and `TaskCancellationReasonV1`;
- constructs `{ type: "request_cancellation", runId, reason }` internally;
- returns the exact
  `ApplicationTaskSystemRunAttemptTransactionReceiptV1<ApplicationRequestCancellationOutcomeV1>`;
- preserves `RunAttemptLifecycleErrorV1` values by identity; and
- requires only the captured Standard service in the Effect environment after
  Layer construction.

It does not accept Application scope, tenant, locator, attempt ID, attempt
number, execution fence, cancellation generation, provider, database, or
transaction capabilities from the caller.

## Ownership

- `@flarex/durable-task` retains cancellation state, decision policy,
  transaction effects, receipt, and failure authority;
- `@flarex/standard-application-invocation` owns only the scope-captured command
  bridge used by a host composition root; and
- `@flarex/application-invocation` will separately own future clean handle
  authentication, ergonomic reason input, and clean outcome projection.

No provider, persistence, host, system-test, or clean facade package gains a
second cancellation decision.

## Validation

Focused proof must cover:

1. exact construction of one `request_cancellation` transaction for the given
   run and reason;
2. receipt identity and nested lifecycle outcome preservation;
3. typed lifecycle/store failure identity without retry or logging;
4. independent Layers dispatching the same run ID only through their captured
   stores;
5. an exact import admission for this one Standard adapter;
6. focused tests, package typecheck, boundary checks, Oxlint gates, and both
   standing reviews before commit.

## Stop

Stop after the private Standard command service, its Layer, tests, boundary
receipt, roadmap updates, validation, review, and commit.

Do not add `cancelTask()`, clean reason normalization, handle authentication,
clean outcome types, provider calls, cancellation delivery, routes,
subscriptions, public SDK APIs, deployment, or production activation in this
checkpoint.
