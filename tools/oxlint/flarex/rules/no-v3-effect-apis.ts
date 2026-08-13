import { defineRule } from "@oxlint/plugins";

import {
  importedEffectNamespace,
  importedName,
  memberName,
} from "./effect-imports.ts";

const replacements = {
  Effect: new Map([
    ["catchAll", "Effect.catch"],
    ["catchAllCause", "Effect.catchCause"],
    ["catchSome", "Effect.catchFilter"],
    ["catchSomeCause", "Effect.catchCause"],
    ["either", "Effect.result"],
  ]),
  Layer: new Map([["scoped", "Layer.effect or Layer.effectContext"]]),
  Option: new Map([["fromNullable", "Option.fromNullishOr"]]),
  Result: new Map<string, string>(),
} as const;

function replacementFor(namespace: keyof typeof replacements, name: string): string | null {
  return replacements[namespace].get(name) ?? null;
}

/** Reject Effect v3 APIs that are absent or renamed in the installed v4 beta. */
export const noV3EffectApisRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow Effect v3 APIs that do not match Flarex's installed Effect v4.",
    },
    messages: {
      either:
        "Effect v4 uses `Result`, not `Either`. Use the installed Result API and preserve the owning boundary contract.",
      removed:
        "`{{api}}` is not the installed Effect v4 API. Use `{{replacement}}` after verifying equivalent failure and lifecycle semantics.",
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (source === "effect/Either") {
          if (node.specifiers.length === 0) {
            context.report({ node, messageId: "either" });
            return;
          }
          for (const specifier of node.specifiers) {
            context.report({ node: specifier, messageId: "either" });
          }
          return;
        }

        if (source === "effect") {
          for (const specifier of node.specifiers) {
            if (
              specifier.type === "ImportSpecifier" &&
              importedName(specifier) === "Either"
            ) {
              context.report({ node: specifier, messageId: "either" });
            }
          }
          return;
        }

        const namespace = source.startsWith("effect/")
          ? source.slice("effect/".length)
          : null;
        if (
          namespace !== "Effect" &&
          namespace !== "Layer" &&
          namespace !== "Option"
        ) {
          return;
        }
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") continue;
          const name = importedName(specifier);
          if (name === null) continue;
          const replacement = replacementFor(namespace, name);
          if (replacement === null) continue;
          context.report({
            node: specifier,
            messageId: "removed",
            data: { api: `${namespace}.${name}`, replacement },
          });
        }
      },
      MemberExpression(node) {
        if (node.object.type !== "Identifier") return;
        const namespace = importedEffectNamespace(context.sourceCode, node.object);
        if (namespace === null) return;
        const name = memberName(node);
        if (name === null) return;
        const replacement = replacementFor(namespace, name);
        if (replacement === null) return;
        context.report({
          node,
          messageId: "removed",
          data: { api: `${namespace}.${name}`, replacement },
        });
      },
    };
  },
});
