import { defineRule } from "@oxlint/plugins";

import {
  createEffectBodyTracker,
} from "./effect-body.ts";

/** Ask the reviewer to classify throws inside Effect-owned callbacks. */
export const noThrowInsideEffectOperationRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Review throw statements inside Effect operations and constructors.",
    },
    messages: {
      thrown:
        "A throw inside Effect-owned code becomes a defect or foreign rejection. The TypeScript reviewer must classify it as an invariant defect, foreign-boundary behavior, or a recoverable failure that belongs in the typed Effect error channel.",
    },
  },
  create(context) {
    const tracker = createEffectBodyTracker(context.sourceCode);

    return {
      Program: tracker.program,
      ArrowFunctionExpression: tracker.enter,
      "ArrowFunctionExpression:exit": tracker.exit,
      FunctionDeclaration: tracker.enter,
      "FunctionDeclaration:exit": tracker.exit,
      FunctionExpression: tracker.enter,
      "FunctionExpression:exit": tracker.exit,
      ThrowStatement(node) {
        if (tracker.inside(node)) context.report({ node, messageId: "thrown" });
      },
    };
  },
});
