# Effect-TS Error Pattern Reference

Use this reference when implementing or reviewing error-handling logic.

## Decision table

| Situation | Preferred pattern | Why |
| --- | --- | --- |
| Expected business failure | `Effect.fail(new TaggedError(...))` | Keep failures typed and explicit |
| One known failure branch | `Effect.catchTag("Tag", ...)` | Keep branch-specific recovery readable |
| Already tagged domain error from upstream | Propagate unchanged; use `tapError` for logs only | Preserve source provenance and avoid duplicate mapping |
| Multiple known failure branches | `Effect.catchTags({ ... })` | Centralize typed branching |
| Boundary fallback for all typed failures | v4 `Effect.catch(...)`; v3 `Effect.catchAll(...)` | Convert typed failures to boundary response |
| Need to inspect defects or interruptions | v4 `Effect.catchCause(...)`; v3 `Effect.catchAllCause(...)`; or `Effect.exit(...)` | Preserve lossless failure details |
| Transient integration failure | `Effect.retry(schedule)` with typed retryability | Deterministic retry behavior |
| Non-retryable integration failure | Return typed terminal error, no retry | Avoid wasted retries and duplicate side effects |

## Template: service-layer at-source typed error emission

```ts
import { Data, Effect } from "effect"

export class MessageDbError extends Data.TaggedError("MessageDbError")<{
  operation: "insert" | "list"
  cause: unknown
}> {}

export const insertMessage = (input: InsertInput) =>
  Effect.tryPromise({
    try: () => db.insert(messages).values(input),
    catch: (cause) => new MessageDbError({ operation: "insert", cause }),
  })
```

## Template: branch by retryability

```ts
import { Effect, Schedule } from "effect"

const retryPolicy = Schedule.recurs(3)

const deliver = postToApi.pipe(
  Effect.catchTag("ApiSendError", (error) =>
    error.isRetryable
      ? postToApi.pipe(Effect.retry(retryPolicy))
      : Effect.fail(error),
  ),
)
```

## Template: boundary conversion

```ts
import { Effect } from "effect"

export const handlerEffect = businessFlow.pipe(
  Effect.catchTags({
    ValidationError: (error) => Effect.succeed({ status: 400 as const, error }),
    AuthError: (error) => Effect.succeed({ status: 401 as const, error }),
  }),
  // Effect v4. Use Effect.catchAll in a v3 workspace.
  Effect.catch((error) =>
    Effect.succeed({ status: 500 as const, errorTag: error._tag }),
  ),
)
```

## Anti-pattern rewrites

Anti-pattern: throw domain errors in async code.
Rewrite: return typed failures with `Effect.fail` and handle with catch operators.

Anti-pattern: broad `try/catch` inside `async` handlers.
Rewrite: move logic into `Effect.gen` and keep a single runtime boundary.

Anti-pattern: retry every failure.
Rewrite: include retryability in error type and branch retries explicitly.

Anti-pattern: remap already-tagged domain errors in downstream pipeline steps.
Rewrite: emit tagged errors where failure originates; downstream steps should propagate and optionally `tapError`.

Anti-pattern: swallow defect details.
Rewrite: inspect `Cause` at boundaries and log with `Effect.logError`.

## Review prompts

Use these quick prompts during review:
- "Is each failure mode represented by a tagged error or explicit cause?"
- "Does recovery logic branch on typed tags instead of string matching?"
- "Are tagged errors emitted at source and propagated without downstream remapping?"
- "Is retry applied only to transient and idempotent operations?"
- "Is there exactly one runtime boundary for this entrypoint?"
- "Are defects observed at the edge instead of normalized into business errors?"
