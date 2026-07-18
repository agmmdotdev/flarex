# Execution Artifact Lifecycle Parity

This roadmap tracks the local-first runtime and hosted deploy/push parity work
after the shared artifact runtime host kit foundation.

## Current Diagnosis

Local dev and hosted execution now share the generated runtime host kit, but the
source package lifecycle is still split across packages:

- `flarex-dev` bundles local source packages and composes the backend-owned
  R2-shaped store into the local Miniflare runtime.
- `flarex-backend` persists hosted source packages, activates deployments, and
  materializes artifact runtime invocations from active deployment records.
- `flarex/artifacts` owns deterministic artifact refs, manifest validation, and
  source-package cloning; the backend-owned R2 adapter consumes that contract.

The goal is not to make local dev run hosted Dynamic Workers. The goal is to
make local and hosted paths share the same lifecycle contract from source
package to artifact ref to materialized runtime invoke, with host mechanics kept
separate.

## Implementation Slices

- [x] L-0. Create a concrete lifecycle parity roadmap and turn checklist.
- [x] L-1. Move execution artifact ref equality and source-package ref
  assertions into `flarex/artifacts`; make the backend durable store consume
  that contract and retire superseded local store facades once unreferenced.
- [x] L-2. Extract a shared artifact lifecycle payload helper for
  `ExecutionArtifactRef` plus optional `sourcePackage` materialization so local
  and hosted invocation paths build the same runtime input shape.
- [x] L-3. Align local dev push/runtime activation around the shared lifecycle
  helper, keeping Miniflare and local file watching as dev-only host mechanics.
- [x] L-4. Align hosted deploy/push activation around the same lifecycle helper,
  keeping Worker Loader, service bindings, and R2 as hosted-only mechanics.
- [x] L-5. Add parity tests that exercise source-package bundle, artifact ref,
  deployment activation, runtime materialization, and invoke behavior across dev
  and backend boundaries.
- [x] L-6. Final audit: local-first runtime and hosted push/deploy still share
  lifecycle behavior while preserving their different host adapters.

## Quality Bar

- Every runtime-affecting slice updates this roadmap and
  `roadmaps/27-execution-artifact-lifecycle-parity-goals.md`.
- Shared contracts belong in `flarex`, `flarex-protocol`, or backend host-kit
  modules only when both local and hosted users consume them.
- `flarex-dev` can own developer ergonomics, watchers, Miniflare process
  management, and local CLI composition, but not a divergent artifact lifecycle
  contract.
- `flarex-backend` can own deployment persistence, Durable Object state, hosted
  service bindings, and R2 integration, but not a divergent artifact lifecycle
  contract.
- The superseded `flarex-dev` in-memory and R2 store facades have no runtime
  consumer or supported compatibility obligation. Local and hosted composition
  use the backend-owned R2 adapter, while shared artifact identity and manifest
  contracts remain in `flarex/artifacts`.
- Significant code changes require focused validation plus the two read-only
  reviewers named in `AGENTS.md`.

## Completed Checkpoints

- `579b1bf` (`Mark host kit audit complete`) finished the shared runtime host
  kit foundation before this lifecycle parity stream began.
- `2d0f118` (`Align hosted artifact ref lifecycle`) aligned hosted finish-push
  artifact ref derivation around the shared deployment artifact Effect helper.
- `1a192cf` (`Add artifact lifecycle parity tests`) added cross-boundary local
  and hosted lifecycle tests plus shared fixtures for source-package,
  activation, materialization, and invoke payload parity.

## Final Audit

Status: completed.

Previous checkpoint recorded in this turn:

- `1a192cf` (`Add artifact lifecycle parity tests`)

Convex source files inspected or used as inspiration:

- None for this final verification slice. This audit checked the
  Cloudflare-specific execution artifact lifecycle contract introduced in this
  roadmap rather than porting a new Convex runtime behavior.

Evidence:

- Source-package bundling remains local tooling owned and is covered by
  `packages/flarex-dev/test/sourcePackage.test.ts`.
- Deterministic artifact refs and ref/source-package validation are owned by
  `packages/flarex/src/artifacts.ts` and covered by
  `packages/flarex/test/artifacts.test.ts`.
- Ref-only and materialized runtime invoke payload construction is owned by
  `packages/flarex-protocol/src/artifact-runtime.ts` and covered by
  `packages/flarex-protocol/test/artifact-runtime.test.ts`.
- Local runtime materialization builds `materializedExecutionArtifactInvokePayload`
  in `packages/flarex-dev/src/executorHttpRuntime.ts`, preserving PGlite,
  Miniflare, freshness, and local request handling as local adapter mechanics.
- Hosted runtime dispatch builds shared artifact runtime payloads in
  `packages/flarex-backend/src/artifactRuntime.ts`, preserving Worker Loader,
  R2, Durable Object deployment state, and service bindings as hosted adapter
  mechanics.
- Hosted deploy/push artifact refs derive through
  `packages/flarex-backend/src/deployment/Runtime.ts` and
  `packages/flarex-backend/src/deployment/Service.ts`, with public finish-push
  preflight delegating to the same helper.
- `packages/flarex-dev/test/artifactLifecycleParity.test.ts` now proves the
  same source package produces the same artifact ref and equivalent invoke
  payload contract across local materialized and hosted ref-only runtime paths.

Known limitations and follow-up work:

- This closes the lifecycle parity stream only. Broader Convex-compatible
  backend behavior, transaction semantics, sync correctness, and production
  deployment hardening remain tracked by their domain roadmaps.

Verification commands run:

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
