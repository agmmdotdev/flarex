import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

export type EffectNamespace = "Effect" | "Layer" | "Option" | "Result";

export function importedName(
  specifier: ESTree.ImportDeclaration["specifiers"][number],
): string | null {
  if (specifier.type !== "ImportSpecifier") return null;
  return specifier.imported.type === "Identifier"
    ? specifier.imported.name
    : specifier.imported.value;
}

export function resolveVariable(
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

export type LocalFunction =
  | ESTree.ArrowFunctionExpression
  | ESTree.Function;

export type LocalClass = Extract<
  ESTree.Node,
  { readonly type: "ClassDeclaration" | "ClassExpression" }
>;

export function resolveLocalClass(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
  seen: Set<Variable> = new Set(),
): LocalClass | null {
  const variable = resolveVariable(sourceCode, identifier);
  if (
    variable === null ||
    seen.has(variable) ||
    variable.defs.length !== 1 ||
    variable.references.some((reference) => reference.isWrite() && !reference.init)
  ) {
    return null;
  }
  seen.add(variable);
  const [definition] = variable.defs;
  if (
    definition?.type === "ClassName" &&
    definition.node.type === "ClassDeclaration"
  ) {
    return definition.node;
  }
  if (
    definition?.type !== "Variable" ||
    definition.node.type !== "VariableDeclarator" ||
    definition.parent?.type !== "VariableDeclaration" ||
    definition.parent.kind !== "const" ||
    definition.node.init === null
  ) {
    return null;
  }
  if (definition.node.init.type === "ClassExpression") {
    return definition.node.init;
  }
  return definition.node.init.type === "Identifier"
    ? resolveLocalClass(sourceCode, definition.node.init, seen)
    : null;
}

export function resolveLocalFunction(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
  seen: Set<Variable> = new Set(),
): LocalFunction | null {
  const variable = resolveVariable(sourceCode, identifier);
  if (variable === null || seen.has(variable) || variable.defs.length !== 1) {
    return null;
  }
  if (variable.references.some((reference) => reference.isWrite() && !reference.init)) {
    return null;
  }
  seen.add(variable);
  const [definition] = variable.defs;
  if (
    definition?.type === "FunctionName" &&
    definition.node.type === "FunctionDeclaration"
  ) {
    return definition.node;
  }
  if (
    definition?.type !== "Variable" ||
    definition.node.type !== "VariableDeclarator" ||
    definition.parent?.type !== "VariableDeclaration" ||
    definition.parent.kind !== "const" ||
    definition.node.init === null
  ) {
    return null;
  }
  const initializer = definition.node.init;
  if (
    initializer.type === "ArrowFunctionExpression" ||
    initializer.type === "FunctionExpression"
  ) {
    return initializer;
  }
  return initializer.type === "Identifier"
    ? resolveLocalFunction(sourceCode, initializer, seen)
    : null;
}

export function importedEffectNamespace(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
  seen: Set<Variable> = new Set(),
): EffectNamespace | null {
  const variable = resolveVariable(sourceCode, identifier);
  if (variable === null || seen.has(variable)) return null;

  for (const definition of variable.defs) {
    if (
      definition.type !== "ImportBinding" ||
      definition.parent?.type !== "ImportDeclaration"
    ) {
      continue;
    }
    const source = definition.parent.source.value;
    if (source === "effect" && definition.node.type === "ImportSpecifier") {
      const name = importedName(definition.node);
      if (name === "Effect" || name === "Layer" || name === "Option" || name === "Result") {
        return name;
      }
    }
    if (
      definition.node.type === "ImportNamespaceSpecifier" &&
      (source === "effect/Effect" ||
        source === "effect/Layer" ||
        source === "effect/Option" ||
        source === "effect/Result")
    ) {
      return source.slice("effect/".length) as EffectNamespace;
    }
  }

  if (
    variable.defs.length !== 1 ||
    variable.references.some((reference) => reference.isWrite() && !reference.init)
  ) {
    return null;
  }
  const [definition] = variable.defs;
  if (
    definition?.type !== "Variable" ||
    definition.node.type !== "VariableDeclarator" ||
    definition.parent?.type !== "VariableDeclaration" ||
    definition.parent.kind !== "const" ||
    definition.node.init?.type !== "Identifier"
  ) {
    return null;
  }
  seen.add(variable);
  return importedEffectNamespace(sourceCode, definition.node.init, seen);
}

export function isImportedEffectFunction(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
  namespace: EffectNamespace,
  names: ReadonlySet<string>,
  seen: Set<Variable> = new Set(),
): boolean {
  const variable = resolveVariable(sourceCode, identifier);
  if (variable === null || seen.has(variable)) return false;
  if (
    variable.defs.some((definition) => {
      if (
        definition.type !== "ImportBinding" ||
        definition.parent?.type !== "ImportDeclaration" ||
        definition.node.type !== "ImportSpecifier"
      ) {
        return false;
      }
      return (
        definition.parent.source.value === `effect/${namespace}` &&
        names.has(importedName(definition.node) ?? "")
      );
    })
  ) {
    return true;
  }
  if (
    variable.defs.length !== 1 ||
    variable.references.some((reference) => reference.isWrite() && !reference.init)
  ) {
    return false;
  }
  const [definition] = variable.defs;
  if (
    definition?.type !== "Variable" ||
    definition.node.type !== "VariableDeclarator" ||
    definition.parent?.type !== "VariableDeclaration" ||
    definition.parent.kind !== "const" ||
    definition.node.init === null
  ) {
    return false;
  }
  seen.add(variable);
  const initializer = definition.node.init;
  if (
    definition.node.id.type === "ObjectPattern" &&
    initializer.type === "Identifier" &&
    importedEffectNamespace(sourceCode, initializer) === namespace
  ) {
    for (const property of definition.node.id.properties) {
      if (property.type !== "Property") continue;
      const binding = property.value.type === "AssignmentPattern"
        ? property.value.left
        : property.value;
      if (
        binding.type !== "Identifier" ||
        binding.name !== identifier.name
      ) {
        continue;
      }
      const key = property.key.type === "Identifier"
        ? property.computed ? null : property.key.name
        : property.key.type === "Literal" &&
            typeof property.key.value === "string"
          ? property.key.value
          : null;
      return key !== null && names.has(key);
    }
    return false;
  }
  if (initializer.type === "Identifier") {
    return isImportedEffectFunction(
      sourceCode,
      initializer,
      namespace,
      names,
      seen,
    );
  }
  return (
    initializer.type === "MemberExpression" &&
    initializer.object.type === "Identifier" &&
    importedEffectNamespace(sourceCode, initializer.object) === namespace &&
    names.has(memberName(initializer) ?? "")
  );
}

export function isImportedEffectPipe(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
  seen: Set<Variable> = new Set(),
): boolean {
  const variable = resolveVariable(sourceCode, identifier);
  if (variable === null || seen.has(variable)) return false;
  if (
    variable.defs.some((definition) =>
      definition.type === "ImportBinding" &&
      definition.parent?.type === "ImportDeclaration" &&
      definition.node.type === "ImportSpecifier" &&
      (definition.parent.source.value === "effect" ||
        definition.parent.source.value === "effect/Function") &&
      importedName(definition.node) === "pipe"
    )
  ) {
    return true;
  }
  if (
    variable.defs.length !== 1 ||
    variable.references.some((reference) => reference.isWrite() && !reference.init)
  ) {
    return false;
  }
  const [definition] = variable.defs;
  if (
    definition?.type !== "Variable" ||
    definition.node.type !== "VariableDeclarator" ||
    definition.parent?.type !== "VariableDeclaration" ||
    definition.parent.kind !== "const" ||
    definition.node.init?.type !== "Identifier"
  ) {
    return false;
  }
  seen.add(variable);
  return isImportedEffectPipe(sourceCode, definition.node.init, seen);
}

export function memberName(member: ESTree.MemberExpression): string | null {
  if (!member.computed && member.property.type === "Identifier") {
    return member.property.name;
  }
  return member.computed &&
    member.property.type === "Literal" &&
    typeof member.property.value === "string"
    ? member.property.value
    : null;
}

export function callCallee(
  call: ESTree.CallExpression,
): ESTree.Expression | ESTree.Super | ESTree.V8IntrinsicExpression {
  return call.callee.type === "TSInstantiationExpression"
    ? call.callee.expression
    : call.callee;
}

export function isNamespaceMember(
  sourceCode: SourceCode,
  expression: ESTree.Expression | ESTree.Super | ESTree.V8IntrinsicExpression,
  namespace: EffectNamespace,
  names: ReadonlySet<string>,
): expression is ESTree.MemberExpression {
  return (
    expression.type === "MemberExpression" &&
    expression.object.type === "Identifier" &&
    importedEffectNamespace(sourceCode, expression.object) === namespace &&
    names.has(memberName(expression) ?? "")
  );
}

export function isEffectCall(
  sourceCode: SourceCode,
  call: ESTree.CallExpression,
  namespace: EffectNamespace,
  names: ReadonlySet<string>,
): boolean {
  const callee = callCallee(call);
  return (
    isNamespaceMember(sourceCode, callee, namespace, names) ||
    (callee.type === "Identifier" &&
      isImportedEffectFunction(sourceCode, callee, namespace, names))
  );
}

export function sameVariable(
  sourceCode: SourceCode,
  left: ESTree.IdentifierReference,
  right: ESTree.IdentifierReference,
): boolean {
  const leftVariable = resolveVariable(sourceCode, left);
  const rightVariable = resolveVariable(sourceCode, right);
  return (
    left.name === right.name &&
    (leftVariable === null || rightVariable === null || leftVariable === rightVariable)
  );
}

export function isUnshadowedGlobal(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
): boolean {
  const variable = resolveVariable(sourceCode, identifier);
  return variable === null || variable.defs.length === 0;
}
