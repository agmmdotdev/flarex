# DTE07 Private Task Result Body Query Preflight

Status: bounded implementation checkpoint completed privately on 2026-08-29.
After the completed DTE07-C1 point query, the user approved the next
prerequisite for a future `awaitTask()`: authorize and load one committed
result body without adding waiting or output decoding.

Evidence snapshot: 2026-08-29 current repository state at commit `8e67c9eb`.

## Decision

Add one unversioned `TaskRunResultQuery` Effect service to
`@flarex/durable-task`. Its live Layer captures one already constructed
Application Task run-attempt store for one trusted scope. `authorizeRead(runId)`
performs the same scope-qualified authoritative inspection used by the point
query and returns an owned `TaskResultCommitmentV1` only when the run is
terminal, succeeded, and carries a result commitment.

Add one unversioned `TaskResultBodyQuery` service to `flarex-backend`. Its live
Layer requires `TaskRunResultQuery`, captures one existing `TaskResultStore`,
and implements exactly this order:

```text
trusted run ID within captured Application scope
  -> authoritative result-read authorization
  -> owned immutable result commitment
  -> existing content-addressed TaskResultStore read
  -> canonical Flarex runtime value
```

Add a narrow `StandardApplicationTaskResultQuery` bridge under
`@flarex/standard-application-invocation`. Its Layer composes the durable
authorization Layer and backend body Layer from host-supplied scope and result
store capabilities. This is the common private composition seam for later test
and production hosts. No clean root operation is added in this checkpoint.

## Ownership And Authorization

- `@flarex/durable-task` owns the lifecycle decision that a result commitment
  is currently readable for one scope-qualified run;
- `@flarex/persistence-postgres` retains scope qualification, database-time
  observation, stored aggregate decoding, and stale-authority rejection;
- `flarex-backend` retains immutable result-object lookup, size/digest checks,
  canonical Flarex value decoding, and R2/resource failures;
- `@flarex/standard-application-invocation` owns only the private integration
  bridge that testing and later production composition can provide; and
- `@flarex/application-invocation` remains unchanged until a separately
  approved output-decoding and waiting contract exists.

The body query accepts only a trusted run ID. It never accepts a caller-supplied
commitment, digest, object key, bucket, task ID, deployment selector, runtime
target, or database locator. Therefore an alternate identifier cannot bypass
the captured scope inspection. The raw aggregate and object key remain private.

The authorized commitment is freshly owned: its record is frozen and its
mutable digest bytes are copied. It is never reconstructed from the safe
hexadecimal projection returned by `inspectTask()`.

## Availability And Error Contract

`TaskRunResultUnavailableError` is a typed durable-domain failure with the
requested run ID and one reason:

- `run_incomplete` for ready, granted, executing, or retry-waiting state;
- `run_not_succeeded` for terminal failed or cancelled state; or
- `result_absent` for terminal success without a result commitment.

The authorization error union also retains every existing
`TaskSystemRunAttemptStoreErrorV1` instance without wrapping, retrying, logging,
or message rewriting. The backend body query then adds the existing exact
`TaskResultStoreError` union and likewise propagates it unchanged. Defects and
interruption remain outside the typed failure channel.

No retry policy is added. A caller deadline and retry budget belong to the
later waiting or host boundary; immutable reads are retryable only when that
owner explicitly chooses a bounded policy.

## Service And Layer Shape

```ts
TaskRunResultQuery.authorizeRead(runId)
  : Effect<TaskResultCommitmentV1, TaskRunResultQueryError>

TaskResultBodyQuery.read(runId)
  : Effect<CanonicalFlarexRuntimeValueV1, TaskResultBodyQueryError>
```

All reusable methods are named `Effect.fn` operations. The durable Layer uses
`Layer.succeed` because it captures an already-created lifecycle-free store.
The backend and Standard bridges use `Layer.effect` only to close service
requirements; Layer construction performs no query or object read.

Each Layer instance belongs to one trusted Application scope and one host-owned
result store. It must not be promoted to a module-global cross-scope service.

## Validation

Focused proof must cover:

1. authorization supplies exactly `inspect_current_attempt` and the requested
   run ID to the captured store;
2. every non-readable lifecycle class maps to its exact availability reason;
3. a readable commitment is detached from mutable stored digest bytes;
4. every upstream store failure is propagated by identity without retry;
5. the body reader authorizes before touching the result store and passes only
   the authorized commitment;
6. authorization and result-store failures short-circuit the later operation
   and retain identity;
7. the Standard bridge closes the two private Layers without adding policy;
8. the existing PGlite lifecycle fixture traverses the new authorization Layer;
9. package typechecks, focused tests, boundary checks, Oxlint gates, and both
   standing reviews pass before commit.

The existing TaskResultStore unit and Miniflare proofs continue to own R2,
canonical value, size, digest, and corruption behavior. This composition-only
checkpoint adds no SQL, object-store implementation, transaction, locking,
migration, or real-Cloudflare claim.

## Stop

The private durable authorization service, backend body reader, Standard
composition bridge, focused unit/PGlite proof, and boundary updates are
complete. Stop at this boundary after validation, review, and commit.

Do not add `awaitTask()`, polling, sleep, result output validation, typed output
decoding, terminal failure projection, cancellation, list/cursor/event APIs,
HTTP routes, SDK compatibility, deployment, or production activation in this
checkpoint.
