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
- [ ] G-4. L-3 local dev lifecycle alignment.
- [ ] G-5. L-4 hosted deploy/push lifecycle alignment.
- [ ] G-6. L-5 cross-boundary lifecycle parity tests.
- [ ] G-7. L-6 final lifecycle parity audit.

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

## Previous Slice

### G-2 / L-1: Shared Artifact Ref/Source-Package Validation

Status: completed and committed in `e482969`
(`Share execution artifact ref validation`).

Purpose:

Make `flarex/artifacts` own exact execution artifact ref comparison and
source-package validation. Local dev and hosted backend artifact stores should
consume the same helper before they trust a stored source package.

Files changed:

- `packages/flarex/src/artifacts.ts`
- `packages/flarex/test/artifacts.test.ts`
- `packages/flarex-dev/src/executionArtifactStore.ts`
- `packages/flarex-dev/test/executionArtifactStore.test.ts`
- `packages/flarex-backend/src/artifactStore.ts`
- this file
- `roadmaps/26-execution-artifact-lifecycle-parity.md`

Validation gates:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/executionArtifactStore.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/artifactStore.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
git diff --check
```

Review gate:

- Required because this changes shared package exports and local runtime store
  validation behavior.

## Next Slice

### G-4 / L-3: Local Dev Lifecycle Alignment

- [ ] Identify local dev runtime invoke/request construction paths that still
  build lifecycle-shaped payloads directly.
- [ ] Route local dev runtime construction through the shared protocol payload
  helper where the lifecycle contract crosses package boundaries.
- [ ] Keep Miniflare process setup, local file watching, and service-binding
  dispatch dev-owned.
- [ ] Add focused tests proving local runtime invokes use the same payload shape
  as hosted runtime invokes.

## Completed Checkpoints

- `579b1bf` (`Mark host kit audit complete`) completed the previous host-kit
  goal before this lifecycle parity stream started.
