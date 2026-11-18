---
name: flarex-oxlint
description: Maintain Flarex Oxlint configuration, rules, scope, severity, provenance, changed-lines enforcement and audit-to-blocking remediation. Do not use for ordinary TypeScript changes needing only standard lint commands.
---

# Flarex Oxlint

Read `tools/oxlint/README.md`, `oxlint.config.ts` and
`tools/oxlint/flarex/PROVENANCE.md`; isolate the requested policy work.

- `lint:core` blocks zero-debt rules across configured roots.
- `lint:diff` blocks configured diagnostics on changed lines.
- `lint:audit` inventories existing warning debt without authorizing broad cleanup.
- Generated/vendor snapshots, `third_party/trigger.dev`, and roots outside the
  approved rollout remain excluded.

## Remediation And Rules

Fix scoped diagnostics while preserving contracts, evaluation/failure order,
Effect channels, persistence and test strength. A lint rule does not authorize
changing a public/data/transaction/trust/lifecycle contract or another owner's
behavior; report out-of-scope remediation.

No baselines, severity downgrades, file/region disables, assertion laundering,
weak safety comments, fallback/dual paths or unrelated cleanup. `SAFETY:` must
state the actual checked invariant.

For reviewer-decision Effect diagnostics, the read-only TypeScript reviewer
inspects the connected operation and selects one disposition:

1. Valid: smallest behavior-preserving correction.
2. Legitimate host/protocol/lifecycle/transaction/compatibility/invariant/
   evaluation-order boundary: recommend one adjacent
   `oxlint-disable-next-line` with
   `-- REVIEW: <boundary-category> - <specific reason>`.
3. False positive: report the rule defect and regression case; do not suppress
   product source.

The main thread owns fixes and exceptions; generic "legacy"/"reviewed" reasons
are insufficient. Keep rules focused on stable invariants and test positive,
negative and edge cases in `tools/oxlint/flarex/rules.test.ts`. Preserve upstream
licenses and provenance with source commit/local changes when adapting a rule.

Promote audit rules only after approved remediation reaches zero findings in
every configured root. Scope expansion requires an explicit rollout assessing
generated code, tests, framework seams and compatibility; do not hide findings
with baselines or exceptions.

## Validation

For source remediation: `pnpm lint:core`, `pnpm lint:diff`, and affected
typechecks/tests; before commit, `pnpm lint:diff -- --staged`.

For config/plugin/rule/severity/provenance/scope changes also run:

- `pnpm test:oxlint-rules`
- `pnpm test:oxlint-diff`
- `pnpm typecheck:oxlint`
- `pnpm typecheck:scripts`
- `pnpm lint:audit -- --silent`

Report unrelated dirty-file failures without modifying those files.
