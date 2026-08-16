import { defineRule } from "@oxlint/plugins";

import { isEffectCall } from "./effect-imports.ts";

/** Ask the reviewer to justify broad typed-failure recovery. */
export const preferTaggedEffectRecoveryRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Review broad Effect.catch recovery for a narrower tagged operator.",
    },
    messages: {
      broad:
        "Effect.catch handles the complete typed failure channel. The TypeScript reviewer must confirm this boundary intentionally owns every failure, or require catchTag, catchTags, catchFilter, mapError, or propagation with precise error semantics.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (isEffectCall(context.sourceCode, node, "Effect", new Set(["catch"]))) {
          context.report({ node, messageId: "broad" });
        }
      },
    };
  },
});
