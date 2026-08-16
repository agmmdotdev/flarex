import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import {
  noBannedTypeAssertionsRule,
  noChainedTypeAssertionsRule,
  noEffectOptionErrorErasureRule,
  noKnownValueWideningRule,
  noManualResultUnwrappingRule,
  noModuleMockingRule,
  noObjectParametersRule,
  noPlatformTimeInsideEffectRule,
  noResultChannelReboxingRule,
  noResultGetOrThrowWithoutBoundaryRule,
  noRuntimeRunnerInsideEffectRule,
  noSilentEffectErrorSwallowRule,
  noThrowInsideEffectOperationRule,
  noUnknownTypeAliasesRule,
  noUnreviewedEffectPromiseRule,
  noV3EffectApisRule,
  noWidenThenAssertRule,
  preferEffectFnForReusableOperationRule,
  preferOptionConstructorsRule,
  preferResultGenForDependentSequenceRule,
  preferTaggedEffectRecoveryRule,
  requireEffectReviewJustificationRule,
  requireSafetyCommentForTypeAssertionRule,
} from "./index.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: {
    sourceType: "module",
    parserOptions: { lang: "ts" },
  },
});

tester.run("quality/no-banned-type-assertions", noBannedTypeAssertionsRule, {
  valid: ["const value = input as (User);", "const value = <User>input;"],
  invalid: [
    { code: "const value = <any>input;", errors: [{ messageId: "banned" }] },
    { code: "const value = input as (unknown);", errors: [{ messageId: "banned" }] },
  ],
});

tester.run("quality/no-chained-type-assertions", noChainedTypeAssertionsRule, {
  valid: ["const value = input as User;"],
  invalid: [
    { code: "const value = (<object>input) as User;", errors: [{ messageId: "chained" }] },
    { code: "const value = ((input as object) as User) as Admin;", errors: [{ messageId: "chained" }] },
  ],
});

tester.run("quality/no-known-value-widening", noKnownValueWideningRule, {
  valid: [
    "declare const external: Record<string, unknown>; const value: Record<string, unknown> = external;",
    "type Record<K, V> = { value: V }; const value: Record<string, unknown> = { value: 1 };",
  ],
  invalid: [
    { code: "const known = { id: 1 } as const; const value: Record<string, unknown> = known;", errors: [{ messageId: "widening" }] },
    { code: "const make = (): Record<string, unknown> => ({ id: 1 });", errors: [{ messageId: "widening" }] },
  ],
});

tester.run("quality/no-module-mocking", noModuleMockingRule, {
  valid: [
    'import { vi } from "vitest"; function boundary(vi: { mock(value: string): void }) { vi.mock("./x"); }',
    'import { vi } from "vitest"; vi.spyOn(store, "save");',
  ],
  invalid: [
    { code: 'import { vi } from "vitest"; vi["mock"]("./x");', errors: [{ messageId: "moduleMock" }] },
    { code: 'import { jest as testApi } from "@jest/globals"; testApi.unstable_mockModule("./x", factory);', errors: [{ messageId: "moduleMock" }] },
  ],
});

tester.run("quality/no-object-parameters", noObjectParametersRule, {
  valid: [
    "type Broad = object; function use<Broad>(value: Broad) { return value; }",
    "type Payload = { id: string }; function use(value: Payload) { return value; }",
    "type Payload = { id: string }; type Fn = (...values: ReadonlyArray<Payload>) => void;",
      "type Tuple = [{ id: string }, string]; type Fn = (...values: Tuple) => void;",
      "type Array<T> = string[]; type Fn = (...values: Array<object>) => void;",
      "type ReadonlyArray<T> = readonly string[]; type Fn = (...values: ReadonlyArray<object>) => void;",
      "interface Array<T> { readonly item: T } type Fn = (...values: Array<object>) => void;",
      "declare class ReadonlyArray<T> { readonly item: T } type Fn = (...values: ReadonlyArray<object>) => void;",
      "function define() { type Array<T> = string[]; type Fn = (...values: Array<object>) => void; return null as unknown as Fn; }",
      "type Broad = object; function define() { type Broad = string; type Fn = (...values: Broad[]) => void; return null as unknown as Fn; }",
  ],
  invalid: [
    { code: "type Broad = object; const use = (value: Broad = {}) => value;", errors: [{ messageId: "objectParameter" }] },
    { code: "type Broad = object; type Fn = (...values: Broad[]) => void;", errors: [{ messageId: "objectParameter" }] },
    { code: "type Fn = (...values: Array<object>) => void;", errors: [{ messageId: "objectParameter" }] },
    { code: "type Fn = (...values: ReadonlyArray<object>) => void;", errors: [{ messageId: "objectParameter" }] },
      { code: "type Fn = (...values: readonly object[]) => void;", errors: [{ messageId: "objectParameter" }] },
      { code: "type Fn = (...values: object[] | string[]) => void;", errors: [{ messageId: "objectParameter" }] },
      { code: "type Values = object[]; type Fn = (...values: Values) => void;", errors: [{ messageId: "objectParameter" }] },
      { code: "function define() { type Broad = object; type Values = Broad[]; type Fn = (...values: Values) => void; return null as unknown as Fn; }", errors: [{ messageId: "objectParameter" }] },
      { code: "type Values = [first: object, second?: string]; type Fn = (...values: Values) => void;", errors: [{ messageId: "objectParameter" }] },
      { code: "type Values = [...object[]]; type Fn = (...values: Values) => void;", errors: [{ messageId: "objectParameter" }] },
      { code: "type Values = [head: string, ...tail: object[]]; type Fn = (...values: Values) => void;", errors: [{ messageId: "objectParameter" }] },
      { code: "type Broad = object; function define() { const Broad = 1; const use = (value: Broad) => value; return [Broad, use] as const; }", errors: [{ messageId: "objectParameter" }] },
      { code: "declare const local: unknown; const Array = local; type Fn = (...values: Array<object>) => void;", errors: [{ messageId: "objectParameter" }] },
      { code: "declare const local: unknown; function define() { const ReadonlyArray = local; type Fn = (...values: ReadonlyArray<object>) => void; return [ReadonlyArray, null as unknown as Fn] as const; }", errors: [{ messageId: "objectParameter" }] },
      { code: "interface Port { use(value: object): void }", errors: [{ messageId: "objectParameter" }] },
  ],
});

tester.run("quality/no-unknown-type-aliases", noUnknownTypeAliasesRule, {
  valid: [
    "type Boundary<T = unknown> = T;",
    "type A = B; type B = A;",
  ],
  invalid: [
    { code: "type Hidden = ((unknown));", errors: [{ messageId: "unknownAlias" }] },
    { code: "type First = Second; type Second = unknown;", errors: [{ messageId: "unknownAlias" }, { messageId: "unknownAlias" }] },
  ],
});

tester.run("quality/no-widen-then-assert", noWidenThenAssertRule, {
  valid: [
    "declare let input: User; let widened: unknown = input; widened = other; const value = widened as User;",
    "declare const input: User; const widened: unknown = input; function later() { return widened as User; }",
  ],
  invalid: [
    { code: "declare const input: User; const broad: object = input; const value = broad as User;", errors: [{ messageId: "widenThenAssert" }] },
    { code: "const input = { id: 1 }; const broad = input as unknown; const value = <User>broad;", errors: [{ messageId: "widenThenAssert" }] },
  ],
});

tester.run("quality/require-safety-comment", requireSafetyCommentForTypeAssertionRule, {
  valid: [
    "// SAFETY: decoder proved the complete User shape.\nconst value = (<User>input);",
    "const value = input as const;",
  ],
  invalid: [
    { code: "const value = <User>input;", errors: [{ messageId: "missingSafetyComment" }] },
    { code: "// safe enough\nconst value = input as User;", errors: [{ messageId: "missingSafetyComment" }] },
  ],
});

tester.run("quality/no-v3-effect-apis", noV3EffectApisRule, {
  valid: [
    'import { Effect } from "effect"; function use(Effect: { catchAll: unknown }) { return Effect.catchAll; }',
    'const Effect = { catchAll: 1 }; Effect.catchAll;',
  ],
  invalid: [
    { code: 'import { Effect as Fx } from "effect"; Fx["catchAll"];', errors: [{ messageId: "removed" }] },
    { code: 'import * as Option from "effect/Option"; Option.fromNullable(value);', errors: [{ messageId: "removed" }] },
  ],
});

tester.run("quality/prefer-option-constructors", preferOptionConstructorsRule, {
  valid: [
    'import { Option } from "effect"; const value = input !== null ? Option.some(transform(input)) : Option.none();',
    'import { Option } from "effect"; let make = Option.some; make = local; const value = input !== null ? make(input) : Option.none();',
  ],
  invalid: [
    { code: 'import { Option } from "effect"; const Fx = Option; const value = null === input ? Fx.none() : Fx.some(input);', errors: [{ messageId: "nullOnly" }] },
    { code: 'import { some, none } from "effect/Option"; const value = undefined !== input ? some(input) : none();', errors: [{ messageId: "undefinedOnly" }] },
  ],
});

tester.run("quality/no-result-channel-reboxing", noResultChannelReboxingRule, {
  valid: [
    'import { Result } from "effect"; if (Result.isFailure(value)) return Result.fail(other.failure);',
    'import { Result } from "effect"; if (Result.isFailure(value)) return Result.succeed(value.failure);',
  ],
  invalid: [
    { code: 'import { Result } from "effect"; const R = Result; if (R.isFailure(value)) return R.fail(value.failure);', errors: [{ messageId: "reboxed" }] },
    { code: 'import { isSuccess, succeed } from "effect/Result"; if (isSuccess(value)) { return succeed(value["success"]); }', errors: [{ messageId: "reboxed" }] },
  ],
});

tester.run("quality/no-manual-result-unwrapping", noManualResultUnwrappingRule, {
  valid: [
    'import { Result } from "effect"; function decode(value) { if (Result.isFailure(value)) return value; if (replace) value = next; else value = other; return value.success; }',
    'import { Result } from "effect"; function decode(value) { if (Result.isFailure(value)) return value; switch (kind) { case (value = next, "next"): break; } return value.success; }',
  ],
  invalid: [
    { code: 'import { Result } from "effect"; function decode(value) { if (Result.isFailure(value)) return value; while (replace) value = next; return value.success; }', errors: [{ messageId: "manual" }] },
    { code: 'import { Result } from "effect"; function decode(value) { if (Result.isFailure(value)) return value; ({ [value.success]: value } = input); }', errors: [{ messageId: "manual" }] },
  ],
});

tester.run("quality/result-get-or-throw", noResultGetOrThrowWithoutBoundaryRule, {
  valid: [
    'import { Result } from "effect"; let unwrap = Result.getOrThrow; unwrap = local; unwrap(value);',
    'const Result = local; Result.getOrThrow(value);',
  ],
  invalid: [
    { code: 'import { Result } from "effect"; const unwrap = Result.getOrThrow; unwrap(value);', errors: [{ messageId: "boundary" }] },
    { code: 'import { getOrThrow as unwrap } from "effect/Result"; unwrap(value);', errors: [{ messageId: "boundary" }] },
  ],
});

tester.run("quality/silent-effect-swallow", noSilentEffectErrorSwallowRule, {
  valid: [
    'import { Effect } from "effect"; const ignore = () => Effect.void; ignore = recover; program.pipe(Effect.catch(ignore));',
    'import { Effect } from "effect"; program.pipe(Effect.catch(() => Effect.succeed(undefined)));',
  ],
  invalid: [
    { code: 'import { Effect } from "effect"; const Fx = Effect; const ignore = () => Fx.void; program.pipe(Fx.catch(ignore));', errors: [{ messageId: "swallowed" }] },
    { code: 'import { catchTags } from "effect/Effect"; import { void as ignored } from "effect/Effect"; catchTags({ Missing: () => ignored });', errors: [{ messageId: "swallowed" }] },
  ],
});

tester.run("quality/prefer-result-gen", preferResultGenForDependentSequenceRule, {
  valid: [
    'import { Result } from "effect"; if (Result.isFailure(a)) return a; function nested() { if (Result.isFailure(b)) return b; }',
  ],
  invalid: [
    { code: 'import { Result } from "effect"; const R = Result; function decode() { if (R.isFailure(a)) return a; if (R.isFailure(b)) return b; }', errors: [{ messageId: "sequence" }] },
  ],
});

tester.run("quality/prefer-effect-fn", preferEffectFnForReusableOperationRule, {
  valid: [
    'import { Effect } from "effect"; function local() { const before = 1; return Effect.gen(function* () { return before; }); }',
    'import { Effect } from "effect"; function outer() { function local() { return Effect.gen(function* () { return 1; }); } return local(); }',
  ],
  invalid: [
    { code: 'import { Effect } from "effect"; const Fx = Effect; export const operation = () => Fx.gen(function* () { return 1; });', errors: [{ messageId: "operation" }] },
    { code: 'import { gen as make } from "effect/Effect"; export function operation() { return make(function* () { return 1; }); }', errors: [{ messageId: "operation" }] },
  ],
});

tester.run("quality/unreviewed-effect-promise", noUnreviewedEffectPromiseRule, {
  valid: [
    'import { Effect } from "effect"; let Fx = Effect; Fx = local; Fx.promise(load);',
    'import { Effect } from "effect"; const constructor = Effect.promise;',
  ],
  invalid: [
    { code: 'import { Effect } from "effect"; const { promise: make = fallback } = Effect; make(load);', errors: [{ messageId: "promise" }] },
    { code: 'import { promise as make } from "effect/Effect"; make(load);', errors: [{ messageId: "promise" }] },
  ],
});

tester.run("quality/effect-option-erasure", noEffectOptionErrorErasureRule, {
  valid: [
    'import { Effect, pipe } from "effect"; pipe(Effect.option, identity);',
    'import { Effect } from "effect"; const constructor = Effect.option;',
  ],
  invalid: [
    { code: 'import { Effect, pipe as compose } from "effect"; compose(program, Effect.option);', errors: [{ messageId: "erased" }] },
    { code: 'import { Effect } from "effect"; const Fx = Effect; program.pipe(Fx.option);', errors: [{ messageId: "erased" }] },
  ],
});

tester.run("quality/tagged-effect-recovery", preferTaggedEffectRecoveryRule, {
  valid: [
    'import { Effect } from "effect"; let recover = Effect.catch; recover = local; program.pipe(recover(handler));',
    'import { Effect } from "effect"; program.pipe(Effect.catchTag("Missing", handler));',
  ],
  invalid: [
    { code: 'import { Effect } from "effect"; const recover = Effect.catch; program.pipe(recover(handler));', errors: [{ messageId: "broad" }] },
    { code: 'import { catch as recover } from "effect/Effect"; program.pipe(recover(handler));', errors: [{ messageId: "broad" }] },
  ],
});

tester.run("quality/runtime-runner-ownership", noRuntimeRunnerInsideEffectRule, {
  valid: [
    'import { Effect } from "effect"; Effect.sync(() => () => Effect.runPromise(program));',
    'import { Effect } from "effect"; Effect.acquireRelease(Effect.succeed(Effect.runPromise(program)), release);',
  ],
  invalid: [
    { code: 'import { Effect } from "effect"; Effect.sync(() => (() => Effect.runPromise(program))());', errors: [{ messageId: "nested" }] },
    { code: 'import { Effect } from "effect"; Effect.sync(() => { class Immediate { value = Effect.runPromise(program); } return new Immediate(); });', errors: [{ messageId: "nested" }] },
  ],
});

tester.run("quality/throw-ownership", noThrowInsideEffectOperationRule, {
  valid: [
    'import { Effect } from "effect"; Effect.sync(() => class Deferred { run() { throw problem; } });',
    'const Effect = local; Effect.sync(() => { throw problem; });',
  ],
  invalid: [
    { code: 'import { Effect } from "effect"; Effect.sync(() => (() => { throw problem; })());', errors: [{ messageId: "thrown" }] },
    { code: 'import { Effect } from "effect"; Effect.sync(() => new class { constructor() { throw problem; } });', errors: [{ messageId: "thrown" }] },
  ],
});

tester.run("quality/platform-time-ownership", noPlatformTimeInsideEffectRule, {
  valid: [
    'import { Effect } from "effect"; Effect.sync(() => class Deferred { value = Date.now(); });',
    'import { Effect } from "effect"; function boundary(Date: { now(): number }) { return Effect.sync(() => Date.now()); }',
  ],
  invalid: [
    { code: 'import { Effect } from "effect"; Effect.sync(() => (() => Date())());', errors: [{ messageId: "clock" }] },
    { code: 'import { Effect } from "effect"; Effect.sync(() => class Immediate { static value = performance.now(); });', errors: [{ messageId: "clock" }] },
  ],
});

tester.run("quality/effect-review-justification", requireEffectReviewJustificationRule, {
  valid: [
    '// oxlint-disable-next-line flarex/no-platform-time-inside-effect -- REVIEW: host - platform adapter owns the external clock\nrun();',
  ],
  invalid: [
    { code: '// oxlint-disable-next-line flarex/no-effect-option-error-erasure -- REVIEW: host - too short\nrun();', errors: [{ messageId: "missing" }] },
    { code: 'run(); // oxlint-disable-line flarex/no-unreviewed-effect-promise -- REVIEW: host - callback cannot reject by contract', errors: [{ messageId: "broad" }] },
  ],
});
