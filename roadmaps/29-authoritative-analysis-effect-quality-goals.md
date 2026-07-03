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
- [ ] G-8. Complete A-8: final audit and cleanup.

## Current Slice

### G-7 / A-7: Backend-Configured Local Deploy And Codegen Use Authoritative Analysis

Status: completed in this code checkpoint.

Purpose:

Align local dev deploy/codegen with authoritative backend analysis when a
backend is configured.

Decision:

- Backend-configured codegen and deploy already start from the source-only
  push path and use backend-returned `codegenAnalysis` for final generated
  files.
- This checkpoint tightens that contract: high-level codegen/deploy now also
  requires backend deployment `analysis` before treating a backend push as
  analyzed.
- Low-level HTTP/local push status parsing can still represent partial push
  statuses for diagnostics, but `generateFlarex`, `dryRunFlarexCodegen`, and
  `deployFlarex` do not silently fall back to local analysis when a backend
  push coordinator is configured.

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

- Required because this changes high-level backend-configured codegen/deploy
  acceptance behavior.

## Previous Slice

### G-6 / A-6: Forged Analysis And Source/Analysis Mismatch Tests

Status: completed and committed in `4fe6cde`
(`Reject source-mismatched analyzed functions`).

Purpose:

Prove forged or source-mismatched analyzed metadata is rejected before
activation where the DeploymentDO boundary has enough source-package evidence
to validate it.

Files changed:

- `packages/flarex-backend/src/deployment/Validation.ts`
- `packages/flarex-backend/test/deploymentValidation.test.ts`
- `packages/flarex-backend/test/push.test.ts`
- `roadmaps/28-authoritative-analysis-effect-quality.md`
- this file

Validation gates:

```sh
corepack pnpm --filter @flarex/analysis typecheck
corepack pnpm --filter @flarex/analysis test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentValidation.test.ts test/push.test.ts -t "source package|forged|declared by source package|stores a candidate|supersedes|moves the active execution artifact|persists partition selector metadata" --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend test
git diff --check
```

Review gate:

- Required and completed in the committed slice.

## Next Slice

### G-8 / A-8: Final Audit And Cleanup

Status: next.

Purpose:

Complete the final authoritative-analysis quality audit and remove or document
remaining duplicate analyzer semantics.

Expected implementation:

- confirm no duplicate analyzer semantic helpers remain outside
  `@flarex/analysis` except host adapter shells;
- confirm remaining generated worker source is adapter mechanics only;
- run the full relevant analysis/backend/dev validation set;
- resolve reviewer findings and record the final migration-quality state.

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
- [ ] Shared analyzer functions are typed, named, and tested independently of
  Miniflare or Cloudflare bindings.
- [ ] Domain failures use tagged errors emitted at the source boundary.
- [ ] Adapter boundaries own HTTP response conversion and runtime execution.
- [ ] Schema decoders are hoisted and reusable.
- [ ] `ValidatorJson` semantics remain unchanged.
- [x] Local dev and hosted paths share analyzer semantics while keeping host
  mechanics separate.
- [x] Focused tests and package typecheck pass.
- [ ] Reviewer findings are resolved or explicitly rejected with rationale.

## Completed Checkpoints

- `3758dd2` (`Mark lifecycle parity audit complete`) completed the prior local
  and hosted artifact lifecycle parity stream before this goal began.
- `7b14f30` (`Plan authoritative analysis Effect quality goal`) created the
  current authoritative analysis goal files.
