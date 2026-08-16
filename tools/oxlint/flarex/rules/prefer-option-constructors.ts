import { defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode } from "@oxlint/plugins";

import {
  isEffectCall,
  isUnshadowedGlobal,
  sameVariable,
} from "./effect-imports.ts";

type ConstructorName = "fromNullOr" | "fromNullishOr" | "fromUndefinedOr";

interface AbsenceCheck {
  readonly constructorName: ConstructorName;
  readonly identifier: ESTree.IdentifierReference;
  readonly someWhenTrue: boolean;
}

function isNullLiteral(
  expression: ESTree.Expression | ESTree.PrivateIdentifier,
): boolean {
  return expression.type === "Literal" && expression.value === null;
}

function isGlobalUndefined(
  sourceCode: SourceCode,
  expression: ESTree.Expression | ESTree.PrivateIdentifier,
): boolean {
  return (
    expression.type === "Identifier" &&
    expression.name === "undefined" &&
    isUnshadowedGlobal(sourceCode, expression)
  );
}

function inspectAbsenceCheck(
  sourceCode: SourceCode,
  test: ESTree.Expression,
): AbsenceCheck | null {
  if (test.type !== "BinaryExpression") return null;

  const nullIdentifier =
    test.left.type === "Identifier" && isNullLiteral(test.right)
      ? test.left
      : test.right.type === "Identifier" && isNullLiteral(test.left)
        ? test.right
        : null;
  if (nullIdentifier !== null) {
    switch (test.operator) {
      case "!==":
        return {
          constructorName: "fromNullOr",
          identifier: nullIdentifier,
          someWhenTrue: true,
        };
      case "===":
        return {
          constructorName: "fromNullOr",
          identifier: nullIdentifier,
          someWhenTrue: false,
        };
      case "!=":
        return {
          constructorName: "fromNullishOr",
          identifier: nullIdentifier,
          someWhenTrue: true,
        };
      case "==":
        return {
          constructorName: "fromNullishOr",
          identifier: nullIdentifier,
          someWhenTrue: false,
        };
      default:
        return null;
    }
  }

  if (test.operator !== "===" && test.operator !== "!==") return null;
  let undefinedIdentifier: ESTree.IdentifierReference | null = null;
  if (isGlobalUndefined(sourceCode, test.right)) {
    undefinedIdentifier = test.left.type === "Identifier" ? test.left : null;
  } else if (isGlobalUndefined(sourceCode, test.left)) {
    undefinedIdentifier = test.right.type === "Identifier" ? test.right : null;
  }
  return undefinedIdentifier === null
    ? null
    : {
        constructorName: "fromUndefinedOr",
        identifier: undefinedIdentifier,
        someWhenTrue: test.operator === "!==",
      };
}

/** Prefer installed Option v4 constructors for exact null, undefined, and nullish flows. */
export const preferOptionConstructorsRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Prefer Option.fromNullOr, fromUndefinedOr, or fromNullishOr for equivalent absence checks.",
    },
    messages: {
      nullOnly:
        "Use `Option.fromNullOr(value)` for this exact null-to-Option conversion.",
      nullish:
        "Use `Option.fromNullishOr(value)` for this exact nullish-to-Option conversion.",
      undefinedOnly:
        "Use `Option.fromUndefinedOr(value)` for this exact undefined-to-Option conversion.",
    },
  },
  create(context) {
    const isOptionCall = (
      expression: ESTree.Expression,
      name: "none" | "some",
      checkedIdentifier: ESTree.IdentifierReference,
    ): boolean => {
      if (expression.type !== "CallExpression") return false;
      if (
        !isEffectCall(context.sourceCode, expression, "Option", new Set([name]))
      ) {
        return false;
      }
      if (name === "none") return expression.arguments.length === 0;
      if (expression.arguments.length !== 1) return false;
      const [argument] = expression.arguments;
      return (
        argument?.type === "Identifier" &&
        sameVariable(context.sourceCode, checkedIdentifier, argument)
      );
    };

    return {
      ConditionalExpression(node) {
        const absenceCheck = inspectAbsenceCheck(context.sourceCode, node.test);
        if (absenceCheck === null) return;

        const someBranch = absenceCheck.someWhenTrue ? node.consequent : node.alternate;
        const noneBranch = absenceCheck.someWhenTrue ? node.alternate : node.consequent;
        if (
          !isOptionCall(someBranch, "some", absenceCheck.identifier) ||
          !isOptionCall(noneBranch, "none", absenceCheck.identifier)
        ) {
          return;
        }

        const messageId = absenceCheck.constructorName === "fromNullOr"
          ? "nullOnly"
          : absenceCheck.constructorName === "fromUndefinedOr"
            ? "undefinedOnly"
            : "nullish";
        context.report({ node, messageId });
      },
    };
  },
});
