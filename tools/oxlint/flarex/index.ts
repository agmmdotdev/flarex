import { definePlugin } from "@oxlint/plugins";

import { noChainedTypeAssertionsRule } from "./anti-slop/rules/no-chained-type-assertions.ts";
import { noKnownValueWideningRule } from "./anti-slop/rules/no-known-value-widening.ts";
import { noModuleMockingRule } from "./anti-slop/rules/no-module-mocking.ts";
import { noObjectParametersRule } from "./anti-slop/rules/no-object-parameters.ts";
import { noUnknownTypeAliasesRule } from "./anti-slop/rules/no-unknown-type-aliases.ts";
import { noWidenThenAssertRule } from "./anti-slop/rules/no-widen-then-assert.ts";
import { requireSafetyCommentForTypeAssertionRule } from "./anti-slop/rules/require-safety-comment-for-type-assertion.ts";
import { noBannedTypeAssertionsRule } from "./rules/no-banned-type-assertions.ts";
import { noPlatformTimeInsideEffectRule } from "./rules/no-platform-time-inside-effect.ts";
import { noResultChannelReboxingRule } from "./rules/no-result-channel-reboxing.ts";
import { noResultGetOrThrowWithoutBoundaryRule } from "./rules/no-result-get-or-throw-without-boundary.ts";
import { noRuntimeRunnerInsideEffectRule } from "./rules/no-runtime-runner-inside-effect.ts";
import { noSilentEffectErrorSwallowRule } from "./rules/no-silent-effect-error-swallow.ts";
import { noV3EffectApisRule } from "./rules/no-v3-effect-apis.ts";
import { preferEffectFnForReusableOperationRule } from "./rules/prefer-effect-fn-for-reusable-operation.ts";
import { preferOptionConstructorsRule } from "./rules/prefer-option-constructors.ts";
import { preferResultGenForDependentSequenceRule } from "./rules/prefer-result-gen-for-dependent-sequence.ts";
import { requireEffectReviewJustificationRule } from "./rules/require-effect-review-justification.ts";

export {
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
    "no-platform-time-inside-effect": noPlatformTimeInsideEffectRule,
    "no-result-channel-reboxing": noResultChannelReboxingRule,
    "no-result-get-or-throw-without-boundary":
      noResultGetOrThrowWithoutBoundaryRule,
    "no-runtime-runner-inside-effect": noRuntimeRunnerInsideEffectRule,
    "no-silent-effect-error-swallow": noSilentEffectErrorSwallowRule,
    "no-unknown-type-aliases": noUnknownTypeAliasesRule,
    "no-v3-effect-apis": noV3EffectApisRule,
    "no-widen-then-assert": noWidenThenAssertRule,
    "prefer-effect-fn-for-reusable-operation":
      preferEffectFnForReusableOperationRule,
    "prefer-option-constructors": preferOptionConstructorsRule,
    "prefer-result-gen-for-dependent-sequence":
      preferResultGenForDependentSequenceRule,
    "require-effect-review-justification": requireEffectReviewJustificationRule,
    "require-safety-comment-for-type-assertion":
      requireSafetyCommentForTypeAssertionRule,
  },
});

export default flarexPlugin;
