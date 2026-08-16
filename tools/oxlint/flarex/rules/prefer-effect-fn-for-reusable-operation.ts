import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import { isEffectCall } from "./effect-imports.ts";

function isEffectGenCall(
  sourceCode: Parameters<typeof isEffectCall>[0],
  expression: ESTree.Expression,
): boolean {
  return (
    expression.type === "CallExpression" &&
    isEffectCall(sourceCode, expression, "Effect", new Set(["gen"]))
  );
}

function returnedEffectGen(
  sourceCode: Parameters<typeof isEffectCall>[0],
  body: ESTree.Function["body"] | ESTree.ArrowFunctionExpression["body"],
): boolean {
  if (body === null) return false;
  if (body.type !== "BlockStatement") return isEffectGenCall(sourceCode, body);
  return (
    body.body.length === 1 &&
    body.body[0]?.type === "ReturnStatement" &&
    body.body[0].argument !== null &&
    isEffectGenCall(sourceCode, body.body[0].argument)
  );
}

/** Ask the reviewer to classify reusable wrappers that only return Effect.gen. */
export const preferEffectFnForReusableOperationRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Review reusable Effect.gen wrappers for an Effect.fn operation boundary.",
    },
    messages: {
      operation:
        "This reusable operation only returns Effect.gen. The TypeScript reviewer must decide whether it needs named Effect.fn observability, an unnamed stack boundary, or is a deliberate standalone/compatibility wrapper.",
    },
  },
  create(context) {
    const inspectDeclaration = (
      declaration: ESTree.Declaration | ESTree.VariableDeclaration,
    ) => {
      if (declaration.type === "FunctionDeclaration") {
        if (
          declaration.id !== null &&
          returnedEffectGen(context.sourceCode, declaration.body)
        ) {
          context.report({ node: declaration, messageId: "operation" });
        }
        return;
      }
      if (declaration.type !== "VariableDeclaration") return;
      for (const declarator of declaration.declarations) {
        if (
          declarator.id.type === "Identifier" &&
          declarator.init !== null &&
          (declarator.init.type === "ArrowFunctionExpression" ||
            declarator.init.type === "FunctionExpression") &&
          returnedEffectGen(context.sourceCode, declarator.init.body)
        ) {
          context.report({ node: declarator, messageId: "operation" });
        }
      }
    };

    return {
      Program(node) {
        for (const statement of node.body) {
          if (statement.type === "ExportNamedDeclaration") {
            if (statement.declaration !== null) inspectDeclaration(statement.declaration);
          } else if (
            statement.type === "FunctionDeclaration" ||
            statement.type === "VariableDeclaration"
          ) {
            inspectDeclaration(statement);
          }
        }
      },
    };
  },
});
