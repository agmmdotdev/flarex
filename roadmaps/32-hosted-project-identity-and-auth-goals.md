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
- [x] G-3. Complete I-2: backend identity resolver and invoke payload propagation.
- [x] G-4. Complete I-3: trusted executor session identity.
- [x] G-5. Complete I-4: generated runtime `ctx.auth`.
- [x] G-6. Complete I-5: HTTP client identity propagation.
- [x] G-7. Complete I-6: sync auth behavior and identity version v1.
- [x] G-8. Complete I-7: auth-aware live-query metadata.
- [x] G-9. Complete I-8: auth provider platform planning checkpoint.

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

Status: complete.

Purpose:

Thread the newly defined `ExecutionIdentity` from trusted backend boundaries
into artifact runtime invoke payloads while keeping hosted production
anonymous until a backend-owned resolver validates identity.

Files changed:

- `packages/flarex-backend/src/auth.ts`
- `packages/flarex-backend/src/types.ts`
- `packages/flarex-backend/src/worker.ts`
- `packages/flarex-backend/src/artifactRuntime.ts`
- `packages/flarex-backend/src/artifactRuntime/HostKit.ts`
- `packages/flarex-backend/src/artifactRuntime/RuntimeRoute.ts`
- `packages/flarex-protocol/src/artifact-runtime.ts`
- backend and protocol tests covering resolver and artifact-runtime identity
  payloads
- both roadmap files

Initial constraints:

- Anonymous identity is the default.
- Hosted production must not trust arbitrary client identity JSON.
- Capability-token and internal-token checks must remain before identity
  reaches executor/user code.

Completed this turn:

- Added backend `resolveExecutionIdentityEffect`, returning anonymous identity
  by default.
- Added a fail-closed trusted header path guarded by
  `FLAREX_TRUSTED_EXECUTION_IDENTITY=true` plus a matching
  `FLAREX_TRUSTED_EXECUTION_IDENTITY_TOKEN` shared secret for local/test
  tooling.
- Kept public invoke request bodies from becoming identity input.
- Extended execution artifact invoke payloads with required
  `ExecutionIdentity`, defaulting builder-created payloads to anonymous.
- Propagated resolved identity from public worker `/invoke` to the internal
  service-binding artifact runtime payload.
- Preserved artifact runtime capability-token and artifact header checks.

Cloudflare difference:

- This is not JWT/JWKS auth. Hosted production remains anonymous unless a
  backend-owned resolver explicitly verifies identity in a later slice.
- The trusted identity header is deliberately named and env-gated so public
  client JSON is not trusted by default.
- Even when the trusted path is enabled, the request must supply the matching
  trusted identity token header before identity JSON is decoded.

Validation:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test -- artifact-runtime.test.ts
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/auth.test.ts test/artifactRuntime.test.ts test/artifactRuntimeRequests.test.ts test/artifactRuntimeRouteBoundary.test.ts test/invokeRequests.test.ts test/artifactRuntimeRoute.test.ts test/hostedRuntimeCore.test.ts
```

Reviewer gate:

- `typescript-diff-reviewer`: fixed duplicate identity guard and test env cast
  findings.
- `code-quality-diff-reviewer`: fixed trusted identity public-boundary finding
  by requiring a shared secret token, and added route-level artifact runtime
  identity assertions.

### G-4 / I-3: Trusted Executor Session Identity

Status: complete.

Purpose:

Persist the propagated `ExecutionIdentity` into trusted executor invoke
sessions, so generated runtime code can later answer
`ctx.auth.getUserIdentity()` from session metadata.

Initial constraints:

- Keep deployment/project mismatch checks before identity reaches user code.
- Keep anonymous identity as the default for existing executor callers.
- Do not implement generated runtime `ctx.auth` until I-4.

Files changed:

- `packages/persistence-postgres/src/schema.ts`
- `packages/persistence-postgres/src/invokeSessions.ts`
- `packages/persistence-postgres/drizzle/0015_silent_hercules.sql`
- `packages/executor/src/types.ts`
- `packages/executor/src/sessions.ts`
- `packages/executor-http/src/requestDecoders.ts`
- `packages/flarex-backend/src/artifactRuntime/GeneratedWorkerSource.ts`
- `packages/executor/test/sessions.test.ts`
- `packages/executor-http/test/http.test.ts`
- `packages/flarex-dev/test/runtimeMaterializer.test.ts`

Completed:

- Added `identity_json` to invoke session metadata with anonymous DB and
  insertion defaults for existing callers.
- Added optional `identity` to `BeginInvokeSessionInput` and required
  `identity` on `BeginInvokeSessionResult`.
- Persisted explicit user identities and returned the session identity from
  executor start.
- Decoded optional `/invoke/start` identity through the shared
  `ExecutionIdentity` Effect Schema path.
- Forwarded execution artifact payload identity from generated workers to the
  postgres executor `/invoke/start` route.
- Kept public generated-worker `/invoke` request-body identity ignored, so
  public callers cannot spoof session identity.
- Rejected direct executor HTTP identity unless a capability token is
  configured and supplied.

Cloudflare difference:

- Hosted production still only gets non-anonymous identities through the
  backend-owned trusted resolver path from I-2. Direct executor HTTP identity
  remains an internal/capability-token route, not a public client contract.

Validation:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/pglite.test.ts
corepack pnpm --filter @flarex/executor exec vitest run test/sessions.test.ts test/postgresRetry.test.ts
corepack pnpm --filter @flarex/executor-http exec vitest run test/http.test.ts
corepack pnpm --filter flarex-backend exec vitest run test/artifactRuntime.test.ts test/artifactRuntimeRoute.test.ts test/artifactRuntimeRequests.test.ts
corepack pnpm --filter flarex-dev exec vitest run test/runtimeMaterializer.test.ts test/generate.test.ts
git diff --check
```

Reviewer checkpoint:

- `typescript-diff-reviewer`: no findings.
- `code-quality-diff-reviewer`: fixed public generated-worker identity spoof
  risk, direct executor HTTP identity capability-token requirement, and PGlite
  identity default/round-trip coverage.

Next:

- G-8 / I-7: auth-aware live-query metadata.

## Later Slices

### G-5 / I-4: Generated Runtime `ctx.auth`

Status: complete.

Purpose:

Make generated runtime contexts expose Convex-shaped
`ctx.auth.getUserIdentity()` from executor session identity, while keeping
unsupported capabilities explicit and fail-closed.

Previous completed checkpoint:

- `08e5181` (`Persist invoke session identity`)

Files changed:

- `packages/flarex-backend/src/artifactRuntime.ts`
- `packages/flarex-backend/src/artifactRuntime/GeneratedWorkerSource.ts`
- `packages/flarex-dev/src/runtimeMaterializer.ts`
- `packages/flarex-dev/test/executorHttpRuntime.test.ts`
- `packages/flarex-dev/test/runtimeMaterializer.test.ts`
- `packages/flarex-dev/test/generate.test.ts`
- both roadmap files

Completed:

- Added required identity to materialized query-session requests.
- Threaded live-query attempt session identity into generated artifact
  query-session execution.
- Replaced generated `ctx.auth.getUserIdentity()` unsupported stubs with an
  identity-backed implementation for local artifact workers and generated
  hosted project workers.
- Preserved unsupported `ctx.scheduler` and `ctx.storage` fail-closed
  capability stubs.
- Added Miniflare materializer tests for query and mutation identity reads.
- Added a live-query rerun test proving existing session identity reaches
  `ctx.auth`.
- Added a generated project-worker test proving backend start-response identity
  reaches user query and mutation handlers.
- Tightened generated identity validation to match the protocol user identity
  shape before user code can observe it.
- Made query-session identity required at the typed artifact runtime boundary.
- Added anonymous and malformed identity regression tests.

Convex references inspected:

- `npm-packages/convex/src/server/authentication.ts`
- `crates/isolate/src/environment/udf/async_syscall.rs`

Cloudflare difference:

- Generated workers use executor session identity as the authority source. They
  still ignore public request-body identity unless a backend-owned resolver
  placed verified identity into the session start response.

Validation:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/runtimeMaterializer.test.ts test/generate.test.ts test/executorHttpRuntime.test.ts
corepack pnpm --filter flarex-backend exec vitest run test/artifactRuntime.test.ts test/artifactRuntimeRoute.test.ts test/artifactRuntimeRequests.test.ts
git diff --check
```

Reviewer checkpoint:

- `typescript-diff-reviewer`: fixed generated identity guard and required
  query-session identity findings.
- `code-quality-diff-reviewer`: fixed generated identity guard and added
  anonymous/malformed identity coverage.

### G-6 / I-5: HTTP Client Identity Propagation

Status: complete.

Purpose:

Add a one-shot HTTP client auth surface that can send bearer auth tokens or
explicit dev/test trusted identities through headers while preserving anonymous
execution and keeping identity out of public invoke JSON bodies.

Previous completed checkpoint:

- `286ca1d` (`Implement generated runtime auth context`)

Files changed:

- `packages/flarex/src/client.ts`
- `packages/flarex/test/client.test.ts`
- `packages/flarex/package.json`
- `packages/flarex-protocol/src/auth-headers.ts`
- `packages/flarex-protocol/src/index.ts`
- `packages/flarex-protocol/package.json`
- `packages/flarex-backend/src/auth.ts`
- `pnpm-lock.yaml`
- both roadmap files

Completed:

- Added public `AuthTokenFetcher`.
- Added `FlarexClient.setAuth(fetchToken)` for one-shot HTTP query and explicit
  HTTP mutation invokes.
- Added `FlarexClient.clearAuth()` to return later HTTP invokes to anonymous.
- Added `FlarexClient.setTrustedExecutionIdentity(identity, token)` for
  explicitly configured dev/test trusted identity headers.
- Kept production JWT/provider verification out of scope.
- Kept public invoke request bodies identity-free; auth is carried only in
  HTTP headers.
- Moved trusted identity header names into `flarex-protocol/auth-headers` and
  reused them from both the SDK and backend resolver.
- Cloned trusted identities when set so later caller mutation cannot alter
  emitted identity headers.
- Left WebSocket `Authenticate` and identity-version behavior for G-7/I-6.

Convex references inspected:

- `npm-packages/convex/src/browser/sync/client.ts`
- `npm-packages/convex/src/browser/sync/authentication_manager.ts`

Cloudflare difference:

- Bearer tokens are forwarded for backend-owned resolver support, but this
  slice does not implement JWT/JWKS validation.
- Trusted identity remains an explicit dev/test path that only works when the
  backend deployment has opted into the matching trusted resolver token.

Validation:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test -- client.test.ts
git diff --check
```

Reviewer checkpoint:

- `typescript-diff-reviewer`: no findings.
- `code-quality-diff-reviewer`: fixed HTTP-only `setAuth` documentation,
  protocol-owned trusted identity header constants, and sync roadmap wording.

### G-7 / I-6: Sync Auth Behavior And Identity Version V1

Status: complete.

Purpose:

Add Convex-style sync auth messages to the public SDK and make backend
connection state advance identity versions and rerun active queries whenever
the connection's auth state changes.

Previous completed checkpoint:

- `de908b7` (`Add HTTP client auth propagation`)

Files changed:

- `packages/flarex/src/sync/protocol.ts`
- `packages/flarex/src/sync/localState.ts`
- `packages/flarex/src/sync/baseClient.ts`
- `packages/flarex/src/client.ts`
- `packages/flarex/test/client.test.ts`
- `packages/flarex-backend/src/connectionDO.ts`
- `packages/flarex-backend/test/sync.test.ts`
- both roadmap files

Completed:

- Added public SDK sync `Authenticate` messages for `User` tokens and `None`.
- Added client-side identity-version ownership to `LocalSyncState`.
- Wired `FlarexClient.setAuth(fetchToken)` and `clearAuth()` into existing
  sync clients and clients created after auth is already set.
- Kept trusted execution identity as an HTTP-only dev/test path for now and
  cleared sync auth when callers switch to that mode.
- Passed the connection execution identity through sync query and mutation
  invokes.
- Made `ConnectionDO` advance identity version for `Authenticate` and rerun all
  active queries under the new version.
- Added client wire tests for `Authenticate` and backend sync tests proving
  identity-version transitions rerun active queries.

Convex references inspected:

- `npm-packages/convex/src/browser/sync/protocol.ts`
- `npm-packages/convex/src/browser/sync/local_state.ts`
- `npm-packages/convex/src/browser/sync/authentication_manager.ts`
- `npm-packages/convex/src/browser/sync/client.ts`

Cloudflare difference:

- This slice establishes protocol and version semantics, but it does not verify
  bearer tokens. Until a backend-owned JWT/JWKS resolver exists, WebSocket
  `Authenticate` changes the identity version and reruns queries without
  granting a non-anonymous hosted execution identity.
- Durable subscription metadata was still not auth-aware in this slice; it was
  completed later in G-8/I-7.

Validation:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test -- client.test.ts
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t Authenticate
git diff --check
```

Reviewer checkpoint:

- `typescript-diff-reviewer`: no findings.
- `code-quality-diff-reviewer`: fixed stale-auth `AuthError` handling and
  async sync-auth refresh race findings with focused tests.

### G-8 / I-7: Auth-Aware Live-Query Metadata

Status: complete.

Purpose:

Make durable live-query subscriptions and delivery payloads identity-aware so
executor reruns run under the subscription identity and ConnectionDO cannot
apply a delivery generated for a different user context.

Previous completed checkpoint:

- `1026682` (`Add sync auth identity version handling`)

Files changed:

- `packages/persistence-postgres/src/schema.ts`
- `packages/persistence-postgres/src/liveQuerySubscriptions.ts`
- `packages/persistence-postgres/src/liveQueryConnections.ts`
- `packages/persistence-postgres/drizzle/0016_volatile_kang.sql`
- `packages/persistence-postgres/drizzle/meta/_journal.json`
- `packages/persistence-postgres/drizzle/meta/0016_snapshot.json`
- `packages/executor/src/types.ts`
- `packages/executor/src/liveQueries.ts`
- `packages/executor-http/src/requestDecoders.ts`
- `packages/flarex-protocol/src/auth.ts`
- `packages/flarex-protocol/src/live-query.ts`
- `packages/flarex/src/sync/delivery.ts`
- `packages/flarex-backend/src/connectionDO.ts`
- focused protocol, persistence, executor, executor-http, and backend sync tests
- both roadmap files

Completed:

- Added `identity_json` to live-query subscription rows with anonymous defaults.
- Propagated the active `ConnectionDO` execution identity when registering
  executor-backed live-query subscriptions.
- Made executor stale-rerun scans list subscription identity and invoke reruns
  with that stored identity, not the scheduler/maintenance caller identity.
- Added shared `executionIdentityFingerprint` in `flarex-protocol/auth`.
- Added normalized `identityFingerprint` to live-query delivery payloads while
  defaulting missing pre-upgrade delivery payloads to anonymous at the decode
  boundary.
- Made executor-generated update and failure deliveries carry the subscription
  identity fingerprint.
- Made `ConnectionDO` record the identity fingerprint used for each active query
  result, mark active queries with the new identity before auth-change reruns,
  and skip delivery payloads whose fingerprint no longer matches.
- Added a backend sync regression proving a delivery with a matching result hash
  but different identity fingerprint is treated as stale and does not publish.

Cloudflare difference:

- This stores and compares the trusted execution identity currently available to
  Flarex. It still does not verify bearer tokens; hosted sync auth remains
  anonymous until the backend-owned auth-provider resolver exists.
- The fingerprint is a delivery guard, not a replacement for the stored
  `identity_json` used by executor reruns.

Validation:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test -- live-query.test.ts auth.test.ts connection.test.ts
corepack pnpm --filter flarex typecheck
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/pglite.test.ts -t "live query subscriptions"
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor exec vitest run test/liveQueries.test.ts -t "live query"
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http exec vitest run test/http.test.ts -t "live query subscription|changed live query reruns|backend delivery wake"
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "different identity"
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "delivery"
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "subscriptions"
git diff --check
```

Reviewer checkpoint:

- `typescript-diff-reviewer`: fixed duplicated live-query delivery SDK types by
  re-exporting the protocol-owned delivery types from `flarex`.
- `code-quality-diff-reviewer`: fixed raw identity leakage by making
  `executionIdentityFingerprint` opaque, added pre-upgrade anonymous delivery
  compatibility, and closed the auth-transition stale-delivery race by marking
  active query guards before awaited reruns.

### G-9 / I-8: Auth Provider Platform Planning Checkpoint

Status: complete.

Purpose:

Decide whether the next core stream is real auth-provider validation or a
different capability after the identity plumbing work.

Files changed:

- `roadmaps/31-hosted-project-identity-and-auth.md`
- `roadmaps/32-hosted-project-identity-and-auth-goals.md`
- `roadmaps/33-auth-provider-platform.md`
- `roadmaps/34-auth-provider-platform-goals.md`

Completed:

- Audited current SDK, backend auth, sync `Authenticate`, source-package,
  artifact identity, deployment validation, and persistence metadata surfaces.
- Confirmed bearer-token SDK surfaces already exist but hosted backend
  verification does not.
- Decided the next stream is auth-provider platform validation, because
  `ctx.auth` is wired but still cannot become a verified hosted production user.
- Created the concrete auth-provider platform roadmap and executable goal
  checklist.

Convex references inspected:

- `npm-packages/convex/src/server/authentication.ts`
- `npm-packages/convex/src/browser/sync/authentication_manager.ts`
- `crates/authentication/src/lib.rs`
- `crates/model/src/auth/types.rs`
- `crates/model/src/auth/mod.rs`
- `crates/application/src/api.rs`

Next stream:

- `roadmaps/33-auth-provider-platform.md`
- `roadmaps/34-auth-provider-platform-goals.md`

Validation:

```sh
git diff --check
```

Reviewer checkpoint:

- Main-thread review only. This was a docs-only planning slice.

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

- [x] `ctx.auth.getUserIdentity()` returns `UserIdentity | null`, not a
  generic unsupported runtime error.
- [x] Anonymous execution remains supported.
- [x] Hosted production does not trust arbitrary client identity JSON.
- [x] Project/deployment mismatch checks run before identity reaches user code.
- [x] Identity transport contracts are decoded through Effect Schema.
- [x] Public SDK types remain Convex-compatible where practical.
- [x] Sync identity changes advance identity version and rerun affected query
  state conservatively.
- [x] Scheduler/rerun paths use subscription identity, not scheduler identity.
- [x] Significant code slices pass reviewers.

## Completed Checkpoints

- `6c9ce28` (`Enforce Effect runtime boundaries`) completed the previous
  runtime-boundary cleanup before this stream began.
