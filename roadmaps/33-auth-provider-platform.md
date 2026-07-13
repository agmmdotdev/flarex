# Auth Provider Platform

This completed roadmap owns backend auth-provider configuration and JWT/JWKS
verification for hosted end-user identity. `FlarexClient.setAuth(...)` can
produce a verified `ctx.auth` identity through configured providers. That
authentication result is not transaction/commit authorization; roadmap 31 and
O03-A own the still-planned signed transaction-grant boundary.

## Current Implemented Boundary

The implemented platform includes:

- `packages/flarex/src/client.ts` stores a bearer token fetcher, forwards
  `Authorization: Bearer ...` for HTTP invokes, and sends sync `Authenticate`.
- backend-owned configured OIDC/custom-JWT verification for HTTP and sync;
- `packages/flarex-backend/src/connectionDO.ts` identity-version tracking and
  authenticated reruns on `Authenticate`;
- `packages/flarex-backend/src/artifactRuntime/GeneratedWorkerSource.ts`
  exposes `ctx.auth.getUserIdentity()` from executor session identity.
- live-query subscription metadata carrying the verified execution identity
  used for executor reruns; and
- package-versioned auth configuration plus a separate deploy/admin update
  boundary.

The bearer verifier checks credential expiry and provider configuration, then
returns `ExecutionIdentity`. It does not retain the credential-expiry/provider
evidence or minimize claims for a signed transaction grant. That is the
explicit O03-A follow-up, not unfinished work in this completed provider
stream.

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
- [x] A-9. Final platform audit.
  - Run the broad auth, sync, backend, executor, persistence, and dev package
    gates.
  - Run both standing reviewers.
  - Update this roadmap and `roadmaps/34-auth-provider-platform-goals.md` with
    final limitations and follow-ups.

## Future Maintenance

This stream has no unchecked implementation item. Future durable auth-provider
changes follow the repository preflight and living-roadmap rules in
`AGENTS.md`; do not append per-turn files, validation receipts, reviewer
receipts, or commit history here.

## Non-Goals

- Do not let clients submit trusted identity JSON in hosted production.
- Do not silently downgrade invalid explicit auth attempts to anonymous.
- Do not mix deploy/admin identity with end-user `ctx.auth` identity.
- Do not implement scheduler or storage capabilities as part of this auth
  stream unless an auth test needs an existing path to be preserved.
- Do not replace `ValidatorJson` with Effect Schema.
- Do not skip backend verification because the SDK already fetched a token.

## Current Checkpoint

Status: A-9 final audit complete.

Previous completed checkpoint: `e7b79ee` (`Separate deploy push auth identity`).

What changed:

- Added a public SDK type regression proving Convex-style auth provider config
  types are exported from `flarex/server` and remain assignable through the
  protocol-owned `AuthProvider` union.
- The broad workspace typecheck found stale cross-package test surfaces after
  authenticated artifact execution became explicit. Fixed app artifact-runtime
  invoke payloads to carry anonymous `ExecutionIdentity`, executor-http/nitro
  fakes to implement `getActiveDeploymentAuthConfig`, nitro fake persistence
  rows to include `identityJson`, and executor-http delivery assertions to
  include identity fingerprints.
- The Effect boundary checker found auth-related Promise bridges that were not
  audited. Centralized dev auth-config decoding through the exported protocol
  Promise decoder and added explicit site/count tracking for the remaining sync
  Authenticate bridge plus protocol auth-config Promise decoder.

Convex references inspected:

- `npm-packages/convex/src/server/authentication.ts`
- `npm-packages/convex/src/browser/sync/authentication_manager.ts`
- `crates/authentication/src/lib.rs`
- `crates/model/src/auth/types.rs`
- `crates/model/src/auth/mod.rs`
- `crates/application/src/api.rs`

Cloudflare difference:

- Flarex's verified identity path crosses Cloudflare Worker, Durable Object,
  service-binding artifact runtime, Dynamic Worker, executor HTTP/Nitro, and
  Postgres persistence package boundaries. The final audit checks those package
  boundaries instead of only the focused backend tests.
- Deployment auth configuration remains package-versioned active metadata.
  There is still no separate dashboard auth-provider settings API.

Final limitations and follow-ups:

- The deploy-push Worker binding is still named `FLAREX_ANALYZED_START_TOKEN`
  for compatibility; a future config cleanup can rename it with an alias window.
- OIDC/custom-JWT provider support is implemented for the configured provider
  shapes in this stream; dashboard/project owner auth and deploy key lifecycle
  remain outside this auth-provider platform goal.
- Client token refresh behavior is limited to the current `setAuth`/sync
  retry semantics; long-lived proactive refresh scheduling can be a later SDK
  ergonomics slice.

Next unchecked implementation item: none for this auth-provider platform
stream.

Verification:

```sh
corepack pnpm typecheck
corepack pnpm --filter flarex test -- registration.test.ts
corepack pnpm --filter flarex-protocol test -- auth.test.ts deployment.test.ts
corepack pnpm --filter @flarex/executor test -- deployments.test.ts
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/pglite.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend exec vitest run test/authJwt.test.ts test/publicAnalyzedStartAuthorization.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend exec vitest run test/artifactRuntimeRoute.test.ts test/artifactRuntime.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend exec vitest run test/push.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-dev exec vitest run test/sourcePackage.test.ts test/executorHttpRuntime.test.ts test/backendPush.test.ts test/dev.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/artifact-runtime test -- worker.test.ts
corepack pnpm --filter @flarex/executor-http test -- http.test.ts
corepack pnpm --filter @flarex/executor-nitro test -- health.test.ts
corepack pnpm check:effect-boundaries
corepack pnpm test:scripts
git diff --check
```

Review gate:

- TypeScript reviewer found no actionable findings.
- Maintainability reviewer found two avoidable local auth-config decode
  `Effect.runPromise` bridges and the pending-review status wording. Fixed by
  reusing `decodeAuthConfigPromise(...)`, removing the two local allowlist
  entries, rerunning validation, and updating this checkpoint status.
- Final re-review found a stale `Effect` import plus roadmap file-list/heading
  accuracy issues. Fixed those and reran the affected gates plus the full
  workspace typecheck.
