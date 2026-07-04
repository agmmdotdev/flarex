# Auth Provider Platform

This roadmap starts the next hosted auth stream after
`roadmaps/31-hosted-project-identity-and-auth.md`. The identity plumbing is now
in place, but hosted production still treats bearer tokens as anonymous. This
stream adds backend-owned auth provider configuration and JWT/JWKS validation so
`FlarexClient.setAuth(...)` can safely produce a real `ctx.auth` identity.

## Current Diagnosis

The public and runtime surfaces already exist:

- `packages/flarex/src/client.ts` stores a bearer token fetcher, forwards
  `Authorization: Bearer ...` for HTTP invokes, and sends sync `Authenticate`.
- `packages/flarex-backend/src/connectionDO.ts` tracks identity version and
  reruns active queries on `Authenticate`.
- `packages/flarex-backend/src/artifactRuntime/GeneratedWorkerSource.ts`
  exposes `ctx.auth.getUserIdentity()` from executor session identity.
- Live-query subscription metadata stores the execution identity used for
  executor reruns.

The production auth platform does not exist yet:

- `packages/flarex-backend/src/auth.ts` only supports anonymous identity and an
  explicitly env-gated trusted dev/test identity header.
- `Authorization: Bearer ...` is not parsed or verified by the backend.
- `ConnectionDO` accepts `Authenticate` messages but currently resets identity
  to anonymous.
- `packages/flarex-dev/src/sourcePackage.ts` and
  `packages/flarex/src/artifacts.ts` do not include an `auth.config` module or
  auth metadata in source-package identity.
- `packages/persistence-postgres/src/schema.ts` stores deployments and
  deployment packages without auth-provider config.
- Deploy/admin identity for configuring auth providers is not modeled and must
  not be confused with end-user `ctx.auth`.

## Convex References

Use Convex for semantics, not direct structure:

- `npm-packages/convex/src/server/authentication.ts`
  - Public `AuthConfig`, OIDC provider, custom JWT provider, and `UserIdentity`
    shape.
- `npm-packages/convex/src/browser/sync/authentication_manager.ts`
  - Client token fetch, forced refresh, server confirmation, and refresh
    scheduling behavior.
- `crates/authentication/src/lib.rs`
  - Provider selection by issuer/audience, OIDC discovery/JWKS validation,
    custom JWT validation, claim mapping, and JWKS response checks.
- `crates/model/src/auth/types.rs`
  - Persisted auth config variants.
- `crates/model/src/auth/mod.rs`
  - Backend-owned auth config storage guarded by admin/system identity.
- `crates/application/src/api.rs`
  - Application execution receives verified identity from backend API
    boundaries.

## Target Semantics

Public user code keeps the existing contract:

```ts
const identity = await ctx.auth.getUserIdentity();
```

Unauthenticated execution returns `null`. Invalid, expired, or untrusted tokens
fail at the backend boundary and do not become anonymous silently when the user
explicitly tried to authenticate.

Auth provider configuration is deployment/project metadata owned by the backend.
End-user clients may send bearer tokens, but they never send trusted identity
JSON or provider configuration.

## Implementation Slices

- [x] A-0. Create this roadmap and the matching goal checklist.
- [x] A-1. Public and protocol auth-provider contracts.
  - Add `AuthConfig` and `AuthProvider` public types compatible with Convex's
    OIDC and custom-JWT provider shapes.
  - Add `flarex-protocol` Effect Schema decoders for provider config.
  - Support OIDC `{ domain, applicationID }`.
  - Support custom JWT
    `{ type: "customJwt", issuer, jwks, algorithm, applicationID? }`.
  - Keep public SDK types lightweight and shared protocol schemas strict.
- [x] A-2. Source-package and deploy ingestion.
  - Decide and implement how local `auth.config.ts` enters the source package.
  - Extend source-package/artifact identity deliberately so auth config changes
    are deploy-visible and reproducible.
  - Extend analyzer/push/deployment validation to carry decoded auth config.
  - Add local dev tests proving auth config is included or absent consistently.
- [x] A-3. Persistence and active deployment metadata.
  - Store provider config as backend-owned deployment/project metadata.
  - Use package-versioned deployment package storage when no new table is needed.
  - Decide whether config is package-versioned, deployment-active-versioned, or
    project-level with active package linkage; document the choice in this file.
  - Keep deploy/admin mutation authority separate from end-user auth.
- [x] A-4. Backend JWT/JWKS resolver.
  - Parse `Authorization: Bearer <token>` only at public/backend auth
    boundaries.
  - Select provider from unverified issuer/audience only, then verify signature,
    issuer, audience, algorithm, `kid`, `exp`, `nbf`, and time-based claims.
  - Validate OIDC discovery/JWKS and custom JWT JWKS.
  - Map verified claims into `UserIdentity`.
  - Cache JWKS conservatively without making stale invalid keys authoritative
    forever.
  - Return typed auth errors and fail closed.
- [x] A-5. Sync `Authenticate` integration.
  - Validate the token in `ConnectionDO` through the same backend resolver.
  - On success, set `executionIdentity` to the verified user identity and
    advance identity version.
  - On failure, send `AuthError` without advancing identity version.
  - Add forced-refresh client behavior only where server errors require it.
- [x] A-6. HTTP invoke integration.
  - Use the same resolver for one-shot HTTP query/mutation/action invokes.
  - Keep trusted dev/test identity headers explicitly env-gated and separate
    from bearer-token identity.
  - Prove HTTP and sync auth map the same token to the same user identity.
- [x] A-7. Live-query and scheduler auth proof.
  - Prove verified identities persist into subscription `identity_json`.
  - Prove executor reruns use the subscription identity.
  - Prove stale previous-user deliveries are still blocked with real verified
    identities, not only trusted test identities.
- [ ] A-8. Deploy/admin identity boundary.
  - Define how auth config is updated by deploy/admin actors.
  - Keep deploy keys, dashboard users, and project ownership out of end-user
    `ctx.auth`.
  - Add tests that public end-user tokens cannot mutate provider config.
- [ ] A-9. Final platform audit.
  - Run the broad auth, sync, backend, executor, persistence, and dev package
    gates.
  - Run both standing reviewers.
  - Update this roadmap and `roadmaps/34-auth-provider-platform-goals.md` with
    final limitations and follow-ups.

## Turn-By-Turn Protocol

Every turn in this stream must:

1. Read this file and `roadmaps/34-auth-provider-platform-goals.md`.
2. Confirm the next unchecked `A-*` item.
3. Inspect the specific Convex references for that slice.
4. Keep the patch scoped to that slice unless validation exposes a required
   small fix.
5. Update both roadmap files with the completed checkbox, files changed,
   Convex references, Cloudflare differences, validation, reviewer result, and
   commit hash when known.
6. Run focused validation plus `git diff --check`.
7. Run both standing reviewers for significant code/test/public-contract
   changes.
8. Fix valid findings in the main thread, rerun validation, and commit.

## Non-Goals

- Do not let clients submit trusted identity JSON in hosted production.
- Do not silently downgrade invalid explicit auth attempts to anonymous.
- Do not mix deploy/admin identity with end-user `ctx.auth` identity.
- Do not implement scheduler or storage capabilities as part of this auth
  stream unless an auth test needs an existing path to be preserved.
- Do not replace `ValidatorJson` with Effect Schema.
- Do not skip backend verification because the SDK already fetched a token.

## Current Checkpoint

Status: A-7 complete.

Previous completed checkpoint: `af6a204` (`Verify HTTP invoke bearer tokens`).

What changed:

- Added a backend sync regression that authenticates with a real RS256 JWT,
  records an executor live-query subscription, and asserts the subscription
  body carries the backend-verified `ExecutionIdentity`.
- Extended the PGlite-backed executor HTTP rerun test to record through the real
  `/live-query-subscriptions/record` route with verified identity, then rerun
  through `/maintenance/live-queries/rerun` and assert persisted subscription
  and delivery fingerprints.
- The same backend regression sends an anonymous-fingerprint delivery and proves
  it is treated as stale, then sends a verified-fingerprint delivery and proves
  it reaches the active WebSocket under the authenticated identity version.
- Updated the local executor HTTP runtime rerun test to use a stored verified
  user `identityJson`, proving rerun materialization and query-session execution
  receive the subscription identity instead of defaulting to anonymous.
- Fixed the local executor HTTP runtime materialization helper to include stored
  subscription `identityJson` in the materialized artifact payload.

Convex references inspected:

- `npm-packages/convex/src/server/authentication.ts`
- `npm-packages/convex/src/browser/sync/authentication_manager.ts`
- `npm-packages/convex/src/browser/sync/client.ts`
- `crates/local_backend/src/subs/mod.rs`
- `crates/application/src/api.rs`
- `crates/application/src/application_function_runner/mod.rs`

Cloudflare difference:

- HTTP verification runs in the Worker route before artifact-runtime dispatch,
  using active deployment package metadata as the provider source.
- The test uses a `data:` JWKS URL to exercise real Worker `fetch` plus
  WebCrypto verification without adding a production test hook.
- Trusted dev/test identity headers remain explicitly env-gated and are not
  derived from end-user bearer tokens.

Next unchecked implementation item: A-8 deploy/admin identity boundary.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts --testNamePattern "verified Authenticate identity" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/executorHttpRuntime.test.ts --testNamePattern "local live-query materialization|PGlite-backed executor state" --testTimeout=120000 --hookTimeout=120000
git diff --check
```
