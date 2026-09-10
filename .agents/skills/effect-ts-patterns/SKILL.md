---
name: effect-ts-patterns
description: Choose and apply Effect TypeScript constructs during implementation, refactoring, and review. Use for runtime data contracts and validation, typed failures, absence/outcomes, async or cancellable work, injected services, resource lifetimes, and Effect composition, including equivalent handwritten Promise, validator, or result code. Choose Schema, Effect, Result, Option, Exit, gen, pipelines, services, and Scope by semantics; preserve pure helpers and framework or protocol boundaries.
---

# Effect TypeScript Patterns

Choose the construct from the claim, evaluation order, and lifetime it owns.
Apply these decisions while implementing, including where Effect imports are
missing. Import counts and stylistic uniformity are not completion criteria.

## Before choosing an API

Read repository instructions and its Effect overlay first. Verify the installed
major version and relevant exports/types. This skill's examples target Effect v4;
use the installed equivalent in other versions. A repo-local copy and project
contracts take precedence over a global copy or historical source example.

For the smallest connected operation, identify:

1. Data entering/leaving the boundary and its authoritative runtime contract.
2. Expected failures, ordinary absence, defects, and interruption.
3. Which computations are pure, eager, lazy, dependent, or concurrent.
4. Dependencies, resources, mutable state, and their owning lifetime.

Reuse the existing contract owner before adding another interface, validator,
codec, service, or helper. Correct bounded touched-flow gaps inside the approved
slice; broader public, transaction, authority, or lifecycle changes need their
own preflight. Skill compliance never expands the user's authorization.

## Choose the representation

| Need or claim | Default | Important boundary |
| --- | --- | --- |
| Runtime data shape, primitive constraints, encoded form, or stable cross-field invariants | Effect Schema | Derive validated data types from the schema; preserve an existing authoritative validator/codec when its semantics differ |
| Pure recoverable parse or policy verdict retained as data | v4 Result | Schema can produce Result; Result is not a replacement for the data schema |
| Async work, expected failure during execution, cancellation, or injected capabilities | Effect<A, E, R> | Schema can decode into Effect; retain precise success, failure, and requirements |
| Ordinary composable absence with no failure reason | Option<A> | Invalid input, corruption, authorization and I/O failure are not absence |
| Completed outcome including typed failure, defect and interruption | Exit<A, E> with Cause | Runtime, supervision, cleanup, diagnostics and tests; not normal service sequencing |
| Pure total calculation, simple guard on established values, or deliberate framework signature | Plain TypeScript | A large handwritten structural validator does not become exempt merely by returning boolean |
| Expected domain/integration error used only in process | Data.TaggedError or established tagged owner | Use Schema-backed tagged errors when encoding/decoding the error is part of its contract |
| Environment/startup settings | Config, with Schema/typed construction for structured data | Validate at the stable construction boundary; do not reread per operation |
| Shared injected capability | Context service | Keep real requirements visible until composition provides them |
| Dependency construction, resource acquisition and startup | Layer and Scope | Business effects remain service operations; request/transaction state is not global |
| Multiple simultaneous instances or a borrowed request/transaction capability | Explicit value or scoped factory | A Context tag represents one value in a given Context; do not collapse instance identity |
| Managed mutable state in an Effect lifetime | Ref family; stronger coordination when needed | A local accumulator may remain local; Ref is not database authority or a durable lock |
| Functional updates with useful structural sharing | Persistent collections | Preserve ordinary array/record/wire contracts at boundaries |

These choices work together. For example, Schema defines a stored record,
decodeUnknownResult performs a pure decode, and Effect.fromResult enters the
service failure channel. Choose each independently; using Effect.gen does not
establish input validity.

## Schema is the default data-contract owner

For new or materially changed runtime data boundaries:

- Find or define one named schema for required/optional fields, literals, unions,
  primitive types, bounds, and intrinsic cross-field invariants. Keep the schema
  with the domain/protocol owner; derive decoded and encoded types from it where
  possible instead of maintaining a parallel interface and boolean validator.
- Decode unknown input before using it as domain data. Choose the appropriate
  unknown-input decoder: Effect in an Effect-owned flow; Result for a deliberate
  pure API. Schema.is fits a true boolean membership decision with no needed
  parse diagnostics or transformation. Throwing decoders belong only at a
  deliberate synchronous startup/framework/compatibility boundary.
- Compile stable decoders once. Compile metadata-derived schemas once per stable
  definition/factory. Make excess keys, coercion, defaults, null/undefined,
  first-error order and encoded/decoded forms explicit.
- Preserve existing authoritative metadata, public validators and canonical
  codecs. A similarly shaped Schema is not evidence of equivalent behavior.
- Keep current policy, database state, clock comparisons, digest verification,
  admission and issuer/WeakMap identity checks in their owning operations.
  Schema does not establish authority, byte ownership or runtime deep freezing.
- Preserve narrow object-inspection/capture code when it owns getter avoidance,
  prototype/key policy, cycles, resource bounds or authentic reference identity
  that an ordinary structural decode does not establish.

Before retaining handwritten structural validation, name the concrete semantic
reason. "Already typed", "returns boolean", "existing code does it", or wrapping
the checks in Result/Effect is insufficient for a foreign data boundary.
Do not add a second validator merely to introduce Schema.

Read [data-contracts.md](references/data-contracts.md) for data-boundary work,
including database rows, configuration and custom capture exceptions.

## Choose composition and evaluation

| Shape | Use |
| --- | --- |
| Reusable operation or service method | Effect.fn, named when the operation warrants an observable span |
| Standalone lazy computation or Layer construction | Effect.gen or a focused pipeline |
| One or a few linear transformations | map/flatMap/mapError through pipe |
| Several dependent successes, branches or loops | The installed Effect.gen, Result.gen or Option.gen |
| Independent collection members | The owning all/traverse combinator with deliberate evaluation/concurrency/failure policy |
| Both branches become plain values | The owning match/fold; Effect.match for Effects |
| Both branches execute Effects | Effect.matchEffect or focused typed recovery |
| Growing tagged union needs exhaustiveness | Match or exhaustive switch with never |
| One clear local predicate | if, ternary or guard clause |

Preserve first-failure and call order. Result and Option are eager: JavaScript
evaluates an array/record's members before all sees them. A lazy iterable can
short-circuit member construction; gen makes sequential dependency explicit.
Effect members are lazy descriptions, but JavaScript creating those descriptions
still runs eagerly. Do not use Effect.all on a shared transaction unless its
ordering, concurrency and cancellation contract permits that execution.

Do not sequence Result by inspecting its tag, extracting success, and manually
reboxing failure. Use map, flatMap, mapError or gen. Originate a new failure with
Result.fail; fold intentionally at a data boundary. Apply the same distinction
to Option propagation. Exit has no role as a general sequencing abstraction.

Refactor the connected composition, not every if into a separate combinator.
Avoid deeply nested pipelines and one-combinator generators that obscure a
simple flow. A thin function delegating to an existing operation may remain
plain; reusable operations hidden behind anonymous Effect.gen wrappers should
use the appropriate Effect.fn boundary. fnUntraced needs a concrete reason.

## Keep failures and lifetimes explicit

- Retain expected failures in E; use tag-specific recovery. Do not convert to
  Option, Result or Exit merely to inspect and reconstruct the same channel.
- Use Effect.sync for deferred synchronous work whose unexpected throw is a
  defect. Use Effect.try/tryPromise at actual foreign throw/rejection boundaries
  where expected failures must be classified. A pure total helper stays plain.
- Keep one lifecycle-owned runtime bridge per real foreign/executable edge.
  Never call runPromise inside ordinary Effect code to hide R or E.
- Keep service contracts, substantial live Layers and composition roots separate
  when they own different responsibilities. Provide dependencies at the host,
  application or test boundary. A scoped factory is justified by actual
  locality/lifetime/cardinality, not by a preference for manual injection.
- Pair acquisition with release. Fork work into a Scope or another explicit
  supervisor and join/interrupt it before its owner ends. A cancellation signal
  alone does not prove a foreign Promise has settled.
- Use Effect time and Schedule for in-process policies; preserve database time
  and durable retry/claim state with their persistence owner. Safe retry requires
  idempotency/reconciliation and eligibility checked on every failed attempt.
- Use the installed Effect HTTP client for ordinary outbound HTTP where its
  contract fits. Keep platform-specific fetch capabilities at narrow adapters.
- Keep readonly typing, detached ownership, runtime freezing, Ref and persistent
  collections distinct. None substitutes for authorization or durable state.

When failure classification, retry, recovery or logging changes, apply the
sibling [effect-ts-error-handling](../effect-ts-error-handling/SKILL.md) skill.
Read relevant sections of [pattern-catalog.md](references/pattern-catalog.md)
for services, state, time, HTTP, codecs and composition; use
[curated-examples.md](references/curated-examples.md) for concrete comparisons.

## Verify decisions, including missing usage

For a substantive implementation/review, assess the actual touched boundaries:

- **Data contracts:** name each schema/authoritative decoder or justified custom
  boundary; inspect types, strictness, malformed input and ownership semantics.
- **Outcomes:** distinguish absence, expected failure, defect and interruption;
  verify that conversions intentionally preserve or discard information.
- **Composition:** verify evaluation/first-failure order and concurrency policy.
- **Services and lifetimes:** explain service/Layer versus scoped-instance choice,
  requirement closure, cleanup, escaped work and cancellation ownership.
- **Validation:** use focused typechecks and meaningful tests for changed claims,
  including malformed input, later non-retryable failures, cleanup and replay
  when relevant. Prefer Effect-aware tests/TestClock where available; retain one
  explicit test bridge where the package requires it.

Report a missing Schema/Effect/Option/Result/Exit/service abstraction when the
semantics require it, even if the code has no such imports. Give a concrete
bounded correction; do not demand all constructs in every file. Counted imports,
green lint and broad "Effect coverage" alone do not establish these decisions.
