import { defineRule } from "@oxlint/plugins";
import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

type ConstructorName = "fromNullOr" | "fromNullishOr";

interface NullCheck {
  readonly constructorName: ConstructorName;
  readonly identifier: ESTree.IdentifierReference;
  readonly someWhenTrue: boolean;
}

function importedName(
  specifier: ESTree.ImportDeclaration["specifiers"][number],
): string | null {
  if (specifier.type !== "ImportSpecifier") return null;
  return specifier.imported.type === "Identifier"
    ? specifier.imported.name
    : specifier.imported.value;
}

function resolveVariable(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
): Variable | null {
  let scope: Scope | null = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) return variable;
    scope = scope.upper;
  }
  return null;
}

function isImportedOptionNamespace(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
): boolean {
  const variable = resolveVariable(sourceCode, identifier);
  return (
    variable !== null &&
    variable.defs.some((definition) => {
      if (
        definition.type !== "ImportBinding" ||
        definition.parent?.type !== "ImportDeclaration"
      ) {
        return false;
      }
      if (definition.parent.source.value === "effect/Option") {
        return definition.node.type === "ImportNamespaceSpecifier";
      }
      return (
        definition.parent.source.value === "effect" &&
        definition.node.type === "ImportSpecifier" &&
        importedName(definition.node) === "Option"
      );
    })
  );
}

function memberName(member: ESTree.MemberExpression): string | null {
  if (!member.computed && member.property.type === "Identifier") {
    return member.property.name;
  }
  return null;
}

function isNullLiteral(
  expression: ESTree.Expression | ESTree.PrivateIdentifier,
): boolean {
  return expression.type === "Literal" && expression.value === null;
}

function inspectNullCheck(test: ESTree.Expression): NullCheck | null {
  if (test.type !== "BinaryExpression") return null;

  const identifier =
    test.left.type === "Identifier" && isNullLiteral(test.right)
      ? test.left
      : test.right.type === "Identifier" && isNullLiteral(test.left)
        ? test.right
        : null;
  if (identifier === null) return null;

  switch (test.operator) {
    case "!==":
      return { constructorName: "fromNullOr", identifier, someWhenTrue: true };
    case "===":
      return { constructorName: "fromNullOr", identifier, someWhenTrue: false };
    case "!=":
      return {
        constructorName: "fromNullishOr",
        identifier,
        someWhenTrue: true,
      };
    case "==":
      return {
        constructorName: "fromNullishOr",
        identifier,
        someWhenTrue: false,
      };
    default:
      return null;
  }
}

/** Prefer the installed Option v4 constructors for exact null and nullish flows. */
export const preferOptionNullConstructorsRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Prefer Option.fromNullOr or Option.fromNullishOr for equivalent null checks.",
    },
    messages: {
      nullOnly:
        "Use `Option.fromNullOr(value)` for this exact null-to-Option conversion.",
      nullish:
        "Use `Option.fromNullishOr(value)` for this exact nullish-to-Option conversion.",
    },
  },
  create(context) {
    const isOptionCall = (
      expression: ESTree.Expression,
      name: "none" | "some",
      checkedIdentifier: ESTree.IdentifierReference,
    ): boolean => {
      if (expression.type !== "CallExpression") return false;
      const callee =
        expression.callee.type === "TSInstantiationExpression"
          ? expression.callee.expression
          : expression.callee;
      if (
        callee.type !== "MemberExpression" ||
        callee.object.type !== "Identifier" ||
        !isImportedOptionNamespace(context.sourceCode, callee.object) ||
        memberName(callee) !== name
      ) {
        return false;
      }
      if (name === "none") return expression.arguments.length === 0;
      if (expression.arguments.length !== 1) return false;

      const [argument] = expression.arguments;
      if (argument?.type !== "Identifier" || argument.name !== checkedIdentifier.name) {
        return false;
      }
      const checkedVariable = resolveVariable(context.sourceCode, checkedIdentifier);
      const argumentVariable = resolveVariable(context.sourceCode, argument);
      return (
        checkedVariable === null ||
        argumentVariable === null ||
        checkedVariable === argumentVariable
      );
    };

    return {
      ConditionalExpression(node) {
        const nullCheck = inspectNullCheck(node.test);
        if (nullCheck === null) return;

        const someBranch = nullCheck.someWhenTrue ? node.consequent : node.alternate;
        const noneBranch = nullCheck.someWhenTrue ? node.alternate : node.consequent;
        if (
          !isOptionCall(someBranch, "some", nullCheck.identifier) ||
          !isOptionCall(noneBranch, "none", nullCheck.identifier)
        ) {
          return;
        }

        context.report({
          node,
          messageId:
            nullCheck.constructorName === "fromNullOr" ? "nullOnly" : "nullish",
        });
      },
    };
  },
});
