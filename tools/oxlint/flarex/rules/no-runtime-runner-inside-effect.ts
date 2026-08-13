import { defineRule } from "@oxlint/plugins";

import { isEffectCall } from "./effect-imports.ts";
import {
  createEffectBodyTracker,
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
        if (
          tracker.inside(node) &&
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
    };
  },
});
