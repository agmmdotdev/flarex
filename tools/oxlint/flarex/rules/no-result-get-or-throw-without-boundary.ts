import { defineRule } from "@oxlint/plugins";

import { isEffectCall } from "./effect-imports.ts";

/** Require reviewer ownership for Result.getOrThrow compatibility boundaries. */
export const noResultGetOrThrowWithoutBoundaryRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Review Result.getOrThrow calls for an explicit compatibility boundary.",
    },
    messages: {
      boundary:
        "Result.getOrThrow leaves the typed Result channel. The TypeScript reviewer must identify the concrete throwing compatibility boundary or require Result/Effect composition that preserves the typed failure.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          isEffectCall(
            context.sourceCode,
            node,
            "Result",
            new Set(["getOrThrow"]),
          )
        ) {
          context.report({ node, messageId: "boundary" });
        }
      },
    };
  },
});
