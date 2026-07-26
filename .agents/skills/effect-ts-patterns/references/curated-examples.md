# Curated Effect Examples

These compact examples are derived from the local Effect v4 source, Flarex,
and T3 Code snapshots. Use them as decision evidence, not templates to paste
unchanged. Confirm exact APIs against the installed Effect version.

## Contents

- Source roles
- Reusable Effect function instead of a wrapper
- Choosing pipe, gen, and all by semantics
- Result for pure validation data
- Result at a deliberate Promise boundary
- Option for intentional absence
- Exit at an observability boundary
- Match for exhaustive error translation
- Gen, pipe, service, Layer, and HTTP together
- Neighboring code is not authority

## Source roles

- Portable API authority: Effect-smol `LLMS.md`, `.patterns/effect.md`, and
  `packages/effect/src/{Effect,Option,Result,Exit}.ts`.
- Flarex contract evidence: `packages/flarex-protocol/src/validator-engine.ts`,
  `packages/flarex-protocol/src/live-query.ts`, and
  `apps/runtime-topology-probe/src/effectBoundary.ts`.
- Application evidence: T3 Code `VcsProcess.ts`, `ApnsClient.ts`,
  `EnvironmentConnector.ts`, `DpopProofs.ts`, and relay `observability.ts`.

Effect-smol defines the APIs. Flarex decides its public and trust-boundary
contracts. T3 Code shows realistic composition, but its own
`docs/operations/effect-fn-checklist.md` records unfinished wrapper debt, so it
must never be treated as uniformly correct precedent.

## Choosing pipe, gen, and all by semantics

A single dependent Result step is a focused pipeline:

```ts
const decodedLimit = optionalPositiveInteger(body.limit, "limit").pipe(
  Result.map(limit => ({ limit })),
)
```

When several decoder results must be named and later decoder calls must not run
after an earlier failure, compose the whole decoder with `Result.gen`:

```ts
const decoded = Result.gen(function*() {
  const limit = yield* optionalPositiveInteger(body.limit, "limit")
  const cursor = yield* optionalCursor(body.cursor, "cursor")
  return { limit, cursor }
})
```

Do not replace that flow with `Result.all({ limit: decodeLimit(), cursor:
decodeCursor() })` unless both calls are intentionally independent: JavaScript
invokes both decoders before `Result.all` receives the record. The same eager
construction rule applies to `Option.all`. `Effect` is different because the
members are lazy descriptions, though JavaScript factory calls used to create
them still run immediately; use `Effect.all` only with an explicit execution
and cancellation policy. `Exit` is already a completed outcome, so map or fold
it at its Cause-owning boundary instead of trying to sequence domain work with
it.

## Reusable Effect function instead of a wrapper

Avoid hiding a reusable operation inside a plain wrapper:

```ts
const decodeChange = (input: unknown) =>
  Effect.gen(function*() {
    const record = yield* decodeRecord(input)
    return yield* decodeFields(record)
  })
```

Prefer a named operation boundary when the operation is meaningful and
observable:

```ts
const decodeChange = Effect.fn("LiveQuery.decodeChange")(function*(
  input: unknown
): Effect.fn.Return<Change, DecodeError> {
  const record = yield* decodeRecord(input)
  return yield* decodeFields(record)
})
```

This follows Effect-smol's `Effect.fn` guidance and Flarex's committed
`LiveQueryProtocol.decodeDeliveryChange` shape. Use unnamed `Effect.fn` for an
internal stack boundary without a span, and use `fnUntraced` only with a
concrete instrumentation or hot-path reason.

## Result for pure validation data

Flarex's validator engine is synchronous and pure. It returns a value-level
result so callers can short-circuit or accumulate validation without starting
an Effect runtime:

```ts
function validate(value: Value): Result.Result<void, ValidationError> {
  if (!isAllowed(value)) {
    return Result.fail(new ValidationError({ path: "$" }))
  }
  return Result.succeed(undefined)
}
```

This is a strong `Result` use: no async work, cancellation, service
requirements, or defects are being modeled. A throwing compatibility API may
fold this Result once at its boundary; internal validation should remain data.

Prefer `Result.match` when both branches become a plain value:

```ts
const message = Result.match(validation, {
  onFailure: error => formatValidationError(error),
  onSuccess: () => "valid",
})
```

## Result at a deliberate Promise boundary

Flarex's runtime-topology probe intentionally normalizes typed protocol
failures to `null` for a host-facing probe API:

```ts
async function valueOrNull<A, E>(effect: Effect.Effect<A, E>): Promise<A | null> {
  const result = await Effect.runPromise(Effect.result(effect))
  return Result.match(result, {
    onFailure: () => null,
    onSuccess: value => value,
  })
}
```

This is acceptable only because the adapter contract explicitly owns the
lossy `A | null` conversion. Do not copy it into domain flow, where callers
usually need the typed `E` channel.

## Option for intentional absence

T3 Code compiles an APNs error-body decoder once and uses `Option.match` to
fold invalid or absent decoded data into a protocol fallback:

```ts
const decodeErrorBody = Schema.decodeUnknownOption(ErrorBodySchema)

function reasonFromBody(body: string): string | undefined {
  if (body.trim() === "") return undefined
  return Option.match(decodeErrorBody(body), {
    onNone: () => body,
    onSome: decoded => decoded.reason ?? body,
  })
}
```

The Option is internal; the public response still uses its required optional
field representation. Likewise, convert an optional response header with
`Option.getOrNull` only at a contract that explicitly requires `null`.

T3 Code also uses `Effect.option` while trying rotated verification keys. That
conversion is justified only if every verification/decode failure means "this
key did not verify; try the next key." If transport, configuration, or defect
reasons must stop the loop, catch only the expected verification error instead
of erasing the whole typed channel.

## Exit at an observability boundary

T3 Code's relay tracer receives `Exit` in the tracer span lifecycle and
inspects failure Causes to annotate typed or defect errors:

```ts
function annotateFailure(span: Tracer.Span, exit: Exit.Exit<unknown, unknown>) {
  Exit.match(exit, {
    onSuccess: () => undefined,
    onFailure: cause => annotateCause(span, cause),
  })
}
```

This is the correct boundary: the tracer owns completion, defects, and
interruption. A domain service should keep ordinary recoverable failures in
`E` rather than returning `Exit` from every method.

## Match for exhaustive error translation

T3 Code's `VcsProcess` maps a tagged process error union into the public VCS
error union with `Match.valueTags`:

```ts
const run = processRunner.run(input).pipe(
  Effect.mapError(
    Match.valueTags({
      ProcessSpawnError: toSpawnError,
      ProcessTimeoutError: toTimeoutError,
      ProcessReadError: toDecodeError,
      ProcessStdinError: toDecodeError,
      ProcessOutputLimitError: toDecodeError,
    }),
  ),
)
```

Adding a new process error variant now requires updating the translation.
Prefer this or an exhaustive `switch` over chained tag checks with a catch-all
default.

## Gen, pipe, service, Layer, and HTTP together

T3 Code's APNs client demonstrates the intended separation:

```ts
const make = Effect.gen(function*() {
  const http = yield* HttpClient.HttpClient

  const send: ClientShape["send"] = Effect.fn("ApnsClient.send")(
    function*(input) {
      const response = yield* makeRequest(input).pipe(
        Effect.flatMap(http.execute),
        Effect.mapError(cause => new ApnsHttpError({ cause })),
      )
      return decodeDelivery(response)
    },
  )

  return Client.of({ send })
})

export const layer = Layer.effect(Client, make)
```

- `Effect.gen` constructs the service once.
- Named `Effect.fn` marks the observable operation.
- `pipe` expresses a short transport and error-mapping chain.
- `HttpClient` is injected and the Layer closes construction requirements.
- Stable Schema codecs are compiled outside the request method.

Do not infer that every nullable field in the returned public payload should
become Option; the protocol owner still decides its external representation.

## Neighboring code is not authority

T3 Code's DPoP service contains both the preferred form and recorded migration
debt in one file: `consume` and `verifyAndConsume` are named `Effect.fn`
operations, while `pruneExpired` is still a reusable service property built as
an `Effect.gen(...).pipe(Effect.withSpan(...))` value.

When adding a similar service operation, follow the intended `Effect.fn`
standard rather than copying the remaining wrapper/value inconsistency. When a
change materially relies on the inconsistent operation and behavior-preserving
tests exist, convert that bounded touched flow instead of postponing it merely
because it predates the diff.
