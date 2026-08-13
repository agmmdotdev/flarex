import type { ESTree, SourceCode } from "@oxlint/plugins";

import {
  callCallee,
  isEffectCall,
  resolveLocalClass,
  resolveLocalFunction,
  type LocalFunction,
} from "./effect-imports.ts";

const operationBuilders = new Set(["fn", "fnUntraced"]);
const callbackConstructors = new Set([
  "acquireRelease",
  "acquireUseRelease",
  "callback",
  "promise",
  "suspend",
  "sync",
  "try",
  "tryPromise",
]);
const bodyBuilders = new Set(["gen", ...callbackConstructors]);
const referencedBodyCache = new WeakMap<
  ESTree.Program,
  ReadonlySet<LocalFunction>
>();
const constructedClassCache = new WeakMap<
  ESTree.Program,
  ReadonlySet<ESTree.Class>
>();

export interface EffectBodyTracker {
  readonly enter: (node: LocalFunction) => void;
  readonly exit: (node: LocalFunction) => void;
  readonly inside: (node: ESTree.Node) => boolean;
  readonly program: (node: ESTree.Program) => void;
}

function isFunctionExpression(value: ESTree.Node): value is LocalFunction {
  return (
    value.type === "ArrowFunctionExpression" ||
    value.type === "FunctionExpression"
  );
}

function referencedFunctionArguments(
  sourceCode: SourceCode,
  call: ESTree.CallExpression,
): LocalFunction[] {
  const callee = callCallee(call);
  const isBuilder =
    isEffectCall(
      sourceCode,
      call,
      "Effect",
      bodyBuilders,
    ) ||
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
    if (isFunctionExpression(argument)) {
      functions.push(argument);
      continue;
    }
    if (argument.type === "Identifier") {
      const resolved = resolveLocalFunction(sourceCode, argument);
      if (resolved !== null) functions.push(resolved);
      continue;
    }
    if (argument.type !== "ObjectExpression") continue;
    for (const property of argument.properties) {
      if (property.type !== "Property") {
        continue;
      }
      if (isFunctionExpression(property.value)) {
        functions.push(property.value);
        continue;
      }
      if (property.value.type !== "Identifier") continue;
      const resolved = resolveLocalFunction(sourceCode, property.value);
      if (resolved !== null) functions.push(resolved);
    }
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

function visitSynchronouslyInvokedFunctions(
  sourceCode: SourceCode,
  root: LocalFunction,
  visit: (node: LocalFunction) => void,
  visitClass: (node: ESTree.Class) => void,
): void {
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const member of value) walk(member);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const record = value as Readonly<Record<string, unknown>>;
    if (
      record.type === "PropertyDefinition" ||
      record.type === "AccessorProperty"
    ) {
      if (record.computed === true) walk(record.key);
      if (record.static === true) walk(record.value);
      return;
    }
    if (
      value !== root &&
      (record.type === "ArrowFunctionExpression" ||
        record.type === "FunctionDeclaration" ||
        record.type === "FunctionExpression")
    ) {
      return;
    }
    if (record.type === "CallExpression") {
      const call = value as ESTree.CallExpression;
      const callee = callCallee(call);
      if (isFunctionExpression(callee)) {
        visit(callee);
      } else if (callee.type === "Identifier") {
        const resolved = resolveLocalFunction(sourceCode, callee);
        if (resolved !== null) visit(resolved);
      }
    }
    if (record.type === "NewExpression") {
      const construction = value as ESTree.NewExpression;
      const classNode = construction.callee.type === "ClassExpression"
        ? construction.callee
        : construction.callee.type === "Identifier"
          ? resolveLocalClass(sourceCode, construction.callee)
          : null;
      if (classNode !== null) {
        visitClass(classNode);
        for (const element of classNode.body.body) {
          if (
            element.type === "MethodDefinition" &&
            element.kind === "constructor"
          ) {
            visit(element.value);
          } else if (
            (element.type === "PropertyDefinition" ||
              element.type === "AccessorProperty") &&
            !element.static &&
            element.value !== null
          ) {
            walk(element.value);
          }
        }
      }
    }
    for (const [key, member] of Object.entries(record)) {
      if (key !== "parent") walk(member);
    }
  };
  walk(root.body);
}

export function collectReferencedEffectBodies(
  sourceCode: SourceCode,
  program: ESTree.Program,
): ReadonlySet<LocalFunction> {
  const cached = referencedBodyCache.get(program);
  if (cached !== undefined) return cached;
  const functions = new Set<LocalFunction>();
  const constructedClasses = new Set<ESTree.Class>();
  visitCallExpressions(program, (node) => {
    for (const callback of referencedFunctionArguments(sourceCode, node)) {
      functions.add(callback);
    }
  });
  const pending = [...functions];
  for (let index = 0; index < pending.length; index += 1) {
    const owner = pending[index];
    if (owner === undefined) continue;
    visitSynchronouslyInvokedFunctions(
      sourceCode,
      owner,
      (callback) => {
        if (functions.has(callback)) return;
        functions.add(callback);
        pending.push(callback);
      },
      (classNode) => constructedClasses.add(classNode),
    );
  }
  referencedBodyCache.set(program, functions);
  constructedClassCache.set(program, constructedClasses);
  return functions;
}

/** Track only callback bodies that the recognized Effect API will execute. */
export function createEffectBodyTracker(sourceCode: SourceCode): EffectBodyTracker {
  let referencedBodies: ReadonlySet<LocalFunction> = new Set();
  let constructedClasses: ReadonlySet<ESTree.Class> = new Set();
  const functionStack: Array<{
    readonly node: LocalFunction;
    readonly owned: boolean;
  }> = [];

  return {
    program(node) {
      referencedBodies = collectReferencedEffectBodies(sourceCode, node);
      constructedClasses = constructedClassCache.get(node) ?? new Set();
    },
    enter(node) {
      functionStack.push({ node, owned: referencedBodies.has(node) });
    },
    exit(node) {
      const frame = functionStack.pop();
      if (frame?.node !== node) {
        throw new Error("Effect body tracker function traversal became unbalanced");
      }
    },
    inside(node) {
      const frame = functionStack.at(-1);
      if (frame === undefined || !frame.owned) return false;
      const owner = frame.node;
      let child: ESTree.Node = node;
      let parent: ESTree.Node | null = node.parent;
      while (parent !== null && parent !== owner) {
        if (
          (parent.type === "PropertyDefinition" ||
            parent.type === "AccessorProperty") &&
          !parent.static &&
          parent.value === child
        ) {
          const classNode = parent.parent.parent;
          return (
            classNode !== null &&
            (classNode.type === "ClassDeclaration" ||
              classNode.type === "ClassExpression") &&
            constructedClasses.has(classNode)
          );
        }
        child = parent;
        parent = parent.parent;
      }
      return true;
    },
  };
}
