# DTE07 Private Task Run Query Preflight

Status: bounded implementation checkpoint completed privately on 2026-08-29.
The user approved the next gate after DTE07-B1: connect the clean opaque
`TaskRun` handle to the authoritative single-run projection. This checkpoint
implements only the production-inert point-query service and clean
`inspectTask(run)` operation.

Evidence snapshot: 2026-08-29 current repository state at commit `37baee82`.

## Decision

Add one unversioned `TaskRunQuery` Effect service to
`@flarex/durable-task/internal/run-projection`. Its live Layer captures one
already constructed `ApplicationTaskSystemRunAttemptStoreShape`, calls that
store's exact `inspectRunAttempt` operation, and passes the decoded snapshot to
`projectTaskRun()`.

Add one internal `StandardApplicationTaskRunQuery` bridge to
`@flarex/standard-application-invocation`. It adapts the durable service to the
existing invocation-owner boundary without adding query policy. Add
`inspectTask(run)` to the clean `@flarex/application-invocation` root. It first
verifies the opaque process-local `TaskRun` handle through its existing WeakMap
owner, then supplies only the handle's immutable run ID to that invocation
bridge.

```text
opaque TaskRun handle
  -> process-local authenticity inspection
  -> Standard Application invocation query bridge
  -> current durable TaskRunQuery Effect service
  -> captured located-scope Application Task store
  -> scope-qualified authoritative point read
  -> projectTaskRun
  -> TaskRunProjection
```

`inspectTask()` is an observation operation. It does not deliver, wait, load a
result body, decode the Task output, cancel, retry, schedule, or subscribe.

## Ownership And Authorization

The owners remain distinct:

- `@flarex/application-invocation` owns the clean operation and opaque
  `TaskRun<Output>` handle;
- `@flarex/standard-application-invocation` owns the narrow integration bridge
  between the clean facade and the durable query capability;
- `@flarex/durable-task` owns the host-neutral query service and safe
  projection;
- the existing Application Task store owns captured trusted-scope authority,
  row qualification, database time, stored-data decoding, aggregate/ledger
  correlation, and stale-authority rejection; and
- `@flarex/persistence-postgres` remains the live database adapter owner.

The clean package does not depend directly on `@flarex/durable-task` and
exports no raw-run-ID query. A forged structural object
fails at the existing opaque-capability inspection before the query service is
acquired or invoked. This remains a defect/programmer error, matching clean
function and Task-reference handling; it is not normalized into a recoverable
database error.

The Standard bridge Layer constructs the durable query Layer for one captured
located scope. It must not be shared
across tenant scopes or installed as a module-global service. Separate scopes
require separate Effect contexts/Layers. The query accepts no task ID,
runtime-target hash, database locator, deployment selector, or alternate
identifier that could bypass the store's run-ID-and-scope qualification.

## Error Contract

The query service returns the exact existing
`TaskSystemRunAttemptStoreErrorV1` union under the unversioned alias
`TaskRunQueryError`. `inspectTask()` exposes the same channel as
`InspectTaskError`.

- unavailable, corruption, stale-scope, transient-store, and terminal-store
  failures retain their original tagged instance and fields;
- the adapter does not wrap, rewrite, log, retry, or collapse those failures;
- defects and interruption remain outside the typed failure channel; and
- transient retry policy remains with a later host/client boundary because the
  adapter cannot decide caller deadline or retry budget.

## Service And Layer Shape

`TaskRunQuery` and its policy-free Standard invocation bridge are narrow Effect
capabilities with one method:

```ts
inspect(runId): Effect<TaskRunProjection, TaskRunQueryError>
```

The implementation is a named `Effect.fn`. `Layer.succeed` is correct because
construction only captures an already-created lifecycle-free store port; it
does not execute a read during Layer construction. The business read occurs
only when `inspect()` is run.

The service requirement remains visible in `inspectTask()`'s Effect `R`
channel until a host or test supplies the Layer. No nested runtime bridge or
deep `Effect.provide` is added.

## Validation

Focused proof must cover:

1. the query service supplies exactly `inspect_current_attempt` and the clean
   handle's run ID to the captured store;
2. the returned value is exactly the owned DTE07-B1 projection;
3. each upstream store failure is propagated by identity with no retry;
4. a forged TaskRun defects before service lookup or store invocation;
5. the application root exports only the plain `inspectTask` addition and no
   System, store, projection helper, or raw-ID API;
6. an existing Application PGlite lifecycle fixture traverses the new query
   Layer and returns the scope-qualified authoritative state; and
7. package typechecks, focused tests, boundary checks, Oxlint gates, and both
   standing reviews pass before commit.

No new SQL, transaction, locking, or migration claim is made. Genuine
PostgreSQL is not required for this composition-only checkpoint; the existing
store retains its separately proven PostgreSQL behavior.

## Stop

The private query service, Standard invocation bridge, clean `inspectTask()`
operation, focused unit/PGlite proof, package and lockfile updates, validation,
and review are complete. Stop at this boundary.

Do not add `awaitTask()`, result-body authorization/loading, output decoding,
cancellation, list/cursor/event APIs, live invalidation, polling, HTTP routes,
SDK compatibility, deployment, or production activation in this checkpoint.
