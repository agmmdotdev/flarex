import { defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode } from "@oxlint/plugins";

import {
  callCallee,
  isEffectCall,
  isImportedEffectPipe,
  isImportedEffectFunction,
  isNamespaceMember,
  memberName,
} from "./effect-imports.ts";

const optionNames = new Set(["option"]);

function isOptionOperator(
  sourceCode: SourceCode,
  node: ESTree.Node,
): boolean {
  return (
    (node.type === "MemberExpression" &&
      isNamespaceMember(sourceCode, node, "Effect", optionNames)) ||
    (node.type === "Identifier" &&
      isImportedEffectFunction(
        sourceCode,
        // SAFETY: CallExpression arguments contain identifier references.
        node as ESTree.IdentifierReference,
        "Effect",
        optionNames,
      ))
  );
}

/** Require reviewer confirmation before discarding an Effect failure channel. */
export const noEffectOptionErrorErasureRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Review Effect.option calls that erase every typed failure reason.",
    },
    messages: {
      erased:
        "Effect.option erases every typed failure reason as Option.none. The TypeScript reviewer must confirm all failures mean absence, or require tag-specific absence recovery while preserving the remaining error channel.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (isEffectCall(context.sourceCode, node, "Effect", optionNames)) {
          context.report({ node, messageId: "erased" });
          return;
        }
        const callee = callCallee(node);
        const isPipe =
          (callee.type === "MemberExpression" && memberName(callee) === "pipe") ||
          (callee.type === "Identifier" &&
            isImportedEffectPipe(context.sourceCode, callee));
        if (!isPipe) {
          return;
        }
        const operatorArguments = callee.type === "MemberExpression"
          ? node.arguments
          : node.arguments.slice(1);
        for (const argument of operatorArguments) {
          if (isOptionOperator(context.sourceCode, argument)) {
            context.report({ node: argument, messageId: "erased" });
          }
        }
      },
    };
  },
});
