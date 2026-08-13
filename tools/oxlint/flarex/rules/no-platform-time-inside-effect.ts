import { defineRule } from "@oxlint/plugins";

import { isUnshadowedGlobal, memberName } from "./effect-imports.ts";
import {
  collectReferencedEffectBodies,
  startsEffectBody,
} from "./effect-body.ts";

/** Ask the reviewer to verify direct platform-clock reads inside Effect operations. */
export const noPlatformTimeInsideEffectRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Review Date.now calls inside Effect.fn or Effect.gen bodies.",
    },
    messages: {
      clock:
        "Direct Date.now inside Effect-native code bypasses Effect time and TestClock. The TypeScript reviewer must decide whether this is a deliberate host adapter or should use the Effect Clock boundary.",
    },
  },
  create(context) {
    let effectBodyDepth = 0;
    const effectBodyCalls = new Set<object>();
    let referencedBodies = new Set<object>();

    const enterReferencedBody = (node: object) => {
      if (referencedBodies.has(node)) effectBodyDepth += 1;
    };
    const exitReferencedBody = (node: object) => {
      if (referencedBodies.has(node)) effectBodyDepth -= 1;
    };

    return {
      Program(node) {
        referencedBodies = new Set(
          collectReferencedEffectBodies(context.sourceCode, node),
        );
      },
      ArrowFunctionExpression: enterReferencedBody,
      "ArrowFunctionExpression:exit": exitReferencedBody,
      FunctionDeclaration: enterReferencedBody,
      "FunctionDeclaration:exit": exitReferencedBody,
      FunctionExpression: enterReferencedBody,
      "FunctionExpression:exit": exitReferencedBody,
      CallExpression(node) {
        if (startsEffectBody(context.sourceCode, node)) {
          effectBodyCalls.add(node);
          effectBodyDepth += 1;
        }
        const callee = node.callee.type === "TSInstantiationExpression"
          ? node.callee.expression
          : node.callee;
        if (
          effectBodyDepth > 0 &&
          callee.type === "MemberExpression" &&
          callee.object.type === "Identifier" &&
          callee.object.name === "Date" &&
          isUnshadowedGlobal(context.sourceCode, callee.object) &&
          memberName(callee) === "now"
        ) {
          context.report({ node, messageId: "clock" });
        }
      },
      "CallExpression:exit"(node) {
        if (!effectBodyCalls.delete(node)) return;
        effectBodyDepth -= 1;
      },
    };
  },
});
