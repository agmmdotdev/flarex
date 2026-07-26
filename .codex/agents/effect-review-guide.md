# Flarex Effect Implementation And Review Overlay

This is the Flarex-specific overlay for the repo-local
`.agents/skills/effect-ts-patterns/SKILL.md`. Any agent that
implements or refactors code importing Effect modules, or plain TypeScript
whose semantics should use Effect, Option, Result, Exit, Match, Schema, Config,
a Context service, Layer, Scope, Fiber, runtime bridge, Effect HTTP flow, typed
Effect errors, or Effect-based tests, must read the repo-local skill and this
file before acting. During standing checkpoint review, the TypeScript reviewer
must first assess every materially changed TypeScript operation for that
applicability and solely owns the resulting Effect implementation-quality
review.

The repo-local skill owns reusable construct selection, workflow, examples,
and active touched-flow improvement. This overlay owns Flarex's
installed-version facts, public contracts, trust boundaries, Cloudflare
differences, review scope, and reviewer responsibility split.

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
2. The repo-local `.agents/skills/effect-ts-patterns/SKILL.md` skill and its
   optional pattern and example references.
3. The local Effect-smol snapshot at
   `opensrc/repos/github.com/effect-TS/effect-smol`, especially `LLMS.md`,
   `.patterns/`, migration notes, and representative source.
4. The repo-local `.agents/skills/effect-ts-error-handling/SKILL.md` skill for
   failure classification, mapping, recovery, retry, and boundary logging.
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
- Beta.90 provides `Option.gen`, `Result.gen`, and `Effect.gen`. Its `Exit`
  module has `map` and `match`, but no `gen`, `all`, or `flatMap`; keep ordinary
  sequencing in `Effect` and retain `Exit` for completed-outcome boundaries.
- `Result.gen` and `Option.gen` short-circuit before later yielded decoder calls.
  Array and record member expressions are evaluated before `Result.all` or
  `Option.all` inspects their input, while a lazy iterable can defer member
  creation and is consumed only through the first failed or absent member. Do
  not replace sequential decoders with `all` until that construction and
  call-level short-circuiting behavior is deliberate.
- Broad recovery uses `Effect.catch`, `Effect.catchCause`, and
  `Effect.catchDefect`; `catchTag` and `catchTags` remain available. Do not use
  v3 `catchAll*` names here.
- `Effect.option` discards every typed failure reason. Prefer
  `Effect.catchNoSuchElement` when only missing-value failure means absence.
- `Effect.exit` captures the full Cause and belongs at runtime, lifecycle,
  supervision, diagnostics, or test boundaries.
- Effect `Encoding` decoders such as hex and base64 return `Result`; use
  `Effect.fromResult` when the parse enters an Effect flow. The installed
  Schema also provides encoded/decoded transforms including
  `FiniteFromString`, `BigIntFromString`, and `Uint8ArrayFrom*`.
- `Schema.NumberFromString` uses JavaScript number coercion. It is not a
  substitute for explicit lexical, integer, safe-range, or domain checks.
- `Option.fromNullishOr` converts nullable boundary values while preserving all
  non-nullish values.
- Named `Effect.fn("Domain.operation")` creates an observable operation span;
  unnamed `Effect.fn` provides a reusable stack boundary without that implicit
  span. `Effect.fnUntraced` drops both and requires a concrete reason.
- Definition-time transforms are passed to the installed `Effect.fn` builder;
  do not pipe a function value as though it were an Effect.
- `Layer.effect` and `Layer.effectContext` run construction in the Layer's
  Scope. This version does not export `Layer.scoped`.
- `Data.Class`, `Data.TaggedClass`, Schema decoding, and readonly TypeScript
  fields do not imply runtime deep freezing. Persistent Effect collections and
  the `Ref` family solve different functional-update and managed-state needs.
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
  clearer. A guard that checks `Result.isFailure(value)` and later projects
  `value.success`, or checks `Result.isSuccess(value)` and later projects
  `value.failure`, is manual unwrapping rather than a simple predicate. Inspect
  the whole flow; repeated or dependent cases normally belong in `Result.map`,
  `Result.flatMap`, or `Result.gen` with the same validation order and
  first-failure behavior.
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
- Apply
  `roadmaps/effect-native-guidance/11-data-validation-and-trust-boundaries.md`
  when validation changes. Schema proves declared structure and intrinsic
  value invariants; it does not prove authorization, crypto, freshness,
  database authority, runtime pins, or WeakMap-backed process-local capability
  authenticity. Keep those owners explicit and preserve defects across broad
  foreign catches.
- Apply
  `roadmaps/effect-native-guidance/12-encoded-data-and-database-codecs.md`
  when a touched flow converts number/text, UTF-8/bytes, JSON, hex/base64, or
  database rows and parameters. Keep total native conversions pure; require a
  named decoder for invalid, lossy, non-canonical, or foreign input. Preserve
  defensive byte copies and project-owned canonical codecs where they express
  ownership or protocol semantics.
- Apply
  `roadmaps/effect-native-guidance/13-runtime-immutability-and-value-ownership.md`
  when a touched flow freezes, clones, shares, or evolves runtime values. Copy
  caller-owned inputs before freezing, distinguish shallow freeze from deep
  ownership, preserve canonical values and WeakMap-backed capability handles,
  and use readonly types, persistent collections, or `Ref` only when their
  distinct semantics fit.
- Apply
  `roadmaps/effect-native-guidance/14-domain-services-layers-and-composition.md`
  when a touched Effect flow introduces, splits, moves, or materially extends a
  domain module, Context service, live Layer, composition root, runtime bridge,
  or scoped startup process. Organize by domain, keep pure logic plain, preserve
  capability cardinality and Context lifetime, and do not execute ordinary
  business work during Layer construction.

## Services, Boundaries, And Tests

- Use `Effect.fn` for reusable Effect-producing operations and service method
  implementations; use `Effect.gen` for Layer construction, standalone Effect
  values, test bodies, and clear dependent orchestration inside an operation.
- Use `pipe` for short linear transformation, recovery, timeout, retry, and
  observability chains. Do not create one-combinator generators or nested
  pipelines that obscure success, failure, or lifecycle flow.
- For `Option` and `Result`, use a short `map` / `flatMap` pipeline for one
  linear transformation, the installed generator form when several success
  values are needed or later calls must not occur after an earlier `None` or
  failure, and `all` only for independent members after checking eager member
  construction. For `Effect`, choose a pipeline or `Effect.gen` by dependency
  and readability, and use `Effect.all` only after checking execution order,
  concurrency, failure, interruption, and cancellation. Preserve full-Cause
  ownership when transforming or folding `Exit` values.
- Review the whole composition shape rather than asking for a separate pipeline
  around every propagation guard. Prefer a short `map` / `flatMap` pipeline for
  one linear transformation or dependent step, and the installed `gen` for
  several named or dependent successes whose order matters.
- Map foreign throws and rejected promises once at their narrow source. Emit
  tagged errors there and do not repeatedly rewrap them downstream.
- For Drizzle work, read
  `roadmaps/effect-native-guidance/09-drizzle-effect-postgres.md`. Do not demand
  removal of the one necessary Promise adapter while Flarex remains on Drizzle
  0.45, do report repeated query-level wrappers, and do not recommend the
  Effect v3 `@effect/sql-drizzle` package in this Effect v4 workspace. Treat
  Drizzle v1 RC plus `@effect/sql-pg` as a preflighted migration candidate,
  not an automatic cleanup.
- Keep runtime runners at real adapter boundaries. Long-lived Workers and
  servers must own resourceful runtimes or Contexts for their lifecycle rather
  than rebuilding them per request.
- Compose and provide Layers at application, host, or test boundaries. Do not
  capture request-, Worker-, or Durable Object-scoped state in a global Layer.
- Keep service contracts separate from substantial live adapters and compose
  local domain graphs before the host graph. A small single implementation may
  keep a static Layer on its service; do not create empty folder or service
  ceremony.
- Use `Layer.effectDiscard` only for startup work that provides no service.
  Business effects remain on service methods; background fibers started by a
  Layer must be scoped to it.
- Do not model dynamically repeated instances as singleton Context tags. Use a
  scoped factory/plain value when several instances of one kind must coexist.
- Keep fibers structured, scoped, supervised, joined, or explicitly
  interrupted.
- Use Effect time in Effect-native domain/service code. Direct platform time is
  allowed in deliberate host adapters and pure parsing or formatting helpers.
  Follow `roadmaps/effect-native-guidance/10-time-clock-and-datetime.md`:
  distinguish live-time acquisition from deterministic conversion, preserve
  database-authoritative transaction time, and do not hide `Date.now()` inside
  `Effect.sync` because that still bypasses `TestClock`.
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

The TypeScript reviewer owns the Effect-applicability assessment for every
materially changed TypeScript operation, including code initially written with
plain Promise, async/try/catch, throws, nullability, ad-hoc outcomes, or manual
dependency threading. It must recommend a bounded transformation when the
operation's recoverable failure, async/cancellation, capability, lifecycle, or
domain-service semantics call for Effect, Result, Option, a service, or a
Layer. Existing Effect imports are not a prerequisite. Pure total helpers,
simple guards, protocol-owned shapes, framework-required signatures, deliberate
compatibility wrappers, defects, and narrow foreign adapters remain plain when
their contracts require it; this is not permission for a package-wide
migration.

The TypeScript reviewer also owns all Effect implementation-quality review
alongside its general TypeScript responsibilities: precise `A`, `E`, and `R`;
public and service contract agreement; return-type stabilization; `fn` / `fnUntraced` /
`gen` / pipeline choice; Option, Result, Exit, Match, and conditional flow;
error provenance and retry; Schema decoded/encoded agreement and compiler
placement; database row/parameter type agreement; tagged-error shapes; Effect
HTTP composition; observability and redaction; Scope, fibers, Layer and runtime
lifecycle; state and collection ownership; mutation isolation; compile-time
versus runtime immutability; domain/module and composition-root responsibility;
Effect test style; unsafe widening and assertions; package dependency direction;
and reuse of stable repo types.

The code-quality reviewer does not apply this overlay as an Effect style or API
checklist. It retains independent ownership of behavioral and data correctness,
trust boundaries, transactions and concurrency, reliability, performance,
operability, general maintainability degradation, obvious defects, plausible
failure modes, and test adequacy in all code. When an Effect implementation has
a concrete systems consequence, that reviewer reports the consequence without
duplicating Effect-pattern analysis.

## Coverage And Finding Calibration

For every TypeScript diff, the reviewer reports its applicability pass:

```text
Effect applicability: 9 operations assessed; 2 transformations recommended; 1 deliberate Promise boundary inspected.
```

When Effect is used or should be used, the TypeScript reviewer also reports one
compact line covering changed constructs and the directly connected touched
flow:

```text
Effect coverage: 3 functions, 1 service/Layer, 2 schemas, 1 runtime edge, 4 tests; one fnUntraced exception inspected.
```

Report a concrete standard violation introduced by the diff or pre-existing in
its materially connected flow. A maintainability, diagnostics, or testability
violation is normally P3; higher severity requires normal correctness,
security, compatibility, data-loss, reliability, or operational evidence.
Label pre-existing findings `Touched-flow debt (pre-existing)` and explain the
connection plus the smallest safe correction.

A changed plain TypeScript flow that semantically requires an Effect-native
operation, Result, Option, service, or Layer is a reportable violation even if
no changed file imports Effect. The finding must name the semantic reason and
the smallest target transformation; a generic preference for Effect syntax is
not sufficient.

Do not report pure helpers, standalone Effect values, tiny inline
compositions, dynamic-schema compilation at its stable factory boundary, or a
documented lifecycle-safe host runner. An exception needs a concrete API,
lifecycle, performance, or boundary reason; neighboring style is not enough.

## Focused Local Evidence

Use these paths instead of scanning entire repositories:

- Repo-local examples:
  `.agents/skills/effect-ts-patterns/references/curated-examples.md`
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
