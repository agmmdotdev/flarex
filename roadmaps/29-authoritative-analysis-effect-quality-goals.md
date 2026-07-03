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
- [ ] G-1. Complete A-1: analyzer and Convex reference audit plus shared
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

### G-0 / A-0: Plan And Goal Setup

Status: completed in this docs-only checkpoint.

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

### G-1 / A-1: Analyzer Contract Audit

Status: next.

Purpose:

Audit the current analyzer implementation and Convex references, then freeze
the exact shared analyzer contract before moving code. This prevents a large
string extraction from becoming an accidental behavior rewrite.

Expected investigation:

- `packages/flarex-dev/src/executionArtifact.ts`
- `packages/flarex-dev/src/backendPush.ts`
- `packages/flarex-backend/src/backendAnalyzerResponse.ts`
- `packages/flarex-backend/src/deployment/Validation.ts`
- `packages/flarex-backend/src/worker.ts`
- `packages/flarex-protocol/src/deployment.ts`
- Convex references listed in
  `roadmaps/28-authoritative-analysis-effect-quality.md`

Expected output:

- A contract table for shared analyzer inputs, outputs, diagnostics, and typed
  error tags.
- A package-boundary decision for the shared analyzer module.
- A list of exact fixtures/tests required before moving analyzer logic.
- No behavior change unless the audit exposes a tiny doc-only correction.

Validation gates:

```sh
git diff --check
```

Review gate:

- Not required if the slice remains docs-only.
- Required if the slice changes production code, tests, or public package
  exports.

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
