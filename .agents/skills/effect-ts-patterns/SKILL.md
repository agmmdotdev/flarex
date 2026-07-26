---
name: effect-ts-patterns
description: Apply idiomatic, version-correct Effect TypeScript patterns during implementation, refactoring, and review. Use whenever code imports or should use Effect, Option, Result or Either, Exit, Match, Schema, Encoding, Config, Context, Layer, Scope, Fiber, Ref, persistent Effect collections, Effect HTTP, Effect tests, runtime bridges, typed Effect errors, encoded-data transforms, database codecs, runtime immutability, domain-first module organization, service contracts, Layer composition, or Context lifecycle ownership; when converting Promise, try/catch, nullable, coercion, ad-hoc result unions, scattered Object.freeze usage, manual dependency threading, or mixed service/adapter files into deliberate Effect and TypeScript designs; or when touched neighboring Effect code may otherwise be copied as precedent.
---

# Effect TypeScript Patterns

Apply Effect as a coherent programming model, not as a thin wrapper around
ordinary Promise, exception, nullable, or ad-hoc union code.

## Execute the workflow

1. Read the repository instructions and any project-owned Effect guide.
2. Inspect the installed Effect version, exports, and types before choosing
   version-specific APIs. Do not mix v3 and v4 examples.
3. Inspect the changed construct plus the smallest connected operation,
   service or Layer, runtime boundary, and direct tests. Treat neighboring code
   as migration evidence, not automatic precedent.
4. Classify the construct and representation before editing.
5. Implement the clearest semantically correct Effect pattern.
6. Actively correct a concrete bounded pattern violation in the touched flow
   when behavior can be preserved and focused validation is available.
7. Verify success, failure, and requirement channels, lifecycle ownership, and
   boundary conversions.
8. Run focused typechecks and tests for the changed boundary.

Do not perform a package-wide migration without approval. Do not use Effect
ceremony merely to replace a clear pure function, Boolean guard, public wire
shape, or framework-required signature.

## Classify the construct

Use these defaults unless repository or installed-version evidence requires a
different form:

| Construct | Default |
| --- | --- |
| Pure calculation or type guard | Ordinary TypeScript function |
| Standalone Effect value | `Effect.gen(...)` or a concise pipeline |
| Reusable observable operation | Named `Effect.fn("Domain.operation")` |
| Reusable internal operation needing a stack boundary | Unnamed `Effect.fn(...)` when supported |
| Service method implementation | Contract-typed named `Effect.fn` |
| Demonstrated zero-instrumentation or hot path | `Effect.fnUntraced(...)` when supported and justified |
| Short linear transform, recovery, timeout, retry, or logging chain | `pipe` with focused combinators |
| Several dependent binds, loops, or branches | `Effect.gen` inside the operation boundary |
| Foreign callback or application entrypoint | One lifecycle-owned runtime bridge |

Choose `pipe`, generator composition, and collection combinators from their
evaluation semantics, not spelling preference:

- For eager `Option` and `Result` values, use a short `map` / `flatMap`
  pipeline for one linear transformation or dependent step. Use the installed
  `gen` when several successes must be named, branches or loops depend on them,
  or later calls must not be constructed after an earlier absence or failure.
  Use `all` only for independent members.
- Expressions used to build an array or record for `Option.all` or `Result.all`
  run before the combinator can inspect them. A lazy iterable may instead defer
  member creation and stop consumption at the first absence or failure. Choose
  `gen` when direct call-level short-circuiting is part of the behavior.
- `Effect` values are lazy descriptions, so a short pipeline and `Effect.gen`
  both preserve execution laziness. Choose between them by dependency and
  readability. Use `Effect.all` only when member independence and its ordering,
  concurrency, failure, interruption, and cancellation policy match the
  contract. Ordinary JavaScript or factory calls used to construct the input
  collection still run eagerly.
- `Exit` is a completed outcome, not a normal sequencing abstraction. Transform
  or fold it only at a runtime, lifecycle, diagnostic, or test boundary that
  owns its complete `Cause`; keep ordinary dependent work in `Effect`.

Refactor the whole composition shape, not each propagation guard mechanically.
One transformation or dependent step usually reads as a short `map` / `flatMap`
pipeline; several named or dependent successes usually read as `gen`. Preserve
the original validation, effect-execution, and first-failure order either way.

Do not write a plain reusable function whose body only returns
`Effect.gen(...)` when the installed version provides the appropriate
`Effect.fn` boundary. Do not pipe the function value returned by `Effect.fn` as
though it were an Effect; use the definition-time transforms supported by the
installed API or pipe each invocation.

## Choose the representation deliberately

| Need | Representation |
| --- | --- |
| Async work, cancellation, typed failure, or injected capabilities | `Effect.Effect<A, E, R>` |
| Intentional internal absence with no failure reason | `Option<A>` |
| Pure recoverable success or failure deliberately retained as data | Effect v4 `Result<A, E>` or the installed-version equivalent |
| Complete outcome including defects and interruption | `Exit<A, E>` |

Keep expected failures in `E` during normal domain composition. Convert only
when the outcome itself becomes data:

- Use `Option` only when every removed error reason truly means absence.
- Use `Result` or `Either` only for a pure value-level branch or a contract
  deliberately carrying success/failure as data.
- Use `Exit` at runtime, lifecycle, supervision, diagnostic, and test
  boundaries that need the full `Cause`; do not use it for ordinary domain
  branching.
- Preserve specified `null`, omitted-field, `{ ok }`, and serialized public or
  persistence shapes at their owning boundary. Convert internally only when
  composition benefits, then convert back once.
- Prefer `Option.match`, `Result.match` or `Either.match`, and `Exit.match` for
  exhaustive folds. One direct local discriminant guard remains valid when it
  is clearer.

Read [references/pattern-catalog.md](references/pattern-catalog.md) whenever the
task involves representation choice, matching, services and Layers, foreign
effects, runtime boundaries, Schema, HTTP, concurrency, runtime immutability,
value ownership, managed state, persistent collections, domain organization,
service/Layer separation, Context lifetimes, composition roots, or Effect tests.

Read [references/curated-examples.md](references/curated-examples.md) when the
task introduces a pattern unfamiliar to the codebase, refactors copied
neighboring Effect code, or needs a concrete comparison between `Effect.fn`,
`Effect.gen`, pipelines, `Option`, `Result`, `Exit`, and `Match`. Load only the
relevant example section rather than copying the whole catalog into the task.

## Preserve all Effect channels

For every reusable operation inspect:

```ts
Effect.Effect<Success, Failure, Requirements>
```

- Keep `Success` aligned with runtime values, Schema decoders, and wire types.
- Keep expected failures narrow, tagged, and distinguishable; do not widen to
  `unknown` or global `Error` to make composition compile.
- Keep real dependencies in `Requirements` until a Layer or adapter provides
  them. Do not hide requirements with casts or repeated local provisioning.
- Use the installed version's return-type helper for exported, generic,
  overloaded, or service-boundary functions when inference needs stabilizing.

Load the repo-local `.agents/skills/effect-ts-error-handling/SKILL.md` skill
when the task adds or changes failure classification, recovery, retry, foreign
error mapping, or boundary logging. Verify its operator names against the
installed Effect major version.

## Act on touched-flow debt

Do not stop at recognizing the preferred pattern. When the current change
calls, extends, copies, or materially relies on a concrete pattern violation,
make the smallest behavior-preserving correction in the same slice if:

- it does not change an accepted public contract, trust boundary, transaction
  boundary, or lifecycle owner;
- it does not require a broad migration; and
- focused tests can preserve behavior.

Otherwise report the debt and its smallest follow-up explicitly. "Neighboring
code already does this" is not a valid exception.

## Verify the result

Before finishing, confirm:

- the construct and representation choices are deliberate;
- tagged or structural unions are exhaustive where future variants matter;
- foreign throws and rejected promises are mapped once at their source;
- resources, fibers, Layers, and runtimes have explicit lifecycle owners;
- domain modules, service contracts, live adapters, and composition roots have
  deliberate responsibilities; Layer construction does not execute ordinary
  business work;
- readonly types, runtime freezes, persistent collections, and managed state
  match the required ownership and mutation semantics;
- stable Schema compilers are not rebuilt per call or loop;
- Effect-aware tests cover typed failures and lifecycle behavior when relevant;
- no new manual runtime, raw-fetch error subsystem, nested try/catch veneer, or
  ad-hoc result type duplicates an installed Effect abstraction without a
  concrete boundary reason.
