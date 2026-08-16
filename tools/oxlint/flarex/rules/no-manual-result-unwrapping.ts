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

function definitelyTerminates(statement: ESTree.Statement): boolean {
  if (statement.type === "ReturnStatement" || statement.type === "ThrowStatement") {
    return true;
  }
  if (statement.type !== "BlockStatement") return false;
  const last = statement.body.at(-1);
  return last !== undefined && definitelyTerminates(last);
}

interface FlowState {
  readonly active: boolean;
  readonly projected: boolean;
}

function scanAssignmentTarget(
  sourceCode: SourceCode,
  value: unknown,
  identifier: ESTree.IdentifierReference,
  channel: ResultChannel,
  state: FlowState,
): FlowState {
  if (value === null || typeof value !== "object") return state;
  const record = value as Readonly<Record<string, unknown>>;
  if (record.type === "Identifier") {
    return sameVariable(sourceCode, identifier, value as ESTree.IdentifierReference)
      ? { ...state, active: false }
      : state;
  }
  if (record.type === "ArrayPattern") {
    return Array.isArray(record.elements)
      ? record.elements.reduce(
          (current, element) =>
            scanAssignmentTarget(sourceCode, element, identifier, channel, current),
          state,
        )
      : state;
  }
  if (record.type === "ObjectPattern") {
    return Array.isArray(record.properties)
      ? record.properties.reduce((current, property) => {
        if (property === null || typeof property !== "object") return current;
        const propertyRecord = property as Readonly<Record<string, unknown>>;
        const afterKey = propertyRecord.type === "Property" &&
            propertyRecord.computed === true
          ? scanFlow(
              sourceCode,
              propertyRecord.key,
              identifier,
              channel,
              current,
            )
          : current;
        return scanAssignmentTarget(
          sourceCode,
          propertyRecord.type === "Property"
            ? propertyRecord.value
            : propertyRecord.argument,
          identifier,
          channel,
          afterKey,
        );
      }, state)
      : state;
  }
  if (record.type === "AssignmentPattern") {
    const defaultState = scanFlow(sourceCode, record.right, identifier, channel, state);
    return scanAssignmentTarget(
      sourceCode,
      record.left,
      identifier,
      channel,
      defaultState,
    );
  }
  if (record.type === "RestElement") {
    return scanAssignmentTarget(sourceCode, record.argument, identifier, channel, state);
  }
  if (
    record.type === "TSAsExpression" ||
    record.type === "TSNonNullExpression" ||
    record.type === "TSSatisfiesExpression" ||
    record.type === "TSTypeAssertion"
  ) {
    return scanAssignmentTarget(sourceCode, record.expression, identifier, channel, state);
  }
  return state;
}

function scanFlow(
  sourceCode: SourceCode,
  value: unknown,
  identifier: ESTree.IdentifierReference,
  channel: ResultChannel,
  state: FlowState,
): FlowState {
  if (Array.isArray(value)) {
    return value.reduce(
      (current, member) => scanFlow(sourceCode, member, identifier, channel, current),
      state,
    );
  }
  if (value === null || typeof value !== "object") return state;
  const record = value as Readonly<Record<string, unknown>>;
  if (
    record.type === "ArrowFunctionExpression" ||
    record.type === "ClassDeclaration" ||
    record.type === "ClassExpression" ||
    record.type === "FunctionDeclaration" ||
    record.type === "FunctionExpression"
  ) {
    return state;
  }
  if (record.type === "MemberExpression") {
    const member = value as ESTree.MemberExpression;
    if (
      state.active &&
      member.object.type === "Identifier" &&
      memberName(member) === channel &&
      sameVariable(sourceCode, identifier, member.object)
    ) {
      return { ...state, projected: true };
    }
  }
  if (record.type === "AssignmentExpression") {
    const assignment = value as ESTree.AssignmentExpression;
    const afterRight = scanFlow(
      sourceCode,
      assignment.right,
      identifier,
      channel,
      state,
    );
    return scanAssignmentTarget(
      sourceCode,
      assignment.left,
      identifier,
      channel,
      afterRight,
    );
  }
  if (record.type === "UpdateExpression") {
    const update = value as ESTree.UpdateExpression;
    return update.argument.type === "Identifier" &&
        sameVariable(sourceCode, identifier, update.argument)
      ? { ...state, active: false }
      : state;
  }
  if (record.type === "IfStatement" || record.type === "ConditionalExpression") {
    const afterTest = scanFlow(sourceCode, record.test, identifier, channel, state);
    const consequent = scanFlow(
      sourceCode,
      record.consequent,
      identifier,
      channel,
      afterTest,
    );
    const alternate = record.alternate === null
      ? afterTest
      : scanFlow(sourceCode, record.alternate, identifier, channel, afterTest);
    return {
      active: consequent.active || alternate.active,
      projected: consequent.projected || alternate.projected,
    };
  }
  if (record.type === "LogicalExpression") {
    const afterLeft = scanFlow(sourceCode, record.left, identifier, channel, state);
    const afterRight = scanFlow(sourceCode, record.right, identifier, channel, afterLeft);
    return {
      active: afterLeft.active || afterRight.active,
      projected: afterLeft.projected || afterRight.projected,
    };
  }
  if (record.type === "WhileStatement") {
    const afterTest = scanFlow(sourceCode, record.test, identifier, channel, state);
    const afterBody = scanFlow(sourceCode, record.body, identifier, channel, afterTest);
    return {
      active: afterTest.active || afterBody.active,
      projected: afterTest.projected || afterBody.projected,
    };
  }
  if (record.type === "DoWhileStatement") {
    const afterBody = scanFlow(sourceCode, record.body, identifier, channel, state);
    return scanFlow(sourceCode, record.test, identifier, channel, afterBody);
  }
  if (record.type === "ForStatement") {
    const afterInit = scanFlow(sourceCode, record.init, identifier, channel, state);
    const afterTest = scanFlow(sourceCode, record.test, identifier, channel, afterInit);
    const afterBody = scanFlow(sourceCode, record.body, identifier, channel, afterTest);
    const afterUpdate = scanFlow(
      sourceCode,
      record.update,
      identifier,
      channel,
      afterBody,
    );
    return {
      active: afterTest.active || afterUpdate.active,
      projected: afterTest.projected || afterUpdate.projected,
    };
  }
  if (record.type === "ForInStatement" || record.type === "ForOfStatement") {
    const loop = value as ESTree.ForInStatement | ESTree.ForOfStatement;
    const afterRight = scanFlow(sourceCode, loop.right, identifier, channel, state);
    const iterationState = loop.left.type === "VariableDeclaration"
      ? scanFlow(sourceCode, loop.left, identifier, channel, afterRight)
      : scanAssignmentTarget(
          sourceCode,
          loop.left,
          identifier,
          channel,
          afterRight,
        );
    const afterBody = scanFlow(
      sourceCode,
      loop.body,
      identifier,
      channel,
      iterationState,
    );
    return {
      active: afterRight.active || afterBody.active,
      projected: afterRight.projected || afterBody.projected,
    };
  }
  if (record.type === "TryStatement") {
    const statement = value as ESTree.TryStatement;
    const afterTry = scanFlow(sourceCode, statement.block, identifier, channel, state);
    const afterCatch = statement.handler === null
      ? state
      : scanFlow(sourceCode, statement.handler.body, identifier, channel, state);
    const merged = {
      active: afterTry.active || afterCatch.active,
      projected: afterTry.projected || afterCatch.projected,
    };
    return statement.finalizer === null
      ? merged
      : scanFlow(sourceCode, statement.finalizer, identifier, channel, merged);
  }
  if (record.type === "SwitchStatement") {
    const statement = value as ESTree.SwitchStatement;
    const afterDiscriminant = scanFlow(
      sourceCode,
      statement.discriminant,
      identifier,
      channel,
      state,
    );
    const exits: FlowState[] = statement.cases.map((entry, startIndex) => {
      let current = afterDiscriminant;
      const evaluatedTests = entry.test === null
        ? statement.cases
        : statement.cases.slice(0, startIndex + 1);
      for (const prior of evaluatedTests) {
        current = scanFlow(
          sourceCode,
          prior.test,
          identifier,
          channel,
          current,
        );
      }
      for (const switchCase of statement.cases.slice(startIndex)) {
        for (const consequent of switchCase.consequent) {
          if (consequent.type === "BreakStatement") return current;
          current = scanFlow(
            sourceCode,
            consequent,
            identifier,
            channel,
            current,
          );
        }
      }
      return current;
    });
    if (!statement.cases.some((switchCase) => switchCase.test === null)) {
      exits.push(statement.cases.reduce(
        (current, switchCase) => scanFlow(
          sourceCode,
          switchCase.test,
          identifier,
          channel,
          current,
        ),
        afterDiscriminant,
      ));
    }
    return exits.reduce<FlowState>(
      (merged, exit) => ({
        active: merged.active || exit.active,
        projected: merged.projected || exit.projected,
      }),
      { active: false, projected: false },
    );
  }
  if (record.type === "ReturnStatement" || record.type === "ThrowStatement") {
    const afterArgument = scanFlow(
      sourceCode,
      record.argument,
      identifier,
      channel,
      state,
    );
    return { ...afterArgument, active: false };
  }
  const children: unknown[] = Object.entries(record)
    .filter(([key, child]) =>
      key !== "parent" &&
      child !== null &&
      typeof child === "object"
    )
    .map(([, child]) => child)
    .sort((left, right) => {
      const leftRecord = left as { readonly start?: number };
      const rightRecord = right as { readonly start?: number };
      const leftStart = Array.isArray(left)
        ? (left[0] as { readonly start?: number } | undefined)?.start
        : leftRecord.start;
      const rightStart = Array.isArray(right)
        ? (right[0] as { readonly start?: number } | undefined)?.start
        : rightRecord.start;
      return (leftStart ?? 0) - (rightStart ?? 0);
    });
  return children.reduce<FlowState>(
    (current, child) => scanFlow(sourceCode, child, identifier, channel, current),
    state,
  );
}

/** Detect a Result guard followed by direct opposite-channel projection. */
export const noManualResultUnwrappingRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Review manual Result guards followed by direct channel projection.",
    },
    messages: {
      manual:
        "This Result guard is followed by direct `{{channel}}` projection. The TypeScript reviewer must decide whether a simple guard is still clearest or whether map, flatMap, match, or Result.gen should own the composition while preserving first-failure order.",
    },
  },
  create(context) {
    return {
      BlockStatement(node) {
        for (const [index, statement] of node.body.entries()) {
          if (
            statement.type !== "IfStatement" ||
            statement.alternate !== null ||
            !definitelyTerminates(statement.consequent)
          ) {
            continue;
          }
          const guarded = guardedIdentifier(context.sourceCode, statement.test);
          if (guarded === null) continue;
          const projectedChannel = guarded.channel === "failure" ? "success" : "failure";
          const laterStatements = node.body.slice(index + 1);
          let state: FlowState = { active: true, projected: false };
          for (const laterStatement of laterStatements) {
            state = scanFlow(
              context.sourceCode,
              laterStatement,
              guarded.identifier,
              projectedChannel,
              state,
            );
            if (state.projected) {
              context.report({
                node: statement,
                messageId: "manual",
                data: { channel: projectedChannel },
              });
              break;
            }
            if (!state.active) break;
          }
        }
      },
    };
  },
});
