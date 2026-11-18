---
name: effect-ts-patterns
description: Choose Effect constructs for runtime data contracts, failures, absence, composition, services, resources and tests, including plain TypeScript that needs those semantics. Use during implementation, refactoring or review; preserve pure helpers and protocol/framework boundaries.
---

# Effect TypeScript Patterns

Read repository instructions and its Effect overlay; verify installed exports.
Examples target v4. For the connected operation identify its data contract,
outcomes, evaluation order, dependencies, and resource lifetime. Apply the
standard while writing code, even when Effect imports are absent; stay within
authorized scope.

## Representation

| Semantics | Owner |
| --- | --- |
| Runtime structure, encoded form, intrinsic value invariants | Schema; derive types from its authoritative decoder |
| Pure recoverable verdict retained as data | v4 Result |
| Async/cancellable work, expected execution failure, injected capabilities | Effect<A, E, R> |
| Intentional absence with no failure reason | Option |
| Completed outcome including defects/interruption | Exit with full Cause at an owning boundary |
| Total pure calculation, simple established-value guard, required framework signature | Plain TypeScript |
| In-process expected error | Data.TaggedError or existing tagged owner |
| Error payload requiring encoding/decoding | Schema-backed tagged error |
| Startup settings | Config; structured validation at construction |
| Shared capability and dependency/resource construction | Context service, Layer and Scope |
| Multiple instances or borrowed request/transaction capability | Explicit value or scoped factory |
| Lifecycle-owned mutable state / useful structural sharing | Ref family / persistent collections |

Schema and Result/Effect solve different problems. Decode unknown before domain
use; prefer Effect decoding in Effect flow and Result for deliberate pure APIs.
Use Schema.is only for membership without parse diagnostics/transformation;
throwing decoders require a deliberate synchronous startup/framework boundary.

Reuse one authoritative validator/codec rather than adding parallel schemas.
Hoist stable compilers; compile metadata-derived schemas at their stable factory.
Preserve excess-key policy, coercion/defaults, null/undefined, encoded/decoded
forms, and first-error order. Schema does not prove authorization, database
state, clock/freshness, digests, issuer identity, byte ownership, or freezing.
Keep no-getter/prototype/key/cycle/bounded capture where its semantics require it.
"Already typed", boolean returns, and Result/Effect wrappers do not justify
handwritten structural validation. See [data contracts](references/data-contracts.md).

## Composition

- Reusable Effect operations/service methods use Effect.fn; name observable
  operations. Use gen for standalone values, Layer construction, test bodies,
  or dependent orchestration; short map/flatMap/mapError pipelines for linear
  transforms. fnUntraced needs a concrete boundary or measured-performance reason.
- Use the owning gen for several dependent Result/Option successes. Propagate
  with map/flatMap/mapError rather than tag inspection, extraction and reboxing;
  Result.fail originates new failures. Fold only when plain outcome data is
  the boundary contract. Exit is not an ordinary sequencing abstraction.
- Result/Option are eager: array/record members run before all. A lazy iterable
  or gen can preserve construction short-circuiting. Effect values are lazy,
  but their JavaScript factories run eagerly.
- Use all/traverse only for independent work with explicit ordering, failure,
  concurrency and cancellation policy. A shared transaction is not automatically
  parallel-safe. Preserve first-failure order.
- Use match/fold for plain branches, Effect.matchEffect for Effect branches;
  use Match or exhaustive switch/never for growing tagged unions. Keep simple
  guards simple and avoid nested pipelines or one-combinator generator ceremony.

## Failure And Lifetime

- Keep exact A/E/R. Recover specific tagged failures; do not convert to
  Option/Result/Exit merely to inspect and rebuild the same channel.
- Effect.sync defers synchronous work whose unexpected throw is a defect;
  try/tryPromise classify actual foreign throws/rejections. Pure helpers stay
  plain. Apply [error handling](../effect-ts-error-handling/SKILL.md) for changed
  classification, retry, recovery or logging.
- Provide services/Layers at host/application/test composition roots. Separate
  substantial live adapters from contracts; Layer construction owns dependencies,
  resources and startup, not ordinary business effects. Preserve Context
  cardinality; do not put request/transaction state into global services.
- Pair acquisition/release; scope/supervise fibers and join/interrupt them before
  their owner ends. A cancellation signal does not prove foreign work settled.
  Keep one lifecycle-owned runner per real executable/foreign callback edge;
  never runPromise inside Effect code to conceal requirements/failures.
- Use Effect time/Schedule for in-process policy; keep database time and durable
  retry/claim state with persistence. Retry requires per-attempt eligibility,
  bounds, and idempotency/reconciliation.
- Prefer installed Effect HTTP for ordinary outbound requests; platform fetch
  capabilities remain narrow adapters. Preserve byte limits as well as decoding.
- Readonly typing, detached ownership, freezing, Ref and persistent collections
  have different guarantees; none establishes authority or durable state.

## Verification And References

Check named data-contract owners, absence/failure/defect/interruption, evaluation
order, dependency closure, cleanup and mutation ownership. Recommend missing
constructs only for concrete semantic gaps, including plain TypeScript; give the
smallest connected correction. Imports and green lint do not prove quality.

Use focused typechecks and behavioral cases for changed claims: malformed
input, first-failure order, later terminal retry errors, cancellation/cleanup
and replay as relevant. Prefer Effect-aware tests, test Layers and TestClock;
keep one explicit test runner where the package requires a Promise bridge.

Read relevant [catalog](references/pattern-catalog.md) sections for services,
state, time, HTTP and codecs, and [curated examples](references/curated-examples.md)
for comparisons. Load references only for the task's actual boundary.
