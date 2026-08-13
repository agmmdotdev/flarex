import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

const bannedTypeKinds = new Set([
  "TSAnyKeyword",
  "TSNeverKeyword",
  "TSUnknownKeyword",
]);

/** Reject assertions to top or bottom types that erase useful evidence. */
export const noBannedTypeAssertionsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow assertions to any, never, or unknown; preserve or validate the original type instead.",
    },
    messages: {
      banned:
        "Do not assert to `any`, `never`, or `unknown`. Preserve the precise type, use a generic contract, or validate the value at its owning boundary.",
    },
  },
  create(context) {
    const checkAssertion = (
      node: ESTree.TSAsExpression | ESTree.TSTypeAssertion,
    ) => {
      if (!bannedTypeKinds.has(node.typeAnnotation.type)) return;
      context.report({ node, messageId: "banned" });
    };

    return {
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,
    };
  },
});
