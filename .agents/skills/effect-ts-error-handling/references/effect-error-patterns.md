# Effect Error Patterns

These examples target Effect v4. Verify exact APIs against the installed source.
Expected failure policy belongs to the domain; source adapters preserve it.

## Schema plus a pure Result and an Effect operation

The schema owns required fields and bounds. Result carries a pure parse verdict;
Effect carries that same failure during execution. There is one field contract.

```ts
import { Data, Effect, Result, Schema } from "effect"

const Request = Schema.Struct({
  name: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_-]{0,63}$/)),
  attempts: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 5 })),
})
type Request = typeof Request.Type

class InvalidRequest extends Data.TaggedError("InvalidRequest")<{
  readonly cause: unknown
}> {}

const parse = Schema.decodeUnknownResult(Request, {
  onExcessProperty: "error",
})
const decodeRequest = (input: unknown): Result.Result<Request, InvalidRequest> =>
  parse(input).pipe(Result.mapError(cause => new InvalidRequest({ cause })))

const prepareRequest = Effect.fn("Request.prepare")((input: unknown) =>
  Effect.fromResult(decodeRequest(input)),
)
```

If no pure consumer exists, decodeUnknownEffect can be the direct primary API.
The name schema first establishes a string; a standalone regex would coerce a
missing value. Current authorization is a later operation, not a request-specific
schema. Avoid an extra wrapper when it has no distinct operation/boundary role.

## Foreign Promise adapter

A narrow documented provider API may report all operational failures as rejected
Promises. Capture that boundary once; do not wrap the surrounding business logic.

```ts
import { Data, Effect } from "effect"

class ProviderFailure extends Data.TaggedError("ProviderFailure")<{
  readonly operation: "send"
  readonly cause: unknown
}> {}

interface Provider {
  readonly send: (message: string, signal: AbortSignal) => Promise<void>
}

const send = Effect.fn("Provider.send")((provider: Provider, message: string) =>
  Effect.tryPromise({
    try: signal => provider.send(message, signal),
    catch: cause => new ProviderFailure({ operation: "send", cause }),
  }),
)
```

This example's provider contract classifies its rejections as operational.
Where the provider/library distinguishes bugs, cancellation, corruption or
already-tagged failures, preserve those distinctions. Passing AbortSignal is
not proof of settlement; resource-owning adapters must honor their drain/release
contract.

## Retry eligibility on every failure

```ts
import { Data, Effect, Schedule } from "effect"

class DeliveryFailure extends Data.TaggedError("DeliveryFailure")<{
  readonly retryable: boolean
}> {}

const deliver = <A>(attempt: Effect.Effect<A, DeliveryFailure>) =>
  attempt.pipe(Effect.retry({
    while: failure => failure.retryable,
    times: 3,
    schedule: Schedule.exponential("100 millis"),
  }))
```

The predicate is evaluated after each failure. A transient first error followed
by a terminal second error stops after two executions. Test that sequence and
the all-transient exhaustion case; do not rely only on eventual success.
This example assumes retrying the attempt is safe. Mutations need their owning
idempotency/uncertainty contract. Durable retries use durable evidence.

Avoid this shape:

```ts
// The first catch classifies one error; later failures are not filtered.
attempt.pipe(Effect.catchTag("DeliveryFailure", error =>
  error.retryable
    ? attempt.pipe(Effect.retry(Schedule.recurs(3)))
    : Effect.fail(error),
))
```

## Preserve absence, expected failure and Cause

| Intent | Boundary decision |
| --- | --- |
| Optional lookup with normal missing result | Option from that lookup; preserve other failure variants |
| Malformed stored record | Schema failure mapped to corruption, not None |
| Need per-item success/error data | Result at the deliberate collection boundary |
| Need normal domain recovery | Keep E and recover by tag |
| Need full completion including cleanup defects/interruption | Exit/Cause at the runtime or resource owner |
| Public error response has a different shape | One explicit projection with appropriate redaction |

Use Data.TaggedError for in-process domain failures. Use a Schema-backed error
when validated encoding/decoding of that error is actually required. Neither
constructor justifies putting arbitrary cause data in a response.

## Root refusal across a callback boundary

When the request owner requires rollback-only behavior, validate through its
refusal path before returning a rejected service Promise. A caller may catch
that Promise; the root must still fail. Do not rewrap an already-latched
participant Cause. Test caught invalid input as well as an uncaught exception.

This rule applies only to owners that require sticky failure. A normal
recoverable validation error in an unrelated service need not poison a root.
