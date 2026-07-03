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
- [ ] A-1. Public and protocol auth-provider contracts.
- [ ] A-2. Source-package and deploy ingestion.
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

Status: next.

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

Exit criteria:

- Public SDK exports `AuthConfig` and `AuthProvider` types.
- Protocol exports Effect Schema decoders for provider config.
- OIDC and custom-JWT variants are accepted and normalized.
- Malformed provider config is rejected with focused tests.
- No backend resolver behavior changes in this slice.

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
