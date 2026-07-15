# Boundaries And Failures

## The Boundary Decision

Choose the representation from the semantics, not from whether the original
function happened to be written in plain TypeScript.

| Situation | Preferred representation |
| --- | --- |
| Pure, total calculation | Ordinary TypeScript value or function |
| Pure recoverable validation retained as data | `Result<A, E>` |
| Intentional absence without a failure reason | `Option<A>` |
| Expected failure inside an Effect operation | `Effect.fail(taggedError)` or `yield*` the tagged error |
| Synchronous foreign API that may throw | Narrow `Effect.try` at that call |
| Foreign Promise that may reject | Narrow `Effect.tryPromise` at that call |
| Defect, invariant violation, or impossible state | Preserve as a defect unless the owning contract explicitly classifies it |
| Runtime owner needs failure, defect, and interruption | `Exit` and `Cause` at that boundary |

`Effect.try` is not the standard wrapper for every function that began as
TypeScript. It is an adapter for an exception boundary.

## Current Pattern To Avoid

The current journal flow demonstrates a recurring transitional shape:

```ts
Effect.try({
  try: () => {
    if (!capabilityIsValid(input)) throw new InvalidCapabilityError(...)
    return decodeAndConstructState(input)
  },
  catch: mapEveryKnownErrorOrWrapUnknown,
})
```

This block combines expected domain failures, throwing decoders, mutable state
bookkeeping, and possible defects. The catch function must then recognize a
growing union with `instanceof`; anything missed becomes a generic persistence
failure. That makes the outer Effect type look precise while the inner control
flow remains exception-based.

The target separates owned decisions from foreign calls:

```ts
const requireCapability = (input: unknown) =>
  capabilityIsValid(input)
    ? Effect.succeed(input)
    : Effect.fail(new InvalidCapabilityError(...))

const loadRow = Effect.tryPromise({
  try: () => driver.query(...),
  catch: cause => new JournalSqlError({ operation: "loadRow", cause }),
})
```

Pure decoding may instead return `Result` and enter an Effect flow once with
`Effect.fromResult`. A Schema decoder that already returns an Effect should be
composed directly.

## Emit Errors At Their Owner

- Domain validation owns domain error tags.
- A persistence service owns database, target-resolution, corruption, and
  retryability tags.
- A transport adapter owns request, response, and status translation.
- A runtime edge owns conversion to HTTP, RPC, logs, metrics, or process
  failure.

Once an upstream operation already returns a tagged error, propagate it
unchanged. Use `tapError` or Cause-aware boundary observation for diagnostics;
do not repeatedly wrap it at each layer.

Catch by tag when one known failure changes control flow. Use broad typed
recovery only where the whole error channel is deliberately translated to a
new boundary contract. Never recover defects or interruption with an ordinary
business fallback merely because a broad JavaScript catch can see them.

## Error Taxonomy Before Operators

Classify a failure before choosing catch, retry, or fallback behavior:

- expected domain rejection;
- transient integration failure safe to retry;
- terminal integration failure;
- stored-data corruption or violated trusted invariant;
- defect; or
- interruption.

Retry only a typed transient failure and only when repeating the operation is
safe. Idempotency keys and transaction semantics remain correctness inputs;
an Effect retry operator does not create idempotency.

## Compatibility Wrappers

Throwing parser functions may remain where a published or Promise-native API
requires them, but they should be thin wrappers over one typed decoder. They
must not become a second validation implementation or the default internal API
for an Effect-native flow.
