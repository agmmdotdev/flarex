# Auth Provider Platform Goals

Active goal continuation:

Finish hosted auth by turning existing bearer-token SDK surfaces into
backend-verified execution identity. The implementation must add provider
configuration, JWT/JWKS validation, sync and HTTP integration, live-query proof,
and deploy/admin boundaries without trusting client identity JSON.

Source roadmap:

- `roadmaps/33-auth-provider-platform.md`

## Goal Status

- [x] A-0. Create the concrete auth-provider platform roadmap and goal
  checklist.
- [x] A-1. Public and protocol auth-provider contracts.
- [x] A-2. Source-package and deploy ingestion.
- [ ] A-3. Persistence and active deployment metadata.
- [ ] A-4. Backend JWT/JWKS resolver.
- [ ] A-5. Sync `Authenticate` integration.
- [ ] A-6. HTTP invoke integration.
- [ ] A-7. Live-query and scheduler auth proof.
- [ ] A-8. Deploy/admin identity boundary.
- [ ] A-9. Final platform audit.

## Current Next Slice

### A-0: Roadmap And Goal Checklist

Status: complete.

Purpose:

Close the previous hosted identity roadmap's planning checkpoint and create the
concrete next stream for production auth-provider validation.

Files changed:

- `roadmaps/31-hosted-project-identity-and-auth.md`
- `roadmaps/32-hosted-project-identity-and-auth-goals.md`
- `roadmaps/33-auth-provider-platform.md`
- `roadmaps/34-auth-provider-platform-goals.md`

Repository findings:

- `packages/flarex/src/client.ts` already exposes bearer-token auth to HTTP and
  sync clients.
- `packages/flarex-backend/src/auth.ts` does not validate bearer tokens.
- `packages/flarex-backend/src/connectionDO.ts` advances identity version on
  `Authenticate` but still uses anonymous identity.
- `packages/flarex-dev/src/sourcePackage.ts` and
  `packages/flarex/src/artifacts.ts` have no auth config field.
- `packages/persistence-postgres/src/schema.ts` and
  `packages/persistence-postgres/src/deploymentPackages.ts` have no provider
  config storage.
- `packages/flarex-backend/src/deployment/Validation.ts` only validates
  modules, functions, schema, and execution in source packages.

Convex references inspected:

- `npm-packages/convex/src/server/authentication.ts`
- `npm-packages/convex/src/browser/sync/authentication_manager.ts`
- `crates/authentication/src/lib.rs`
- `crates/model/src/auth/types.rs`
- `crates/model/src/auth/mod.rs`
- `crates/application/src/api.rs`

Cloudflare difference:

- Flarex has split Cloudflare Worker, Durable Object, Dynamic Worker, and
  executor boundaries. Auth config and token verification must be backend-owned
  metadata and resolver behavior, while generated workers receive only verified
  `ExecutionIdentity`.

Validation:

```sh
git diff --check
```

Reviewer checkpoint:

- Main-thread review only. This was a docs-only planning slice.

### A-1: Public And Protocol Auth-Provider Contracts

Status: complete.

Purpose:

Create the stable public and protocol contract for auth provider configuration
before source-package ingestion or backend verification code begins.

Expected files:

- `packages/flarex/src/auth.ts`
- `packages/flarex/src/index.ts`
- `packages/flarex-protocol/src/auth.ts`
- `packages/flarex-protocol/src/index.ts`
- `packages/flarex-protocol/test/auth.test.ts`
- `packages/flarex/test/*` if public type regression coverage is needed
- both roadmap files

Completed:

- Public SDK exports `AuthConfig` and `AuthProvider` types.
- `flarex/server` exports the auth config types for Convex-style
  `auth.config.ts` imports.
- Public SDK provider config types reuse `flarex-protocol/auth` as the source
  of truth instead of duplicating the shape.
- Protocol exports Effect Schema decoders for provider config.
- OIDC and custom-JWT variants are accepted through the protocol schema.
- Malformed provider config is rejected with focused tests.
- No backend resolver behavior changes in this slice.

Files changed:

- `packages/flarex/src/auth.ts`
- `packages/flarex/src/server.ts`
- `packages/flarex-protocol/src/auth.ts`
- `packages/flarex-protocol/test/auth.test.ts`
- `roadmaps/33-auth-provider-platform.md`
- `roadmaps/34-auth-provider-platform-goals.md`

Convex references inspected:

- `npm-packages/convex/src/server/authentication.ts`
- `crates/model/src/auth/types.rs`
- `crates/authentication/src/lib.rs`

Cloudflare difference:

- Provider config is now a typed contract, but it is not yet source-packaged,
  stored, or used by the backend resolver. End-user clients still cannot supply
  provider config.

Validation gates:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test -- auth.test.ts
git diff --check
```

Review gate:

- Required, because this changes public SDK types and shared protocol contracts.
- `typescript-diff-reviewer`: fixed missing `flarex/server` exports and SDK
  provider type duplication by re-exporting protocol-owned provider types.
- `code-quality-diff-reviewer`: fixed missing `flarex/server` exports and
  corrected roadmap wording so the slice promises validation, not
  normalization.

### A-2: Source-Package And Deploy Ingestion

Status: complete.

Purpose:

Carry auth provider config through the same local-first and hosted deploy path
as functions, schema, and execution artifacts.

Expected files:

- `packages/flarex-dev/src/sourcePackage.ts`
- `packages/flarex/src/artifacts.ts`
- `packages/flarex-protocol/src/deployment.ts`
- `packages/flarex-backend/src/deployment/Validation.ts`
- `packages/flarex-backend/src/deployment/Requests.ts`
- focused dev, protocol, and backend deployment tests
- both roadmap files

Completed:

- The local source package can include or omit auth config consistently.
- Source-package hashing accounts for auth config when present.
- Deployment validation decodes auth config through the protocol contract.
- No persistence schema or backend JWT verification changes happen in this
  slice.

Files changed:

- `packages/flarex-dev/src/sourcePackage.ts`
- `packages/flarex-dev/src/executionArtifactStore.ts`
- `packages/flarex-dev/src/executorHttpRuntime.ts`
- `packages/flarex-dev/test/sourcePackage.test.ts`
- `packages/flarex-dev/test/artifactLifecycleParity.test.ts`
- `packages/flarex-dev/test/executorHttpRuntime.test.ts`
- `packages/flarex-dev/test/runtimeMaterializer.test.ts`
- `packages/flarex/src/artifacts.ts`
- `packages/flarex/test/artifacts.test.ts`
- `packages/flarex-protocol/src/deployment.ts`
- `packages/flarex-protocol/test/deployment.test.ts`
- `packages/flarex-backend/src/types.ts`
- `packages/flarex-backend/src/deployment/Validation.ts`
- `packages/flarex-backend/src/deployment/Requests.ts`
- `packages/flarex-backend/src/deployment/StorageRows.ts`
- `packages/flarex-backend/src/artifactStore.ts`
- `packages/flarex-backend/test/deploymentValidation.test.ts`
- `packages/flarex-backend/test/deploymentRequests.test.ts`
- `packages/flarex-backend/test/deploymentStorageRows.test.ts`
- `packages/executor/src/deploymentPackages.ts`
- both roadmap files

Convex references inspected:

- `npm-packages/convex/src/server/authentication.ts`
- `crates/model/src/auth/types.rs`
- `crates/model/src/auth/mod.rs`

Cloudflare difference:

- The deploy/source-package path carries decoded provider config metadata and
  the config module path. It does not expose provider config through end-user
  invoke requests.
- Artifact refs include auth config metadata, so local Miniflare and hosted
  Dynamic Worker execution agree on package identity.
- Active provider persistence and token verification remain future slices.

Validation:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test -- artifacts.test.ts
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test -- deployment.test.ts
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/sourcePackage.test.ts test/executorHttpRuntime.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentValidation.test.ts test/deploymentRequests.test.ts test/deploymentStorageRows.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test -- deployments.test.ts
git diff --check
```

Review gate:

- Required, because this changes shared source-package and deployment protocol
  contracts.
- `typescript-diff-reviewer` found that protocol decoders allowed auth config
  states that backend validation rejected, and local materialization accepted
  looser metadata than hosted validation. Fixed by adding protocol-level source
  package invariants and matching local materialization checks.
- `code-quality-diff-reviewer` found that deployment storage row decoding
  stripped auth config metadata before backend validation could preserve it.
  Fixed by adding explicit stored source-package auth fields and storage-row
  coverage.

### A-3: Persistence And Active Deployment Metadata

Status: next.

Purpose:

Store active auth provider config as backend-owned deployment metadata so the
HTTP and sync auth resolvers can load the currently active providers without
trusting client input.

Expected files:

- `packages/persistence-postgres/src/schema.ts`
- `packages/persistence-postgres/src/deploymentPackages.ts` or a dedicated auth
  metadata module
- `packages/flarex-backend/src/deployment/Store.ts`
- `packages/flarex-backend/src/deployment/Validation.ts`
- backend, persistence, executor, and route tests
- both roadmap files

Exit criteria:

- Provider config is persisted and recoverable for the active deployment.
- The storage shape is explicitly package-versioned, deployment-active, or
  project-level; the chosen ownership is documented.
- Deploy/admin write authority remains separate from end-user `ctx.auth`.
- No JWT/JWKS bearer verification changes happen in this slice.

## Turn Protocol

Every implementation turn follows this loop:

1. Read this file and `roadmaps/33-auth-provider-platform.md`.
2. Confirm the next unchecked `A-*` item.
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

## Required Quality Checklist

- [ ] Provider config is backend-owned and decoded through Effect Schema.
- [ ] Public SDK auth types stay Convex-compatible where practical.
- [ ] Bearer tokens are never treated as identity without backend verification.
- [ ] Invalid explicit auth attempts fail closed.
- [ ] Sync and HTTP use the same token verification semantics.
- [ ] Live-query reruns use the verified subscription identity.
- [ ] Deploy/admin identity is separate from end-user `ctx.auth`.
- [ ] Trusted dev/test identity remains explicitly env-gated.
- [ ] Significant code slices pass reviewers.
