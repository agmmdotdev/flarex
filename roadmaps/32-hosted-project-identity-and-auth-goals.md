# Hosted Project Identity And Auth Goals

Active goal:

Implement Convex-shaped hosted project identity and `ctx.auth` support step by
step: define shared public/protocol identity contracts, propagate identity
through backend invoke and trusted executor sessions, make generated runtime
`ctx.auth.getUserIdentity()` return `UserIdentity | null`, add sync
`Authenticate` and identity-version behavior, update roadmap checkboxes each
turn, validate, review significant patches, and commit each completed slice.

Source roadmap:

- `roadmaps/31-hosted-project-identity-and-auth.md`

## Goal Status

- [x] G-0. Create the concrete hosted project identity and auth roadmap.
- [x] G-1. Start the long-running Codex goal for this implementation stream.
- [x] G-2. Complete I-1: public and protocol identity contracts.
- [ ] G-3. Complete I-2: backend identity resolver and invoke payload propagation.
- [ ] G-4. Complete I-3: trusted executor session identity.
- [ ] G-5. Complete I-4: generated runtime `ctx.auth`.
- [ ] G-6. Complete I-5: HTTP client identity propagation.
- [ ] G-7. Complete I-6: sync auth behavior and identity version v1.
- [ ] G-8. Complete I-7: auth-aware live-query metadata.
- [ ] G-9. Complete I-8: auth provider platform planning checkpoint.

## Current Next Slice

### G-1: Start Goal

Status: complete.

Purpose:

Open the long-running goal for this implementation stream before code changes.

Exit criteria:

- The active goal names this implementation stream.
- The next implementation turn starts at G-2 / I-1.

### G-2 / I-1: Public And Protocol Identity Contracts

Status: complete.

Purpose:

Create the stable identity contract before threading identity through runtime
entrypoints. This avoids ad hoc auth shapes appearing separately in SDK,
backend, executor, and generated worker code.

Files expected:

- `packages/flarex/src/auth.ts`
- `packages/flarex/src/server.ts`
- `packages/flarex/src/index.ts`
- `packages/flarex/test/*`
- `packages/flarex-protocol/src/auth.ts`
- `packages/flarex-protocol/src/index.ts`
- `packages/flarex-protocol/test/auth.test.ts`
- `packages/analysis/test/auth-contract.test.ts`
- `roadmaps/31-hosted-project-identity-and-auth.md`
- this file

Implementation notes:

- Keep public `UserIdentity` compatible with Convex's documented shape.
- Model internal identity as anonymous or user identity.
- Use Effect Schema in `flarex-protocol`; keep public SDK types lightweight.
- Do not add JWT verification in this slice.
- Do not trust client-supplied identity in hosted production.

Validation gates:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter @flarex/analysis typecheck
corepack pnpm --filter @flarex/analysis test -- auth-contract.test.ts
git diff --check
```

Review gate:

- Required, because this changes public SDK types and shared protocol
  contracts.

Completed this turn:

- Added public SDK `Auth`, `UserIdentity`, `UserIdentityAttributes`, and
  `JSONValue` types.
- Added `auth` to query, mutation, partition-scoped mutation, and action
  contexts.
- Added protocol `UserIdentity` and `ExecutionIdentity` schemas plus Effect
  decode helpers.
- Added auth protocol tests for anonymous identity, user identity, custom
  claims, and malformed identity rejection.
- Re-exported auth contracts from package root, `flarex/server`, and
  `flarex-protocol`.
- Added an analysis type guard test so public SDK identity types stay
  compatible with protocol identities.

Convex references inspected:

- `npm-packages/convex/src/server/authentication.ts`
- `npm-packages/convex/src/server/registration.ts`
- `npm-packages/convex/src/browser/sync/protocol.ts`
- `npm-packages/convex/src/browser/sync/local_state.ts`
- `npm-packages/convex/src/browser/sync/authentication_manager.ts`

Validation:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test -- registration.test.ts
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test -- auth.test.ts
corepack pnpm --filter @flarex/analysis typecheck
corepack pnpm --filter @flarex/analysis test -- auth-contract.test.ts
```

Reviewer gate:

- `typescript-diff-reviewer`: fixed nested JSON and protocol plain-object
  guard findings.
- `code-quality-diff-reviewer`: fixed public/protocol drift guard and roadmap
  wording findings.

### G-3 / I-2: Backend Identity Resolver And Invoke Payload Propagation

Status: next.

Purpose:

Thread the newly defined `ExecutionIdentity` from trusted backend boundaries
into artifact runtime invoke payloads while keeping hosted production
anonymous until a backend-owned resolver validates identity.

Expected files:

- `packages/flarex-backend/src/project.ts`
- `packages/flarex-backend/src/artifactRuntime/*`
- `packages/flarex-protocol/src/invoke.ts`
- backend and protocol tests
- both roadmap files

Initial constraints:

- Anonymous identity is the default.
- Hosted production must not trust arbitrary client identity JSON.
- Capability-token and internal-token checks must remain before identity
  reaches executor/user code.

## Later Slices

### G-4 / I-3: Trusted Executor Session Identity

- Persist execution identity in invoke session metadata.
- Return or expose identity where generated runtime needs it.
- Preserve deployment/project mismatch checks before user code sees identity.

### G-5 / I-4: Generated Runtime `ctx.auth`

- Implement `ctx.auth.getUserIdentity()` in generated runtime source.
- Test local Miniflare and hosted artifact-runtime behavior.
- Keep `ctx.scheduler` and `ctx.storage` unsupported.

### G-6 / I-5: HTTP Client Identity Propagation

- Add client API for setting and clearing auth.
- Propagate identity/token through configured backend resolver path.
- Preserve anonymous execution by default.

### G-7 / I-6: Sync Auth Behavior And Identity Version V1

- Wire existing `Authenticate`/`AuthError` message shapes into backend identity
  behavior.
- Track identity version in `ConnectionDO`.
- Rerun active connection queries on auth change.

### G-8 / I-7: Auth-Aware Live-Query Metadata

- Store identity hash/version with durable subscription metadata.
- Ensure scheduler/executor reruns use subscription identity.
- Prevent stale previous-user results from being delivered after auth changes.

### G-9 / I-8: Auth Provider Platform Planning Checkpoint

- Decide the next stream for JWT/JWKS provider config, auth refresh,
  deploy-key/admin identities, and project ownership control plane.

## Turn Protocol

Every implementation turn in this goal follows this loop:

1. Read this file and `roadmaps/31-hosted-project-identity-and-auth.md`.
2. Confirm the next unchecked `G-*` and matching `I-*`.
3. Inspect relevant Convex references before editing.
4. Keep the patch scoped to that slice.
5. Update both roadmap files before validation.
6. Run focused validation listed for the slice plus `git diff --check`.
7. Run both standing reviewers for significant code/test/public-contract
   changes:
   - `typescript-diff-reviewer`
   - `code-quality-diff-reviewer`
8. Fix valid findings in the main thread and rerun validation.
9. Commit the completed slice.

## Required Quality Checklist For Code Slices

- [ ] `ctx.auth.getUserIdentity()` returns `UserIdentity | null`, not a
  generic unsupported runtime error.
- [ ] Anonymous execution remains supported.
- [ ] Hosted production does not trust arbitrary client identity JSON.
- [ ] Project/deployment mismatch checks run before identity reaches user code.
- [ ] Identity transport contracts are decoded through Effect Schema.
- [ ] Public SDK types remain Convex-compatible where practical.
- [ ] Sync identity changes advance identity version and rerun affected query
  state conservatively.
- [ ] Scheduler/rerun paths use subscription identity, not scheduler identity.
- [ ] Significant code slices pass reviewers.

## Completed Checkpoints

- `6c9ce28` (`Enforce Effect runtime boundaries`) completed the previous
  runtime-boundary cleanup before this stream began.
