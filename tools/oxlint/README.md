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

- `flarex/no-v3-effect-apis`
- `flarex/prefer-option-constructors`
- `flarex/require-effect-review-justification`
- `flarex/no-unknown-type-aliases`
- `flarex/no-widen-then-assert`

The first two Effect rules are deterministic syntax/import checks against the
installed Effect v4 API. `prefer-option-constructors` covers exact null-only,
undefined-only, and nullish conversions; it does not replace public or
protocol-owned absence shapes merely because they contain `undefined` or
`null`.

## Reviewer-decision Effect rules

These rules are warning-level evidence and are still blocking on added or
modified lines through `lint:diff`:

- `flarex/no-platform-time-inside-effect`
- `flarex/no-result-channel-reboxing`
- `flarex/no-result-get-or-throw-without-boundary`
- `flarex/no-runtime-runner-inside-effect`
- `flarex/no-silent-effect-error-swallow`
- `flarex/prefer-effect-fn-for-reusable-operation`
- `flarex/prefer-result-gen-for-dependent-sequence`

The TypeScript reviewer must inspect the smallest connected operation and
classify each in-diff diagnostic as a required bounded fix, a legitimate
boundary exception, or a rule false positive. A diagnostic is evidence, not
automatic authority to rewrite a public representation, validation order,
transaction boundary, lifecycle owner, or compatibility adapter.

For a legitimate exception, the reviewer states the concrete boundary reason
and the main thread may add only an adjacent line-scoped directive:

```ts
// oxlint-disable-next-line flarex/no-result-channel-reboxing -- REVIEW: compatibility - preserves the public result allocation
```

The required category is one of `public`, `protocol`, `host`, `compatibility`,
`transaction`, `lifecycle`, or `evaluation-order`, followed by a concrete
explanation.

File and region disables are rejected. If the diagnostic is a real false
positive, fix the rule and add a regression case instead of suppressing source.

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
