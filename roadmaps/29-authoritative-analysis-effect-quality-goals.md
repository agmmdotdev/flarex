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
- [ ] G-4. Complete A-4: backend analyzer response path proves shared contract
  consumption.
- [ ] G-5. Complete A-5: direct `/push/start-analyzed` is protected, internal,
  or removed from normal public hosted flow.
- [ ] G-6. Complete A-6: forged-analysis and source/analysis mismatch tests.
- [ ] G-7. Complete A-7: local dev deploy/codegen uses authoritative backend
  analysis when a backend is configured.
- [ ] G-8. Complete A-8: final audit and cleanup.

## Current Slice

### G-3 / A-3: Local Miniflare Analyzer Worker Uses Shared Semantics

Status: completed in this code checkpoint.

Purpose:

Refactor the local execution-artifact analyzer worker so its generated worker
source calls the shared `@flarex/analysis` semantics instead of carrying a
second analyzer implementation.

Decision:

- `packages/flarex-dev/src/executionArtifact.ts` now bundles a small local
  analyzer worker shell with Vite so Miniflare can load `@flarex/analysis`.
- The worker shell still owns console capture, deterministic import-time
  globals, rejected import-time globals, diagnostics propagation, and dynamic
  imports of developer execution/schema modules.
- Rejected globals are scoped only around user module imports, then restored
  before the shared Effect analyzer runs.

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

- Required because this adds a package, exports shared helpers, and moves
  analyzer semantics.

## Previous Slice

### G-2 / A-2: Shared Analyzer Semantics Extraction

Status: completed and committed in `ce4c485`
(`Extract shared analyzer semantics`).

Purpose:

Create `@flarex/analysis` and move pure analyzer semantics into it without
changing local runtime behavior.

Files changed:

- `packages/analysis/package.json`
- `packages/analysis/tsconfig.json`
- `packages/analysis/src/index.ts`
- `packages/analysis/test/analyzer.test.ts`
- `packages/flarex-dev/package.json`
- `packages/flarex-dev/src/analyze.ts`
- `packages/flarex-dev/src/backendPush.ts`
- `packages/flarex-dev/src/executionArtifact.ts`
- `packages/flarex-dev/src/generate.ts`
- `pnpm-lock.yaml`
- `roadmaps/28-authoritative-analysis-effect-quality.md`
- this file

Validation gates:

```sh
corepack pnpm --filter @flarex/analysis typecheck
corepack pnpm --filter @flarex/analysis test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/analyze.test.ts test/executionArtifact.test.ts test/backendPush.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
git diff --check
```

Review gate:

- Required and completed in the committed slice.

## Next Slice

### G-4 / A-4: Backend Analyzer Response Path Proves Shared Contract Consumption

Status: next.

Purpose:

Make the hosted backend analyzer response path consume the same shared analyzer
contract and typed validation helpers rather than relying only on backend-local
response validation.

Expected implementation:

- inspect `packages/flarex-backend/src/backendAnalyzerResponse.ts`,
  `packages/flarex-backend/src/deployment/Validation.ts`, and
  `packages/flarex-protocol/src/deployment.ts`;
- route analyzer success/failure envelopes through shared protocol/analyzer
  helpers where portable;
- preserve existing public `/push` response behavior;
- do not harden `/push/start-analyzed` yet except where a shared-contract
  helper is needed for A-4.

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
