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
- [x] G-6. H-5 shared identity helpers.
- [x] G-7. H-6 adapter simplification pass.
- [x] G-8. Final host-kit audit: local-first runtime and hosted Dynamic Worker
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

### G-8: Final Host-Kit Audit

Status: completed in this turn; commit pending.

Purpose:

Prove the shared artifact runtime host kit end state from current files and
validation output. This is an audit-only slice; no runtime code changes are
required.

Files changed:

- `roadmaps/24-shared-artifact-runtime-host-kit.md`
- this file

Audit results:

- [x] Confirmed local and hosted materializers share source-package module
  validation, generated worker source profiles, env construction, internal
  invoke request construction, invoke response decoding, and identity fragments
  through `packages/flarex-backend/src/artifactRuntime/HostKit.ts` and
  `packages/flarex-backend/src/artifactRuntime.ts`.
- [x] Confirmed backend activation and invocation still flow through active
  deployment `executionArtifactRef` plus `sourcePackage`, with
  `ServiceBindingExecutionArtifactRuntime` loading or forwarding source
  packages before materialization.
- [x] Confirmed host mechanics remain separate:
  - local keeps Miniflare construction, in-process `FLAREX_BACKEND` service
    binding dispatch, query-session test support, and disposal;
  - hosted keeps Worker Loader `get(...)`, Dynamic Worker cache identity,
    hosted fail-closed env validation, and `globalOutbound: null`.
- [x] Ran the final relevant test matrix.

Validation gates:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev build
corepack pnpm --filter flarex-backend exec vitest run test/artifactRuntime.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-dev exec vitest run test/runtimeMaterializer.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter @flarex/artifact-runtime typecheck
corepack pnpm --filter @flarex/artifact-runtime build
corepack pnpm --filter @flarex/artifact-runtime exec vitest run test/worker.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter @flarex/artifact-runtime test
git diff --check
```

Review gate:

- Not required; this slice is docs-only audit recording after the reviewed H-6
  implementation commit.

## Later Slices

### Completed: G-7 / H-6 Adapter Simplification Pass

Committed in `a0ef99a` (`Simplify artifact runtime host adapters`).

### Completed: G-6 / H-5 Shared Identity Helpers

Committed in `77a9f6e` (`Share artifact runtime identity helpers`).

### Completed: G-5 / H-4 Shared Internal Invoke Request And Response Decode

Committed in `a9a894f` (`Share artifact invoke boundary helpers`).

### G-6 / H-5: Shared Identity Helpers

- [x] Move `executorIdentity(...)` and `internalAuthIdentity(...)` into the
  host kit.
- [x] Keep final Dynamic Worker ID assembly hosted-only.
- [x] Add direct identity stability tests.

### G-7 / H-6: Adapter Simplification Pass

- [x] Reduce local materializer to Miniflare adapter responsibilities.
- [x] Reduce hosted materializer to Worker Loader adapter responsibilities.
- [x] Ensure local-first runtime still uses the same source package and
  generated execution contracts as hosted runtime.

### G-8: Final Host-Kit Audit

- [x] Confirm local `flarex/` source package, generated runtime wrapper,
  executor syscall protocol, artifact runtime request/response contracts, and
  backend activation path are shared.
- [x] Confirm only host mechanics differ:
  - local: Miniflare, in-process service bindings, query-session test support;
  - hosted: Worker Loader, Dynamic Worker cache identity, `globalOutbound:
    null`.
- [x] Run final relevant test matrix.

## Non-Goals

- Do not emulate Cloudflare Dynamic Workers as the local truth.
- Do not move Worker Loader mechanics into `flarex-dev`.
- Do not move Miniflare mechanics into the hosted Worker app.
- Do not put host composition helpers in `flarex-protocol`.
- Do not expose raw database/storage bindings to generated user code.
