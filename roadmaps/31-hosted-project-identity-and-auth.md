# Hosted Project Identity And Auth

This roadmap tracks the next core implementation stream after the Effect
runtime-boundary cleanup: introduce a Convex-shaped identity path for hosted
Flarex without jumping straight into a full auth-provider platform.

## Current Diagnosis

The hosted runtime has a usable execution path, but identity is still not a
real platform concept:

- `packages/flarex-backend/src/project.ts` resolves `projectId` from
  `FLAREX_PROJECT_ID` or request bodies, but that is routing metadata, not user
  identity or project ownership.
- `@flarex/executor` validates deployment/project mismatches for trusted
  executor calls and stores user identity on invoke sessions.
- `packages/flarex-backend/src/artifactRuntime/GeneratedWorkerSource.ts`
  now emits `ctx.auth.getUserIdentity()` backed by executor session identity.
- Sync already has query-set versions, but it does not have Convex-style
  `Authenticate` handling or identity-version transitions.

The next implementation should make identity a typed execution input that
flows from public request or sync session to backend execution, trusted executor
session metadata, generated runtime `ctx.auth`, and live-query state.

## Convex References

Use Convex for semantics and compatibility targets:

- `npm-packages/convex/src/server/authentication.ts`
  - `UserIdentity` shape and `Auth.getUserIdentity(): Promise<UserIdentity | null>`.
- `npm-packages/convex/src/server/registration.ts`
  - query, mutation, and action contexts expose `ctx.auth`.
- `npm-packages/convex/src/browser/sync/protocol.ts`
  - `Authenticate`, `AuthError`, and identity version in sync state versions.
- `npm-packages/convex/src/browser/sync/local_state.ts`
  - client-side auth token changes bump identity version.
- `npm-packages/convex/src/browser/sync/authentication_manager.ts`
  - auth confirmation and refresh are client state, not user-function code.
- `crates/application/src/api.rs`
  - backend APIs receive an `Identity` and pass it into function execution.
- `crates/sync/src/state.rs`
  - sync state tracks current identity and identity version.
- `crates/sync/src/worker.rs`
  - auth changes revalidate identity and update query execution context.
- `crates/isolate/src/environment/udf/async_syscall.rs`
  - `getUserIdentity` returns the current transaction identity to user code.
- `crates/model/src/auth/mod.rs`
  - auth provider configuration is backend-owned deployment state.

## Flarex Difference

Flarex cannot copy Convex's integrated backend/auth stack directly:

- hosted user code runs in Cloudflare Dynamic Workers;
- the trusted executor may run behind HTTP/Nitro/Postgres;
- WebSocket sessions live in Cloudflare `ConnectionDO`;
- deployment metadata lives behind Cloudflare Workers, Durable Objects, R2, and
  service bindings;
- full JWT provider configuration and JWKS validation would be a product
  feature, not the first execution capability.

So v1 should copy the execution semantics, not the whole provider platform.

## Target V1 Semantics

### Public Developer Model

User code should be able to write:

```ts
const identity = await ctx.auth.getUserIdentity();
if (identity === null) {
  return null;
}
return identity.subject;
```

For queries, mutations, and actions, unauthenticated execution returns `null`
from `getUserIdentity()`. It should not throw merely because auth is not
configured.

### Identity Contract

Add a public identity type compatible with Convex's core shape:

```ts
export type UserIdentity = {
  readonly tokenIdentifier: string;
  readonly subject: string;
  readonly issuer: string;
  readonly name?: string;
  readonly givenName?: string;
  readonly familyName?: string;
  readonly nickname?: string;
  readonly preferredUsername?: string;
  readonly profileUrl?: string;
  readonly pictureUrl?: string;
  readonly email?: string;
  readonly emailVerified?: boolean;
  readonly phoneNumber?: string;
  readonly phoneNumberVerified?: boolean;
  readonly [claim: string]: Json | undefined;
};
```

Internal transport should carry:

```ts
type ExecutionIdentity =
  | { readonly kind: "anonymous" }
  | { readonly kind: "user"; readonly user: UserIdentity };
```

`UserIdentity` belongs in the public `flarex` package because generated
function contexts expose it. The transport schema belongs in
`flarex-protocol`, because backend, artifact runtime, executor HTTP, and dev
runtime all need to validate the same JSON boundary.

### Authority Boundary

V1 may accept a trusted dev/test identity header or internal identity payload,
but hosted production must not treat arbitrary client JSON as a verified user.

The first production-safe shape is:

```txt
public request / sync Authenticate
  -> backend auth resolver
  -> typed ExecutionIdentity
  -> internal artifact invoke payload
  -> trusted executor session metadata
  -> generated runtime ctx.auth.getUserIdentity()
```

Until real JWT provider validation exists, hosted public clients should only
get anonymous identity unless an explicitly configured trusted test/platform
identity mechanism is enabled.

## Implementation Slices

- [x] I-0. Create this concrete roadmap and the matching turn checklist.
- [x] I-1. Public and protocol identity contracts.
  - Add public `UserIdentity`, `UserIdentityAttributes`, and `Auth` types to
    `packages/flarex/src`.
  - Add `ExecutionIdentity` transport schemas and helpers to
    `packages/flarex-protocol`.
  - Update `QueryCtx`, `MutationCtx`, action context, and generated server
    typings to include `auth`.
  - Add tests for identity schema acceptance, custom claims, anonymous identity,
    and rejection of malformed identity JSON.
- [x] I-2. Backend identity resolver and invoke payload propagation.
  - Add a backend identity resolver that returns anonymous identity by default.
  - Add a trusted internal/dev identity input path for tests and local tooling,
    with explicit fail-closed production naming.
  - Extend artifact runtime invoke payloads with `ExecutionIdentity`.
  - Preserve capability-token and internal-token auth boundaries.
- [x] I-3. Trusted executor session identity.
  - Persist identity on invoke session metadata.
  - Return identity from begin/start session responses where generated runtime
    needs it.
  - Make executor project/deployment mismatch checks continue to run before
    identity reaches user code.
- [x] I-4. Generated runtime `ctx.auth`.
  - Replace hosted and local unsupported `ctx.auth.getUserIdentity()` stubs with
    a shared generated implementation returning the session identity.
  - Preserve unsupported `ctx.scheduler` and `ctx.storage` as explicit
    fail-closed capabilities.
  - Add local Miniflare and hosted artifact-runtime tests proving query and
    mutation functions can read identity.
- [x] I-5. HTTP client identity propagation.
  - Add SDK support for setting/clearing auth on one-shot query/mutation calls.
  - Send auth to backend as an authorization token or typed dev/test identity
    only through the configured resolver path.
  - Keep production JWT verification out of scope unless this slice explicitly
    adds the provider config.
- [ ] I-6. Sync auth behavior and identity version v1.
  - Wire existing `Authenticate` and `AuthError` message shapes to backend
    identity behavior.
  - Track identity version in `ConnectionDO`.
  - On identity change, conservatively rerun all active queries for that
    connection.
  - Add SDK `setAuth` / `clearAuth` or equivalent sync-client hooks.
- [ ] I-7. Auth-aware live-query metadata.
  - Store identity hash/version with live-query subscription rows where
    rerun/delivery needs to know the active user context.
  - Ensure executor reruns use the subscription identity, not the scheduler or
    maintenance caller identity.
  - Prove identity changes do not publish stale results from a previous user.
- [ ] I-8. Auth provider platform planning checkpoint.
  - Audit what remains for real JWT provider configuration, JWKS caching,
    token expiry, refresh behavior, deploy keys, admin identities, and
    dashboard/project ownership.
  - Decide whether to implement auth provider validation next or continue with
    scheduler/storage capabilities.

## Turn-By-Turn Protocol

Every implementation turn in this stream should follow this loop:

1. Read this file and
   `roadmaps/32-hosted-project-identity-and-auth-goals.md`.
2. Confirm the next unchecked item.
3. Inspect the listed Convex references for the specific slice before editing.
4. Keep the patch scoped to that slice unless validation or reviewers expose a
   required small fix.
5. Update both roadmap files with:
   - completed checkbox;
   - files changed;
   - previous completed checkpoint commit when known;
   - Convex references inspected;
   - Cloudflare differences;
   - validation commands.
6. Run focused validation for the affected packages plus `git diff --check`.
7. For significant code/test changes, run both standing reviewers:
   - `typescript-diff-reviewer`
   - `code-quality-diff-reviewer`
8. Fix valid findings in the main thread, rerun validation, and commit.

## Validation Matrix By Slice

Expected focused gates:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/artifact-runtime typecheck
corepack pnpm --filter @flarex/artifact-runtime test
git diff --check
```

Use narrower focused test files during individual turns, then broaden before
closing the stream.

## Non-Goals For V1

- Do not implement the full JWT/JWKS provider platform in the first slice.
- Do not add dashboard/team/user management.
- Do not add admin impersonation or deploy-key acting identities yet.
- Do not make `ctx.scheduler` or `ctx.storage` look implemented.
- Do not trust arbitrary client-provided identity JSON in hosted production.
- Do not bypass executor project/deployment ownership checks.
- Do not make identity a global mutable singleton in generated workers.

## Current Checkpoint

Previous completed checkpoint: `286ca1d` (`Implement generated runtime auth context`).

What changed:

- Added public `AuthTokenFetcher`.
- Added `FlarexClient.setAuth(fetchToken)` for one-shot HTTP query and explicit
  HTTP mutation invokes.
- Added `FlarexClient.clearAuth()` to return later HTTP invokes to anonymous.
- Added `FlarexClient.setTrustedExecutionIdentity(identity, token)` for
  explicitly configured dev/test trusted identity headers.
- Kept public invoke request bodies identity-free; auth is carried only in
  HTTP headers.
- Moved trusted identity header names into `flarex-protocol/auth-headers` and
  reused them from both the SDK and backend resolver.
- Cloned trusted identities when set so later caller mutation cannot alter
  emitted identity headers.
- Left WebSocket `Authenticate` and identity-version behavior for I-6.

Convex references inspected:

- `npm-packages/convex/src/browser/sync/client.ts`
- `npm-packages/convex/src/browser/sync/authentication_manager.ts`

Known limitations:

- Existing backend sync protocol has an `Authenticate` skeleton, but the public
  SDK sync protocol and identity changes are not yet wired to backend resolver
  or live-query reruns.
- Hosted production still defaults to anonymous identity until a real auth
  provider resolver is implemented.
- Bearer auth tokens are forwarded by the client, but JWT/JWKS verification is
  still a backend-owned future slice.
- Trusted identity headers are still an explicit dev/test resolver path guarded
  by backend opt-in and a shared secret token.

Verification:

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
