# Effect Error Patterns

Effect v4 illustrations; verify installed APIs. [The skill](../SKILL.md) owns
classification, recovery, retry, settlement and diagnostic policy.

## Schema plus a pure Result and an Effect operation

One required-field/bounded-value contract, two verdict carriers:

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

Use decodeUnknownEffect directly if there is no pure consumer. String validation
must precede regex (missing values otherwise coerce); authorization is a later
contextual operation. Do not add wrappers without a distinct boundary role.

## Foreign Promise adapter

Capture one provider contract that reports operational failure by rejection:

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

That documented rejection contract justifies this mapping; otherwise preserve
distinguishable bugs, cancellation, corruption and tagged failures. AbortSignal
does not prove settlement: resource adapters must drain/release as required.
Do not wrap surrounding business logic.

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

The predicate runs after EACH failure: transient then terminal stops after two
executions. Test that sequence and all-transient exhaustion, not just eventual
success. This example assumes repetition is safe; mutations need idempotency/
uncertainty recovery, and durable retries need durable evidence.

Avoid classifying only the initial failure and retrying later failures blindly:

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
| Normal missing lookup | Option; retain other failures |
| Malformed stored data | Decode failure mapped to corruption, not None |
| Deliberate per-item verdict | Result at collection boundary |
| Domain recovery | E with tag-specific recovery |
| Full completion/cleanup defect/interruption | Exit/Cause at resource/runtime owner |
| Different public error shape | One redacted projection |

Data.TaggedError fits in-process failure; Schema-backed errors fit validated
encoding/decoding. Neither makes arbitrary cause data safe for public responses.

## Root refusal across a callback boundary

For owners requiring sticky rollback-only failure, register refusal before
exposing the rejected service Promise. The caller may catch it; the root must
still fail. Preserve already-latched participant Cause without rewrapping.
Test caught invalid input and uncaught exceptions. Ordinary recoverable
validation in unrelated services need not poison a root.
