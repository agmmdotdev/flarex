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
- [ ] G-3. L-2 shared artifact lifecycle payload helper.
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

### G-2 / L-1: Shared Artifact Ref/Source-Package Validation

Status: implemented in this turn; commit pending.

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

### G-3 / L-2: Shared Artifact Lifecycle Payload Helper

- [ ] Identify the current backend-only runtime invoke payload construction in
  `packages/flarex-backend/src/artifactRuntime.ts`.
- [ ] Extract a helper that produces the canonical runtime input from
  `ExecutionArtifactRef`, `functionName`, `args`, and optional source package.
- [ ] Update local/hosted call sites to consume that helper where the lifecycle
  contract crosses package boundaries.
- [ ] Add focused tests for with-source and ref-only materialization behavior.

## Completed Checkpoints

- `579b1bf` (`Mark host kit audit complete`) completed the previous host-kit
  goal before this lifecycle parity stream started.
