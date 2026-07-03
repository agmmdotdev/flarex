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
- [ ] G-5. Complete A-5: direct `/push/start-analyzed` is protected, internal,
  or removed from normal public hosted flow.
- [ ] G-6. Complete A-6: forged-analysis and source/analysis mismatch tests.
- [ ] G-7. Complete A-7: local dev deploy/codegen uses authoritative backend
  analysis when a backend is configured.
- [ ] G-8. Complete A-8: final audit and cleanup.

## Current Slice

### G-4 / A-4: Backend Analyzer Response Path Proves Shared Contract Consumption

Status: completed in this code checkpoint.

Purpose:

Make the hosted backend analyzer response path consume the same shared analyzer
contract and typed validation helpers rather than relying only on backend-local
response validation.

Decision:

- `@flarex/analysis` now exposes shared analyzer success-envelope and
  protocol-success response helpers.
- `flarex-backend` decodes analyzer envelopes and diagnostics through the
  shared helpers before assembling analyzed-start payloads.
- Backend deployment validation still owns persistence/runtime-specific
  semantic checks and public error mapping.
- `/push/start-analyzed` remains unhardened until G-5/A-5.

Files changed:

- `packages/analysis/src/index.ts`
- `packages/analysis/test/analyzer.test.ts`
- `packages/flarex-backend/package.json`
- `packages/flarex-backend/src/backendAnalyzerResponse.ts`
- `packages/flarex-backend/src/deployment/Validation.ts`
- `pnpm-lock.yaml`
- `roadmaps/28-authoritative-analysis-effect-quality.md`
- this file

Validation gates:

```sh
corepack pnpm --filter @flarex/analysis typecheck
corepack pnpm --filter @flarex/analysis test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
git diff --check
```

Review gate:

- Required because this changes public route trust-boundary behavior and
  must preserve source-only push behavior while rejecting untrusted analyzed
  metadata.

## Previous Slice

### G-3 / A-3: Local Miniflare Analyzer Worker Uses Shared Semantics

Status: completed and committed in `d9067c6`
(`Use shared analyzer in execution artifact`).

Purpose:

Refactor the local execution-artifact analyzer worker so its generated worker
source calls the shared `@flarex/analysis` semantics instead of carrying a
second analyzer implementation.

Files changed:

- `packages/flarex-dev/src/executionArtifact.ts`
- `packages/flarex-dev/test/executionArtifact.test.ts`
- `roadmaps/28-authoritative-analysis-effect-quality.md`
- this file

Validation gates:

```sh
corepack pnpm --filter @flarex/analysis typecheck
corepack pnpm --filter @flarex/analysis test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/executionArtifact.test.ts test/backendPush.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
git diff --check
```

Review gate:

- Required and completed in the committed slice.

## Next Slice

### G-5 / A-5: Protect Direct Analyzed Start Push

Status: next.

Purpose:

Protect or remove normal public trust in direct `/push/start-analyzed` traffic
so hosted production does not accept client-produced analysis as authority.

Expected implementation:

- inspect public route dispatch, internal deployment route boundaries, and
  tests that still call `/push/start-analyzed`;
- choose the smallest enforceable guard that keeps test/internal harnesses
  usable while preventing normal hosted public clients from supplying analyzed
  metadata;
- preserve source-only `/push` behavior through `FLAREX_ANALYZER`;
- update tests to prove untrusted direct analyzed-start traffic is rejected.

Validation gates:

```sh
corepack pnpm --filter @flarex/analysis typecheck
corepack pnpm --filter @flarex/analysis test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
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
