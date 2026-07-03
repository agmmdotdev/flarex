# Authoritative Analysis Effect Quality Goals

Active goal:

Implement authoritative shared analyzer and Effect-quality hardening step by
step: make hosted backend analysis the trusted source of deployment metadata,
extract and share analyzer semantics with local dev, protect or remove
prototype start-analyzed trust paths, keep Effect code typed and boundary-clean,
update roadmap checkboxes each turn, validate, review significant patches, and
commit each completed slice.

Source roadmap:

- `roadmaps/28-authoritative-analysis-effect-quality.md`

## Goal Status

- [x] G-0. Start the long-running goal and create the concrete roadmap files.
- [x] G-1. Complete A-1: analyzer and Convex reference audit plus shared
  contract freeze.
- [ ] G-2. Complete A-2: shared pure analyzer semantics extraction.
- [ ] G-3. Complete A-3: local Miniflare analyzer worker consumes shared
  semantics.
- [ ] G-4. Complete A-4: backend analyzer response path proves shared contract
  consumption.
- [ ] G-5. Complete A-5: direct `/push/start-analyzed` is protected, internal,
  or removed from normal public hosted flow.
- [ ] G-6. Complete A-6: forged-analysis and source/analysis mismatch tests.
- [ ] G-7. Complete A-7: local dev deploy/codegen uses authoritative backend
  analysis when a backend is configured.
- [ ] G-8. Complete A-8: final audit and cleanup.

## Current Slice

### G-1 / A-1: Analyzer Contract Audit

Status: completed in this docs-only checkpoint.

Purpose:

Audit the current analyzer implementation and Convex references, then freeze
the exact shared analyzer contract before moving code.

Decision:

- A-2 should add `packages/analysis` as `@flarex/analysis`.
- The shared package owns analyzer semantics and typed analyzer errors.
- `flarex-dev` keeps Vite, Miniflare, local double-run nondeterminism checks,
  file discovery, and local response adapters.
- `flarex-backend` keeps Worker service-binding fetch, deployment state,
  artifact storage, public route mapping, and activation validation.
- `flarex-protocol` remains the transport schema owner.

Files changed:

- `roadmaps/28-authoritative-analysis-effect-quality.md`
- this file

Validation gates:

```sh
git diff --check
```

Review gate:

- Not required. This slice is docs-only.

## Previous Slice

### G-0 / A-0: Plan And Goal Setup

Status: completed and committed in `7b14f30`
(`Plan authoritative analysis Effect quality goal`).

Purpose:

Convert the backend-authoritative analysis concern into a concrete turn-by-turn
goal with an Effect-specific quality bar.

Files changed:

- `roadmaps/28-authoritative-analysis-effect-quality.md`
- this file
- `roadmaps/README.md`

Validation gates:

```sh
git diff --check
```

Review gate:

- Not required. This slice is docs-only.

## Next Slice

### G-2 / A-2: Shared Analyzer Semantics Extraction

Status: next.

Purpose:

Create `@flarex/analysis` and move pure analyzer semantics into it without
changing behavior. This is the first code slice and must be protected by
focused shared-package tests before the Miniflare worker string is changed.

Expected implementation:

- add `packages/analysis/package.json`, `tsconfig.json`, `src/index.ts`, and
  focused tests;
- extract semantics from `packages/flarex-dev/src/analyze.ts`, not from the
  untyped worker string first;
- expose typed Effect helpers and conversion helpers named in
  `roadmaps/28-authoritative-analysis-effect-quality.md`;
- keep host adapters unchanged in this slice except for importing shared
  helpers if needed to prove parity.

Validation gates:

```sh
corepack pnpm --filter @flarex/analysis typecheck
corepack pnpm --filter @flarex/analysis test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/analyze.test.ts test/executionArtifact.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
git diff --check
```

Review gate:

- Required because this adds a package, exports shared helpers, and moves
  analyzer semantics.

## Turn Protocol

Each implementation turn follows this protocol:

1. Read this file and
   `roadmaps/28-authoritative-analysis-effect-quality.md`.
2. Confirm the next unchecked `G-*` and matching `A-*`.
3. Keep the patch scoped to that slice.
4. Update both roadmap files before validation.
5. Run focused validation listed for the slice.
6. Run both standing reviewers for significant code/test/public-contract
   changes:
   - `typescript-diff-reviewer`
   - `code-quality-diff-reviewer`
7. Fix valid findings in the main thread and rerun validation.
8. Commit the completed slice.

## Required Quality Checklist For Code Slices

Before marking a code slice complete, confirm:

- [ ] No trusted hosted path accepts client-produced analysis as authority.
- [ ] Shared analyzer functions are typed, named, and tested independently of
  Miniflare or Cloudflare bindings.
- [ ] Domain failures use tagged errors emitted at the source boundary.
- [ ] Adapter boundaries own HTTP response conversion and runtime execution.
- [ ] Schema decoders are hoisted and reusable.
- [ ] `ValidatorJson` semantics remain unchanged.
- [ ] Local dev and hosted paths share analyzer semantics while keeping host
  mechanics separate.
- [ ] Focused tests and package typecheck pass.
- [ ] Reviewer findings are resolved or explicitly rejected with rationale.

## Completed Checkpoints

- `3758dd2` (`Mark lifecycle parity audit complete`) completed the prior local
  and hosted artifact lifecycle parity stream before this goal began.
- `7b14f30` (`Plan authoritative analysis Effect quality goal`) created the
  current authoritative analysis goal files.
