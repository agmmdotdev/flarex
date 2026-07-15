# Data Types, Schema, And Control Flow

## Use Outcome Types For Their Meaning

The repository currently uses `Result` in a few strong places, especially the
pure validator engine. `Option`, `Exit`, and `Match` appear much less often.
That is evidence to inspect, not proof that every flow should use them.

### Option

Use `Option<A>` for composable absence with no error reason. Good candidates
include an internal lookup where missing is ordinary and several operations
compose before the final fold.

Do not turn authentication failure, invalid input, database failure, or stored
corruption into `None`. Preserve public and wire-owned `null` or omitted-field
representations and convert only at the owning boundary.

### Result

Use `Result<A, E>` when recoverable success or failure is deliberately a pure
value. This is appropriate for synchronous validation, batch-item outcomes, or
parsing that must accumulate failures without an Effect runtime.

```ts
function decodeOperation(input: unknown): Result.Result<Operation, DecodeError> {
  return isOperation(input)
    ? Result.succeed(input)
    : Result.fail(new DecodeError({ input }))
}

const operationEffect = Effect.fromResult(decodeOperation(input))
```

Do not convert an Effect to Result just to branch and immediately rebuild the
failure channel.

### Exit

Use `Exit` when the owner needs the complete outcome: typed failure, defect,
or interruption. Typical owners are a runtime adapter, supervisor, cleanup
path, diagnostic collector, or test.

It is acceptable that most domain service methods do not mention `Exit`.
Returning it everywhere would hide the useful distinction between expected
failure and complete runtime Cause.

### Match And Switch

Use `Match` or an exhaustive `switch` plus a `never` check for tagged unions
where a new variant must produce a compile error. Use `Option.match`,
`Result.match`, and `Exit.match` to fold those values when both branches matter.

A native exhaustive switch is not inferior. A simple Boolean condition should
remain a simple guard instead of being expanded into pattern-matching ceremony.

## Schema Boundaries

- Prefer Effect-returning Schema decoders inside Effect-native flows.
- Hoist stable decoders and encoders out of request loops.
- Compile dynamic schemas once at their narrowest stable factory boundary.
- Keep throwing synchronous decoders only as pure or compatibility boundaries,
  not as the default internal API for Effect services.
- Preserve Flarex `ValidatorJson`, protocol-owned `{ ok }` unions, encoded wire
  shapes, and trusted corruption checks; library uniformity does not override
  those contracts.

## Effect.fn, Effect.gen, And pipe

| Construct | Prefer it when |
| --- | --- |
| `Effect.fn("Domain.operation")` | A reusable operation or service method deserves a named observable boundary |
| Unnamed `Effect.fn` | A reusable internal operation needs a stack boundary without an implicit span |
| `Effect.gen` | Several dependent binds, branches, loops, or cleanup steps read clearly in imperative order |
| `pipe` | A short linear map, flatMap, recovery, timeout, retry, or observability chain is clearest left-to-right |
| Plain TypeScript | The helper is pure and Effect adds no failure, requirement, lifecycle, or concurrency meaning |

Avoid reusable functions that merely return an anonymous `Effect.gen` value,
one-combinator generators, and deeply nested pipelines. Do not replace a clear
generator with `pipe`, or a clear pipeline with a generator, only to satisfy a
syntax preference.
