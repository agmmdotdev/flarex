import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import {
  noBannedTypeAssertionsRule,
  noChainedTypeAssertionsRule,
  noKnownValueWideningRule,
  noModuleMockingRule,
  noObjectParametersRule,
  noSilentEffectErrorSwallowRule,
  noUnknownTypeAliasesRule,
  noWidenThenAssertRule,
  preferOptionNullConstructorsRule,
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

tester.run("flarex/prefer-option-null-constructors", preferOptionNullConstructorsRule, {
  valid: [
    'import { Option } from "effect"; const value = Option.fromNullOr(input);',
    'import { Option } from "effect"; const value = Option.fromNullishOr(input);',
    'import { Option } from "effect"; const value = input !== null ? Option.some(other) : Option.none();',
    'import { Option } from "effect"; function boundary(Option: { some(value: unknown): unknown; none(): unknown }, input: unknown) { return input !== null ? Option.some(input) : Option.none(); }',
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
  ],
});

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
