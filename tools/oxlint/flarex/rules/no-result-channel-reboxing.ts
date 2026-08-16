import { defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode } from "@oxlint/plugins";

import {
  isEffectCall,
  memberName,
  sameVariable,
} from "./effect-imports.ts";

type ResultChannel = "failure" | "success";

function guardedIdentifier(
  sourceCode: SourceCode,
  test: ESTree.Expression,
): { readonly channel: ResultChannel; readonly identifier: ESTree.IdentifierReference } | null {
  if (test.type !== "CallExpression" || test.arguments.length !== 1) return null;
  const channel = isEffectCall(sourceCode, test, "Result", new Set(["isFailure"]))
    ? "failure"
    : isEffectCall(sourceCode, test, "Result", new Set(["isSuccess"]))
      ? "success"
      : null;
  const [argument] = test.arguments;
  return channel !== null && argument?.type === "Identifier"
    ? { channel, identifier: argument }
    : null;
}

function onlyReturn(statement: ESTree.Statement): ESTree.ReturnStatement | null {
  if (statement.type === "ReturnStatement") return statement;
  if (
    statement.type === "BlockStatement" &&
    statement.body.length === 1 &&
    statement.body[0]?.type === "ReturnStatement"
  ) {
    return statement.body[0];
  }
  return null;
}

/** Detect manual Result channel propagation that should be composed deliberately. */
export const noResultChannelReboxingRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Review Result guards that immediately reconstruct the same channel.",
    },
    messages: {
      reboxed:
        "This manually reconstructs the same Result channel. The TypeScript reviewer must decide whether to return the existing Result or use map, flatMap, mapError, or Result.gen while preserving evaluation and first-failure order.",
    },
  },
  create(context) {
    return {
      IfStatement(node) {
        const guarded = guardedIdentifier(context.sourceCode, node.test);
        if (guarded === null || node.alternate !== null) return;
        const returned = onlyReturn(node.consequent);
        if (returned?.argument?.type !== "CallExpression") return;
        const constructorName = guarded.channel === "failure" ? "fail" : "succeed";
        if (
          !isEffectCall(
            context.sourceCode,
            returned.argument,
            "Result",
            new Set([constructorName]),
          ) ||
          returned.argument.arguments.length !== 1
        ) {
          return;
        }
        const [argument] = returned.argument.arguments;
        if (
          argument?.type !== "MemberExpression" ||
          argument.object.type !== "Identifier" ||
          memberName(argument) !== guarded.channel ||
          !sameVariable(context.sourceCode, guarded.identifier, argument.object)
        ) {
          return;
        }
        context.report({ node, messageId: "reboxed" });
      },
    };
  },
});
