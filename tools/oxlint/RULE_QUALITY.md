# Flarex Oxlint Rule Quality Contract

This document records what each custom rule is expected to detect, the
adversarial mutations used to test that claim, and what remains a reviewer or
type-system decision. A passing rule suite proves only these stated syntactic
contracts; it does not prove complete Effect program correctness.

## Quality levels

- **Deterministic:** an imported API or local syntax has one repository-owned
  interpretation. These rules may block directly.
- **Reviewer evidence:** the AST identifies a risky construct, but the owning
  boundary determines whether it is correct. These rules require TypeScript
  reviewer adjudication on changed lines.
- **Audit heuristic:** useful evidence with known intentional gaps. Promotion
  requires zero scoped debt and a separate approved remediation.

## Coverage matrix

| Rule | Role | Adversarial coverage | Intentional non-goals |
| --- | --- | --- | --- |
| `no-banned-type-assertions` | Audit heuristic | `as` and angle-bracket forms; parenthesized banned types; `any`, `never`, `unknown`; permits `as const` and named owner types | Does not resolve aliases to banned types or replace runtime decoding |
| `no-chained-type-assertions` | Audit heuristic | Mixed `as`/angle forms, parentheses, chains longer than two, `as const` interaction | Does not judge a single assertion's soundness |
| `no-known-value-widening` | Audit heuristic | Bindings, assignments, returns, expression bodies, properties, stable aliases, shadowed built-ins | Syntactic evidence only; no compiler type-flow reconstruction |
| `no-module-mocking` | Audit heuristic | Vitest/Jest globals and imports, computed methods, shadowing | Does not ban spies or project-specific test doubles; test rollout remains separate |
| `no-object-parameters` | Audit heuristic | Function/runtime/type signatures, defaults, array/readonly-array/tuple rest collections, lexical alias chains, unions, built-in and generic shadowing | Does not substitute generic alias parameters or resolve imported/namespace-qualified aliases without type information |
| `no-unknown-type-aliases` | Blocking | Local/forward aliases, parentheses, scope shadowing, cycles, generic exclusions | Does not reject useful unions containing `unknown` or generic boundary types |
| `no-widen-then-assert` | Blocking | `unknown`/`any`/`object`/broad records, stable aliases, same-boundary ordering, reassignment and closure exclusions | Deliberately local and immutable; no compiler-wide interprocedural flow |
| `require-safety-comment-for-type-assertion` | Audit heuristic | `as`/angle assertions, nested owners, line/block comments, `as const` exemption | Validates presence and adjacency, not truth of the stated invariant |
| `no-v3-effect-apis` | Blocking | Root/submodule/namespace imports, renames, aliases, shadowing, removed Either path | Only the installed-version removal catalog; not a general API migrator |
| `prefer-option-constructors` | Blocking | Null/undefined/nullish equality direction, direct/submodule imports, shadowing, exact branch identity | Only exact ternary conversions; no public/protocol absence redesign |
| `no-result-channel-reboxing` | Reviewer evidence | Failure/success guards, direct/submodule imports, same-binding identity, concise/block returns | Only literal immediate same-channel reconstruction; transformed-payload translation is a reviewer-owned heuristic gap and should use deliberate Result composition |
| `no-manual-result-unwrapping` | Reviewer evidence | Path-aware writes/projections across branches, patterns, loops, try/finally, switch ordering | Bounded local control flow, not arbitrary interprocedural alias analysis |
| `prefer-result-gen-for-dependent-sequence` | Reviewer evidence | Repeated Result guards, imports/aliases, nested block ownership | Cannot prove dependency/eagerness; reviewer decides `gen`, pipeline, or existing guards |
| `no-result-get-or-throw-without-boundary` | Reviewer evidence | Root/submodule imports and stable aliases; shadow/reassignment exclusions | Cannot prove whether a compatibility boundary is legitimate |
| `prefer-effect-fn-for-reusable-operation` | Reviewer evidence | Top-level declarations/exports, concise/block wrappers, imported/aliased `gen` | Intentionally excludes local one-off helpers and operations with additional behavior |
| `no-unreviewed-effect-promise` | Reviewer evidence | Root/submodule imports, namespace/function/destructured aliases, mutation and shadowing | Cannot prove a Promise is non-rejecting |
| `no-effect-option-error-erasure` | Reviewer evidence | Direct/method/standalone pipe applications, aliases, data/operator distinction, re-exports | Cannot prove every failure semantically means absence |
| `prefer-tagged-effect-recovery` | Reviewer evidence | Root/submodule imports and stable aliases; shadow/reassignment exclusions | Cannot prove the boundary owns the complete typed failure channel |
| `no-silent-effect-error-swallow` | Reviewer evidence | Direct/named/object handlers, root/submodule imports, callback mutation | Only literal `Effect.void`/`unit` erasure; does not infer arbitrary wrapper semantics |
| `no-runtime-runner-inside-effect` | Reviewer evidence | Effect-owned callbacks, aliases, IIFEs, named calls/classes, eager/deferred execution | Custom wrappers around runtime runners require reviewer inspection |
| `no-throw-inside-effect-operation` | Reviewer evidence | Effect-owned callbacks, synchronous/deferred functions and class initialization | Cannot classify invariant defects versus recoverable failures |
| `no-platform-time-inside-effect` | Reviewer evidence | `Date.now`, `Date()`, `new Date()`, `performance.now`, shadowing, execution ownership | Custom clock wrappers and host adapter legitimacy require review |
| `require-effect-review-justification` | Blocking | Every reviewer rule, next-line-only directives, category spelling, concrete reason length | Does not prove the review rationale is factually correct |

## Adversarial mutation families

Every applicable rule should retain tests for:

1. root namespace, submodule namespace, and direct named imports;
2. renamed imports and stable local aliases;
3. shadowed and reassigned bindings that must not resolve as Effect APIs;
4. parenthesized, concise, block, computed-property, and destructured syntax;
5. immediate versus deferred execution where callback ownership matters;
6. evaluation order and partial versus exhaustive control-flow paths;
7. a nearby valid counterexample that differs by one semantic fact.

When a mutation cannot be handled soundly without type information, record it
as an intentional non-goal and require the TypeScript reviewer to inspect the
connected operation. Do not add a broad AST guess merely to increase counts.
