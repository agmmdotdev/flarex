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
- [x] G-2. H-1 shared runtime worker source profiles.
- [x] G-3. H-2 shared source package module-map validation.
- [x] G-4. H-3 shared generated-worker env construction.
- [x] G-5. H-4 shared internal invoke request and response decode.
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

### G-5 / H-4: Shared Internal Invoke Request And Response Decode

Status: implemented and committed in `a9a894f` (`Share artifact invoke boundary helpers`).

Purpose:

Move internal invoke request construction and invoke response decoding behind
shared runtime helpers. Local Miniflare and hosted Dynamic Worker adapters
should use the same invoke request body/header contract and the same invoke
response protocol decode path. Local query-session response decoding remains
local-only and does not imply hosted query-session support.

Files expected to change:

- `packages/flarex-backend/src/artifactRuntime/HostKit.ts`
- `packages/flarex-backend/src/artifactRuntime.ts`
- `packages/flarex-backend/src/types.ts`
- `packages/flarex-protocol/src/invoke.ts`
- `packages/flarex-dev/src/runtimeMaterializer.ts`
- `apps/artifact-runtime/src/worker.ts`
- `packages/flarex-backend/test/artifactRuntime.test.ts`
- `roadmaps/24-shared-artifact-runtime-host-kit.md`
- this file

Implementation tasks:

- [x] Add shared internal request/header helpers:
  - `executionArtifactInternalRequestHeaders(...)`
  - `executionArtifactInternalInvokeRequest(...)`
- [x] Use the shared invoke request helper from local Miniflare invokes.
- [x] Use the shared invoke request helper from hosted Dynamic Worker invokes.
- [x] Use the same invoke response decode path for local and hosted invokes.
- [x] Keep local query-session response decoding available without claiming
  hosted query-session support.
- [x] Preserve `observedTs` in invoke response read sets by updating the invoke
  protocol/backend read-set contract.
- [x] Add focused shared tests for request construction and invoke response
  decoding.

Next slice after commit: `G-6 / H-5`, shared identity helpers.

Validation gates:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter @flarex/artifact-runtime typecheck
corepack pnpm --filter flarex-backend exec vitest run test/artifactRuntime.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-dev exec vitest run test/runtimeMaterializer.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter @flarex/artifact-runtime exec vitest run test/worker.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-protocol test
git diff --check
```

Review gate:

- Required, because H-4 is a public package-boundary refactor touching runtime
  request/response contracts.

## Later Slices

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
