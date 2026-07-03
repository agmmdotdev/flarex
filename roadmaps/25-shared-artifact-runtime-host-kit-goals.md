# Shared Artifact Runtime Host Kit Goals

Active goal:

Implement the shared artifact runtime host kit step by step, starting with
H-1 shared runtime worker source profiles, updating this checklist each turn,
validating, reviewing significant changes, and committing each completed slice.

Source roadmap:

- `roadmaps/24-shared-artifact-runtime-host-kit.md`

Goal status:

- [x] G-0. Create the concrete host-kit implementation roadmap.
  - Commit: `aa3d089` (`Plan shared artifact runtime host kit`)
- [x] G-1. Start the long-running Codex goal for this implementation stream.
  - Goal objective: implement the shared artifact runtime host kit step by
    step, update the checklist each turn, validate, review significant changes,
    and commit each completed slice.
- [ ] G-2. H-1 shared runtime worker source profiles.
- [ ] G-3. H-2 shared source package module-map validation.
- [ ] G-4. H-3 shared generated-worker env construction.
- [ ] G-5. H-4 shared internal invoke request and response decode.
- [ ] G-6. H-5 shared identity helpers.
- [ ] G-7. H-6 adapter simplification pass.
- [ ] G-8. Final host-kit audit: local-first runtime and hosted Dynamic Worker
  behavior still share contracts and generated runtime logic.

## Turn Protocol

Every implementation turn in this goal should follow this loop:

1. Read this file and `roadmaps/24-shared-artifact-runtime-host-kit.md`.
2. Confirm the next unchecked goal item.
3. Keep the patch scoped to that item unless a reviewer/test exposes a
   required small fix.
4. Update this file:
   - mark completed items;
   - add the previous completed checkpoint commit when known;
   - record the next goal item.
5. Update the domain roadmap if the implementation changes runtime behavior or
   package boundaries.
6. Run the validation gates named for the current item.
7. For significant code/test changes, run both read-only reviewers:
   - `typescript-diff-reviewer`
   - `code-quality-diff-reviewer`
8. Fix valid reviewer findings in the main thread.
9. Rerun validation after fixes.
10. Commit the completed slice.

## Current Next Slice

### G-2 / H-1: Shared Runtime Worker Source Profiles

Purpose:

Create the first shared SDK surface without changing runtime behavior. The
host adapters should still own Miniflare and Worker Loader details, but the
generated runtime worker source profile should come from one host-kit helper.

Files expected to change:

- `packages/flarex-backend/src/artifactRuntime/HostKit.ts`
- `packages/flarex-backend/src/artifactRuntime.ts`
- `packages/flarex-dev/src/runtimeMaterializer.ts`
- `apps/artifact-runtime/src/worker.ts`
- `roadmaps/24-shared-artifact-runtime-host-kit.md`
- this file

Implementation tasks:

- [ ] Add `HostKit.ts`.
- [ ] Add `executionArtifactRuntimeWorkerSource(...)`.
- [ ] Support a local profile:
  - `backendBinding: "FLAREX_BACKEND"`
  - `backendBaseUrl: "https://flarex-backend.internal"`
  - local missing-binding message
  - `includeQuerySessionRoute: true`
- [ ] Support a hosted profile:
  - `backendBinding: "FLAREX_EXECUTOR"`
  - `backendBaseUrl: "https://flarex-executor.internal"`
  - hosted missing-binding message
  - `includeUnsupportedCapabilities: true`
- [ ] Replace local `runtimeWorkerSource(...)` with the host-kit helper.
- [ ] Replace hosted `dynamicWorkerRuntimeSource(...)` with the host-kit helper.
- [ ] Keep host adapters otherwise unchanged.

Validation gates:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev build
corepack pnpm --filter @flarex/artifact-runtime test
corepack pnpm --filter flarex-dev exec vitest run test/runtimeMaterializer.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
git diff --check
```

Review gate:

- Required, because H-1 is a public package-boundary refactor touching runtime
  source generation.

## Later Slices

### G-3 / H-2: Shared Source Package Module-Map Validation

- [ ] Move source-module validation to `executionArtifactWorkerModules(...)`.
- [ ] Preserve hosted reserved-path, duplicate-path, and missing-source errors.
- [ ] Reuse the same module validation from local Miniflare materialization.
- [ ] Add or adjust focused tests for both adapters.

### G-4 / H-3: Shared Generated-Worker Env Construction

- [ ] Move executor/project/auth/invoke-attempt/internal-token env construction
  into `executionArtifactWorkerEnv(...)`.
- [ ] Keep host-specific binding injection outside the helper.
- [ ] Preserve hosted invalid transport errors.

### G-5 / H-4: Shared Internal Invoke Request And Response Decode

- [ ] Add shared internal invoke request/header helpers.
- [ ] Use the same invoke response decode path for local and hosted.
- [ ] Keep local query-session response decoding available without claiming
  hosted query-session support.

### G-6 / H-5: Shared Identity Helpers

- [ ] Move `executorIdentity(...)` and `internalAuthIdentity(...)` into the
  host kit.
- [ ] Keep final Dynamic Worker ID assembly hosted-only.
- [ ] Add direct identity stability tests.

### G-7 / H-6: Adapter Simplification Pass

- [ ] Reduce local materializer to Miniflare adapter responsibilities.
- [ ] Reduce hosted materializer to Worker Loader adapter responsibilities.
- [ ] Ensure local-first runtime still uses the same source package and
  generated execution contracts as hosted runtime.

### G-8: Final Host-Kit Audit

- [ ] Confirm local `flarex/` source package, generated runtime wrapper,
  executor syscall protocol, artifact runtime request/response contracts, and
  backend activation path are shared.
- [ ] Confirm only host mechanics differ:
  - local: Miniflare, in-process service bindings, query-session test support;
  - hosted: Worker Loader, Dynamic Worker cache identity, `globalOutbound:
    null`.
- [ ] Run final relevant test matrix.

## Non-Goals

- Do not emulate Cloudflare Dynamic Workers as the local truth.
- Do not move Worker Loader mechanics into `flarex-dev`.
- Do not move Miniflare mechanics into the hosted Worker app.
- Do not put host composition helpers in `flarex-protocol`.
- Do not expose raw database/storage bindings to generated user code.
