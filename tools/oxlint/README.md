# Flarex Oxlint

The root Oxlint profile covers the first-party kernel sources named explicitly
by `lint:core` and `lint:audit`. It does not scan `third_party/trigger.dev`,
generated sources, vendored source snapshots, or application packages that
have not entered the rollout.

## Commands

- `pnpm lint` and `pnpm lint:core` run the blocking zero-debt rules and hide
  audit-only warnings.
- `pnpm lint:diff` fails when any configured diagnostic touches an added or
  modified line in the working tree. `pnpm lint:diff -- --staged` reads and
  checks the exact index snapshot before commit. `pnpm lint:diff -- --base
  <git-ref>` reads the committed `HEAD` snapshot and checks changes from that
  merge base for CI or branch review.
  Snapshot modes fail closed if the working Oxlint policy differs from the
  staged or committed policy they are meant to apply.
- `pnpm lint:audit` prints existing built-in and Flarex rule debt without
  failing the command.
- `pnpm test:oxlint-rules` runs the custom-rule behavior suite.
- `pnpm typecheck:oxlint` checks the configuration and custom plugin sources.

## Current blocking rules

- `flarex/no-silent-effect-error-swallow`
- `flarex/no-unknown-type-aliases`
- `flarex/no-widen-then-assert`
- `flarex/prefer-option-null-constructors`

All other configured custom rules and built-in categories are audit-only. A
rule may move to blocking only after its scoped findings reach zero through an
approved source migration. Do not add a baseline file, bulk suppressions, or
source rewrites merely to make the audit quiet.

The diff gate is the ratchet for audit-only rules: old findings outside changed
lines remain visible in `lint:audit`, while new or materially touched findings
fail. File-level diagnostics without a precise label are owned by any changed
file so they cannot bypass the ratchet. Fix current-diff findings inside the
approved slice; do not weaken a rule or expand into another package owner just
to obtain a green command.

Tests, `packages/flarex-backend`, and `apps/executor` are later rollout scopes.
The existing `cloudflare:workers` module-mocking test seam must be assessed
before `no-module-mocking` can become blocking for tests.

See `flarex/PROVENANCE.md` for rule ownership and upstream attribution.
