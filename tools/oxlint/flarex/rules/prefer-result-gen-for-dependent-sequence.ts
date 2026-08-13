import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import { isEffectCall } from "./effect-imports.ts";

interface BlockState {
  readonly node: ESTree.BlockStatement;
  guardCount: number;
}

/** Identify blocks with repeated manual Result propagation for reviewer adjudication. */
export const preferResultGenForDependentSequenceRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Review repeated Result guards for Result.gen or focused combinator composition.",
    },
    messages: {
      sequence:
        "This block manually sequences {{count}} Result guards. The TypeScript reviewer must decide whether the operations are dependent and belong in Result.gen, whether one step belongs in map/flatMap, or whether the existing boundary shape is intentional. Preserve construction order and first failure.",
    },
  },
  create(context) {
    const blocks: BlockState[] = [];

    return {
      BlockStatement(node) {
        blocks.push({ node, guardCount: 0 });
      },
      IfStatement(node) {
        const current = blocks.at(-1);
        if (
          current === undefined ||
          node.test.type !== "CallExpression" ||
          node.test.arguments.length !== 1
        ) {
          return;
        }
        if (
          isEffectCall(
            context.sourceCode,
            node.test,
            "Result",
            new Set(["isFailure", "isSuccess"]),
          )
        ) {
          current.guardCount += 1;
        }
      },
      "BlockStatement:exit"() {
        const current = blocks.pop();
        if (current === undefined || current.guardCount < 2) return;
        context.report({
          node: current.node,
          messageId: "sequence",
          data: { count: String(current.guardCount) },
        });
      },
    };
  },
});
