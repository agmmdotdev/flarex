# Hosted Project Identity And Auth

## Current Transaction-Grant Boundary

The hosted auth-provider platform is implemented: backend-owned JWT/JWKS
verification resolves configured bearer credentials into `ExecutionIdentity`
for HTTP, sync, generated `ctx.auth`, and live-query reruns. Authenticated user
identity is not transaction or commit authorization.

The bearer resolver verifies credential expiry and selects a configured
provider, but its returned `ExecutionIdentity` does not retain credential
expiry, matched-provider/config evidence, or a policy-minimized claim set.
O03-A must introduce an internal trusted `VerifiedAuthContext` (or equivalently
named non-public capability) that preserves only the verified authentication
facts required for policy evaluation and grant minting. It is never accepted
as caller JSON from a client, Dynamic Worker, SessionDO, or public executor
transport.

S07 provides only physical transaction-session columns for canonical grant
evidence: grant identity, checked object JSON, Value Codec V1 bytes, SHA-256,
expiry, and a copied nonnegative revocation epoch. It implements no production
grant minting, signature verification, key lifecycle, or commit-time
revalidation. Completed S07-A adds the sole current scope-revocation authority
and private storage primitives, but no trusted command or operational consumer.
The separate identity/access-policy SHA-256 is matching evidence only, and the
legacy FNV identity fingerprint is not replacement authorization.

### [ ] O03-A — Freeze Transaction-Grant Authority

Status: next unapproved gate after completed S07-A. No signed transaction grant,
trusted revocation command, or operational epoch comparison is implemented;
a separate evidence-backed O03-A implementation preflight is required before
its code changes.

Accepted direction:

- Define a versioned short-lived signed transaction grant binding trusted
  scope, mutation function and execution pins, policy version, bounded allowed
  operations/capabilities, explicitly minimized inert claims, canonical
  argument/request evidence, expiry, and the current scope authorization-
  revocation epoch.
- Derive the grant only from authoritative argument validation, trusted
  package/artifact/function/schema/policy pins, and an internal
  `VerifiedAuthContext`. `ExecutionIdentity`, its fingerprint, and a grant
  digest do not authorize an operation by themselves.
- Consume S07-A's coarse V1 `authorization_revocation_epoch` on the
  authoritative located data-plane scope clock. Admission, lease renewal, and
  final commit fail closed unless the copied grant/session value still equals
  the current scope value. A bump fences every earlier scope grant and attempt;
  V1 does not claim selective per-user or per-grant revocation.
- Bound grant expiry by originating credential expiry when present and by the
  configured grant/session lifetime. Anonymous and explicitly trusted dev/test
  inputs require separately named provenance and bounded expiry; they never
  masquerade as verified bearer credentials.
- Use no opaque per-grant database or premature per-policy epoch registry.
  S07 stores immutable evidence only; the O03-A preflight must decide whether
  that evidence includes the signed envelope, signature/key provenance, or a
  verified canonical projection after admission.

The following mechanics are deliberately unresolved until the O03-A preflight:

- signing algorithm and canonical signed-payload/envelope format;
- key generation, custody, rotation, overlap, revocation, and verifier lookup;
- exact trusted issuer/minting API and transport before Dynamic Worker code;
- grant-ID/replay semantics and anonymous/trusted-dev issuance;
- trusted increment authority and the control-to-data-plane command path over
  S07-A's private storage primitive;
- exact claim allowlist, sensitive-data retention, package exports, and Worker
  bindings.

O03-B owns session admission after O03-A. C04 verifies authority before
planning, and O06/O07 revalidate it in the final transaction that records the
committed outcome. No roadmap may claim production transaction-grant creation,
signature revalidation, or revocation before those gates pass.

## Accepted Rationale: Bind Sessions To Trusted Transaction Grants

Requirements:

- Required every compiler-backed attempt to use a short-lived signed
  transaction grant whose verified canonical evidence is copied into the
  Postgres session anchor and contains scope, function, validated canonical
  argument and request identity/evidence, authenticated inert claims/
  capabilities, policy version, expiry, and revocation epoch.
- Kept identity/access fingerprint for matching and cache keys, but stopped
  treating a fingerprint as enough information to authorize operations.
- Pinned policy semantics for the short grant lifetime unless its revocation
  epoch advances, which fences the attempt.
- Required trusted argument validation before execution and trusted return
  validation before mutation commit.

Rationale:

The SessionDO journal is untrusted transport. A fingerprint cannot evaluate
claim-based policy, and Worker-only validation cannot protect the authoritative
commit boundary. The trusted executor needs a verifiable grant, current
revocation authority, and pinned validators to prevent scope/function/policy
substitution.

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - trusted function execution and session-request outcome boundary.
- `npm-packages/convex/src/server/authentication.ts`
  - identity claims exposed to functions.

How Flarex differs:

- Flarex crosses Dynamic Worker, Durable Object, and Postgres boundaries, so
  authority must be explicit, short-lived, fenced, and revocable.

Current gaps:

- S07-A's current scope revocation storage and O03-A's grant schema,
  signing/verifier mechanism, claims minimization, trusted increment command,
  and key/evidence retention remain unimplemented.

The completed lower sections preserve the identity-plumbing design inputs that
preceded roadmap 33. Current provider authentication is implemented; the
remaining active concern in this file is the transaction-grant boundary above.

## Completed Identity-Plumbing Baseline

Typed execution identity now flows from backend-owned bearer verification or
an explicitly trusted dev/test boundary through artifact execution, executor
sessions, generated `ctx.auth`, sync identity versions, and durable live-query
reruns. Project/deployment routing metadata remains separate from end-user
identity, and deploy/admin identity remains a separate authority. This
completed plumbing is an input to O03-A; it is not itself a transaction grant.

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
- JWT/JWKS provider verification is implemented, but Flarex still needs an
  explicit transaction grant because authenticated identity crosses a split
  Dynamic Worker/executor/Postgres boundary.

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

Hosted public bearer identity is accepted only after the implemented configured
JWT/JWKS verifier succeeds. The explicit trusted test/platform identity path
remains separately env-gated and must not masquerade as bearer verification.

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
- [x] I-6. Sync auth behavior and identity version v1.
  - Wire existing `Authenticate` and `AuthError` message shapes to backend
    identity behavior.
  - Track identity version in `ConnectionDO`.
  - On identity change, conservatively rerun all active queries for that
    connection.
  - Add SDK `setAuth` / `clearAuth` or equivalent sync-client hooks.
- [x] I-7. Auth-aware live-query metadata.
  - Store identity hash/version with live-query subscription rows where
    rerun/delivery needs to know the active user context.
  - Ensure executor reruns use the subscription identity, not the scheduler or
    maintenance caller identity.
  - Prove identity changes do not publish stale results from a previous user.
- [x] I-8. Auth provider platform planning checkpoint.
  - Audit what remains for real JWT provider configuration, JWKS caching,
    token expiry, refresh behavior, deploy keys, admin identities, and
    dashboard/project ownership.
  - Decide whether to implement auth provider validation next or continue with
    scheduler/storage capabilities.

## Future Maintenance

The completed I-* identity stream must not be restarted from its historical
checklist. Future identity or transaction-grant work follows the repository
preflight and living-roadmap rules in `AGENTS.md`; do not append per-turn files,
validation receipts, reviewer receipts, or commit history here.

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

## Non-Goals For The Transaction-Grant Slice

- Do not rebuild or fork the completed JWT/JWKS provider platform.
- Do not add dashboard/team/user management.
- Do not add admin impersonation or deploy-key acting identities yet.
- Do not make `ctx.scheduler` or `ctx.storage` look implemented.
- Do not trust arbitrary client-provided identity JSON in hosted production.
- Do not bypass executor project/deployment ownership checks.
- Do not make identity a global mutable singleton in generated workers.

## Historical Identity-Stream Closure

Previous completed checkpoint: `89fb9e4` (`Add auth-aware live query metadata`).

What changed:

- Completed the final planning checkpoint for this identity stream.
- Confirmed the execution path is ready for real auth-provider work:
  `ctx.auth.getUserIdentity()` exists, identity reaches executor sessions, sync
  auth changes advance identity version, and live-query reruns carry stored
  subscription identity.
- At that checkpoint, the remaining production gap was backend-owned bearer-
  token verification. Roadmap 33 later completed that platform; O03-A now owns
  the separate transaction-grant gap.
- Created `roadmaps/33-auth-provider-platform.md` and
  `roadmaps/34-auth-provider-platform-goals.md` as the next concrete
  turn-by-turn stream.

Code findings:

- `packages/flarex/src/client.ts` already forwards `Authorization: Bearer ...`
  for HTTP and sends sync `Authenticate` messages from `setAuth(...)`.
- At that checkpoint `packages/flarex-backend/src/auth.ts` only resolved
  anonymous identity or explicit trusted dev/test headers. Roadmap 33 later
  added configured bearer JWT verification.
- `packages/flarex-backend/src/connectionDO.ts` handles `Authenticate` by
  bumping identity version and rerunning queries, but still sets anonymous
  identity.
- `packages/flarex-dev/src/sourcePackage.ts` and
  `packages/flarex/src/artifacts.ts` include only functions, schema, and
  execution in source package identity; no `auth.config` artifact exists.
- `packages/persistence-postgres/src/schema.ts` and
  `packages/persistence-postgres/src/deploymentPackages.ts` store deployment
  package metadata but no auth-provider config.
- `packages/flarex-backend/src/deployment/Validation.ts` validates source
  packages without an auth config field, so the backend would currently reject
  or drop auth config unless the contract is extended deliberately.

Decision:

- The next core stream is auth-provider platform validation, not scheduler or
  storage capability work. The public SDK auth surfaces now exist, but hosted
  production still cannot turn a bearer token into a non-anonymous
  `ExecutionIdentity`.
- The implementation must keep trusted identity as a dev/test escape hatch and
  make bearer-token identity backend-owned and fail-closed.

Convex references inspected:

- `npm-packages/convex/src/server/authentication.ts`
- `npm-packages/convex/src/browser/sync/authentication_manager.ts`
- `crates/authentication/src/lib.rs`
- `crates/model/src/auth/types.rs`
- `crates/model/src/auth/mod.rs`
- `crates/application/src/api.rs`

Known limitations after this stream:

- WebSocket `Authenticate` advances identity version and reruns queries, but
  bearer tokens are still anonymous until `roadmaps/33-auth-provider-platform.md`
  is implemented.
- `setAuth(...)` currently sends tokens before the backend has provider config,
  validation, JWKS cache, or token-expiry semantics.
- There is still no deploy/admin identity model for updating auth provider
  config. That must remain separate from end-user `ctx.auth` identity.

Verification:

```sh
git diff --check
```

Reviewer checkpoint:

- Main-thread review only. This checkpoint is docs/planning; no code, tests, or
  public contracts changed.
