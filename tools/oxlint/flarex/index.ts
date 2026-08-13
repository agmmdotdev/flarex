import { definePlugin } from "@oxlint/plugins";

import { noChainedTypeAssertionsRule } from "./anti-slop/rules/no-chained-type-assertions.ts";
import { noKnownValueWideningRule } from "./anti-slop/rules/no-known-value-widening.ts";
import { noModuleMockingRule } from "./anti-slop/rules/no-module-mocking.ts";
import { noObjectParametersRule } from "./anti-slop/rules/no-object-parameters.ts";
import { noUnknownTypeAliasesRule } from "./anti-slop/rules/no-unknown-type-aliases.ts";
import { noWidenThenAssertRule } from "./anti-slop/rules/no-widen-then-assert.ts";
import { requireSafetyCommentForTypeAssertionRule } from "./anti-slop/rules/require-safety-comment-for-type-assertion.ts";
import { noBannedTypeAssertionsRule } from "./rules/no-banned-type-assertions.ts";
import { noSilentEffectErrorSwallowRule } from "./rules/no-silent-effect-error-swallow.ts";
import { preferOptionNullConstructorsRule } from "./rules/prefer-option-null-constructors.ts";

export {
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
};

/** Flarex-owned Oxlint rules selected for evidence preservation and Effect correctness. */
const flarexPlugin = definePlugin({
  meta: { name: "flarex" },
  rules: {
    "no-banned-type-assertions": noBannedTypeAssertionsRule,
    "no-chained-type-assertions": noChainedTypeAssertionsRule,
    "no-known-value-widening": noKnownValueWideningRule,
    "no-module-mocking": noModuleMockingRule,
    "no-object-parameters": noObjectParametersRule,
    "no-silent-effect-error-swallow": noSilentEffectErrorSwallowRule,
    "no-unknown-type-aliases": noUnknownTypeAliasesRule,
    "no-widen-then-assert": noWidenThenAssertRule,
    "prefer-option-null-constructors": preferOptionNullConstructorsRule,
    "require-safety-comment-for-type-assertion":
      requireSafetyCommentForTypeAssertionRule,
  },
});

export default flarexPlugin;
