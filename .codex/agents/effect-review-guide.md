# Flarex Effect Implementation And Review Overlay

This is the Flarex-specific overlay for the global
`C:\Users\Admin\.codex\skills\effect-ts-patterns\SKILL.md`. Any agent that
implements, refactors, or reviews code importing Effect modules or changing an
Effect, Option, Result, Exit, Match, Schema, Config, Context service, Layer,
Scope, Fiber, runtime bridge, Effect HTTP flow, or Effect-based test must read
the global skill and this file before acting.

The global skill owns reusable construct selection, workflow, examples, and
active touched-flow improvement. This overlay owns Flarex's installed-version
facts, public contracts, trust boundaries, Cloudflare differences, review
scope, and reviewer responsibility split.

## Active Implementation Rule

Apply the standard while writing code; do not wait for a reviewer to request
it. Inspect the smallest connected operation, service or Layer, runtime
boundary, and direct tests before copying neighboring code. Existing local
inconsistency is migration evidence, not authority.

When a change calls, extends, copies, or materially relies on a concrete Effect
pattern violation, fix the smallest behavior-preserving touched flow in the
same approved slice when focused validation exists. Do not expand into an
unapproved package migration or change a public contract, trust boundary,
transaction boundary, or lifecycle owner without a new preflight.

## Authority And Evidence

Apply these sources in order:

1. Flarex's accepted design, public contracts, trust boundaries, and installed
   Effect exports and types.
2. The global `effect-ts-patterns` skill and its optional pattern and example
   references.
3. The local Effect-smol snapshot at
   `opensrc/repos/github.com/effect-TS/effect-smol`, especially `LLMS.md`,
   `.patterns/`, migration notes, and representative source.
4. The global `effect-ts-error-handling` skill for failure classification,
   mapping, recovery, retry, and boundary logging.
5. Curated T3 Code application evidence under
   `opensrc/repos/github.com/pingdotgg/t3code`.

Effect-smol is the API and library-style authority. T3 Code is application
evidence, not a uniformly correct standard: its
`docs/operations/effect-fn-checklist.md` records unfinished wrapper debt. Never
copy version-specific syntax until it agrees with Flarex's installed Effect
version.

## Installed Effect v4 Facts

Flarex currently installs Effect v4 beta.90. Re-check the lockfile and exports
when the dependency changes.

- Use `Result`, not v3 `Either`, and `Effect.result`, not `Effect.either`.
- Broad recovery uses `Effect.catch`, `Effect.catchCause`, and
  `Effect.catchDefect`; `catchTag` and `catchTags` remain available. Do not use
  v3 `catchAll*` names here.
- `Effect.option` discards every typed failure reason. Prefer
  `Effect.catchNoSuchElement` when only missing-value failure means absence.
- `Effect.exit` captures the full Cause and belongs at runtime, lifecycle,
  supervision, diagnostics, or test boundaries.
- `Option.fromNullishOr` converts nullable boundary values while preserving all
  non-nullish values.
- Named `Effect.fn("Domain.operation")` creates an observable operation span;
  unnamed `Effect.fn` provides a reusable stack boundary without that implicit
  span. `Effect.fnUntraced` drops both and requires a concrete reason.
- Definition-time transforms are passed to the installed `Effect.fn` builder;
  do not pipe a function value as though it were an Effect.
- `Layer.effect` and `Layer.effectContext` run construction in the Layer's
  Scope. This version does not export `Layer.scoped`.
- Effect HTTP client modules are exported from `effect/unstable/http` in this
  beta. Ordinary fetch transport is provided by `FetchHttpClient.layer`; typed
  request/response helpers live in `HttpClientRequest` and
  `HttpClientResponse`. Re-check this unstable API on every Effect upgrade.

## Flarex Contract Rules

- Preserve exact `Effect.Effect<A, E, R>` channels. Do not hide a failure or
  requirement with `unknown`, global `Error`, or an assertion.
- Use `Option` only for intentional internal absence. Preserve public,
  persisted, Convex-facing, and wire-owned `null` or omitted-field shapes.
- Use `Result` for pure recoverable success/failure deliberately retained as
  data. Preserve protocol-owned `{ ok }` unions and convert at most once at the
  protocol boundary.
- Use `Exit` only when the complete Cause is part of the owning boundary.
- Fold outcome values with `Option.match`, `Result.match`, or `Exit.match` when
  both cases are plain data. Direct local discriminant guards remain valid when
  clearer.
- Use `Match.typeTags`, `Match.valueTags`, or an exhaustive `switch` plus
  `never` for tagged unions when future variants must be compile errors. Keep a
  simple Boolean guard simple.
- Use `Effect.match` for plain handlers and `Effect.matchEffect` for effectful
  handlers. Cause-aware matching is a boundary operation, not normal domain
  recovery.
- Pure ValidatorJson evaluation may return `Result`; Effect Schema must not
  silently replace Flarex `ValidatorJson` or Convex-style validation semantics.
- Throwing parser APIs are compatibility wrappers over typed decoders, not a
  second source of validation truth.

## Services, Boundaries, And Tests

- Use `Effect.fn` for reusable Effect-producing operations and service method
  implementations; use `Effect.gen` for Layer construction, standalone Effect
  values, test bodies, and clear dependent orchestration inside an operation.
- Use `pipe` for short linear transformation, recovery, timeout, retry, and
  observability chains. Do not create one-combinator generators or nested
  pipelines that obscure success, failure, or lifecycle flow.
- Map foreign throws and rejected promises once at their narrow source. Emit
  tagged errors there and do not repeatedly rewrap them downstream.
- Keep runtime runners at real adapter boundaries. Long-lived Workers and
  servers must own resourceful runtimes or Contexts for their lifecycle rather
  than rebuilding them per request.
- Compose and provide Layers at application, host, or test boundaries. Do not
  capture request-, Worker-, or Durable Object-scoped state in a global Layer.
- Keep fibers structured, scoped, supervised, joined, or explicitly
  interrupted.
- Use Effect time in Effect-native domain/service code. Direct platform time is
  allowed in deliberate host adapters and pure parsing or formatting helpers.
- For ordinary outbound HTTP use the installed Effect HTTP client with
  injected transport, explicit statuses, Schema decoding, timeout, and safe
  bounded retry.
- Prefer `HttpClientRequest.schemaBodyJson` for typed JSON encoding,
  `HttpClientResponse.schemaBodyJson` or `schemaJson` for decoding, and
  `filterStatusOk` or `matchStatus` for an explicit status contract. Preserve
  response-size limits; Schema decoding does not impose a byte bound.
- Do not mechanically replace Cloudflare service-binding or Durable Object
  `Fetcher.fetch` calls. Keep them behind one narrow typed platform adapter.
- Hoist stable Schema compilers. Compile dynamic schemas once at their narrowest
  stable factory boundary.
- Prefer `@effect/vitest`, test Layers, `TestClock`, typed failure assertions,
  and lifecycle tests when the package provides them. Otherwise keep one
  explicit Promise test bridge instead of repeated manual runtimes.

## Reviewer Ownership

The TypeScript reviewer owns precise `A`, `E`, and `R`; public and service
contract agreement; return-type stabilization; Layer dependency closure;
Schema decoded/encoded agreement; tagged-error shapes; unsafe widening and
assertions; and reuse of stable repo types.

The code-quality reviewer owns `fn` / `fnUntraced` / `gen` / pipeline choice;
Option, Result, Exit, Match, and conditional-flow choice; error provenance and
retry; HTTP composition; observability and redaction; Scope, fibers, Layer and
runtime lifecycle; Schema compiler placement; and Effect test style.

Both reviewers retain their broader correctness responsibilities. The Effect
standard adds to, rather than replaces, behavioral, security, transaction,
compatibility, performance, operability, and test-quality review.

## Coverage And Finding Calibration

When Effect is in scope, each reviewer reports one compact line covering
changed constructs and the directly connected touched flow:

```text
Effect coverage: 3 functions, 1 service/Layer, 2 schemas, 1 runtime edge, 4 tests; one fnUntraced exception inspected.
```

Report a concrete standard violation introduced by the diff or pre-existing in
its materially connected flow. A maintainability, diagnostics, or testability
violation is normally P3; higher severity requires normal correctness,
security, compatibility, data-loss, reliability, or operational evidence.
Label pre-existing findings `Touched-flow debt (pre-existing)` and explain the
connection plus the smallest safe correction.

Do not report pure helpers, standalone Effect values, tiny inline
compositions, dynamic-schema compilation at its stable factory boundary, or a
documented lifecycle-safe host runner. An exception needs a concrete API,
lifecycle, performance, or boundary reason; neighboring style is not enough.

## Focused Local Evidence

Use these paths instead of scanning entire repositories:

- Global examples:
  `C:\Users\Admin\.codex\skills\effect-ts-patterns\references\curated-examples.md`
- Flarex pattern map:
  `roadmaps/effect-native-guidance/README.md` and its focused domain guides
- Effect-smol: `LLMS.md`, `.patterns/effect.md`, `.patterns/testing.md`,
  `packages/effect/src/Effect.ts`, `Option.ts`, `Result.ts`, and `Exit.ts`
- Flarex: `packages/flarex-protocol/src/validator-engine.ts`,
  `packages/flarex-protocol/src/live-query.ts`, and
  `apps/runtime-topology-probe/src/effectBoundary.ts`
- T3 Code: `apps/server/src/vcs/VcsProcess.ts`,
  `infra/relay/src/agentActivity/ApnsClient.ts`,
  `infra/relay/src/environments/EnvironmentConnector.ts`,
  `infra/relay/src/auth/DpopProofs.ts`, and `infra/relay/src/observability.ts`
