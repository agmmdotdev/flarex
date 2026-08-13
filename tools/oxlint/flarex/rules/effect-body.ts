import type { ESTree, SourceCode } from "@oxlint/plugins";

import {
  callCallee,
  isEffectCall,
  resolveLocalFunction,
  type LocalFunction,
} from "./effect-imports.ts";

const operationBuilders = new Set(["fn", "fnUntraced"]);

function hasFunctionArgument(call: ESTree.CallExpression): boolean {
  return call.arguments.some(
    (argument) =>
      argument.type === "ArrowFunctionExpression" ||
      argument.type === "FunctionExpression",
  );
}

export function startsEffectBody(
  sourceCode: SourceCode,
  call: ESTree.CallExpression,
): boolean {
  const callee = callCallee(call);
  if (
    isEffectCall(sourceCode, call, "Effect", new Set(["gen"])) &&
    hasFunctionArgument(call)
  ) {
    return true;
  }
  if (
    isEffectCall(sourceCode, call, "Effect", operationBuilders) &&
    hasFunctionArgument(call)
  ) {
    return true;
  }
  return (
    callee.type === "CallExpression" &&
    isEffectCall(sourceCode, callee, "Effect", operationBuilders) &&
    hasFunctionArgument(call)
  );
}

function referencedFunctionArguments(
  sourceCode: SourceCode,
  call: ESTree.CallExpression,
): LocalFunction[] {
  const callee = callCallee(call);
  const isBuilder =
    isEffectCall(sourceCode, call, "Effect", new Set(["gen"])) ||
    isEffectCall(sourceCode, call, "Effect", operationBuilders) ||
    (callee.type === "CallExpression" &&
      isEffectCall(
        sourceCode,
        callee,
        "Effect",
        operationBuilders,
      ));
  if (!isBuilder) return [];
  const functions: LocalFunction[] = [];
  for (const argument of call.arguments) {
    if (argument.type !== "Identifier") continue;
    const resolved = resolveLocalFunction(sourceCode, argument);
    if (resolved !== null) functions.push(resolved);
  }
  return functions;
}

function visitCallExpressions(
  value: unknown,
  visit: (node: ESTree.CallExpression) => void,
): void {
  if (Array.isArray(value)) {
    for (const member of value) visitCallExpressions(member, visit);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const record = value as Readonly<Record<string, unknown>>;
  if (record.type === "CallExpression") {
    // SAFETY: the Oxlint ESTree traversal identified the concrete node type.
    visit(value as ESTree.CallExpression);
  }
  for (const [key, member] of Object.entries(record)) {
    if (key !== "parent") visitCallExpressions(member, visit);
  }
}

export function collectReferencedEffectBodies(
  sourceCode: SourceCode,
  program: ESTree.Program,
): ReadonlySet<LocalFunction> {
  const functions = new Set<LocalFunction>();
  visitCallExpressions(program, (node) => {
    for (const callback of referencedFunctionArguments(sourceCode, node)) {
      functions.add(callback);
    }
  });
  return functions;
}
