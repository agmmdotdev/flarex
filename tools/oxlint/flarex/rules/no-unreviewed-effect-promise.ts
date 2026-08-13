import { defineRule } from "@oxlint/plugins";

import { isEffectCall } from "./effect-imports.ts";

/** Require reviewer confirmation that Effect.promise cannot reject. */
export const noUnreviewedEffectPromiseRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Review Effect.promise calls for a proven non-rejecting Promise contract.",
    },
    messages: {
      promise:
        "Effect.promise turns rejection into a defect. The TypeScript reviewer must confirm this Promise is contractually non-rejecting, or require Effect.tryPromise with typed foreign-failure mapping at the owning boundary.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (isEffectCall(context.sourceCode, node, "Effect", new Set(["promise"]))) {
          context.report({ node, messageId: "promise" });
        }
      },
    };
  },
});
