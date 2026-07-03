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
- [ ] G-6. Complete A-6: forged-analysis and source/analysis mismatch tests.
- [ ] G-7. Complete A-7: local dev deploy/codegen uses authoritative backend
  analysis when a backend is configured.
- [ ] G-8. Complete A-8: final audit and cleanup.

## Current Slice

### G-5 / A-5: Protect Direct Analyzed Start Push

Status: completed in this code checkpoint.

Purpose:

Protect normal hosted public flow from trusting client-produced analysis through
direct `/push/start-analyzed` requests.

Decision:

- `FLAREX_ANALYZED_START_TOKEN` gates public direct analyzed-start traffic.
- Missing tokens and wrong bearer credentials fail with a typed
  `PublicAnalyzedStartAuthorizationError` mapped to a public 401 response.
- Authorization happens before analyzed-start JSON parsing.
- Backend-owned source-only `/push/start` remains the normal public hosted path
  and continues through `FLAREX_ANALYZER`.
- Tests that intentionally use direct analyzed-start now do so through an
  explicit test harness token.

Files changed:

- `packages/flarex-backend/src/types.ts`
- `packages/flarex-backend/src/worker.ts`
- `packages/flarex-backend/src/worker/PublicAnalyzedStartAuthorization.ts`
- `packages/flarex-backend/test/backendHarness.ts`
- `packages/flarex-backend/test/publicAnalyzedStartAuthorization.test.ts`
- `packages/flarex-backend/test/push.test.ts`
- `packages/flarex-backend/test/artifactRuntimeRoute.test.ts`
- `packages/flarex-backend/test/executionDO.test.ts`
- `packages/flarex-backend/test/invoke.test.ts`
- `packages/flarex-backend/test/sync.test.ts`
- `packages/flarex-dev/test/backendSyncRuntime.test.ts`
- `packages/flarex-dev/test/runtimeMaterializer.test.ts`
- `roadmaps/28-authoritative-analysis-effect-quality.md`
- this file

Validation gates:

```sh
corepack pnpm --filter @flarex/analysis typecheck
corepack pnpm --filter @flarex/analysis test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/publicAnalyzedStartAuthorization.test.ts test/push.test.ts -t "public analyzed start authorization|keeps public start source-only|rejects malformed analyzed push request bodies" --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend test
git diff --check
```

Review gate:

- Required because this changed public route trust-boundary behavior and had to
  preserve source-only push behavior while rejecting untrusted analyzed
  metadata.

## Previous Slice

### G-4 / A-4: Backend Analyzer Response Path Proves Shared Contract Consumption

Status: completed and committed in `9e89cad`
(`Share backend analyzer response contract`).

Purpose:

Make the hosted backend analyzer response path consume the same shared analyzer
contract and typed validation helpers rather than relying only on backend-local
response validation.

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

- Required and completed in the committed slice.

## Next Slice

### G-6 / A-6: Forged Analysis And Source/Analysis Mismatch Tests

Status: next.

Purpose:

Prove public clients cannot activate analysis that was not produced by the
backend analyzer path, and prove source/analysis mismatch cases fail before
activation.

Expected implementation:

- add tests that try to activate direct analyzed-start payloads with forged or
  mismatched schema/function/codegen metadata;
- confirm unauthorized direct analyzed-start traffic still fails before parsing;
- keep trusted internal/test direct analyzed-start coverage only where the
  token is explicit;
- preserve source-only `/push` behavior through `FLAREX_ANALYZER`.

Validation gates:

```sh
corepack pnpm --filter @flarex/analysis typecheck
corepack pnpm --filter @flarex/analysis test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
git diff --check
```

Review gate:

- Required because this will extend trust-boundary and activation-invariant
  tests around deployment analysis.

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
- [ ] Local dev and hosted paths share analyzer semantics while keeping host
  mechanics separate.
- [ ] Focused tests and package typecheck pass.
- [ ] Reviewer findings are resolved or explicitly rejected with rationale.

## Completed Checkpoints

- `3758dd2` (`Mark lifecycle parity audit complete`) completed the prior local
  and hosted artifact lifecycle parity stream before this goal began.
- `7b14f30` (`Plan authoritative analysis Effect quality goal`) created the
  current authoritative analysis goal files.
