# Flarex Effect Review Guide

This is the shared Effect v4 review guide for the standing
`typescript-diff-reviewer` and `code-quality-diff-reviewer`. Both reviewers must
read it when a changed file imports Effect modules or changes an Effect,
Schema, Config, Context service, Layer, Scope, Fiber, runtime bridge, or
Effect-based test.

This guide is not a request to migrate unrelated legacy code. Review the
changed lines plus the smallest semantically connected operation, service,
Layer, runtime boundary, and direct call path needed to understand them. A
concrete, actionable pre-existing guide violation must be reported when the
diff calls, extends, copies, or materially relies on it; label it
`touched-flow debt` and propose a bounded improvement. Do not roam through
unrelated files or turn a checkpoint into a package-wide migration. Existing
inconsistency is not an exception for new code.

## Authority And Evidence

Apply these sources in order:

1. Flarex's accepted behavior, public contracts, trust boundaries, and the
   exports, types, and source of the Effect version actually installed in this
   workspace.
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
- Use a concise `pipe` for a short linear transformation, recovery, timeout,
  retry, or observability chain; `map` / `flatMap` pipelines remain idiomatic
  for dependent work when they stay clear. Prefer `Effect.gen` when several
  dependent binds, loops, branches, or sequential capabilities are easier to
  read imperatively.
- Do not wrap one clear combinator in a generator, split one logical pipeline
  across repeated one-step `.pipe(...)` calls, or nest pipelines until the
  success and failure flow becomes harder to see. Pattern matching belongs at
  the branch; `pipe` is not a substitute for exhaustive control flow.
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

An explicit violation of the wrapper rule within the review scope must be
reported as a P3 maintainability and diagnostics defect. Raise severity only
when it also erases a failure or requirement type, breaks tracing relied on
operationally, or causes a real correctness/lifecycle problem.

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

## Choose Effect, Option, Result, Or Exit

Effect v4 beta.90 in this workspace exports `Result`, not `Either`. Older Effect
v3 examples that use `Either` or `Effect.either` map conceptually to `Result`
and `Effect.result` here. Do not propose an `Either` import until the installed
version changes.

| Need | Representation | Review guardrail |
| --- | --- | --- |
| Async work, cancellation, typed failure, or injected capabilities | `Effect.Effect<A, E, R>` | Keep expected failures in `E` during normal domain composition |
| Composable internal absence with no failure reason | `Option<A>` | Preserve intentional `null`/optional wire and Convex-facing contracts at their boundary |
| Pure recoverable success/failure that is deliberately data | `Result<A, E>` | Preserve accepted `{ ok }` wire/protocol contracts; do not invent parallel internal outcome types |
| Complete runtime outcome including defects and interruption | `Exit<A, E>` | Use at runtime, lifecycle, supervision, diagnostics, and test boundaries, not routine domain branching |

Apply these conversions deliberately:

- `Effect.result` turns only the typed failure channel into `Result.Failure`;
  defects and interruptions still fail the Effect. Use `Result.match` when both
  branches are intentionally plain data.
- `Effect.option` turns every typed failure into `Option.none` and therefore
  erases its reason; defects and interruptions still fail. Use it only when
  every typed failure truly means ignorable absence. When only
  `NoSuchElementError` means absence, prefer `Effect.catchNoSuchElement` so
  other failures remain visible.
- `Effect.exit` captures the full `Cause`. Inspect it with `Exit.match` when a
  host adapter, fiber owner, cleanup path, test, or diagnostic boundary must
  distinguish typed failure, defect, and interruption.
- Use `Option.fromNullishOr` at a nullable boundary when internal composition
  benefits from `Option`. Do not force `Option` into public or persisted shapes
  whose specified representation is `null` or an omitted field.
- Do not convert an Effect to `Result` or `Option`, immediately branch with
  nested `if` statements, and then rebuild Effects. Keep the failure in `E` and
  use `Effect.catchTag` / `Effect.catchTags` or `Effect.matchEffect` unless
  treating the outcome as data is the actual contract.
- Do not replace an accepted public, wire, or persisted `{ ok }` union merely
  for library uniformity. Convert at an internal boundary only when composition
  benefits and convert back at the protocol owner.

## Matching And Conditional Flow

Use the smallest construct that makes the cases explicit:

- An ordinary guard clause, `if`, or ternary is correct for one simple pure
  predicate. Effect style does not mean replacing every Boolean with a
  combinator.
- Use `Match.typeTags` or `Match.valueTags` for a `_tag` discriminated union
  when every variant must be handled. Use `Match.type` with `Match.when` /
  `Match.tag` / `Match.tags` and finish with `Match.exhaustive` for more
  structural cases. A native exhaustive `switch` with a `never` assertion is
  also valid.
  A final default branch that silently treats every future variant as the last
  known case is not exhaustive.
- Use `Option.match`, `Result.match`, and `Exit.match` when folding those data
  types. Their discriminants are public, so one direct local guard is valid;
  avoid scattering repeated `_tag` / `isSome` / `isFailure` checks throughout
  a flow when one exhaustive fold is clearer.
- Use `Effect.match` when both handlers return plain values and
  `Effect.matchEffect` when a handler performs Effect work. Wrapping both
  branches in `Effect.succeed` only to use `matchEffect` is needless ceremony.
- Use `Effect.matchCause` / `Effect.matchCauseEffect` only when the full Cause is
  intentionally part of boundary handling. Normal typed recovery belongs in
  `Effect.catchTag` / `Effect.catchTags` and must not accidentally normalize
  defects.
- `Effect.when` accepts an effectful Boolean and returns an `Option` so the
  skipped case is explicit. Use a plain guard when the condition is already a
  pure Boolean and no optional result is needed.

For example, an internal route dispatcher should make new variants a compile
error:

```ts
import { Match } from "effect"

type InternalRoute =
  | { readonly _tag: "Deployment"; readonly request: Request }
  | { readonly _tag: "Registry"; readonly request: Request }

const dispatch = Match.typeTags<InternalRoute>()({
  Deployment: ({ request }) => handleDeployment(request),
  Registry: ({ request }) => handleRegistry(request),
})
```

Prefer that shape over chained tag checks with an implicit final fallback. For
Effect success/failure, fold directly instead of manufacturing an internal
intermediate `{ ok: boolean }` value:

```ts
const response = operation.pipe(
  Effect.match({
    onFailure: toFailureResponse,
    onSuccess: toSuccessResponse,
  }),
)
```

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
- Do not put JavaScript `try/catch` around yielded Effects or wrap an entire
  Promise-based domain workflow in one `Effect.tryPromise`. Keep JavaScript
  `try/catch` inside a pure compatibility helper or the narrow foreign call it
  actually guards, then map the failure once at the Effect boundary.
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
- In beta.90, `Layer.effect` and `Layer.effectContext` run construction in the
  Layer's Scope and remove the `Scope` requirement. There is no
  `Layer.scoped` export. Use `Effect.acquireRelease` or the matching scoped
  primitive inside Layer construction whenever acquisition owns cleanup.
- Use `Layer.succeed` for an already-created, lifecycle-free value and
  `Layer.effect` for effectful or scoped construction. Compose dependencies
  with Layers and provide the finished graph at an application or test
  boundary rather than repeatedly providing services inside domain methods.
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

## HTTP And Foreign Capabilities

For ordinary outbound HTTP inside Effect-native services, prefer the installed
`effect/unstable/http` service:

Flag an Effect veneer that keeps a second JavaScript error system inside it:

```ts
const load = Effect.tryPromise({
  try: async () => {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error("HTTP " + response.status)
      return await response.json()
    } catch (cause) {
      console.error("request failed", cause)
      throw cause
    }
  },
  catch: (cause) => new UpstreamError({ cause }),
}).pipe(Effect.catch(() => Effect.succeed(undefined)))
```

That shape duplicates catching and logging, treats status and decoding as
untyped exceptions, and finally erases the failure. Prefer one typed boundary:

```ts
import { Effect, Schema } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientResponse,
} from "effect/unstable/http"

const Policy = Schema.Struct({ id: Schema.String })

export const loadPolicy = Effect.fn("PolicyClient.load")(function* (
  url: string,
) {
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.filterStatusOk,
  )
  const response = yield* client.get(url)
  return yield* HttpClientResponse.schemaBodyJson(Policy)(response)
})

export const HttpLive = FetchHttpClient.layer
```

Review the whole HTTP contract, not only the transport call:

- Inject `HttpClient.HttpClient` into the service and provide
  `FetchHttpClient.layer` at the host composition boundary. This keeps tests,
  tracing, interruption, and transport substitution under Layer ownership.
- Build requests with `HttpClientRequest`, make accepted status codes explicit,
  and decode bodies with `HttpClientResponse` Schema helpers. Raw
  `response.json() as Type` is not runtime validation.
- Apply timeouts and bounded retry policy at the integration boundary. Retry
  only transient failures and requests that are safe to repeat; never add
  generic retries to non-idempotent writes without an idempotency contract.
- Flag domain/service code that combines raw global `fetch`, nested JavaScript
  `try/catch`, manual `response.ok` checks, unchecked JSON, and repeated error
  wrapping when the touched flow can use the Effect HTTP service.
- Do not mechanically replace Cloudflare Durable Object or service-binding
  `Fetcher.fetch` calls. They are platform capability calls, not necessarily
  ordinary Internet HTTP. Wrap them once behind a narrow injected adapter with
  typed errors, cancellation, status/decoding policy, and lifecycle ownership.
- `Effect.tryPromise` remains correct at a real foreign Promise boundary. The
  problem is scattering adapters or using one giant wrapper as an Effect veneer
  over a nested Promise/throw/catch subsystem.

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
- Match, conditional, `Option` / `Result` / `Exit`, and HTTP composition choice;
- meaningful tracing and boundary-safe structured logging;
- at-source error mapping, recovery, retry, and redaction;
- resource Scope, cancellation, structured concurrency, and Layer lifecycle;
- runtime-runner placement, Schema compiler placement, and Effect test style.

Both reviewers retain their broader responsibilities. An Effect checklist does
not replace behavioral, security, transaction, compatibility, performance, or
test-quality review.

## Coverage And Finding Calibration

When Effect is in scope, the final review must include one compact line covering
both changed constructs and directly connected touched-flow constructs, such as:

```text
Effect coverage: 3 functions, 1 service/Layer, 2 schemas, 1 runtime edge, 4 tests; one fnUntraced exception inspected.
```

An exception must be justified by a concrete API, lifecycle, performance, or
boundary constraint. "Existing local style" is not enough.

- P0-P2 still require their normal correctness, security, data-loss,
  compatibility, reliability, or bounded-impact evidence.
- Report at least P3 for an explicit guide violation introduced by the diff or
  pre-existing in the materially touched flow, such as a reusable
  `function -> Effect.gen` wrapper, nested runtime, non-exhaustive tagged
  dispatch, raw-`fetch` error subsystem, repeated manual test runtime, or stable
  Schema compiler rebuilt per call, even before it becomes a runtime bug.
- Mark a pre-existing finding as `Touched-flow debt (pre-existing)` and explain
  exactly how the diff exercises, extends, copies, or relies on it. Recommend
  the smallest behavior-preserving same-slice correction. If that correction
  changes a public contract, trust/transaction boundary, or materially expands
  the approved slice, report it as an adjacent follow-up instead of silently
  demanding a broad rewrite.
- The main thread should fix bounded touched-flow debt in the current
  checkpoint when tests can preserve behavior and the approved scope does not
  change. Otherwise it must triage the finding explicitly; a reviewer must not
  suppress it merely because the problematic line predates the diff.
- Do not report pure functions, standalone Effect values, tiny inline
  compositions, dynamic-schema compilation at its stable factory boundary, or
  a documented and lifecycle-safe host runner.

## Local Research Pointers

Use these as focused evidence rather than scanning whole repositories:

- `opensrc/repos/github.com/effect-TS/effect-smol/LLMS.md`
- `opensrc/repos/github.com/effect-TS/effect-smol/ai-docs/src/01_effect/01_basics/02_effect-fn.ts`
- `opensrc/repos/github.com/effect-TS/effect-smol/ai-docs/src/01_effect/02_services/01_service.ts`
- `opensrc/repos/github.com/effect-TS/effect-smol/ai-docs/src/01_effect/04_resources/10_acquire-release.ts`
- `opensrc/repos/github.com/effect-TS/effect-smol/ai-docs/src/50_http-client/10_basics.ts`
- `opensrc/repos/github.com/effect-TS/effect-smol/migration/v3-to-v4.md`
- `opensrc/repos/github.com/effect-TS/effect-smol/ai-docs/src/09_testing/10_effect-tests.ts`
- `opensrc/repos/github.com/pingdotgg/t3code/docs/operations/effect-fn-checklist.md`
- `opensrc/repos/github.com/pingdotgg/t3code/docs/operations/observability.md`
- `opensrc/repos/github.com/pingdotgg/t3code/apps/server/src/vcs/VcsProcess.ts`
- `opensrc/repos/github.com/pingdotgg/t3code/infra/relay/src/agentActivity/ApnsClient.ts`
- `opensrc/repos/github.com/pingdotgg/t3code/tsconfig.base.json`
- `opensrc/repos/github.com/pingdotgg/t3code/oxlint-plugin-t3code/rules/no-inline-schema-compile.ts`
- `opensrc/repos/github.com/pingdotgg/t3code/oxlint-plugin-t3code/rules/no-manual-effect-runtime-in-tests.ts`
