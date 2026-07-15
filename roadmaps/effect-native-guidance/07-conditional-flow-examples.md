# Conditional Flow Examples

## The Rule

Do not replace every `if` with an Effect operator. Replace ad hoc branching
when an existing Effect or outcome abstraction expresses the semantics more
accurately, improves exhaustiveness, or preserves failure channels.

| Condition being handled | Preferred form |
| --- | --- |
| One local Boolean or null guard | Ordinary `if`, ternary, or early return |
| Pure `_tag` union folded to a value | `Match.valueTags` or reusable `Match.typeTags` |
| Pure `Option`, `Result`, or `Exit` folded to a value | Its module's `match` |
| `Result<A, E>` entering Effect flow | `Effect.fromResult` |
| One typed Effect failure changes behavior | `Effect.catchTag` |
| Several typed failures change behavior | `Effect.catchTags` |
| Both Effect success and failure become plain data | `Effect.match` |
| Success and failure handlers both return Effects | `Effect.matchEffect` |
| Run an Effect only when an effectful condition succeeds with `true` | `Effect.when`, producing `Option` |
| Complex dependent branches inside one operation | Clear `Effect.gen` with normal guards |

## Keep Simple Guards Simple

This is already clear and preserves the exact failure channel:

```ts
const status = yield* readPush(pushId)
if (status === null) {
  return yield* Effect.fail(new StoredPushMissingError({ pushId }))
}
```

`Option` would help only if absence must compose through several operations or
is the method's intended internal result. `Match` would add ceremony to one
Boolean decision.

Simple predicates used while validating unknown data should also remain
ordinary TypeScript. Effect does not replace type guards.

## Replace Repeated Tagged Dispatch

Several current internal route dispatchers use a sequence of `_tag` checks and
then treat the last untested variant as the default. That works today, but a
new route variant can silently fall into the wrong handler.

For a reusable dispatcher, the installed Effect v4 `Match.typeTags` makes every
tag explicit:

```ts
type RouteInput =
  | { readonly _tag: "Health" }
  | { readonly _tag: "GetPush"; readonly pushId: string }
  | { readonly _tag: "AbandonPush"; readonly pushId: string }

const dispatchRoute = Match.typeTags<RouteInput>()({
  Health: () => healthHandler(),
  GetPush: route => getPushHandler(route.pushId),
  AbandonPush: route => abandonPushHandler(route.pushId),
})

return yield* dispatchRoute(input)
```

Adding another `_tag` now requires another handler. `Match.valueTags(input,
handlers)` is the inline equivalent. An exhaustive `switch` plus a `never`
check remains equally valid when imperative statements are clearer.

## Stop Inspecting Result Tags Manually

Current search-parameter code constructs ad hoc `Success` / `Failure` values,
checks `._tag`, yields the error, and extracts `.value`. If the helper returns
Effect v4 `Result`, the bridge is already provided:

```ts
const indexId = yield* Effect.fromResult(
  requiredIntegerSearchParam(searchParams, "indexId"),
)
const at = yield* Effect.fromResult(
  optionalIntegerSearchParam(searchParams, "at"),
)
```

Keep `Result.match` for a pure fold:

```ts
const message = Result.match(validation, {
  onFailure: error => error.message,
  onSuccess: () => "valid",
})
```

Do not convert an Effect to Result and then inspect the tag merely to recreate
the Effect failure channel.

## Fold Intentional Absence Once

Repeated `value === undefined ? fallback : transform(value)` branches can use
`Option` when absence is truly part of an internal pipeline:

```ts
const authorization = Option.fromNullishOr(headers.authorization)

const token = Option.match(authorization, {
  onNone: () => "anonymous",
  onSome: value => value.replace(/^Bearer\s+/i, ""),
})
```

Do not use this for invalid authorization: malformed credentials need a typed
failure, not `None`. Preserve wire-owned omitted fields and `null` at their
boundary.

## Choose The Effect Fold That Matches The Branches

Use `Effect.match` only when both branches become plain success data:

```ts
const response = operation.pipe(
  Effect.match({
    onFailure: error => errorToResponse(error),
    onSuccess: value => valueToResponse(value),
  }),
)
```

Use `Effect.matchEffect` when either branch performs Effect work:

```ts
const response = operation.pipe(
  Effect.matchEffect({
    onFailure: error => auditFailure(error).pipe(
      Effect.as(errorToResponse(error)),
    ),
    onSuccess: value => auditSuccess(value).pipe(
      Effect.as(valueToResponse(value)),
    ),
  }),
)
```

If the audit should observe without changing success or failure, prefer
`Effect.tap` and `Effect.tapError`; do not fold and reconstruct both channels.

If only one tagged failure is recovered and success should pass through, use
`catchTag` instead of folding both sides:

```ts
const optionalRow = loadRow(id).pipe(
  Effect.map(Option.some),
  Effect.catchTag("RowNotFoundError", () => Effect.succeed(Option.none())),
)
```

The success mapping happens before recovery so both final branches are
`Option<Row>`. Other typed failures remain in `E`.

## Use Effect.when Only When Skipping Is Data

In Effect v4, `Effect.when(effect, conditionEffect)` evaluates an effectful
Boolean condition, runs the effect only for `true`, and returns `Option<A>`.

```ts
const maybeReceipt = Effect.when(
  publishReceipt,
  authorizationAllowsPublication,
)
```

This is appropriate only when `None` means "intentionally skipped." If the
false branch is forbidden, invalid, or needs a distinct result, use a normal
guard with `Effect.fail`, `Effect.filterOrFail`, or explicit branching.

## Match Error Unions At Translation Boundaries

When an upstream Effect has a tagged error union and every variant maps to a
new boundary error, `Match.valueTags` prevents a forgotten variant:

```ts
const translated = operation.pipe(
  Effect.mapError(
    Match.valueTags({
      TransportError: toExternalUnavailable,
      DecodeError: toExternalProtocolError,
      AuthorizationError: toExternalAuthorizationError,
    }),
  ),
)
```

Do not use `mapError` to rewrap an already-correct domain error. Translation is
for a real boundary between error contracts.

## Current High-Value Review Targets

- sequential `_tag` route dispatch in registry and deployment boundaries;
- direct `Result` tag checks in partition route decoding;
- long tagged or discriminated error translation chains;
- status branches in manually wrapped HTTP clients; and
- repeated three-or-more-variant `kind` flows where a new variant must not
  reach a default branch.

Keep simple null guards, two-way local decisions, validation predicates, and
clear exhaustive codec switches unless a stronger semantic reason appears.
