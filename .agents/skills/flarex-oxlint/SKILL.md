---
name: flarex-oxlint
description: Maintain Flarex's scoped Oxlint policy and ratchet. Use when changing oxlint.config.ts, custom or vendored rules under tools/oxlint, lint scope or severity, changed-lines enforcement, provenance, false-positive handling, or an approved remediation that promotes an audit rule to blocking. Do not use for ordinary TypeScript work that only needs the standard lint commands.
---

# Flarex Oxlint

Maintain the repository's deterministic lint policy without converting legacy
debt into authority for new code or broadening an approved implementation slice.

## Establish The Boundary

Read `tools/oxlint/README.md`, `oxlint.config.ts`, and
`tools/oxlint/flarex/PROVENANCE.md` before changing policy. Inspect the current
Git diff and separate the requested lint work from unrelated application work.

Preserve the three enforcement roles:

- `lint:core` blocks zero-debt rules across every configured source root.
- `lint:diff` blocks all configured diagnostics on added or modified lines.
- `lint:audit` inventories pre-existing warning debt without authorizing a
  package-wide cleanup.

Generated sources, vendored snapshots, `third_party/trigger.dev`, and packages
outside the explicit rollout remain excluded until an owner approves expanding
the scope.

## Remediate Findings

Fix a current-diff finding when the smallest behavior-preserving correction is
inside the approved slice and focused validation exists. Preserve static and
runtime contracts, validation and failure order, Effect channels, persistence
semantics, and test strength.

Do not obtain a green result through severity downgrades, blanket disables,
baseline files, assertion laundering, weak safety comments, fallback or dual
paths, or unrelated cleanup. A `SAFETY:` comment must state the actual checked
invariant; it is not a ceremonial suppression.

If remediation would change a public contract, trust or transaction boundary,
data model, lifecycle owner, or another package owner's behavior, stop at that
boundary and report the finding. Lint policy does not authorize the expansion.

For reviewer-decision Effect rules, treat the AST diagnostic as evidence rather
than a mechanical rewrite instruction. The TypeScript reviewer inspects the
smallest connected operation and chooses exactly one disposition:

1. valid diagnostic: require the smallest behavior-preserving correction;
2. legitimate host, protocol, lifecycle, transaction, or compatibility
   boundary: state the concrete reason and recommend one adjacent
   `oxlint-disable-line` or `oxlint-disable-next-line` directive with
   `-- REVIEW: <boundary-category> - <specific reason>`; or
3. real false positive: report the rule defect and add a regression test when
   the main thread corrects the rule; do not suppress source.

The reviewer stays read-only. The main thread owns any fix or reviewed
exception. Never use a file/region disable, baseline, severity downgrade, or a
generic justification such as `legacy` or `reviewed`.

## Change Rules Or Scope

Keep a Flarex-owned rule focused on a stable repository invariant and add
positive, negative, and edge-case tests in `tools/oxlint/flarex/rules.test.ts`.
Adapt an upstream rule locally only when its behavior matches the repository
contract; preserve its license and update provenance with the source commit and
local modifications.

Promote an audit rule to blocking only after approved remediation leaves zero
findings in every configured source root. Do not hide remaining findings with
file exceptions or a stored baseline. Expand source roots only through an
explicit rollout that first assesses generated files, tests, framework seams,
and package-specific compatibility constraints.

## Validate

For ordinary scoped source remediation, run:

1. `pnpm lint:core`
2. `pnpm lint:diff`
3. the focused typecheck and tests owned by the changed package

Before committing a scoped checkpoint, also run `pnpm lint:diff -- --staged`
so validation reads the exact index snapshot rather than unrelated worktree
edits.

When configuration, plugins, rules, severity, provenance, or lint scope changes,
also run:

1. `pnpm test:oxlint-rules`
2. `pnpm test:oxlint-diff`
3. `pnpm typecheck:oxlint`
4. `pnpm typecheck:scripts`
5. `pnpm lint:audit -- --silent`

Treat failures from unrelated dirty files as evidence and report their exact
boundary. Do not modify those files merely to validate lint governance.
