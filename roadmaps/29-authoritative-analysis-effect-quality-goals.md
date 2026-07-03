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
- [x] G-2. Complete A-2: shared pure analyzer semantics extraction.
- [x] G-3. Complete A-3: local Miniflare analyzer worker consumes shared
  semantics.
- [x] G-4. Complete A-4: backend analyzer response path proves shared contract
  consumption.
- [x] G-5. Complete A-5: direct `/push/start-analyzed` is protected, internal,
  or removed from normal public hosted flow.
- [x] G-6. Complete A-6: forged function metadata and source-module mismatch tests.
- [x] G-7. Complete A-7: local dev deploy/codegen uses authoritative backend
  analysis when a backend is configured.
- [x] G-8. Complete A-8: final audit and cleanup.

## Current Slice

### G-8 / A-8: Final Audit And Cleanup

Status: completed in this code checkpoint.

Purpose:

Complete the authoritative-analysis Effect-quality stream by removing the last
duplicate dev-side contract parser and recording the final boundary audit.

Decision:

- `backendPush.ts` no longer manually reparses nested deployment analysis and
  codegen analysis shapes. It delegates those public contract boundaries to the
  shared `flarex-protocol/deployment` Effect decoders.
- The dev push status envelope remains locally parsed because it is adapter
  state and may represent partial diagnostics or in-progress pushes.
- Codegen-only restrictions remain local to dev codegen: route metadata is
  rejected and table validators are still required for generated code.
- Reviewer feedback on duplicate backend validator conversion was resolved by
  delegating backend validator mapping back to `@flarex/analysis`.
- The Vite watcher generated-output typecheck assertion now waits long enough
  for the spawned TypeScript process to fail on slower local runs.
- The remaining generated analyzer worker string is host adapter mechanics
  only. Runtime marker inspection remains invocation adapter validation, not a
  deployment analysis authority path.

Files changed:

- `packages/flarex-dev/src/backendPush.ts`
- `packages/flarex-dev/test/backendPush.test.ts`
- `packages/flarex-dev/test/vite.test.ts`
- `roadmaps/28-authoritative-analysis-effect-quality.md`
- this file

Validation gates:

```sh
corepack pnpm --filter @flarex/analysis typecheck
corepack pnpm --filter @flarex/analysis test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
git diff --check
```

Review gate:

- Required because this is the final code audit before closing the
  authoritative-analysis quality stream.

## Previous Slice

### G-7 / A-7: Backend-Configured Local Deploy And Codegen Use Authoritative Analysis

Status: completed and committed in `8ca76af`
(`Require backend analysis for configured codegen`).

Purpose:

Align local dev deploy/codegen with authoritative backend analysis when a
backend is configured.

Files changed:

- `packages/flarex-dev/src/generate.ts`
- `packages/flarex-dev/test/generate.test.ts`
- `packages/flarex-dev/test/cli.test.ts`
- `roadmaps/28-authoritative-analysis-effect-quality.md`
- this file

Validation gates:

```sh
corepack pnpm --filter @flarex/analysis typecheck
corepack pnpm --filter @flarex/analysis test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts test/cli.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
git diff --check
```

Review gate:

- Required and completed in the committed slice.

## Next Slice

### Completion Audit

Status: pending validation, reviewer pass, and commit.

Purpose:

No unchecked implementation slices remain. After this checkpoint validates,
passes reviewers, and is committed, close the active goal.

Completion evidence to verify before closing:

- Roadmap A-8 and goal G-8 are checked.
- Full relevant validation has passed.
- Both standing reviewers have no unresolved blocking findings.
- The final A-8 checkpoint is committed.

Validation gates:

```sh
corepack pnpm --filter @flarex/analysis typecheck
corepack pnpm --filter @flarex/analysis test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
git diff --check
```

Review gate:

- Required because this is the final audit before closing the long-running
  authoritative-analysis quality stream.

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

- [x] No trusted hosted path accepts client-produced analysis as authority.
- [x] Shared analyzer functions are typed, named, and tested independently of
  Miniflare or Cloudflare bindings.
- [x] Domain failures use tagged errors emitted at the source boundary.
- [x] Adapter boundaries own HTTP response conversion and runtime execution.
- [x] Schema decoders are hoisted and reusable.
- [x] `ValidatorJson` semantics remain unchanged.
- [x] Local dev and hosted paths share analyzer semantics while keeping host
  mechanics separate.
- [x] Focused tests and package typecheck pass.
- [x] Reviewer findings are resolved or explicitly rejected with rationale.

## Completed Checkpoints

- `3758dd2` (`Mark lifecycle parity audit complete`) completed the prior local
  and hosted artifact lifecycle parity stream before this goal began.
- `7b14f30` (`Plan authoritative analysis Effect quality goal`) created the
  current authoritative analysis goal files.
- `4fe6cde` (`Reject source-mismatched analyzed functions`) completed forged
  analysis and source/analysis mismatch coverage.
- `8ca76af` (`Require backend analysis for configured codegen`) completed
  backend-configured codegen/deploy authority alignment.
