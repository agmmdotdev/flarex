---
name: effect-ts-error-handling
description: Apply version-correct Effect TypeScript error-handling patterns for typed domain errors, recoverable versus non-recoverable failures, foreign error mapping, retries, and boundary-safe logging. Use when refactoring async or try/catch code into Effect pipelines, designing service errors, adding catch or retry logic, converting failures to Result, Option, or Exit, or reviewing Effect error code for anti-patterns.
---

# Effect-TS Error Handling

Use this skill to make error handling explicit, typed, and composable in Effect-TS code.

## Execute the workflow

1. Classify failures before coding.
2. Model domain failures as tagged errors at the first failing boundary.
3. Keep one runtime boundary per handler.
4. Inspect the installed Effect version and recover explicitly with its catch
   operators.
5. Retry only transient failures with a schedule.
6. Observe defects at boundaries, not in domain flow.
7. Verify type precision for `E` and dependency precision for `R`.

## Classify failures

Classify each failure as one of the following:
- Domain error: expected business failure, recoverable (`Effect.fail`).
- External transient error: network, timeout, rate limit, potentially retryable.
- External terminal error: invalid credentials, invalid payload, non-retryable.
- Defect: bug or impossible state (`Effect.die`), not regular control flow.

Design recovery strategy from this classification before writing operators.

## Preserve composition semantics

Choose composition by dependency and evaluation behavior, not by a preference
for pipelines. Use a short `map` / `flatMap` pipeline for one linear
transformation or dependent step. Use the installed `Result.gen`, `Option.gen`,
or `Effect.gen` when several values must be unwrapped in order or later work
must not occur after an earlier failure or absence.

Use `all` only for independent members whose ordering, accumulation,
concurrency, interruption, allocation, and failure selection match the
contract. Array and record expressions passed to `Result.all` or `Option.all`
are evaluated before the combinator can short-circuit; `Effect` values are lazy,
but ordinary JavaScript used to construct their collection is not. Keep `Exit`
at the runtime or diagnostic boundary that owns its complete `Cause`; do not
turn it into an ordinary sequencing abstraction. Refactor the whole flow rather
than mechanically replacing every propagation guard, and preserve the original
call order and first-failure behavior.

## Model typed errors

Use tagged errors for every domain and integration boundary.

```ts
import { Data } from "effect"

export class ConversationNotFoundError extends Data.TaggedError("ConversationNotFoundError")<{
  conversationId: string
}> {}

export class FacebookSendError extends Data.TaggedError("FacebookSendError")<{
  pageId: string
  senderId: string
  isRetryable: boolean
  cause: unknown
}> {}
```

Prefer narrow, meaningful fields over generic `message: string` errors.

## Emit tagged errors at source

Create the tagged error where the failure first occurs (service boundary, API boundary, DB boundary, parser boundary).
Do not re-wrap or re-map the same failure in downstream orchestration steps.

Good pattern:
- Source function maps unknown/foreign failures once into a domain tagged error.
- Callers `yield*` that effect and optionally `tapError` for logs.
- Recovery is done with `catchTag` or `catchTags` at intended boundaries.

Avoid this anti-pattern:
- Step A emits `GenerateAiResponseError`.
- Step B catches and maps it again to another `GenerateAiResponseError` with duplicated context.
- Result: noisy stack traces, duplicated mapping logic, and weaker error provenance.

## Choose catch operators intentionally

Use the operator that matches intent. `Effect.catchTag` and
`Effect.catchTags` are available across the relevant versions. For the broader
operators, inspect the installed version:

- Effect v4: `Effect.catch`, `Effect.catchCause`, `Effect.catchDefect`, and
  `Effect.catchFilter`.
- Effect v3: `Effect.catchAll`, `Effect.catchAllCause`, and the matching
  `catchSome*` family.

Do not copy v3 operator names into a v4 workspace or vice versa. Use
Cause-aware and defect recovery sparingly at diagnostics and integration
boundaries.

Prefer `catchTag` or `catchTags` for domain logic because they preserve error intent.

## Apply retries safely

Retry only when the error is transient and the side effect is safe to retry.

```ts
import { Effect, Schedule } from "effect"

const retryPolicy = Schedule.exponential("100 millis")

const sendWithRetry = sendMessageEffect.pipe(
  Effect.catchTag("FacebookSendError", (error) =>
    error.isRetryable
      ? sendMessageEffect.pipe(Effect.retry(retryPolicy))
      : Effect.fail(error),
  ),
)
```

Cap retries and route exhausted attempts to a typed terminal state.

## Keep runtime boundaries clean

Use one runtime boundary at each public entrypoint (`runPromise` or project helper).
Do not inject dependencies inside business pipelines with `Effect.provideService`.
Compose layers once at module boundaries and keep domain code dependency-declared.

## Observe defects and causes

Inspect defects with the installed version's Cause operators, `sandbox`,
`exit`, or defect-tap operators at boundaries.
Log defects with Effect logging APIs and avoid `console.*` in production paths.
Treat defects as signals to fix code paths, not as normal recoverable business outcomes.

## Run review checklist

Before finalizing changes, verify all items:
- No `throw` for domain flow.
- No broad `try/catch` around Effect pipelines.
- No conversion to untyped `Error` where domain context is needed.
- No retry loop for clearly terminal failures.
- No nested runtime boundaries in one request path.
- All recovery branches keep typed error semantics explicit.
- No downstream `Effect.mapError` remapping of already-tagged domain errors.

## Load detailed patterns

Read `references/effect-error-patterns.md` for decision tables, templates, and anti-pattern rewrites.
