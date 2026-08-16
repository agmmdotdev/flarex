import { defineRule } from "@oxlint/plugins";

import { isUnshadowedGlobal, memberName } from "./effect-imports.ts";
import {
  createEffectBodyTracker,
} from "./effect-body.ts";

/** Ask the reviewer to verify direct platform-clock reads inside Effect operations. */
export const noPlatformTimeInsideEffectRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Review direct platform-clock reads inside Effect operations and Effect-owned constructor callbacks.",
    },
    messages: {
      clock:
        "A direct platform-clock read inside Effect-native code bypasses Effect time and TestClock. The TypeScript reviewer must decide whether this is a deliberate host adapter or should use the Effect Clock boundary.",
    },
  },
  create(context) {
    const tracker = createEffectBodyTracker(context.sourceCode);

    return {
      Program: tracker.program,
      ArrowFunctionExpression: tracker.enter,
      "ArrowFunctionExpression:exit": tracker.exit,
      FunctionDeclaration: tracker.enter,
      "FunctionDeclaration:exit": tracker.exit,
      FunctionExpression: tracker.enter,
      "FunctionExpression:exit": tracker.exit,
      CallExpression(node) {
        const callee = node.callee.type === "TSInstantiationExpression"
          ? node.callee.expression
          : node.callee;
        const isDateCall =
          tracker.inside(node) &&
          callee.type === "Identifier" &&
          callee.name === "Date" &&
          isUnshadowedGlobal(context.sourceCode, callee);
        const isPlatformNow =
          tracker.inside(node) &&
          callee.type === "MemberExpression" &&
          callee.object.type === "Identifier" &&
          (callee.object.name === "Date" || callee.object.name === "performance") &&
          isUnshadowedGlobal(context.sourceCode, callee.object) &&
          memberName(callee) === "now";
        if (isDateCall || isPlatformNow) {
          context.report({ node, messageId: "clock" });
        }
      },
      NewExpression(node) {
        if (
          tracker.inside(node) &&
          node.arguments.length === 0 &&
          node.callee.type === "Identifier" &&
          node.callee.name === "Date" &&
          isUnshadowedGlobal(context.sourceCode, node.callee)
        ) {
          context.report({ node, messageId: "clock" });
        }
      },
    };
  },
});
