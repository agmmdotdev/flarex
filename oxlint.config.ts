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
    // These rules were zero-debt when this scoped profile was introduced.
    "flarex/no-silent-effect-error-swallow": "error",
    "flarex/no-unknown-type-aliases": "error",
    "flarex/no-widen-then-assert": "error",
    "flarex/prefer-option-null-constructors": "error",
    "flarex/require-safety-comment-for-type-assertion": "warn",
  },
});
