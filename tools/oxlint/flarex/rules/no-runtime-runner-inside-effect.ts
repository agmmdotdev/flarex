import { defineRule } from "@oxlint/plugins";

import { isEffectCall } from "./effect-imports.ts";
import {
  collectReferencedEffectBodies,
  startsEffectBody,
} from "./effect-body.ts";

const runtimeRunners = new Set([
  "runFork",
  "runPromise",
  "runPromiseExit",
  "runSync",
  "runSyncExit",
]);

/** Prevent nested Effect runtimes inside an Effect-native operation. */
export const noRuntimeRunnerInsideEffectRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow Effect runtime runners inside Effect.fn or Effect.gen bodies.",
    },
    messages: {
      nested:
        "Do not run a new Effect runtime inside an Effect-native operation. Compose or yield the Effect and keep one runtime bridge at the owning adapter boundary.",
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
        if (
          effectBodyDepth > 0 &&
          isEffectCall(
            context.sourceCode,
            node,
            "Effect",
            runtimeRunners,
          )
        ) {
          context.report({ node, messageId: "nested" });
        }
      },
      "CallExpression:exit"(node) {
        if (!effectBodyCalls.delete(node)) return;
        effectBodyDepth -= 1;
      },
    };
  },
});
