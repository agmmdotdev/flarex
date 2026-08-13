import { defineRule } from "@oxlint/plugins";

const reviewerDecisionRules = new Set([
  "flarex/no-effect-option-error-erasure",
  "flarex/no-manual-result-unwrapping",
  "flarex/no-platform-time-inside-effect",
  "flarex/no-result-channel-reboxing",
  "flarex/no-result-get-or-throw-without-boundary",
  "flarex/no-runtime-runner-inside-effect",
  "flarex/no-silent-effect-error-swallow",
  "flarex/no-throw-inside-effect-operation",
  "flarex/no-unreviewed-effect-promise",
  "flarex/prefer-effect-fn-for-reusable-operation",
  "flarex/prefer-result-gen-for-dependent-sequence",
  "flarex/prefer-tagged-effect-recovery",
]);

/** Require durable reviewer rationale for a narrow semantic Effect-rule exception. */
export const requireEffectReviewJustificationRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Require reviewer rationale for semantic Effect lint exceptions.",
    },
    messages: {
      broad:
        "Semantic Effect rules may not be disabled for a file or region. Use one line-scoped exception only after TypeScript reviewer adjudication.",
      missing:
        "This semantic Effect exception needs `-- REVIEW: <boundary-category> - <specific reason>` from TypeScript reviewer adjudication.",
    },
  },
  create(context) {
    return {
      Program(node) {
        for (const comment of context.sourceCode.getAllComments()) {
          if (/^\s*oxlint-disable-line(?:\s+--|\s*$)/u.test(comment.value)) {
            context.report({ node, messageId: "broad" });
          }
        }
        const { directives } = context.sourceCode.getDisableDirectives();
        for (const directive of directives) {
          if (directive.value.trim() === "") {
            context.report({ node: directive.node, messageId: "broad" });
            continue;
          }
          const disabledRules = directive.value
            .split(",")
            .map((value) => value.trim())
            .filter((value) => reviewerDecisionRules.has(value));
          if (disabledRules.length === 0) continue;
          if (
            directive.type === "disable" ||
            directive.type === "disable-line" ||
            directive.type === "enable"
          ) {
            context.report({ node: directive.node, messageId: "broad" });
            continue;
          }
          if (
            !/^REVIEW:\s+(?:public|protocol|host|compatibility|transaction|lifecycle|evaluation-order|invariant)\s+-\s+\S.{9,}$/u.test(
              directive.justification.trim(),
            )
          ) {
            context.report({ node: directive.node, messageId: "missing" });
          }
        }
      },
    };
  },
});
