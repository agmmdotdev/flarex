# Flarex Oxlint rule provenance

This plugin deliberately selects and adapts rules instead of enabling either
source repository wholesale.

## Vendored MIT sources

The files under `anti-slop/` are copied from
[`dmmulroy/anti-slop`](https://github.com/dmmulroy/anti-slop) commit
`9b80d9a5c317d3af94d88a577bdbde4d9a45f7be`. They remain covered by the
included MIT `LICENSE`.

The plugin currently registers these vendored rules:

- `no-chained-type-assertions`
- `no-known-value-widening`
- `no-module-mocking`
- `no-object-parameters`
- `no-unknown-type-aliases`
- `no-widen-then-assert`
- `require-safety-comment-for-type-assertion`

## Flarex-owned rules

The files under `rules/` are independent Flarex implementations informed by
the public rule catalog in
[`typeonce-dev/ai-automation`](https://github.com/typeonce-dev/ai-automation)
commit `0bca096fe6fe9878cd15303a623dd2cd85915ddd`. No source was copied because
that repository did not expose a license when this plugin was created.

The Flarex implementations are intentionally narrower:

- `no-banned-type-assertions` rejects only assertions directly targeting
  `any`, `never`, or `unknown`.
- `no-silent-effect-error-swallow` recognizes imported Effect recovery
  handlers that return only `Effect.void` or `Effect.unit` for reviewer
  adjudication.
- `prefer-option-constructors` recognizes imported Option namespaces and
  distinguishes exact `fromNullOr`, `fromUndefinedOr`, and `fromNullishOr`
  conversions using the installed Effect v4 API.
- `no-v3-effect-apis` rejects a narrow catalog of removed or renamed v3 imports
  and members that are unambiguous under Flarex's installed v4 API.
- `no-runtime-runner-inside-effect`, `no-platform-time-inside-effect`,
  `no-result-channel-reboxing`, `no-result-get-or-throw-without-boundary`,
  `no-silent-effect-error-swallow`, `prefer-result-gen-for-dependent-sequence`, and
  `prefer-effect-fn-for-reusable-operation` emit semantic review evidence.
  The TypeScript reviewer, not the AST heuristic, owns the final connected-flow
  decision.
- `require-effect-review-justification` rejects broad semantic-rule disables
  and requires a specific reviewer rationale on a line-scoped exception.

Any future upstream refresh must be reviewed as a normal tooling change. Do
not overwrite Flarex-owned adaptations mechanically.
