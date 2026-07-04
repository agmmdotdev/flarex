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
- [x] A-8. Deploy/admin identity boundary.
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

Status: A-8 complete.

Previous completed checkpoint: `b44aca4` (`Prove live query auth identity`).

What changed:

- All public Worker deployment push mutations now require the deploy/admin push
  bearer token before JSON body parsing: `push/start`, `push/start-analyzed`,
  `push/:pushId/finish`, and `push/:pushId/abandon`.
- The deploy-push authorization helper now has a generic mutation entry point,
  generic public error text, deploy-push-named test credentials, and an
  explicit compatibility path for the older analyzed-start unit API.
- Added a regression with a real end-user JWT matching the active deployment
  auth config. The user bearer token is rejected for all four deploy-push
  mutation routes, and the active auth config remains unchanged.
- Local dev's in-process backend push coordinator now sends an explicit local
  deploy-push token, and the local backend runtime binds the same token.
- Reviewer findings fixed before commit: local deploy POST credentials are
  required at the helper boundary; route-matrix coverage now covers all
  deploy-push mutations; deploy-push naming is first-class in the public auth
  helper and test harness; the compatibility error keeps the legacy Effect tag
  while the deploy-push class is nominally typed.

Convex references inspected:

- `crates/model/src/auth/mod.rs`
- `crates/keybroker/src/broker.rs`
- `crates/local_backend/src/deploy_config2.rs`
- `crates/application/src/lib.rs`

Cloudflare difference:

- Convex routes auth config and deploy writes through admin/system identities
  and `DeploymentOp::Deploy`; Flarex currently uses a configured deploy-push
  bearer token for the Worker deploy boundary.
- End-user bearer JWTs are only execution identity for `ctx.auth` and are not
  accepted as deploy/admin credentials for provider config mutation.

Next unchecked implementation item: A-9 final platform audit.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/push.test.ts test/publicAnalyzedStartAuthorization.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendPush.test.ts test/dev.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```
