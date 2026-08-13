import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import {
  noBannedTypeAssertionsRule,
  noChainedTypeAssertionsRule,
  noKnownValueWideningRule,
  noModuleMockingRule,
  noObjectParametersRule,
  noPlatformTimeInsideEffectRule,
  noResultChannelReboxingRule,
  noResultGetOrThrowWithoutBoundaryRule,
  noRuntimeRunnerInsideEffectRule,
  noSilentEffectErrorSwallowRule,
  noUnknownTypeAliasesRule,
  noV3EffectApisRule,
  noWidenThenAssertRule,
  preferEffectFnForReusableOperationRule,
  preferOptionConstructorsRule,
  preferResultGenForDependentSequenceRule,
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

tester.run("flarex/no-banned-type-assertions", noBannedTypeAssertionsRule, {
  valid: [
    "const value = input as User;",
    "const value = { id: '1' } as const;",
  ],
  invalid: [
    { code: "const value = input as unknown;", errors: [{ messageId: "banned" }] },
    { code: "const value = input as never;", errors: [{ messageId: "banned" }] },
  ],
});

tester.run("flarex/no-chained-type-assertions", noChainedTypeAssertionsRule, {
  valid: ["const value = input as User;", "const value = { id: '1' } as const;"],
  invalid: [
    {
      code: "const value = input as object as User;",
      errors: [{ messageId: "chained" }],
    },
  ],
});

tester.run("flarex/no-known-value-widening", noKnownValueWideningRule, {
  valid: [
    "const handlers = { start: () => 1 } satisfies Record<string, () => number>;",
  ],
  invalid: [
    {
      code: "const handlers: Record<string, () => number> = { start: () => 1 };",
      errors: [{ messageId: "widening" }],
    },
  ],
});

tester.run("flarex/no-module-mocking", noModuleMockingRule, {
  valid: ["vi.spyOn(store, 'save');", "const vi = { mock() {} }; vi.mock();"],
  invalid: [
    { code: "vi.mock('./store');", errors: [{ messageId: "moduleMock" }] },
  ],
});

tester.run("flarex/no-object-parameters", noObjectParametersRule, {
  valid: ["function save(value: User) { return value; }"],
  invalid: [
    {
      code: "function save(value: object) { return value; }",
      errors: [{ messageId: "objectParameter" }],
    },
  ],
});

tester.run(
  "flarex/no-silent-effect-error-swallow",
  noSilentEffectErrorSwallowRule,
  {
    valid: [
      'import { Effect } from "effect"; operation.pipe(Effect.catch(() => Effect.fail(new Error())));',
      "const Effect = { catch: (handler: unknown) => handler, void: 1 }; Effect.catch(() => Effect.void);",
      'import { Effect } from "effect"; function boundary(Effect: { catch(handler: unknown): unknown; void: unknown }) { return Effect.catch(() => Effect.void); }',
      'import { Effect } from "effect"; function ignore() { return Effect.void; } ignore = () => Effect.fail(new Error()); operation.pipe(Effect.catch(ignore));',
    ],
    invalid: [
      {
        code: 'import { Effect } from "effect"; operation.pipe(Effect.catch(() => Effect.void));',
        errors: [{ messageId: "swallowed" }],
      },
      {
        code: 'import { Effect as Fx } from "effect"; Fx.catchTags({ Missing: () => Fx.unit });',
        errors: [{ messageId: "swallowed" }],
      },
      {
        code: 'import { catch as recover, unit as ignored } from "effect/Effect"; operation.pipe(recover(() => ignored));',
        errors: [{ messageId: "swallowed" }],
      },
      {
        code: 'import { Effect } from "effect"; const ignore = () => Effect.void; operation.pipe(Effect.catch(ignore));',
        errors: [{ messageId: "swallowed" }],
      },
      {
        code: 'import { Effect } from "effect"; function ignore() { return Effect.void; } operation.pipe(Effect.catch(ignore));',
        errors: [{ messageId: "swallowed" }],
      },
    ],
  },
);

tester.run("flarex/no-unknown-type-aliases", noUnknownTypeAliasesRule, {
  valid: [
    "type UserId = string;",
    "type Maybe<T> = T | unknown;",
    "type Value = string; function boundary() { type Value = number; type Local = Value; }",
  ],
  invalid: [
    {
      code: "type ExternalValue = unknown;",
      errors: [{ messageId: "unknownAlias" }],
    },
    {
      code: "function boundary() { type Hidden = unknown; return 1; }",
      errors: [{ messageId: "unknownAlias" }],
    },
    {
      code: "type Outer = unknown; function boundary() { type Hidden = Outer; return 1; }",
      errors: [
        { messageId: "unknownAlias" },
        { messageId: "unknownAlias" },
      ],
    },
    {
      code: "function boundary() { type Hidden = Local; type Local = unknown; return 1; }",
      errors: [
        { messageId: "unknownAlias" },
        { messageId: "unknownAlias" },
      ],
    },
  ],
});

tester.run("flarex/no-widen-then-assert", noWidenThenAssertRule, {
  valid: ["declare const input: unknown; const value = input as User;"],
  invalid: [
    {
      code: "declare const user: User; const widened: unknown = user; const value = widened as User;",
      errors: [{ messageId: "widenThenAssert" }],
    },
  ],
});

tester.run("flarex/prefer-option-constructors", preferOptionConstructorsRule, {
  valid: [
    'import { Option } from "effect"; const value = Option.fromNullOr(input);',
    'import { Option } from "effect"; const value = Option.fromNullishOr(input);',
    'import { Option } from "effect"; const value = Option.fromUndefinedOr(input);',
    'import { Option } from "effect"; const value = input !== null ? Option.some(other) : Option.none();',
    'import { Option } from "effect"; function boundary(Option: { some(value: unknown): unknown; none(): unknown }, input: unknown) { return input !== null ? Option.some(input) : Option.none(); }',
    'import { Option } from "effect"; function boundary(undefined: unknown, input: unknown) { return input !== undefined ? Option.some(input) : Option.none(); }',
  ],
  invalid: [
    {
      code: 'import { Option } from "effect"; const value = input !== null ? Option.some(input) : Option.none();',
      errors: [{ messageId: "nullOnly" }],
    },
    {
      code: 'import { Option } from "effect"; const value = input === null ? Option.none() : Option.some(input);',
      errors: [{ messageId: "nullOnly" }],
    },
    {
      code: 'import { Option } from "effect"; const value = input != null ? Option.some(input) : Option.none();',
      errors: [{ messageId: "nullish" }],
    },
    {
      code: 'import { Option } from "effect"; const value = null == input ? Option.none() : Option.some(input);',
      errors: [{ messageId: "nullish" }],
    },
    {
      code: 'import { Option } from "effect"; const value = input !== undefined ? Option.some(input) : Option.none();',
      errors: [{ messageId: "undefinedOnly" }],
    },
    {
      code: 'import * as Option from "effect/Option"; const value = undefined === input ? Option.none() : Option.some(input);',
      errors: [{ messageId: "undefinedOnly" }],
    },
    {
      code: 'import { none, some } from "effect/Option"; const value = input !== undefined ? some(input) : none();',
      errors: [{ messageId: "undefinedOnly" }],
    },
  ],
});

tester.run("flarex/no-v3-effect-apis", noV3EffectApisRule, {
  valid: [
    'import { Effect, Option } from "effect"; Effect.catch; Effect.result; Option.fromNullishOr;',
    'function boundary(Effect: { catchAll: unknown }) { return Effect.catchAll; }',
  ],
  invalid: [
    {
      code: 'import { Effect, Layer, Option } from "effect"; Effect.catchAll; Layer.scoped; Option.fromNullable;',
      errors: [
        { messageId: "removed" },
        { messageId: "removed" },
        { messageId: "removed" },
      ],
    },
    {
      code: 'import { catchAll } from "effect/Effect"; catchAll(() => 1);',
      errors: [{ messageId: "removed" }],
    },
    {
      code: 'import { catchAll as recover } from "effect/Effect";',
      errors: [{ messageId: "removed" }],
    },
    {
      code: 'import { Either } from "effect"; type E = Either.Either<string, Error>;',
      errors: [{ messageId: "either" }],
    },
    {
      code: 'import * as Either from "effect/Either"; Either.left("x");',
      errors: [{ messageId: "either" }],
    },
    {
      code: 'import "effect/Either";',
      errors: [{ messageId: "either" }],
    },
  ],
});

tester.run("flarex/no-result-channel-reboxing", noResultChannelReboxingRule, {
  valid: [
    'import { Result } from "effect"; if (Result.isFailure(value)) return Result.fail(other.failure);',
    'const Result = local; if (Result.isFailure(value)) return Result.fail(value.failure);',
  ],
  invalid: [
    {
      code: 'import { Result } from "effect"; if (Result.isFailure(value)) return Result.fail(value.failure);',
      errors: [{ messageId: "reboxed" }],
    },
    {
      code: 'import * as Result from "effect/Result"; if (Result.isSuccess(value)) { return Result.succeed(value.success); }',
      errors: [{ messageId: "reboxed" }],
    },
    {
      code: 'import { fail, isFailure } from "effect/Result"; if (isFailure(value)) return fail(value.failure);',
      errors: [{ messageId: "reboxed" }],
    },
  ],
});

tester.run(
  "flarex/no-result-get-or-throw-without-boundary",
  noResultGetOrThrowWithoutBoundaryRule,
  {
    valid: [
      'import { Result } from "effect"; Result.match(value, { onFailure: fail, onSuccess: succeed });',
      'const Result = local; Result.getOrThrow(value);',
    ],
    invalid: [
      {
        code: 'import { Result } from "effect"; Result.getOrThrow(value);',
        errors: [{ messageId: "boundary" }],
      },
      {
        code: 'import * as Result from "effect/Result"; Result.getOrThrow(value);',
        errors: [{ messageId: "boundary" }],
      },
      {
        code: 'import { getOrThrow as unwrap } from "effect/Result"; unwrap(value);',
        errors: [{ messageId: "boundary" }],
      },
    ],
  },
);

tester.run(
  "flarex/prefer-result-gen-for-dependent-sequence",
  preferResultGenForDependentSequenceRule,
  {
    valid: [
      'import { Result } from "effect"; function decode() { if (Result.isFailure(a)) return a; return b; }',
      'const Result = local; function decode() { if (Result.isFailure(a)) return a; if (Result.isFailure(b)) return b; }',
    ],
    invalid: [
      {
        code: 'import { Result } from "effect"; function decode() { if (Result.isFailure(a)) return a; if (Result.isFailure(b)) return b; return Result.succeed(1); }',
        errors: [{ messageId: "sequence" }],
      },
      {
        code: 'import { isFailure } from "effect/Result"; function decode() { if (isFailure(a)) return a; if (isFailure(b)) return b; return b; }',
        errors: [{ messageId: "sequence" }],
      },
    ],
  },
);

tester.run(
  "flarex/prefer-effect-fn-for-reusable-operation",
  preferEffectFnForReusableOperationRule,
  {
    valid: [
      'import { Effect } from "effect"; const value = Effect.gen(function* () { return 1; });',
      'import { Effect } from "effect"; const operation = Effect.fn("operation")(function* () { return 1; });',
      'const Effect = local; function operation() { return Effect.gen(function* () { return 1; }); }',
    ],
    invalid: [
      {
        code: 'import { Effect } from "effect"; function operation() { return Effect.gen(function* () { return 1; }); }',
        errors: [{ messageId: "operation" }],
      },
      {
        code: 'import * as Effect from "effect/Effect"; export const operation = () => Effect.gen(function* () { return 1; });',
        errors: [{ messageId: "operation" }],
      },
      {
        code: 'import { gen } from "effect/Effect"; const operation = () => gen(function* () { return 1; });',
        errors: [{ messageId: "operation" }],
      },
    ],
  },
);

tester.run("flarex/no-runtime-runner-inside-effect", noRuntimeRunnerInsideEffectRule, {
  valid: [
    'import { Effect } from "effect"; Effect.runPromise(program);',
    'const Effect = local; Effect.gen(function* () { return Effect.runPromise(program); });',
    'import { Effect } from "effect"; Effect.gen(function* () { return yield* program; });',
  ],
  invalid: [
    {
      code: 'import { Effect } from "effect"; Effect.gen(function* () { return Effect.runPromise(program); });',
      errors: [{ messageId: "nested" }],
    },
    {
      code: 'import { Effect } from "effect"; const operation = Effect.fn("operation")(function* () { return Effect.runSync(program); });',
      errors: [{ messageId: "nested" }],
    },
    {
      code: 'import { gen, runPromise as run } from "effect/Effect"; gen(function* () { return run(program); });',
      errors: [{ messageId: "nested" }],
    },
    {
      code: 'import { Effect } from "effect"; function* body() { return Effect.runPromise(program); } Effect.gen(body);',
      errors: [{ messageId: "nested" }],
    },
  ],
});

tester.run("flarex/no-platform-time-inside-effect", noPlatformTimeInsideEffectRule, {
    valid: [
      'import { Effect } from "effect"; const now = Date.now(); Effect.gen(function* () { return now; });',
      'import { Effect } from "effect"; function boundary(Date: { now(): number }) { return Effect.gen(function* () { return Date.now(); }); }',
      'import { Effect } from "effect"; function* body() { return Date.now(); } body = function* () { return 1; }; Effect.gen(body);',
  ],
  invalid: [
    {
      code: 'import { Effect } from "effect"; Effect.gen(function* () { return Date.now(); });',
      errors: [{ messageId: "clock" }],
    },
    {
      code: 'import { Effect } from "effect"; const operation = Effect.fn(function* () { return Date.now(); });',
      errors: [{ messageId: "clock" }],
    },
    {
      code: 'import { gen } from "effect/Effect"; gen(function* () { return Date.now(); });',
      errors: [{ messageId: "clock" }],
    },
    {
      code: 'import { Effect } from "effect"; function* body() { return Date.now(); } Effect.gen(body);',
      errors: [{ messageId: "clock" }],
    },
    {
      code: 'import { Effect } from "effect"; const body = function* () { return Date.now(); }; const alias = body; Effect.gen(alias);',
      errors: [{ messageId: "clock" }],
    },
  ],
});

tester.run(
  "flarex/require-effect-review-justification",
  requireEffectReviewJustificationRule,
  {
    valid: [
      '// oxlint-disable-next-line flarex/no-result-channel-reboxing -- REVIEW: compatibility - preserves the public result allocation\nrun();',
    ],
    invalid: [
      {
        code: '// oxlint-disable-next-line flarex/no-result-channel-reboxing\nrun();',
        errors: [{ messageId: "missing" }],
      },
      {
        code: '// oxlint-disable flarex/no-result-channel-reboxing -- REVIEW: legacy adapter boundary\nrun();',
        errors: [{ messageId: "broad" }],
      },
      {
        code: '// oxlint-disable-next-line\nrun();',
        errors: [{ messageId: "broad" }],
      },
      {
        code: 'run(); // oxlint-disable-line -- REVIEW: compatibility - preserves this boundary',
        errors: [{ messageId: "broad" }],
      },
      {
        code: '// oxlint-disable-next-line flarex/no-result-channel-reboxing -- REVIEW: legacy adapter boundary\nrun();',
        errors: [{ messageId: "missing" }],
      },
    ],
  },
);

tester.run(
  "flarex/require-safety-comment-for-type-assertion",
  requireSafetyCommentForTypeAssertionRule,
  {
    valid: [
      "// SAFETY: decodeUser proved the complete User contract.\nconst value = input as User;",
      "const value = { id: '1' } as const;",
    ],
    invalid: [
      {
        code: "const value = input as User;",
        errors: [{ messageId: "missingSafetyComment" }],
      },
    ],
  },
);
