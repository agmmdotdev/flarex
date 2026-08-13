import { defineRule } from "@oxlint/plugins";
import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

const recoveryMethods = new Set([
  "catch",
  "catchReason",
  "catchReasons",
  "catchTag",
  "catchTags",
]);
const discardedEffectNames = new Set(["unit", "void"]);

type Callback = ESTree.ArrowFunctionExpression | ESTree.Function;

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

function isImportedEffectNamespace(
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
      if (definition.parent.source.value === "effect/Effect") {
        return definition.node.type === "ImportNamespaceSpecifier";
      }
      return (
        definition.parent.source.value === "effect" &&
        definition.node.type === "ImportSpecifier" &&
        importedName(definition.node) === "Effect"
      );
    })
  );
}

function memberName(member: ESTree.MemberExpression): string | null {
  if (!member.computed && member.property.type === "Identifier") {
    return member.property.name;
  }
  return member.computed &&
    member.property.type === "Literal" &&
    typeof member.property.value === "string"
    ? member.property.value
    : null;
}

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
    const isEffectMember = (
      expression: ESTree.Expression,
      names: ReadonlySet<string>,
    ): expression is ESTree.MemberExpression =>
      expression.type === "MemberExpression" &&
      expression.object.type === "Identifier" &&
      isImportedEffectNamespace(context.sourceCode, expression.object) &&
      names.has(memberName(expression) ?? "");

    const silentlyDiscards = (callback: Callback): boolean => {
      const expression = returnedExpression(callback);
      return expression !== null && isEffectMember(expression, discardedEffectNames);
    };

    const inspectRecoveryArgument = (argument: ESTree.CallExpression["arguments"][number]) => {
      if (
        argument.type === "ArrowFunctionExpression" ||
        argument.type === "FunctionExpression"
      ) {
        return silentlyDiscards(argument);
      }
      if (argument.type !== "ObjectExpression") return false;
      return argument.properties.some(
        (property) =>
          property.type === "Property" &&
          (property.value.type === "ArrowFunctionExpression" ||
            property.value.type === "FunctionExpression") &&
          silentlyDiscards(property.value),
      );
    };

    return {
      CallExpression(node) {
        if (
          node.callee.type === "Super" ||
          node.callee.type === "V8IntrinsicExpression" ||
          !isEffectMember(node.callee, recoveryMethods)
        ) {
          return;
        }
        if (!node.arguments.some(inspectRecoveryArgument)) return;
        context.report({ node, messageId: "swallowed" });
      },
    };
  },
});
