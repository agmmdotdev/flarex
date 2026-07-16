# Testing, Observability, And Adoption

## Current Testing Shape

The workspace uses Vitest with many explicit `Effect.runPromise` bridges.
There is currently no declared `@effect/vitest` dependency, no Effect-aware
test syntax in the inspected tests, and no located `TestClock` use. This is a
reasonable migration baseline, but it means cancellation, virtual time,
Layer wiring, release, and Cause behavior are easy to under-test.

Until a package deliberately adopts an Effect-aware test runner, keep a small
shared Promise bridge at the test boundary rather than starting manual runtimes
throughout helpers. Do not add `@effect/vitest` merely to rewrite syntax; adopt
it with the first slice that benefits from test Layers, deterministic time, or
structured concurrency assertions.

## What Effect Tests Should Prove

For an Effect-native operation, test the semantic channels separately:

- success value;
- each meaningful tagged failure and its payload;
- defects or complete Cause only when the boundary owns them;
- interruption behavior for transactions, semaphores, and fibers;
- Scope release and Layer construction failure;
- retry count, schedule, idempotency, and terminal failure;
- deterministic time behavior where time affects correctness; and
- runtime adapter translation independently from domain failure behavior.

When runtime immutability is in scope, assert freezing only if it is an API or
authority contract. Prefer ownership tests that mutate the original caller
input after capture and prove the stored snapshot remains unchanged. Exercise
nested data for deep-snapshot contracts, forged identities for opaque
capabilities, and mutable-buffer aliasing for byte boundaries. A test that only
counts freezes or checks syntax does not prove ownership safety.

Postgres persistence slices still require their focused PGlite lane and the
relevant real-Postgres correctness lane. Mock Layers cannot prove isolation,
locks, rollback, migrations, or query behavior.

## Observability

- Name meaningful operations with qualified `Effect.fn` spans.
- Add span attributes and logs at the owner of the useful context, while
  redacting document contents, credentials, grants, and other sensitive data.
- Observe already-tagged failures without rewrapping them merely to add a log.
- Observe defects and full Causes at runtime boundaries.
- Distinguish interruption, retry exhaustion, database unavailability, stored
  corruption, and expected domain rejection in metrics and logs.
- Use untraced functions only with a measured hot-path or deliberate
  instrumentation reason.

## Incremental Adoption Rule

Effect quality is an active implementation standard, but it does not authorize
unbounded cleanup. Each future slice should:

1. inspect the changed operation and directly connected flow;
2. fix bounded touched-flow debt when behavior and validation are stable;
3. avoid importing a neighboring exception-based pattern as new precedent;
4. preserve public, persistence, transaction, and trust contracts unless the
   preflight explicitly approves changing them; and
5. rerun both standing reviewers after the final significant code diff.

## Completion Criteria For A Future Port

A vertical port is complete when:

- the public/internal boundary chosen by the slice returns exact `A`, `E`, and
  `R` channels;
- owned expected failures are no longer thrown and recaught;
- foreign throws or rejected Promises are mapped once at their owner;
- redundant downstream `instanceof` reconstruction is removed;
- services, Layers, Scope, and runtime ownership match the real lifecycle;
- focused tests cover typed failure plus transaction/concurrency behavior; and
- required package, PGlite, real-Postgres, and boundary checks pass.

An increased count of Effect imports, Layers, Option values, or pipelines is
not an exit criterion.
