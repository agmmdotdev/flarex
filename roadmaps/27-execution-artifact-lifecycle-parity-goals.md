# Execution Artifact Lifecycle Parity Goals

Active goal:

Implement local-first runtime and deploy/push parity step by step, using the
shared artifact runtime host kit as the foundation: define the execution
artifact lifecycle contract from source package to artifact ref to materialized
runtime to invoke, keep dev and hosted paths sharing that contract, update the
checklist each turn, validate, review significant changes, and commit each
completed slice.

Source roadmap:

- `roadmaps/26-execution-artifact-lifecycle-parity.md`

Goal status:

- [x] G-0. Create the concrete lifecycle parity roadmap and checklist.
- [x] G-1. Start the long-running Codex goal for this implementation stream.
  - Goal objective: implement local-first runtime and deploy/push parity step by
    step, using the shared artifact runtime host kit as the foundation.
- [x] G-2. L-1 shared artifact ref/source-package validation.
  - Commit: `e482969` (`Share execution artifact ref validation`)
- [x] G-3. L-2 shared artifact lifecycle payload helper.
  - Commit: `3e2bd56` (`Share artifact runtime invoke payload builders`)
- [x] G-4. L-3 local dev lifecycle alignment.
  - Commit: `ece1188` (`Align local executor artifact payloads`)
- [x] G-5. L-4 hosted deploy/push lifecycle alignment.
  - Commit: `2d0f118` (`Align hosted artifact ref lifecycle`)
- [x] G-6. L-5 cross-boundary lifecycle parity tests.
  - Commit: `1a192cf` (`Add artifact lifecycle parity tests`)
- [x] G-7. L-6 final lifecycle parity audit.
  - Commit: reported in final response (`Mark lifecycle parity audit complete`)

## Turn Protocol

Every implementation turn in this goal should follow this loop:

1. Read this file and `roadmaps/26-execution-artifact-lifecycle-parity.md`.
2. Confirm the next unchecked goal item.
3. Keep the patch scoped to that item unless validation or reviewers expose a
   required small fix.
4. Update this file:
   - mark completed items;
   - add the previous completed checkpoint commit when known;
   - record the next goal item.
5. Update the domain roadmap when runtime behavior or package boundaries change.
6. Run the validation gates named for the current item.
7. For significant code/test changes, run both read-only reviewers:
   - `typescript-diff-reviewer`
   - `code-quality-diff-reviewer`
8. Fix valid reviewer findings in the main thread.
9. Rerun validation after fixes.
10. Commit the completed slice.

## Current Slice

### G-7 / L-6: Final Lifecycle Parity Audit

Status: completed; docs marker commit reported in the final response.

Purpose:

Audit the completed lifecycle stream against the original objective and prove
the local-first and hosted deploy/push paths share the same execution artifact
contract while preserving separate host adapters.

Files changed:

- this file
- `roadmaps/26-execution-artifact-lifecycle-parity.md`

Validation gates:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol exec vitest run test/artifact-runtime.test.ts test/deployment.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor exec vitest run test/deployments.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/sourcePackage.test.ts test/artifactLifecycleParity.test.ts test/executorHttpRuntime.test.ts test/runtimeMaterializer.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/artifactStore.test.ts test/publicStartArtifactBoundary.test.ts test/publicFinishArtifactBoundary.test.ts test/deploymentService.test.ts test/hostedRuntimeCore.test.ts test/artifactRuntime.test.ts test/artifactRuntimeRoute.test.ts test/artifactRuntimeRequests.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
git diff --check
```

Review gate:

- Not required. This slice is docs-only after validating the final state.

## Previous Slice

### G-6 / L-5: Cross-Boundary Lifecycle Parity Tests

Status: completed and committed in `1a192cf`
(`Add artifact lifecycle parity tests`).

Purpose:

Prove the local and hosted runtime paths share the same source-package to
artifact-ref to invoke-payload lifecycle contract while keeping their host
adapters separate. Local runtime tests now use the same production
source-package persistence serializer as executor package registration, and
hosted runtime tests share the same public push/deployment helper fixture as
the cross-boundary parity test.

Files changed:

- `packages/executor/src/deploymentPackages.ts`
- `packages/executor/src/index.ts`
- `packages/flarex-backend/package.json`
- `packages/flarex-backend/test/hostedRuntimeCore.test.ts`
- `packages/flarex-backend/test/lifecycleFixture.ts`
- `packages/flarex-dev/test/artifactLifecycleParity.test.ts`
- `packages/flarex-dev/test/executorHttpRuntime.test.ts`
- `packages/flarex-dev/test/localRuntimeFixture.ts`
- this file
- `roadmaps/26-execution-artifact-lifecycle-parity.md`

Validation gates:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor exec vitest run test/deployments.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/artifactLifecycleParity.test.ts test/executorHttpRuntime.test.ts test/runtimeMaterializer.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/hostedRuntimeCore.test.ts test/artifactRuntime.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
git diff --check
```

Review gate:

- Required because this adds cross-package lifecycle parity coverage and shared
  test fixtures.

## Previous Slice

### G-5 / L-4: Hosted Deploy/Push Lifecycle Alignment

Status: completed and committed in `2d0f118`
(`Align hosted artifact ref lifecycle`).

Purpose:

Make the hosted finish-push preflight derive execution artifact refs through the
same deployment artifact Effect helper used by deployment service code. Worker
route policy, R2-backed artifact availability, and public dispatch error mapping
remain backend-owned host mechanics.

Files changed:

- `packages/flarex-backend/src/deployment/Runtime.ts`
- `packages/flarex-backend/src/deployment/PublicFinishArtifactBoundary.ts`
- `packages/flarex-backend/test/publicFinishArtifactBoundary.test.ts`
- this file
- `roadmaps/26-execution-artifact-lifecycle-parity.md`

Validation gates:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/publicFinishArtifactBoundary.test.ts test/deploymentService.test.ts test/hostedRuntimeCore.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
git diff --check
```

Review gate:

- Required because this changes hosted finish-push artifact ref derivation.

## Previous Slice

### G-4 / L-3: Local Dev Lifecycle Alignment

Status: completed and committed in `ece1188`
(`Align local executor artifact payloads`).

Purpose:

Make the local executor runtime use the shared artifact lifecycle payload
helper when materializing active deployment packages for live-query reruns. The
local runtime still owns PGlite, Miniflare, freshness, and service-binding
composition; the cross-package runtime payload shape now comes from
`flarex-protocol/artifact-runtime`.

Files changed:

- `packages/flarex-dev/package.json`
- `packages/flarex-dev/src/executorHttpRuntime.ts`
- `packages/flarex-dev/test/executorHttpRuntime.test.ts`
- `pnpm-lock.yaml`
- this file
- `roadmaps/26-execution-artifact-lifecycle-parity.md`

Validation gates:

```sh
corepack pnpm install
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/executorHttpRuntime.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-dev exec vitest run test/backendSyncRuntime.test.ts test/runtimeMaterializer.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
git diff --check
```

Review gate:

- Required because this changes local executor runtime materialization behavior
  and adds a direct shared protocol dependency.

## Previous Slice

### G-3 / L-2: Shared Artifact Lifecycle Payload Helper

Status: completed and committed in `3e2bd56`
(`Share artifact runtime invoke payload builders`).

Purpose:

Make `flarex-protocol/artifact-runtime` own construction of the runtime invoke
payload shape, including ref-only payloads and materialized payloads with
`sourcePackage`. Backend service-binding runtime source loading stays backend
owned, but the final object sent to the runtime binding now comes from shared
protocol constructors.

Files changed:

- `packages/flarex-protocol/src/artifact-runtime.ts`
- `packages/flarex-protocol/test/artifact-runtime.test.ts`
- `packages/flarex-backend/src/artifactRuntime.ts`
- `packages/flarex-backend/src/artifactRuntime/RuntimeRoute.ts`
- this file
- `roadmaps/26-execution-artifact-lifecycle-parity.md`

Validation gates:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol exec vitest run test/artifact-runtime.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/artifactRuntime.test.ts test/artifactRuntimeRequests.test.ts test/artifactRuntimeRoute.test.ts test/hostedRuntimeCore.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
git diff --check
```

Review gate:

- Required because this changes shared protocol exports and backend runtime
  payload construction.

## Next Slice

No next slice for this lifecycle parity goal. The remaining work moves back to
the broader core implementation roadmaps after this audit marker.

## Completed Checkpoints

- `579b1bf` (`Mark host kit audit complete`) completed the previous host-kit
  goal before this lifecycle parity stream started.
- `2d0f118` (`Align hosted artifact ref lifecycle`) completed the hosted
  deploy/push lifecycle alignment slice.
- `1a192cf` (`Add artifact lifecycle parity tests`) completed the
  cross-boundary lifecycle parity test slice.
