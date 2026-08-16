import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import {
  isEffectCall,
  isImportedEffectFunction,
  isNamespaceMember,
  resolveLocalFunction,
} from "./effect-imports.ts";

const recoveryMethods = new Set([
  "catch",
  "catchReason",
  "catchReasons",
  "catchTag",
  "catchTags",
]);
const discardedEffectNames = new Set(["unit", "void"]);

type Callback = ESTree.ArrowFunctionExpression | ESTree.Function;

function returnedExpression(callback: Callback): ESTree.Expression | null {
  if (callback.body === null) return null;
  if (callback.body.type !== "BlockStatement") return callback.body;
  if (callback.body.body.length !== 1) return null;
  const [statement] = callback.body.body;
  return statement?.type === "ReturnStatement" && statement.argument !== null
    ? statement.argument
    : null;
}

/** Reject Effect recovery handlers that erase a failure without replacement semantics. */
export const noSilentEffectErrorSwallowRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Effect recovery handlers that return only Effect.void or Effect.unit.",
    },
    messages: {
      swallowed:
        "This recovery handler silently discards the typed failure. Recover with explicit domain meaning, transform the error, observe it at the owning boundary, or let it propagate.",
    },
  },
  create(context) {
    const isDiscardedEffect = (
      expression: ESTree.Expression,
    ): boolean =>
      isNamespaceMember(
        context.sourceCode,
        expression,
        "Effect",
        discardedEffectNames,
      ) ||
      (expression.type === "Identifier" &&
        isImportedEffectFunction(
          context.sourceCode,
          expression,
          "Effect",
          discardedEffectNames,
        ));

    const silentlyDiscards = (callback: Callback): boolean => {
      const expression = returnedExpression(callback);
      return expression !== null && isDiscardedEffect(expression);
    };

    const inspectRecoveryArgument = (argument: ESTree.CallExpression["arguments"][number]) => {
      if (
        argument.type === "ArrowFunctionExpression" ||
        argument.type === "FunctionExpression"
      ) {
        return silentlyDiscards(argument);
      }
      if (argument.type === "Identifier") {
        const callback = resolveLocalFunction(context.sourceCode, argument);
        return callback !== null && silentlyDiscards(callback);
      }
      if (argument.type !== "ObjectExpression") return false;
      return argument.properties.some(
        (property) => {
          if (property.type !== "Property") return false;
          if (
            property.value.type === "ArrowFunctionExpression" ||
            property.value.type === "FunctionExpression"
          ) {
            return silentlyDiscards(property.value);
          }
          if (property.value.type !== "Identifier") return false;
          const callback = resolveLocalFunction(context.sourceCode, property.value);
          return callback !== null && silentlyDiscards(callback);
        },
      );
    };

    return {
      CallExpression(node) {
        if (
          !isEffectCall(context.sourceCode, node, "Effect", recoveryMethods)
        ) {
          return;
        }
        if (!node.arguments.some(inspectRecoveryArgument)) return;
        context.report({ node, messageId: "swallowed" });
      },
    };
  },
});
