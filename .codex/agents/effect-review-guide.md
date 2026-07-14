# Flarex Effect Review Guide

This is the shared Effect v4 review guide for the standing
`typescript-diff-reviewer` and `code-quality-diff-reviewer`. Both reviewers must
read it when a changed file imports Effect modules or changes an Effect,
Schema, Config, Context service, Layer, Scope, Fiber, runtime bridge, or
Effect-based test.

This guide is not a request to migrate unrelated legacy code. Review the
changed diff, report newly introduced or materially exposed problems, and use
nearby debt only as evidence. Existing inconsistency is not an exception for
new code.

## Authority And Evidence

Apply these sources in order:

1. Flarex's accepted behavior, public contracts, trust boundaries, and the
   Effect version actually installed in this workspace.
2. The optional local Effect reference at
   `opensrc/repos/github.com/effect-TS/effect-smol/LLMS.md`, its `.patterns/`
   documents when present, and representative Effect source for API details.
3. The global `effect-ts-error-handling` skill for failure classification,
   at-source mapping, recovery, retries, and runtime-boundary discipline.
4. Curated implementation evidence from
   `opensrc/repos/github.com/pingdotgg/t3code`.

Effect-smol is the API and library-style authority. T3 Code is useful
application evidence, not a uniformly correct standard: its own
`docs/operations/effect-fn-checklist.md` records unfinished wrapper-style debt.
Do not copy version-specific syntax until it agrees with Flarex's installed
Effect version.

## Classify The Construct First

| Construct | Default form |
| --- | --- |
| Pure calculation or type guard | Ordinary TypeScript function |
| Standalone, already-created Effect value | `Effect.gen(...)` or a concise pipeline |
| Observable reusable operation whose body constructs or composes an Effect | `Effect.fn("Domain.operation")` |
| Internal reusable operation that needs a stack boundary but not a span | Unnamed `Effect.fn(function* (...) { ... })` |
| Service-method implementation returning an Effect | Contract-typed `Effect.fn("Service.method")` |
| Demonstrated hot-path or deliberately zero-instrumentation Effect function | `Effect.fnUntraced(...)` |
| Inline callback or one-off branch inside an existing operation | Inline Effect/pipeline; do not manufacture a named function |
| External runtime entrypoint or foreign callback | One explicit, lifecycle-owned Effect runner |

The important rule is not "every function uses `Effect.fn`." It is that a
reusable Effect-producing operation should not be hidden inside a plain wrapper
whose only implementation is `Effect.gen`.

## Effect.fn, Effect.gen, And Pipelines

Flag new or changed wrapper-style code like this:

```ts
export function issueGrant(
  input: IssueGrantInput,
): Effect.Effect<IssuedGrant, IssueGrantError, GrantSigner> {
  return Effect.gen(function* () {
    const signer = yield* GrantSigner
    return yield* signer.issue(input)
  })
}
```

Prefer a meaningful Effect function boundary:

```ts
export const issueGrant = Effect.fn("TransactionGrantIssuer.issue")(
  function* (
    input: IssueGrantInput,
  ): Effect.fn.Return<IssuedGrant, IssueGrantError, GrantSigner> {
    const signer = yield* GrantSigner
    return yield* signer.issue(input)
  },
)
```

Apply these checks:

- Use a stable, qualified name for an observable domain, service, adapter, or
  workflow operation. The name should describe the operation rather than its
  implementation file.
- Use unnamed `Effect.fn(function* (...) { ... })` for a reusable internal
  operation that should retain stack-frame diagnostics without creating an
  implicit tracing span.
- Use `Effect.fn.Return<A, E, R>` when an exported, generic, overloaded, or
  service-boundary signature needs explicit stabilization. Do not add it when
  inference is already precise and local.
- Pass definition-time transforms as additional `Effect.fn` arguments when
  that API is supported. Do not build the function and then accidentally pipe
  the function value as though it were an Effect.
- Use `Effect.fnUntraced` only for a demonstrated hot path, high-frequency
  callback, public library constructor/combinator where instrumentation is not
  part of the API, or an operation with deliberate explicit span placement. It
  drops both the stack-frame boundary and implicit span, so that loss of
  diagnostics must be explainable from the call path.
- `Effect.gen` remains correct for a one-off Effect value, Layer construction,
  an Effect test body, or inline orchestration inside an already named
  operation.
- A short ordinary function returning a clear combinator pipeline can remain
  ordinary, especially when it preserves a framework signature or already
  applies a stable `Effect.withSpan`. Do not replace clarity with generator
  ceremony.
- Pure helpers stay ordinary TypeScript:

```ts
export function canonicalizePolicy(policy: GrantPolicy): Uint8Array {
  return textEncoder.encode(stableJson(policy))
}
```

An explicit violation of the wrapper rule is reportable as a P3 maintainability
and diagnostics defect. Raise severity only when it also erases a failure or
requirement type, breaks tracing relied on operationally, or causes a real
correctness/lifecycle problem.

## Success, Failure, And Requirements

For every changed reusable Effect operation, inspect all three channels:

```ts
Effect.Effect<Success, Failure, Requirements>
```

- `Success` must match the runtime value and any Schema decoder or wire
  contract.
- `Failure` must contain expected failures callers can actually distinguish.
  Do not widen to `unknown`, global `Error`, or a generic catch-all merely to
  make composition compile.
- `Requirements` must expose real dependencies until a Layer or adapter
  provides them. Do not hide a dependency with a cast or leak implementation
  services from an allegedly closed service method.
- Service interfaces may use ordinary Effect-returning function signatures;
  their implementations should normally be contract-typed `Effect.fn`
  functions.

```ts
export interface UserStoreShape {
  readonly load: (id: UserId) => Effect.Effect<User, UserNotFoundError>
}

const load: UserStoreShape["load"] = Effect.fn("UserStore.load")(
  function* (id) {
    // implementation dependencies were captured while building the service
  },
)
```

Check encoded versus decoded Schema types, optionality, and tagged union
exhaustiveness. An unsafe assertion that hides an `A`, `E`, or `R` disagreement
is a contract defect, not a style issue.

## Typed Errors And Foreign Effects

Classify failures before reviewing recovery:

- expected domain failure: typed failure channel;
- transient integration failure: typed retryability plus a bounded schedule;
- terminal integration failure: typed and not retried;
- defect or impossible state: defect channel, observed at an outer boundary.

Map foreign failures once where they enter Effect:

```ts
export class GrantSignerError extends Data.TaggedError("GrantSignerError")<{
  readonly cause: unknown
}> {}

export const signGrant = Effect.fn("GrantSigner.sign")((bytes: Uint8Array) =>
  Effect.tryPromise({
    try: () => signer.sign(bytes),
    catch: (cause) => new GrantSignerError({ cause }),
  }),
)
```

- Use `Data.TaggedError` for typed in-process failures that do not need a
  serialization contract.
- Use `Schema.TaggedErrorClass` or the current version's schema-backed error
  class for API, RPC, persisted, or otherwise encoded failures.
- Use `Effect.try` / `Effect.tryPromise` for operations that can throw or reject.
  `Effect.promise` is only valid when rejection is impossible or intentionally
  a defect.
- Do not put JavaScript `try/catch` around yielded Effects.
- Emit or translate the error at its source, then propagate it. Repeated
  downstream `mapError` wrapping destroys provenance.
- Prefer tag-specific recovery. A broad catch is appropriate only at a boundary
  that intentionally converts the whole typed channel.
- Use the installed Effect v4 recovery names: `Effect.catch`,
  `Effect.catchCause`, and `Effect.catchDefect`; `Effect.catchTag` and
  `Effect.catchTags` remain available. The global error-handling skill's older
  `catchAll`, `catchAllCause`, and `catchSomeDefect` names are v3 guidance and
  must not be proposed for this workspace.
- Use `return yield*` for terminal failure or interruption so control flow and
  inference agree.
- Retry only typed transient failures when the operation is safe to repeat.

## Services, Layers, Scope, And Concurrency

- Prefer class-form `Context.Service` with a stable package-qualified identity
  for genuine shared capabilities, lifecycle ownership, or substitution in
  tests. Do not create a service for every small explicit port.
- Keep service contracts narrow. Build implementations effectfully, close
  implementation dependencies in the Layer, and return a value satisfying the
  service shape.
- Compose and provide Layers at application, host, or test boundaries. Repeated
  `provideService` inside domain operations often hides lifecycle and
  requirement mistakes.
- Use `Layer.scoped`, `Effect.acquireRelease`, or the matching scoped primitive
  whenever acquisition owns cleanup. A `Scope` requirement hidden inside
  `Layer.effect` is a defect.
- Use structured concurrency. Owned fibers should be scoped, supervised, or
  explicitly joined/interrupted; do not let background work escape a request,
  Worker, Durable Object, or test lifecycle accidentally.
- Do not capture request-, Worker-, or Durable Object-scoped state in a global
  Layer or singleton.
- Effect-native domain and service code obtains the current time from `Clock`
  or `DateTime.now`; do not call `Date.now()` or `new Date()` to read the current
  clock inside those flows. Direct platform time is acceptable in a deliberate
  host adapter or pure parsing/formatting code that is not reading "now".
- Use Effect scheduling and interruption primitives when cancellation or
  deterministic testing matters. Other platform APIs can be wrapped once in an
  explicit host adapter.

## Runtime Boundaries

The normal shape is one runtime execution bridge at each real host boundary,
with Layer ownership matched to the host lifecycle.

For a one-shot executable, provide the complete Layer and run once:

```ts
const program = handler(request).pipe(Effect.provide(AppLayer))
return Effect.runPromise(program)
```

For a long-lived Worker, server, or framework, do not rebuild a resourceful
application Layer for every request. Build a lifecycle-owned `ManagedRuntime`
or capture an Effect `Context` once, re-enter it from each foreign callback, and
dispose/release it at the host shutdown boundary when the host provides one. A
per-request Layer is appropriate only for resources whose ownership is
genuinely request-scoped.

Inside domain and service Effect code, compose with `yield*` or combinators;
never call `runPromise`, `runSync`, or create another `ManagedRuntime` merely to
escape the type system.

Legitimate exceptions include executable entrypoints and foreign host callbacks
that capture an Effect `Context` and re-enter with `Effect.run*With`, or use a
lifecycle-owned `ManagedRuntime` through its runner methods. Registration and
teardown remain under explicit acquisition and release. The reviewer must
verify that lifecycle rather than flagging the runner by syntax alone.

## Schema And Config

Schema decoder and encoder functions are compiled. Hoist stable compilers out
of per-request functions and loops:

```ts
const decodeGrant = Schema.decodeUnknownEffect(TransactionGrantSchema)

// Unnamed Effect.fn: reusable stack boundary without an operation span.
export const parseGrant = Effect.fn(
  (input: unknown) => decodeGrant(input),
)
```

- A schema supplied dynamically cannot be hoisted to module scope. Compile it
  once at the narrowest stable factory/handler-construction boundary.
- Inside Effect code, prefer Effect-returning Schema APIs so parse failures stay
  typed; do not use a synchronous decoder and catch it as an exception.
- Keep runtime Schema, static types, encoded forms, persisted values, and tests
  in agreement.
- Use typed `Config` and injectable providers for environment configuration
  when the package has adopted them. Do not read mutable globals throughout
  domain code.
- Effect Schema must not silently replace Flarex `ValidatorJson` or Convex-style
  validation semantics. Respect the protocol owner.

## Observability And Boundaries

- Put named spans on meaningful operations: trusted request handlers, service
  calls, persistence/transaction operations, queue handoffs, and external
  integrations. Tiny helpers should usually inherit the active span.
- Use Effect logging and structured annotations. Do not use `console.*` in
  production Effect flows.
- Keep secrets, raw credentials, signed grants, and sensitive claims out of
  errors, logs, and span attributes.
- Put high-cardinality request IDs and paths on spans only when appropriate;
  keep metric labels bounded and normalized.
- Preserve causes at integration boundaries and observe defects at adapters,
  not by turning every defect into a domain failure.

## Effect Tests

When `@effect/vitest` is available in the package, prefer:

```ts
it.effect("rejects an expired grant", () =>
  Effect.gen(function* () {
    yield* TestClock.adjust("2 minutes")
    const error = yield* verifyGrant(input).pipe(Effect.flip)
    assert.strictEqual(error._tag, "GrantExpiredError")
  }).pipe(Effect.provide(TestGrantLayer)),
)
```

- Use ordinary `it` for pure synchronous code.
- Use `it.effect`, test Layers, and Effect assertions for Effect programs.
- Use `TestClock` for time and deterministic Effect concurrency primitives for
  fibers, retries, and timeouts.
- Do not add `Effect.run*` or `ManagedRuntime.make` inside individual tests when
  an Effect-aware test runner is available.
- If a package has not adopted `@effect/vitest`, keep any Promise bridge in one
  explicit test adapter/helper rather than repeating manual runtimes. Do not
  demand a new dependency as an incidental P1 fix.
- Test typed failure channels, interruption/cleanup, Layer wiring, and runtime
  decoding—not only successful values.

## Reviewer Ownership

The TypeScript reviewer owns:

- precise `A`, `E`, and `R` channels;
- `Effect.fn.Return` and public/service contract agreement;
- service requirement closure and Layer dependency types;
- Schema `Type`/`Encoded` agreement and tagged-error shapes;
- unsafe assertions, widening, or duplicated types that hide Effect drift.

The code-quality reviewer owns:

- the `fn` / `fnUntraced` / `gen` / pipeline choice;
- meaningful tracing and boundary-safe structured logging;
- at-source error mapping, recovery, retry, and redaction;
- resource Scope, cancellation, structured concurrency, and Layer lifecycle;
- runtime-runner placement, Schema compiler placement, and Effect test style.

Both reviewers retain their broader responsibilities. An Effect checklist does
not replace behavioral, security, transaction, compatibility, performance, or
test-quality review.

## Coverage And Finding Calibration

When Effect is in scope, the final review must include one compact line such as:

```text
Effect coverage: 3 functions, 1 service/Layer, 2 schemas, 1 runtime edge, 4 tests; one fnUntraced exception inspected.
```

An exception must be justified by a concrete API, lifecycle, performance, or
boundary constraint. "Existing local style" is not enough.

- P0-P2 still require their normal correctness, security, data-loss,
  compatibility, reliability, or bounded-impact evidence.
- P3 may be used for an explicit guide violation introduced by the diff, such
  as a reusable `function -> Effect.gen` wrapper, repeated manual test runtime,
  or stable Schema compiler rebuilt per call, even before it becomes a runtime
  bug.
- Do not report pure functions, standalone Effect values, tiny inline
  compositions, dynamic-schema compilation at its stable factory boundary, or
  a documented and lifecycle-safe host runner.

## Local Research Pointers

Use these as focused evidence rather than scanning whole repositories:

- `opensrc/repos/github.com/effect-TS/effect-smol/LLMS.md`
- `opensrc/repos/github.com/effect-TS/effect-smol/ai-docs/src/01_effect/01_basics/02_effect-fn.ts`
- `opensrc/repos/github.com/effect-TS/effect-smol/ai-docs/src/01_effect/02_services/01_service.ts`
- `opensrc/repos/github.com/effect-TS/effect-smol/ai-docs/src/01_effect/04_resources/10_acquire-release.ts`
- `opensrc/repos/github.com/effect-TS/effect-smol/ai-docs/src/09_testing/10_effect-tests.ts`
- `opensrc/repos/github.com/pingdotgg/t3code/docs/operations/effect-fn-checklist.md`
- `opensrc/repos/github.com/pingdotgg/t3code/docs/operations/observability.md`
- `opensrc/repos/github.com/pingdotgg/t3code/tsconfig.base.json`
- `opensrc/repos/github.com/pingdotgg/t3code/oxlint-plugin-t3code/rules/no-inline-schema-compile.ts`
- `opensrc/repos/github.com/pingdotgg/t3code/oxlint-plugin-t3code/rules/no-manual-effect-runtime-in-tests.ts`
