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
- [ ] G-7. Complete A-7: local dev deploy/codegen uses authoritative backend
  analysis when a backend is configured.
- [ ] G-8. Complete A-8: final audit and cleanup.

## Current Slice

### G-6 / A-6: Forged Analysis And Source/Analysis Mismatch Tests

Status: completed in this code checkpoint.

Purpose:

Prove forged or source-mismatched analyzed metadata is rejected before
activation where the DeploymentDO boundary has enough source-package evidence
to validate it.

Decision:

- Analyzed function metadata must refer only to modules declared by
  `sourcePackage.functions`.
- The invariant is enforced at analyzed-start service-input decode time and
  stored-row decode time.
- A forged direct analyzed-start request that declares only `other.js` but
  submits `lessons:list` analysis is rejected with a typed deployment
  validation error and cannot create an active deployment.
- Existing codegen-vs-analysis mismatch tests continue to prove mismatched
  codegen metadata is rejected before activation.

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

- Required because this changed activation-adjacent validation and rejection
  behavior for analyzed deployment metadata.

## Previous Slice

### G-5 / A-5: Protect Direct Analyzed Start Push

Status: completed and committed in `c51bc6a`
(`Protect direct analyzed start push`).

Purpose:

Protect normal hosted public flow from trusting client-produced analysis through
direct `/push/start-analyzed` requests.

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

- Required and completed in the committed slice.

## Next Slice

### G-7 / A-7: Backend-Configured Local Deploy And Codegen Use Authoritative Analysis

Status: next.

Purpose:

Align local dev deploy/codegen with authoritative backend analysis when a
backend is configured.

Expected implementation:

- inspect `packages/flarex-dev/src/backendPush.ts`, local deploy/codegen paths,
  and backend runtime materializer tests;
- ensure backend-configured deploy consumes backend-returned analysis and
  `codegenAnalysis` rather than local-only analyzer output;
- keep local-only mode using local analysis for fast feedback;
- preserve shared analyzer semantics and hosted route trust-boundaries.

Validation gates:

```sh
corepack pnpm --filter @flarex/analysis typecheck
corepack pnpm --filter @flarex/analysis test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
git diff --check
```

Review gate:

- Required because this will touch local deploy/codegen behavior and shared
  local-vs-hosted analysis authority.

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
