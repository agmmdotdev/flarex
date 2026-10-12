# Curated Effect Examples

Illustrative Effect v4/Flarex/T3 Code snippets, not paste-ready templates.
Verify installed APIs; [the catalog](pattern-catalog.md) owns general selection.

## Source roles

Installed Effect source/types define APIs; Flarex owns public/trust contracts.
Flarex witnesses: `packages/flarex-protocol/src/validator-engine.ts`,
`live-query.ts`, and `apps/runtime-topology-probe/src/effectBoundary.ts`.
T3 Code witnesses: VcsProcess, ApnsClient, EnvironmentConnector, DpopProofs and
relay observability. Effect-smol is historical; T3's
`docs/operations/effect-fn-checklist.md` records wrapper debt, not uniform
precedent.

## Choosing pipe, gen, and all by semantics

One linear Result transform:

```ts
const decodedLimit = optionalPositiveInteger(body.limit, "limit").pipe(
  Result.map(limit => ({ limit })),
)
```

Dependent successes with later decoder calls suppressed after failure:

```ts
const decoded = Result.gen(function*() {
  const limit = yield* optionalPositiveInteger(body.limit, "limit")
  const cursor = yield* optionalCursor(body.cursor, "cursor")
  return { limit, cursor }
})
```

Translate/propagate composition, rather than inspecting and reboxing channels:

```ts
// Avoid
const arena = planArena(input)
if (Result.isFailure(arena)) {
  return Result.fail(toPlanError(arena.failure))
}
return validateUsage(arena.success.usage)

// Prefer
return planArena(input).pipe(
  Result.mapError(toPlanError),
  Result.flatMap(arena => validateUsage(arena.usage)),
)
```

Inside gen, translate before yielding:

```ts
const arena = yield* planArena(input).pipe(Result.mapError(toPlanError))
const required = arena.usage
```

Result.fail originates a raw-condition failure; filterOrFail validates an existing
success. Result.all({ limit: decodeLimit(), cursor: decodeCursor() }) calls BOTH
decoders before receiving the record; Option.all has the same eager construction.
Effect members are lazy but their JavaScript factories are eager. Use all only
for intended independence/order/cancellation; Exit folds completed Causes,
not domain sequencing.

## Reusable Effect function instead of a wrapper

Avoid hiding a reusable operation behind a plain gen wrapper:

```ts
const decodeChange = (input: unknown) =>
  Effect.gen(function*() {
    const record = yield* decodeRecord(input)
    return yield* decodeFields(record)
  })
```

A meaningful observable operation owns a named boundary:

```ts
const decodeChange = Effect.fn("LiveQuery.decodeChange")(function*(
  input: unknown
): Effect.fn.Return<Change, DecodeError> {
  const record = yield* decodeRecord(input)
  return yield* decodeFields(record)
})
```

Flarex's LiveQueryProtocol.decodeDeliveryChange illustrates this shape.
Unnamed fn supplies an internal stack boundary without a span; fnUntraced needs
an instrumentation/hot-path reason.

## Schema for data, Result or Effect for the parse outcome

See [data contracts](data-contracts.md) and the
[Schema example](../../effect-ts-error-handling/references/effect-error-patterns.md).
Schema owns required fields/bounds and intrinsic stored-state relations;
Result carries pure parsing, then enters Effect once. Current lease validity
and issuer authenticity remain contextual. Preserve no-getter capture/codecs.

## Result for pure validation data

ValidatorJson owns Flarex's existing pure validation semantics:

```ts
function validate(value: Value): Result.Result<void, ValidationError> {
  if (!isAllowed(value)) {
    return Result.fail(new ValidationError({ path: "$" }))
  }
  return Result.succeed(undefined)
}
```

No async/cancellation/runtime is needed. This manual guard is not a template for
new structural decoders: use Schema. A throwing compatibility edge folds Result
once; internal validation remains data. Fold when both branches are plain:

```ts
const message = Result.match(validation, {
  onFailure: error => formatValidationError(error),
  onSuccess: () => "valid",
})
```

## Result at a deliberate Promise boundary

The runtime-topology probe's host API explicitly owns this lossy projection:

```ts
async function valueOrNull<A, E>(effect: Effect.Effect<A, E>): Promise<A | null> {
  const result = await Effect.runPromise(Effect.result(effect))
  return Result.match(result, {
    onFailure: () => null,
    onSuccess: value => value,
  })
}
```

Do not use it in domain flow that needs E. The real Promise adapter owns the
runner and A | null contract.

## Option for intentional absence

An APNs-style protocol can deliberately treat malformed/absent error details as
fallback. Compile its JSON-text decoder once:

```ts
const decodeErrorBody = Schema.decodeUnknownOption(
  Schema.fromJsonString(ErrorBodySchema),
)

function reasonFromBody(body: string): string | undefined {
  if (body.trim() === "") return undefined
  return Option.match(decodeErrorBody(body), {
    onNone: () => body,
    onSome: decoded => decoded.reason ?? body,
  })
}
```

Option stays internal; preserve public optional/null fields, using getOrNull
only where required. Rotated-key verification may use Effect.option only if EVERY
typed verification/decode failure means "try another key". Transport/configuration
failures must stop via specific recovery; defects must not be erased.

## Exit at an observability boundary

A relay tracer owns completion and can annotate the full Cause:

```ts
function annotateFailure(span: Tracer.Span, exit: Exit.Exit<unknown, unknown>) {
  Exit.match(exit, {
    onSuccess: () => undefined,
    onFailure: cause => annotateCause(span, cause),
  })
}
```

Normal domain services retain recoverable failure in E. Exit belongs to the
completion/cleanup/diagnostic owner, including defects and interruption.

## Match for exhaustive error translation

VcsProcess maps the process error union to its public error union:

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

A new variant requires updating the mapping. Exhaustive Match or switch avoids
a catch-all silently assigning the last known meaning.

## Gen, pipe, service, Layer, and HTTP together

A factory closing over injected capabilities and reusable Effect methods is
service-shaped; Layer construction keeps requirements visible in R. Plain/scoped
factories need locality/lifetime/multi-instance justification.

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

gen constructs once, named fn marks send, pipe handles transport/error projection,
HttpClient is injected and Layer closes construction requirements. Compile stable
Schema codecs outside send; public nullable fields still obey their protocol.

## Neighboring code is not authority

In the reviewed DPoP snapshot, consume/verifyAndConsume use named fn while
pruneExpired retains a gen value with withSpan. Follow the intended operation
boundary, not neighboring debt. Correct materially relied-on touched-flow debt
when authorized and behavior-preserving witnesses exist.
