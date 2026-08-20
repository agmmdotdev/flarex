import { defineConfig } from "oxlint";

export default defineConfig({
  jsPlugins: [
    {
      name: "flarex",
      specifier: "./tools/oxlint/flarex/index.ts",
    },
  ],
  ignorePatterns: [
    "**/*.generated.ts",
    ".codex-worktrees/**",
    ".tmp/**",
    "dist/**",
    "effect-ts-migration-draft/**",
    "node_modules/**",
    "opensrc/**",
    "third_party/**",
  ],
  categories: {
    // Existing built-in-rule debt is visible in `lint:audit` but is not a
    // production-source migration authorization.
    correctness: "warn",
    suspicious: "warn",
  },
  rules: {
    // Audit-only until each rule reaches zero findings in the scoped sources.
    "flarex/no-banned-type-assertions": "warn",
    "flarex/no-chained-type-assertions": "warn",
    "flarex/no-known-value-widening": "warn",
    "flarex/no-module-mocking": "warn",
    "flarex/no-object-parameters": "warn",
    // Semantic Effect diagnostics are reviewer evidence. The TypeScript
    // reviewer adjudicates the connected flow before the main thread fixes or
    // records one narrow, reviewed exception.
    "flarex/no-effect-option-error-erasure": "warn",
    "flarex/no-manual-result-unwrapping": "warn",
    "flarex/no-platform-time-inside-effect": "warn",
    "flarex/no-result-channel-reboxing": "warn",
    "flarex/no-result-get-or-throw-without-boundary": "warn",
    "flarex/no-runtime-runner-inside-effect": "warn",
    "flarex/no-silent-effect-error-swallow": "warn",
    "flarex/no-throw-inside-effect-operation": "warn",
    "flarex/no-unreviewed-effect-promise": "warn",
    "flarex/prefer-effect-fn-for-reusable-operation": "warn",
    "flarex/prefer-result-gen-for-dependent-sequence": "warn",
    "flarex/prefer-tagged-effect-recovery": "warn",
    // These rules were zero-debt when this scoped profile was introduced.
    "flarex/no-unknown-type-aliases": "error",
    "flarex/no-v3-effect-apis": "error",
    "flarex/no-widen-then-assert": "error",
    "flarex/prefer-option-constructors": "error",
    "flarex/require-effect-review-justification": "error",
    "flarex/require-safety-comment-for-type-assertion": "warn",
    // Convex document system fields and Effect tagged discriminants.
    "no-underscore-dangle": ["warn", {
      allow: ["_id", "_creationTime", "_tag"],
    }],
  },
});
