# Auth Provider Platform Goals

Completed goal archive:

This stream finished backend-verified hosted auth through A-9. The detailed
slice records below are historical evidence, not current architecture or
implementation instructions. Current provider status lives in roadmap 33;
roadmap 31/O03-A owns the still-planned transaction-grant boundary.

Source roadmap:

- `roadmaps/33-auth-provider-platform.md`

## Goal Status

- [x] A-0. Create the concrete auth-provider platform roadmap and goal
  checklist.
- [x] A-1. Public and protocol auth-provider contracts.
- [x] A-2. Source-package and deploy ingestion.
- [x] A-3. Persistence and active deployment metadata.
- [x] A-4. Backend JWT/JWKS resolver.
- [x] A-5. Sync `Authenticate` integration.
- [x] A-6. HTTP invoke integration.
- [x] A-7. Live-query and scheduler auth proof.
- [x] A-8. Deploy/admin identity boundary.
- [x] A-9. Final platform audit.

## Historical Slice Record

Statements inside individual slices describe repository state at that slice's
time. Use Git for chronology and verify current code/roadmaps before reusing
them.

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

Status: complete.

Purpose:

Store active auth provider config as backend-owned deployment metadata so the
HTTP and sync auth resolvers can load the currently active providers without
trusting client input.

Files changed:

- `packages/executor/src/authConfig.ts`
- `packages/executor/src/errors.ts`
- `packages/executor/src/index.ts`
- `packages/executor/src/types.ts`
- `packages/executor/test/deployments.test.ts`
- `packages/flarex-backend/src/deployment/Store.ts`
- `packages/flarex-backend/test/deploymentService.test.ts`
- `packages/flarex-protocol/src/auth.ts`
- `packages/persistence-postgres/test/pglite.test.ts`
- both roadmap files

Completed:

- Provider config is persisted and recoverable for the active deployment.
- The storage shape is explicitly package-versioned, deployment-active, or
  project-level; the chosen ownership is documented.
- Deploy/admin write authority remains separate from end-user `ctx.auth`.
- No JWT/JWKS bearer verification changes happen in this slice.

Ownership decision:

- The persisted source of truth is package-versioned:
  `deployment_packages.source_package_json` stores the decoded deploy-owned
  `authConfig` and `authConfigModule`.
- Active auth config is derived through `deployments.active_package_id` and
  exposed by executor `getActiveDeploymentAuthConfig`.
- Deployment DO activation also writes `active_auth_config` and
  `active_auth_config_module` active metadata for the backend active deployment
  store.
- No new project-level auth table or client-writeable auth settings route was
  added in this slice.

Convex references inspected:

- `npm-packages/convex/src/server/authentication.ts`
- `crates/model/src/auth/types.rs`
- `crates/model/src/auth/mod.rs`

Cloudflare difference:

- Hosted auth provider config follows package activation instead of a separate
  global Convex deployment auth settings model. This keeps local-first package
  identity and hosted active runtime behavior aligned.
- End-user invoke/sync requests still only carry bearer tokens. They do not
  carry provider config or trusted identity JSON.

Validation:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test -- auth.test.ts
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test -- deployments.test.ts
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/pglite.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```

Review gate:

- Required, because this adds a public executor API and active auth metadata
  persistence.
- `typescript-diff-reviewer` found that the active auth config result type did
  not encode the `authConfig`/`authConfigModule` nullability relationship, and
  that backend active metadata could serialize an empty auth module for an
  invalid internal state. Fixed with a correlated result union and a
  fail-closed active metadata guard.
- `code-quality-diff-reviewer` found missing tests for corrupt persisted auth
  metadata pairing/module states. Fixed with table-driven executor tests for
  module-without-config, config-without-module, and module-missing-from-package
  recovery failures.

### A-4: Backend JWT/JWKS Resolver

Status: complete.

Purpose:

Validate bearer tokens against the active backend-owned auth provider config and
turn successful verification into `ExecutionIdentity`.

Files changed:

- `packages/flarex-backend/src/authJwt.ts`
- `packages/flarex-backend/test/authJwt.test.ts`
- both roadmap files

Completed:

- Bearer tokens are parsed from explicit HTTP/sync auth inputs.
- OIDC and custom JWT provider metadata resolves JWKS without trusting clients.
- Invalid explicit auth attempts fail closed.
- No deploy/admin identity is reused as end-user `ctx.auth`.

Convex references inspected:

- `npm-packages/convex/src/server/authentication.ts`
- `crates/common/src/auth.rs`
- `crates/authentication/src/lib.rs`
- `crates/keybroker/src/broker.rs`
- `crates/model/src/auth/types.rs`
- `crates/model/src/auth/mod.rs`

Cloudflare difference:

- The resolver uses injected `fetch` plus Worker/WebCrypto primitives rather
  than adding a Node/Jose dependency.
- HTTP invoke and sync `Authenticate` are not wired in this slice; they will call
  this resolver in A-5/A-6.

Validation:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/authJwt.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```

Review gate:

- Required, because this is the shared bearer-token verification path for HTTP
  and sync.
- `typescript-diff-reviewer` found that camel-case reserved `UserIdentity` keys
  could be injected through custom JWT claims, and flagged weak JSON-boundary
  assertions. Fixed by excluding reserved output identity keys from custom
  claims and keeping parsed JSON typed as `unknown` at the boundary.
- `code-quality-diff-reviewer` found fail-open malformed `nbf` handling, overly
  loose OIDC audience/issuer validation, optional OIDC discovery issuer
  handling, overly detailed public HTTP errors, and case-sensitive Bearer scheme
  parsing. Fixed with fail-closed `nbf` validation, provider-specific audience
  checks, required matching discovery issuer, generic HTTP auth failure text, and
  case-insensitive Bearer parsing.

### A-5: Sync `Authenticate` Integration

Status: complete.

Purpose:

Wire sync `Authenticate` messages through the backend JWT/JWKS resolver so
WebSocket identity changes use verified user identity instead of resetting to
anonymous.

Files changed:

- `packages/flarex/src/sync/baseClient.ts`
- `packages/flarex/src/sync/localState.ts`
- `packages/flarex/test/client.test.ts`
- `packages/flarex-backend/src/connectionDO.ts`
- `packages/flarex-backend/test/sync.test.ts`
- `roadmaps/33-auth-provider-platform.md`
- `roadmaps/34-auth-provider-platform-goals.md`

Exit criteria:

- `Authenticate` with `tokenType: "User"` verifies the token against active
  backend-owned auth config.
- Success advances identity version and reruns active queries with the verified
  identity.
- Failure sends `AuthError` without advancing identity version.
- `Authenticate` with `tokenType: "None"` clears to anonymous without needing a
  provider.

What changed:

- `ConnectionDO` resolves the next sync identity before mutating connection
  state. User tokens are wrapped as bearer tokens and verified through
  `resolveBearerExecutionIdentityEffect` using the active deployment package's
  `sourcePackage.authConfig`.
- Successful user auth updates `executionIdentity`, advances identity version,
  and reruns active queries with the verified identity.
- Invalid user auth sends generic `AuthError` and leaves the current identity
  version unchanged.
- The SDK rolls back its optimistic local identity version when the server
  returns `AuthError`, so the next auth message uses the server base version.
- `None` auth clears to anonymous locally; `Admin` auth remains separate from
  end-user identity and fails closed.
- Authenticated sync execution now fails instead of dropping verified identity
  if the legacy direct-invoke fallback is used without an artifact runtime.
- Sync tests now activate a deployment with auth config, sign a real RS256 JWT,
  serve JWKS through a `data:` URL, and assert rerun execution receives the
  verified `ExecutionIdentity`.

Convex references inspected:

- `npm-packages/convex/src/browser/sync/authentication_manager.ts`
- `npm-packages/convex/src/server/authentication.ts`
- `crates/authentication/src/lib.rs`
- `crates/model/src/auth/types.rs`
- `crates/model/src/auth/mod.rs`

Cloudflare difference:

- Verification happens inside `ConnectionDO` because the sync WebSocket state
  owns identity versions and active query reruns.
- The backend loads provider config from the active deployment package rather
  than accepting provider config or identity JSON from the client.

Validation:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts --testNamePattern "Authenticate" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test -- client.test.ts
git diff --check
```

Review gate:

- Required before commit because this changes the sync auth boundary and
  identity rerun behavior.
- First-pass reviewers found SDK auth-version desync after `AuthError`,
  possible stale async auth commit, generic error leakage, untested `Admin`
  auth, direct invoke identity drop, and weaker copied test types. These were
  fixed in the main thread and validation was rerun.
- Second-pass TypeScript reviewers found no remaining actionable findings.
- The second-pass quality reviewer found missing direct-invoke guard coverage.
  Added a regression proving verified sync identity fails explicitly when the
  artifact runtime is unavailable instead of falling through as anonymous.

### A-6: HTTP Invoke Integration

Status: complete.

Purpose:

Use the same backend-owned bearer-token verification semantics for one-shot
HTTP invokes that sync `Authenticate` now uses.

Files changed:

- `packages/flarex-backend/src/worker.ts`
- `packages/flarex-backend/src/artifactRuntime.ts`
- `packages/flarex-backend/test/authFixtures.ts`
- `packages/flarex-backend/test/artifactRuntime.test.ts`
- `packages/flarex-backend/test/artifactRuntimeRoute.test.ts`
- `packages/flarex-backend/test/sync.test.ts`
- `roadmaps/33-auth-provider-platform.md`
- `roadmaps/34-auth-provider-platform-goals.md`

Exit criteria:

- HTTP `Authorization: Bearer <token>` is verified against active deployment
  `sourcePackage.authConfig`.
- Verified HTTP identity is passed into artifact-runtime invocation.
- Invalid explicit bearer auth fails closed with generic auth text.
- Trusted dev/test identity headers remain explicitly env-gated and separate
  from bearer-token identity.
- Authenticated HTTP invoke cannot fall through to legacy direct invoke as
  anonymous.

What changed:

- `routePublicInvoke` loads the active deployment before identity resolution and
  resolves bearer identity with `resolveBearerExecutionIdentityEffect` using the
  active package auth config.
- Trusted dev/test identity headers still route through
  `resolveExecutionIdentityEffect`, and only when the explicit trusted identity
  header is present.
- `routeInvoke` now receives the loaded active deployment and passes verified
  identity to the artifact runtime.
- The artifact runtime interface now requires call sites to pass an explicit
  `ExecutionIdentity`; anonymous identity is chosen at route/auth boundaries.
- The legacy direct-invoke fallback now fails for authenticated HTTP identity
  instead of dropping it.
- HTTP route tests sign a real RS256 token, serve JWKS through `data:`, assert
  the runtime receives the verified identity, assert invalid bearer auth returns
  `401`, cover trusted-header failure modes, and cover the direct-fallback
  guard.
- Shared RS256 JWT/JWKS test fixtures are reused by HTTP and sync auth tests.

Convex references inspected:

- `npm-packages/convex/src/server/authentication.ts`
- `crates/authentication/src/lib.rs`
- `crates/model/src/auth/types.rs`
- `crates/model/src/auth/mod.rs`
- `crates/application/src/api.rs`

Cloudflare difference:

- HTTP auth runs in the Worker route before artifact-runtime service binding
  dispatch, using package-versioned active deployment metadata instead of a
  separate deployment auth-settings table.

Validation:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/artifactRuntimeRoute.test.ts test/artifactRuntime.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts --testNamePattern "Authenticate" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test -- client.test.ts
git diff --check
```

Review gate:

- Required before commit because this changes the public HTTP auth boundary and
  identity propagation into user code.
- TypeScript reviewer found the artifact runtime interface still allowed omitted
  identity, runtime-call assertions used `unknown`, and an R2 bucket test cast
  should be guarded. Fixed with an explicit identity runtime API, typed payload
  decoding, and an R2 bucket guard.
- Quality reviewer found duplicated JWT test fixtures and missing route-level
  trusted-header failure coverage. Fixed with `test/authFixtures.ts` and
  trusted-header disabled/missing-token assertions.

### A-7: Live-Query And Scheduler Auth Proof

Status: complete.

Purpose:

Prove that backend-verified user identity does not stop at sync
`Authenticate` or HTTP invoke. Live-query subscription recording, scheduler
rerun execution, and delivery freshness checks must all preserve the same
verified `ExecutionIdentity`.

Files changed:

- `packages/flarex-backend/test/sync.test.ts`
- `packages/flarex-dev/src/executorHttpRuntime.ts`
- `packages/flarex-dev/test/executorHttpRuntime.test.ts`
- `packages/flarex-dev/test/localRuntimeFixture.ts`
- `roadmaps/33-auth-provider-platform.md`
- `roadmaps/34-auth-provider-platform-goals.md`

Exit criteria:

- A WebSocket authenticated with a real RS256 JWT records executor subscription
  metadata with the backend-verified user identity.
- The real executor HTTP record route persists verified identity as
  subscription `identityJson` in PGlite-backed executor state.
- A stale delivery computed for anonymous identity is rejected for that
  authenticated live query.
- A delivery computed with the verified identity fingerprint reaches the active
  WebSocket and advances the authenticated identity version path.
- Executor HTTP rerun materialization uses stored subscription `identityJson`
  when building the materialized payload and query-session request.

What changed:

- Added a backend sync regression that signs a real JWT, authenticates the
  WebSocket, adds a live query through the executor-backed subscription path,
  and asserts `/live-query-subscriptions/record` receives the verified user
  identity.
- Extended that regression to send both anonymous and verified delivery
  fingerprints to the connection Durable Object, proving stale previous-user
  results are blocked with a real verified identity.
- Updated the local executor HTTP runtime lifecycle test to use a stored
  verified user `identityJson` and assert both materialization and
  `executeQuerySession` run under that identity.
- Extended the PGlite-backed executor HTTP rerun test to record a verified
  identity through `/live-query-subscriptions/record`, rerun via
  `/maintenance/live-queries/rerun`, and assert the persisted subscription and
  durable delivery use the verified identity/fingerprint.
- Fixed the local executor HTTP runtime to pass subscription `identityJson` into
  the materialized artifact payload instead of materializing as anonymous.
- Added the new auth-config lookup method to the dev fake executor defaults so
  `flarex-dev` typecheck continues to exercise the full executor interface.

Convex references inspected:

- `npm-packages/convex/src/server/authentication.ts`
- `npm-packages/convex/src/browser/sync/authentication_manager.ts`
- `npm-packages/convex/src/browser/sync/client.ts`
- `crates/local_backend/src/subs/mod.rs`
- `crates/application/src/api.rs`
- `crates/application/src/application_function_runner/mod.rs`

Cloudflare difference:

- Convex keeps live subscriptions inside its database/subscription worker
  model. Flarex persists executor subscription identity as JSON and uses
  Durable Object delivery freshness checks, so the proof covers the explicit
  Worker/DO/executor boundaries.

Validation:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts --testNamePattern "verified Authenticate identity" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/executorHttpRuntime.test.ts --testNamePattern "local live-query materialization" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-dev exec vitest run test/executorHttpRuntime.test.ts --testNamePattern "PGlite-backed executor state" --testTimeout=120000 --hookTimeout=120000
git diff --check
```

Review gate:

- Required before commit because this proves authenticated live-query identity
  persistence and scheduler rerun behavior across backend and executor package
  boundaries.
- First-pass quality reviewer found the proof was split between backend route
  emission and fake stored subscription consumption. Fixed by extending the
  PGlite-backed executor HTTP runtime test to cover real record route,
  persistence, rerun, and delivery fingerprint behavior.
- Final TypeScript and quality re-reviews found no actionable findings.

### A-8: Deploy/Admin Identity Boundary

Status: complete.

Purpose:

Keep end-user bearer tokens scoped to application execution identity
(`ctx.auth`) and prevent them from mutating backend-owned provider config or
deployment state. Auth config changes must enter through deploy/admin push
credentials.

Files changed:

- `packages/flarex-backend/src/worker.ts`
- `packages/flarex-backend/src/worker/PublicAnalyzedStartAuthorization.ts`
- `packages/flarex-backend/test/artifactRuntimeRoute.test.ts`
- `packages/flarex-backend/test/executionDO.test.ts`
- `packages/flarex-backend/test/invoke.test.ts`
- `packages/flarex-backend/test/lifecycleFixture.ts`
- `packages/flarex-backend/test/publicAnalyzedStartAuthorization.test.ts`
- `packages/flarex-backend/test/push.test.ts`
- `packages/flarex-backend/test/sync.test.ts`
- `packages/flarex-dev/src/backendPush.ts`
- `packages/flarex-dev/src/dev.ts`
- `packages/flarex-dev/test/backendPush.test.ts`
- `packages/flarex-dev/test/backendSyncRuntime.test.ts`
- `packages/flarex-dev/test/runtimeMaterializer.test.ts`
- `roadmaps/33-auth-provider-platform.md`
- `roadmaps/34-auth-provider-platform-goals.md`

Exit criteria:

- Public Worker deploy-push mutations require deploy/admin credentials before
  body decoding.
- Valid end-user bearer JWTs are rejected for auth-config start/finish deploy
  mutations.
- Valid end-user bearer JWTs are rejected for every public deploy-push
  mutation route.
- Rejected end-user deploy attempts do not alter the active provider config.
- Local dev backend push still uses explicit deploy credentials and does not
  bypass the hosted Worker boundary.

What changed:

- Added `authorizePublicDeploymentPushMutationRequest(...)` as the generic
  deploy-push authorization entry point using the configured
  `FLAREX_ANALYZED_START_TOKEN` deploy token.
- Added `PublicDeploymentPushAuthorizationError` as the deploy-push-named error
  boundary while preserving the legacy `PublicAnalyzedStartAuthorizationError`
  Effect tag for compatibility. The deploy-push class has a private declared
  brand so the narrower route error type remains nominal in TypeScript.
- Routed public `push/start`, `push/start-analyzed`, `push/:pushId/finish`, and
  `push/:pushId/abandon` through that authorization boundary before body
  parsing or dispatch.
- Added a backend regression that activates an auth config, signs a real user
  JWT accepted by that config, then proves the user bearer token cannot call
  any public deploy-push mutation route and the active auth config is
  unchanged.
- Updated backend and dev test helpers to use deploy credentials for legitimate
  push mutations.
- Added deploy-push-named backend test credentials and a shared
  `deployPushJsonHeaders(...)` helper; the older analyzed-start constants
  remain aliases for compatibility only.
- Added an explicit local-dev deploy-push token used by
  `LocalBackendPushCoordinator` and bound into the local backend Miniflare.

Convex references inspected:

- `crates/model/src/auth/mod.rs`
- `crates/keybroker/src/broker.rs`
- `crates/local_backend/src/deploy_config2.rs`
- `crates/application/src/lib.rs`

Cloudflare difference:

- Convex uses admin/system identities and `DeploymentOp::Deploy` checks around
  auth config and deploy writes. Flarex currently models this as a configured
  Worker deploy-push bearer token; end-user JWTs remain execution identity only.

Validation:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/push.test.ts test/publicAnalyzedStartAuthorization.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendPush.test.ts test/dev.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```

Review gate:

- TypeScript and quality reviewers found issues in the first passes around
  optional local deploy credentials, incomplete route-matrix coverage,
  analyzed-start naming drift, and compatibility tagged-error behavior.
- All reviewer findings were fixed before commit; focused backend/dev
  validation and `git diff --check` passed afterward.

### A-9: Final Platform Audit

Status: complete.

Purpose:

Prove the full hosted auth-provider platform across package boundaries instead
of relying only on the focused slice tests.

Files changed:

- `apps/artifact-runtime/test/worker.test.ts`
- `packages/executor-http/test/http.test.ts`
- `packages/executor-nitro/test/health.test.ts`
- `packages/executor-nitro/test/helpers.ts`
- `packages/flarex-dev/src/executorHttpRuntime.ts`
- `packages/flarex-dev/src/sourcePackage.ts`
- `packages/flarex/test/registration.test.ts`
- `scripts/check-effect-boundaries.mjs`
- `roadmaps/33-auth-provider-platform.md`
- `roadmaps/34-auth-provider-platform-goals.md`

Exit criteria:

- Public SDK auth provider types are verified through `flarex/server`.
- Workspace-wide typecheck passes after all auth identity boundary changes.
- Broad auth, sync, backend, executor, persistence, dev, artifact-runtime,
  executor-http, and executor-nitro gates pass.
- Effect runtime boundary checker passes with audited auth-related Promise
  bridges and zero production `Effect.runSync` sites.
- Final limitations and follow-ups are recorded in the main roadmap.

What changed:

- Added a public SDK type regression for Convex-style `AuthConfig`,
  `AuthProvider`, OIDC provider, and custom-JWT provider imports from
  `flarex/server`.
- Fixed app artifact-runtime tests to include explicit anonymous
  `ExecutionIdentity` in invoke payloads, materialized payload assertions, and
  generated Dynamic Worker request bodies.
- Fixed executor HTTP/Nitro test fakes so they implement the required active
  auth-config executor API and persisted identity fields.
- Updated executor-http live-query delivery expectations to include identity
  fingerprints.
- Centralized dev auth-config decoding through `decodeAuthConfigPromise(...)`
  and added the remaining auth-related Promise bridges found by A-9 to the
  Effect boundary checker allowlist with exact site/count tracking.

Convex references inspected:

- `npm-packages/convex/src/server/authentication.ts`
- `npm-packages/convex/src/browser/sync/authentication_manager.ts`
- `crates/authentication/src/lib.rs`
- `crates/model/src/auth/types.rs`
- `crates/model/src/auth/mod.rs`
- `crates/application/src/api.rs`

Cloudflare difference:

- Flarex crosses explicit Worker, Durable Object, service-binding artifact
  runtime, Dynamic Worker, executor HTTP/Nitro, and Postgres package
  boundaries. The audit fixes the package-local test surfaces that still
  assumed implicit anonymous identity.

Final limitations and follow-ups:

- `FLAREX_ANALYZED_START_TOKEN` remains the deploy-push binding name for
  compatibility; rename with an alias window later.
- Dashboard/project owner auth and deploy key lifecycle are outside this stream.
- Proactive SDK token refresh scheduling can be added later on top of the
  current backend-verified `setAuth`/sync semantics.

Validation:

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

- Required before commit because this is the final audit checkpoint and it
  touches cross-package tests plus the Effect runtime boundary checker.
- TypeScript reviewer found no actionable findings.
- Maintainability reviewer found avoidable local auth-config decode
  `Effect.runPromise` bridges and pending-review status wording. Fixed by
  reusing the protocol `decodeAuthConfigPromise(...)`, removing the two local
  Effect-boundary allowlist entries, rerunning validation, and updating the
  roadmap statuses.
- Final re-review found a stale `Effect` import and roadmap accuracy issues.
  Fixed those and reran the affected gates plus the full workspace typecheck.

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

- [x] Provider config is backend-owned and decoded through Effect Schema.
- [x] Public SDK auth types stay Convex-compatible where practical.
- [x] Bearer tokens are never treated as identity without backend verification.
- [x] Invalid explicit auth attempts fail closed.
- [x] Sync and HTTP use the same token verification semantics.
- [x] Sync query reruns use verified Authenticate identity.
- [x] Live-query scheduler deliveries use the verified subscription identity.
- [x] Deploy/admin identity is separate from end-user `ctx.auth`.
- [x] Trusted dev/test identity remains explicitly env-gated.
- [x] Significant code slices pass reviewers.
