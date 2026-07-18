# FlarexDB OCC And Transaction Plan

Status: private non-routing `O02` snapshot resolution and S07's physical
session/snapshot-lease authority are complete; standalone `O01` retired before
implementation; schema-owned `S07-A` scope-revocation storage is complete. The
former `O03` is split into complete `O03-A` grant authority and active `O03-B`
session authority. Protocol-only `O03-A1` is complete. `O03-A2` is an
accepted three-checkpoint authority-integration sequence: `O03-A2a` and
host-neutral authority checkpoint `O03-A2b` are complete. `O03-A2c` is complete
as exactly two private boundaries: located-current-epoch admission and
schema-neutral two-sided point-mutation preparation. Operational revocation and
hosted Worker/key adapters are deferred to their first real consumers. O03-B1
activation, O03-B2a restart-safe exact-running reload, and O03-B2b1 exact abort/expiry
terminalization complete the required O03-B authority core. O04's private
exact-snapshot point-read semantics and dependencies are complete; O05 pure
point-OCC validation is also complete. Standalone C01 was retired before
implementation; C02's inert logical protocol, C03's trusted point journal, and
C04A's private stored-attempt authentication and C04B1's private current
commit-authority authentication and C04B2's private-C07 final-value proof are
complete. Corrected C04C1 private logical point planning and O06's reusable
rollback-proven point-commit transaction kernel, O07-A private read-only
committed-outcome resolver, and O07-B private durable point publication are
complete. C05-A's exact scalar-fenced finishing transition and C05-B's separate
fresh-process finishing reconstruction/private publisher composition are
complete. O08-A atomic exact-attempt replacement and O08-B1's bounded
same-factory fresh-attempt handoff are complete; O08-B2 trusted user-code rerun
composition is next, while O08-C known-settled SQL retry and O08-D uncertain-outcome
policy remain pending. C04C2
remains conditional and unapproved.
O03-B2b2 renewal/race proof is a conditional
operational extension that requires a proven long-running-attempt consumer; it
does not block the private C02-C07 proof.

This plan owns exact snapshots, typed read dependencies, conflict validation,
the short scope-local commit lane, result-bearing idempotency, retry classes,
retention floors, target generation activation fencing, prototype OCC
retirement, and conditional live-migration safety.

It consumes physical tables from
[01-schema-and-migrations.md](./01-schema-and-migrations.md) and supplies the
trusted transaction primitive used by
[03-commit-compiler.md](./03-commit-compiler.md).

Hosted production execution uses a dedicated private Cloudflare executor
Worker and a request-scoped Postgres client through cache-disabled Hyperdrive.
This changes the host, not OCC semantics: the executor still holds no SQL
transaction while untrusted user code runs, and only the short final trusted
commit lane owns locks and publication. The existing `/invoke/*` Fetch
protocol remains the first private service-binding adapter; Nitro/Vercel is an
optional compatibility lane.

## Authoritative Inputs

- [Accepted snapshot, idempotency, and retry rules](../../design-notes/flarex-db-accepted-design.md)
- [V1 schema/OCC cutline](../../design-notes/flarex-commerce-cms-v1-schema-cutline.md)
- [Long-form OCC and transaction tables](../../design-notes/flarex-internal-db-schema.md)
- [OCC domain history](../03-occ-and-transactions.md)
- [Trusted executor boundary](../20-postgres-executor.md)
- [Commit compiler/session boundary](../35-commit-compiler-and-session-intent.md)

Current implementation evidence:

- [`packages/executor/src/sessions.ts`](../../packages/executor/src/sessions.ts)
  uses wall-clock `beginTs` and Postgres staging.
- [`packages/executor/src/retry.ts`](../../packages/executor/src/retry.ts)
  currently combines OCC and SQL serialization into one full-attempt retry and
  does not yet model deadlock or uncertain-decision recovery correctly.
- [`packages/persistence-postgres/src/commits.ts`](../../packages/persistence-postgres/src/commits.ts)
  is the legacy all-in-one commit path.

Convex-first implementation references:

- [`crates/database/src/reads.rs`](../../../../crates/database/src/reads.rs)
  records present, missing, and range reads and checks overlapping writes;
- [`crates/database/src/transaction.rs`](../../../../crates/database/src/transaction.rs)
  provides exact begin-snapshot and read-your-writes semantics;
- [`crates/database/src/committer.rs`](../../../../crates/database/src/committer.rs)
  validates reads before ordered publication and accounts for pending writes;
- [`crates/model/src/session_requests/types.rs`](../../../../crates/model/src/session_requests/types.rs)
  stores successful mutation outcomes durably;
- [`crates/application/src/application_function_runner/mod.rs`](../../../../crates/application/src/application_function_runner/mod.rs)
  checks prior outcomes before execution and stores results atomically.

## Fixed OCC Invariants

- The authoritative token is exactly
  `SnapshotToken { scopeId, epoch, commitSeq }`.
- A new FlarexDB session never uses wall-clock time as its snapshot. Legacy
  `beginTs/readTs` remains private to the legacy adapter during coexistence.
- Snapshot creation reads the current scope clock. A commit locks that clock,
  validates the token epoch/fence and dependencies, then allocates
  `lastCommitSeq + 1` inside the same transaction.
- Rollback consumes no sequence. The scope commit feed is dense and contiguous.
- Epoch is a fence, not a row-visibility predicate. Exact reads include the
  newest revision at or before `commitSeq` even if that revision was written in
  an older epoch.
- Missing rows are dependencies. Inserting a row after a transaction observed
  it missing is a conflict when that absence affected the result.
- All authoritative writers participate in the same scope commit lane or a
  formally equivalent serializable/fenced protocol. Backfills, repairs,
  Payload, and Medusa do not bypass it.
- User code, hooks, workflows, network calls, and long actions never run while
  a Postgres transaction or scope-clock row lock is open.
- Exactly one storage generation is authoritative for a scope. Active attempts
  are pinned and cannot cross a cutover.

## Typed Dependency Baseline

Dependency types are introduced just in time by the gates that can prove their
semantics. Completed `O04` owns present and qualified-missing point
dependencies, `O10` owns index
ranges, and relation gates own edge ranges after stable relation identity is
accepted. A conservative table-version fence is added only if its consuming
gate demonstrates that it is necessary. Do not predeclare unsupported variants
or allocate a second row-version authority beside `CommitSeq`.

## Turn Checklist

### O01 — Retired Before Implementation

The standalone contract-and-port extraction gate was premature. It duplicated
the existing `ScopeClockReader`/trusted authority resolver and guessed session,
row, commit, outcome, and feed contracts before their consumers and physical
stores existed. Its immediately necessary seam was folded into `O02`.

Introduce later contracts only at their real owners: row revisions at `S06`,
current revocation storage at `S07-A`, grant semantics at `O03-A`, initial
session authority at `S07`/`O03-B`, point dependencies at `O04`, point conflict
decisions at `O05`, commit/feed capabilities at `S08`/`O06`, and committed
outcomes at `S09-A`/`O07-B`. A row revision derives from `CommitSeq`; it never owns
another sequence. The legacy adapter never treats wall-clock `ts` as a
replacement commit sequence.

### [x] O02 — Resolve Current App-Data Snapshots

Outcome:

- Bind one private `AppDataSnapshotResolver` to trusted construction-time
  authority readers. Request code supplies only an already-authorized
  deployment identity; no public route or user code receives this capability.
- Control metadata locates the data plane. One read of the located data-plane
  scope clock supplies the exact `SnapshotToken { scopeId, epoch, commitSeq }`,
  `storageGeneration`, and `storageGenerationFence` together.
- Treat the result as an ephemeral selection, not a durable pin or commit
  authorization. `S07-A` owns current revocation storage, `O03-A` owns signed-
  grant semantics, `O03-B` owns initial session/package/schema/policy binding
  and the current lease, and `O06`/`O07-B` own final transactional revalidation.
- Leave legacy `beginTs` and production storage-generation routing unchanged.

Exit gate:

- empty scope returns sequence `0`;
- two scopes have independent tokens;
- trusted placement/clock failures retain typed fail-closed resolution;
- exact bigint sequences survive PGlite and real-Postgres resolution;
- the resolver and nested token are immutable snapshots of one clock read;
- no code aliases legacy `ts` to the dense `commitSeq`.

### [x] O03-A — Establish Transaction-Grant Authority

Status: approved parent gate after its evidence-backed preflight. The preflight
split protocol/evidence freezing from private authority integration because
each trust, transaction, and recovery boundary needs independent proof. Its A1,
A2a, A2b, and corrected two-boundary A2c checkpoints are complete without
adding a new product capability or changing the transaction-grant format.

Outcome:

- Define one strict versioned, self-contained signed transaction grant whose
  domain-separated canonical evidence binds deployment and scope,
  package/artifact/source/function/schema/policy pins, canonical argument and
  request identity/evidence, the bounded point-mutation capabilities, minimized
  inert claims, issue/expiry times, and revocation epoch. Signature verification
  proves provenance; canonical bytes or their digest alone never authorize.
- Introduce an internal `VerifiedAuthContext` at the trusted backend boundary.
  It retains credential expiry and authenticated-provider evidence after JWT/
  OIDC verification, and applies an explicit claim allowlist before grant
  issuance. Policy version/capabilities come from separate trusted policy/
  catalog authority. When the originating credential has an expiry, grant
  expiry may not exceed it; every grant is also bounded by the configured
  platform/session lifetime. Do not copy a broad `ExecutionIdentity` or
  arbitrary custom claims into the grant.
- Consume S07-A's nonnegative scope-wide current revocation authority. V1
  deliberately invalidates all outstanding grants for the scope when this
  counter advances; do not invent a per-policy registry or per-grant
  persistence lifecycle before either has a real consumer.
- Keep issuer key custody at a trusted backend/platform boundary and expose
  only verification/key-resolution capability to the trusted executor. O03-A1
  fixes the wire algorithm to strict Ed25519 flattened JWS and O03-A2b freezes
  host-neutral key rotation/disablement. Hosted-production custody wiring owns
  Worker secret and binding adapters; no minting secret may enter an artifact
  or Dynamic Worker.
- Reuse the completed JWT/JWKS provider platform as upstream authentication.
  This gate creates transaction authorization, not another auth-provider,
  dashboard-owner, refresh-token, per-user revocation, or general app-policy
  platform.

#### [x] O03-A1 — Freeze Inert Grant Protocol And Evidence

Status: complete as an inert protocol/canonical-evidence checkpoint only. It
creates no production signing, verification, policy, or revocation authority.

Outcome:

- Add only the explicit `flarex-protocol/transaction-grant` subpath, without a
  package-root, SDK, server, executor, or Worker-app re-export.
- Define one strict flattened JWS object containing exactly `protected`,
  `payload`, and `signature`. Its canonical protected header fixes
  `alg: "Ed25519"`, `typ: "flarex-transaction-grant+jws"`, and a bounded local
  key ID. Reject the deprecated polymorphic `EdDSA` name, caller-selected
  algorithms, unprotected headers, compact/general JWS, detached payloads,
  `crit`, `b64: false`, unknown fields, padding, and noncanonical Base64url.
- Encode the signed payload as exact Value Codec V1 canonical bytes. Bind the
  logical deployment/scope, package/artifact/source/module/function/schema/
  policy pins, validated-argument hash, internal request key/hash, a signed
  opaque grant ID, closed point-operation capabilities, explicitly inert auth
  evidence, issue/expiry times, and S07-A revocation epoch. Do not duplicate
  the physical scope UUID, full validated arguments, session state, storage
  fence, snapshot token, or attempt state inside the grant.
- Limit a complete grant to 64 KiB with smaller field/collection limits. The
  512-byte protected-header, 48,000-byte canonical-payload, and fixed 64-byte
  signature limits imply a 64,869-byte maximum canonical envelope before the
  independent 65,536-byte defense-in-depth check. The grant ID is correlation
  evidence, not a one-time nonce: exact signed-request
  replay is a retry until expiry or epoch invalidation, while any changed
  authority-bearing field is a different request and must fail later trusted
  verification.
- Produce only inert canonical evidence compatible with S07's existing grant
  columns. No unsigned object, canonical bytes, grant digest, identity/policy
  digest, or decoder result is a verified transaction capability.
- Keep raw wire schemas explicitly unverified. Only strict inner decoding may
  assign canonical segment/JWS brands, and authority-bearing identity/policy,
  validated-argument, and request hashes remain distinct nominal types.
- Require the complete payload, including nested claim keys and strings, to be
  encodable by Value Codec V1. Deep-freeze parsed object/array projections and
  return defensive byte copies so redundant inert evidence cannot diverge
  after derivation.

Exit gate:

- fixed non-production Ed25519 vectors pin the protected header, payload,
  signing input, 64-byte signature, full envelope, canonical envelope evidence,
  and SHA-256;
- Node and pinned Miniflare/workerd WebCrypto verify the same vector;
- strict decoding rejects malformed/unsupported JWS shapes, noncanonical
  encodings, extra or missing fields, invalid pins/times/epochs, unordered or
  duplicate capabilities, oversized evidence, and artifact/source mismatch;
- Value Codec payload and full-envelope bytes are independent of object
  insertion order and project the exact branded S07 evidence fields; and
- package tests, typecheck, build, and both standing diff reviewers pass.

Non-goals:

- no `VerifiedAuthContext`, production issuer, trusted verifier/key resolver,
  production key, policy resolver, current-epoch comparison, revocation command,
  Worker binding, DDL, route, or session activation; and
- no general JOSE abstraction or new JOSE dependency.

#### [x] O03-A2 — Integrate Trusted Grant Authority

Status: complete as the accepted three-checkpoint integration sequence. These
labels refine review and execution order only; they do not change
transaction-grant V1, the storage generation, or a product version.

##### [x] O03-A2a — Preserve Verified Authentication Provenance

Status: complete as the backend-private verified-authentication-provenance
checkpoint. It creates no grant signing, verification, policy, epoch, transport,
or transaction authority.

Outcome:

- Add a backend-private `VerifiedAuthContext` that is produced only by trusted
  authentication resolution and is never accepted from protocol JSON, a client,
  an artifact, a Dynamic Worker, or an executor request.
- Make the context a process-local authenticity capability backed by runtime
  registry membership, not a transportable TypeScript/Schema brand. It proves
  historical bearer verification only and contains no scope, policy, operation,
  signing, or transaction authority.
- Retain verified bearer issuer, subject, exact credential expiry, and matched
  provider/config evidence while deriving the existing `ExecutionIdentity`
  compatibility projection separately.
- Preserve current `ExecutionIdentity` and generated `ctx.auth` behavior,
  including existing custom claims. For transaction-grant authority, the
  initial custom-claim allowlist is empty: issuer and subject remain explicit
  inert bearer evidence and the grant-facing `claims` object is empty.
- Represent anonymous provenance separately. Keep the env-gated trusted-dev
  identity path compatibility-only until a separately named principal and
  bounded expiry are accepted; it cannot mint a grant in this checkpoint.
- Validate the minimized issuer/subject/empty-claims projection against the
  existing transaction-grant V1 inert-auth schema. A credential whose claims
  remain valid for `ExecutionIdentity` but violate the narrower grant evidence
  bounds must keep its compatibility identity while failing typed projection.

Exit gate:

- successful bearer verification retains exact expiry and matched-provider
  evidence;
- invalid, expired, wrong-provider, wrong-audience, and tampered credentials
  continue to fail closed;
- unknown JSON and public protocol inputs cannot construct the private verified
  context;
- grant-facing projection contains no unapproved custom claims;
- copied private brands, inherited handles, and mutated compatibility identities
  cannot forge or alter the process-local evidence;
- existing `ExecutionIdentity` and `ctx.auth` compatibility projections remain
  unchanged; and
- focused backend tests, typecheck, build, and both standing reviewers pass.

Non-goals:

- no policy selection, grant signing or verification, key lifecycle, epoch
  lookup, revocation command, Worker binding, route, session, or persistence
  change; and
- no storage of the process-local context in ConnectionDO state, subscription
  rows, artifact payloads, or executor persistence.

##### [x] O03-A2b — Establish Host-Neutral Grant Authority

Status: complete as the host-neutral, non-routing grant-authority kernel.

Outcome:

- Add the independently trusted point-operation policy source, backend-side
  issuance/signing contract, executor-side opaque verification capability, and
  key rotation/disablement semantics.
- Before issuance, recheck current time, current active provider/config
  membership, and trusted policy; the A2a handle alone authorizes nothing.
- Prove tamper, key, time, pin, policy, capability, claim, and inert-evidence
  boundaries without adding production transport or session activation.

Accepted V1 authority contract:

- The only accepted policy is `policy_point_mutation_v1`. It permits anonymous
  and verified-bearer mutation execution with the exact canonical capability
  set `db:get`, `db:insert`, `db:patch`, `db:replace`, and `db:delete`, keeps
  verified-bearer custom claims empty, and rejects `trustedDev`. This is not a
  role, team, tenant, or general application-authorization system.
- Identity/access-policy matching evidence is the SHA-256 of the Value Codec V1
  canonical value `{ format: "flarex.identity-access-policy", version: 1,
  policyVersion, auth, capabilities }`. The backend derives it and the executor
  recomputes it; an `ExecutionIdentity`, caller-supplied digest, or persisted
  inert grant cannot stand in for verified authority.
- The backend-private issuer accepts only A2a authentication provenance plus
  internal future-preparation pins. It independently applies the code-owned
  current V1 policy and reloads current active provider configuration, current
  time, and one immutable signing-key snapshot, then derives policy,
  capabilities, digest, grant ID, timestamps, expiry, and key ID. A provider's
  recorded array index is
  diagnostic only: the same semantic provider configuration may move within
  the current array, while removal or changed configuration blocks new grants.
- Grant lifetime is explicit configuration with no inherited five-minute
  fixture default. Expiry is the earliest of the configured maximum lifetime,
  exact originating credential expiry, and any signing-key verification
  retention deadline. Credential expiry must be strictly after issuance, and
  expiry has no grace period.
- A keyring has exactly one active signer, may retain older verification-only
  keys through their outstanding grant lifetime, rejects disabled, unknown,
  wrong-purpose, duplicate-ID, or out-of-window keys, and never lets a caller
  select `kid`. Key IDs are immutable and must not be reused; a replacement
  public verification capability is published before new signing begins.
  Backend code receives a signing capability rather than private key bytes;
  executor code receives only verification/key-resolution capability.
- Executor verification strictly derives the A1 inert envelope, resolves the
  exact `kid` from an independently selected deployment key namespace, verifies
  Ed25519, enforces explicit future-skew and maximum-lifetime configuration,
  recomputes and enforces the fixed policy, compares every independently
  expected logical pin, and only then returns a process-local WeakMap-backed
  opaque capability. The signed revocation epoch remains inert evidence here;
  A2c owns its authoritative source and exact current-epoch comparison.
- Exact signed-grant replay remains the accepted retry model until expiry,
  key disablement, or A2c epoch invalidation. A2b adds no replay database.

Exit gate:

- deterministic digest and signing tests cover anonymous and verified-bearer
  issuance, provider removal/change/reordering, exact credential and configured
  lifetime boundaries, key rotation/disablement, and caller non-selection of
  policy, capabilities, digest, time, grant ID, and key ID;
- verification rejects malformed or tampered envelopes, bad signatures,
  unknown/disabled/wrong-purpose/out-of-window keys, future/expired/overlong
  grants, wrong logical pins, policy/capability/digest drift, `trustedDev`, and
  nonempty verified-bearer claims;
- structural brands, copied symbols, serialized handles, inert evidence, and a
  bare signature result cannot construct the executor capability; and
- focused Node tests and a real workerd/Miniflare execution of the authority
  kernel pass without production bindings, routes, or persistence changes.

Non-goals:

- no authoritative preparation source or current epoch lookup/comparison;
  O03-A2c owns those. Checked revocation, private transport, Cloudflare
  binding/key adapters, and cross-Worker propagation remain deferred to their
  first operational or hosted-production consumers;
- no session activation or later OCC work; and
- no production key material or hidden time defaults.

##### [x] O03-A2c — Complete Private Grant-Admission Authority

Status: complete as the third O03-A2 checkpoint without introducing a product
or grant version. It has exactly two blocking authority boundaries: located
current-epoch admission and schema-neutral two-sided point-mutation
preparation. Both are complete. Operational revocation and hosted Worker/key
adapters remain separate nonblocking gates that require fresh preflights.

###### [x] Admit Grants Against The Located Current Epoch

Outcome:

- Consume only an opaque grant already verified by O03-A2b. Resolve current
  scope placement from its verified logical deployment through trusted located
  authority; never select a physical target from grant JSON or a caller-authored
  scope.
- Read S07-A's sole current scope-wide authorization-revocation epoch, require
  exact equality with the signed grant, and return a second process-local opaque
  capability. Equality is established only at that read's linearization point:
  the capability is preliminary, and O03-B must recheck inside its short
  activation transaction.

Exit gate:

- a current grant passes, while an otherwise-valid old grant fails after the
  existing private S07-A test primitive advances the epoch;
- wrong scope, missing/corrupt authority, scope isolation, and exact bigint
  values fail closed through typed errors on PGlite and focused real Postgres;
- serialized, spread, prototype-derived, structural, and crypto-only handles
  cannot construct the epoch-admitted capability; and
- the tests state the read-versus-bump race explicitly and do not claim durable
  execution authority before O03-B.

Non-goals:

- no grant minting, function/schema/argument preparation, revocation command,
  Worker binding, `/invoke/*`, session/OCC, routing, or legacy-path change.

###### [x] Prepare Target Point-Mutation Starts

Outcome:

- A runtime-neutral validator and evidence kernel checks exact function path,
  mutation kind, public visibility, argument metadata, table-aware IDs, and
  canonical arguments. Function arguments remain object-shaped even for
  `v.any()`.
- Backend issuance and executor verification perform separate trusted metadata
  and scope-epoch reads. Each returns its own WeakMap-backed opaque handle; the
  issuer accepts only its prepared handle, the verifier accepts only the
  independently prepared executor handle, and signature/pin/current-epoch
  checks produce the final opaque capability for O03-B. Structural prepared
  facts cannot authorize either side.
- The implementation is a schema-neutral private test-generation kernel over
  immutable setup-seeded adapters. It persists nothing, adds no DDL or active
  pointer, and fails closed for missing, inactive, corrupt, duplicate,
  wrong-kind, internal, or invalid-argument metadata.
- `validatedArgsSha256` is SHA-256 over Value Codec V1 canonical validated
  arguments. `requestSha256` is SHA-256 over the Value Codec V1 canonical value
  `{ format: "flarex.point-mutation-request", version: 1, deploymentId,
  functionPath, functionKind: "mutation", validatedArgsSha256, requestKey }`.
  Auth, policy, epoch, time, and signing-key data remain separate pins.
- Production preparation remains a separate roadmap-17 plus S03-D4/S04 adapter
  that must read one coherent active package/artifact/source/function-validator/
  schema snapshot with an activation revision or fence. S04's schema pointer
  alone is insufficient, and that later physical representation requires its
  own preflight.

Non-goals:

- do not call or extend legacy `prepareInvoke`, DeploymentDO active metadata,
  numeric prototype schema authority, partition/shard routing, or a temporary
  dual-authority bridge.

###### Deferred: Advance Scope-Wide Grant Revocation

Outcome:

- At the first operational or admin consumer, add a private command that
  accepts trusted located scope authority plus
  `expectedCurrentEpoch`, advances S07-A exactly once in a short transaction,
  and returns previous/current values. A stale expectation fails instead of
  double-bumping after an uncertain-response retry.
- Prove scope isolation, concurrent one-winner behavior, rollback, exhaustion,
  and old/current-grant behavior on PGlite and real Postgres.

Non-goals:

- no per-user, per-policy, or per-grant registry and no premature active-session
  enforcement.

###### Deferred: Install Private Worker And Key Adapters

Outcome:

- At the first hosted-production prepared-start consumer, add a distinct
  backend-only Worker binding/entrypoint for preparation and
  revocation. Never reuse the artifact-visible executor credential. Keep signer
  private material in a backend secret and give the executor verifier capability
  only.
- Prove authentication before body/database allocation, malformed boundary
  handling, key rotation/disablement, stale-isolate refresh, cleanup, and
  Dynamic Worker denial without changing `/invoke/*` or production routing.

Parent exit gate:

- located-current-epoch admission and two-sided preparation pass without
  changing the transaction-grant V1 format, storage generation, product
  version, or target DDL; and
- production prepared-start binding remains explicitly owned by roadmap 17 and
  S03-D4/S04 until a coherent active-metadata snapshot and activation fence
  exist.

Parent non-goals:

- no `/invoke/*` or production-generation routing change;
- no session row, snapshot lease, point read, journal, OCC, outcome, commit, or
  cleanup operation; and
- no opaque per-grant database, grant audit product, role system, general
  application authorization language, or prototype compatibility bridge.

### [x] O03-B — Establish Active Session Authority

Status: required pre-consumer authority core complete. `O03-B1` establishes one
active request anchor atomically, `O03-B2a` reloads one exact running attempt
across trusted-process boundaries, and `O03-B2b1` supplies exact abort/expiry
terminalization. O03-B2b2 is retained as a conditional operational extension;
it is not an O05 prerequisite.

#### [x] O03-B1 — Atomically Activate One Point-Mutation Anchor

Status: complete as a private, non-routing atomic activation and exact active-
anchor replay checkpoint. O04 now consumes its pinned snapshot semantics;
O05 now consumes O04's qualified point dependencies without broadening this
activation boundary.

Outcome:

- Require only the final private prepared-start capability produced from
  independent issuer/executor preparation, grant verification, and current-
  epoch admission. Callers cannot author physical placement, session identity,
  pins, canonical evidence, expiry, revocation, generation, or snapshot fields.
- Prepare and verify package/artifact/function/schema/policy pins, canonical
  arguments, request evidence, and the signed grant outside SQL. Generate a
  canonical native UUID session identity inside the trusted executor boundary.
- Use one short located-data-plane transaction to lock and recheck the scope
  clock, generation/fence, epoch, selected snapshot, and authorization
  revocation epoch. Capture one database timestamp after the authority lock.
- For a new request, atomically insert S07's session directly as `running` at
  fence `1` plus exactly one matching snapshot lease. Set session hard expiry
  to the already platform-bounded verified-grant expiry and set initial lease
  expiry to `min(databaseNow + configuredLeaseDuration, hardExpiry)`. The
  derived lease must be strictly live; there is no hidden duration default.
- Treat one exact matching `running` anchor under the same
  `(scope_uuid, request_key)` lock as activation replay: return its unchanged
  identity, fence, snapshot, evidence, and timestamps without extending its
  lease. This is active-anchor recovery, not committed-result replay. Changed
  evidence, multiple matches, stale authority, a missing/mismatched/expired
  lease, or a non-`running` anchor fails closed and never creates another
  anchor. The invariant is logical under the scope-clock lock; S07's lookup
  index is not promoted to a database uniqueness claim.
- Return only a private process-local activated-session capability. Remain
  non-routing and do not add point reads, finish/commit/retry/retention
  operations, a legacy adapter, or a broad persistence-facade method.

Exit gate:

- a structural, serialized, spread, or foreign prepared-start value causes no
  SQL, and session identity is generated and validated only inside trusted
  construction;
- both rows commit or neither does, including injected failure after every
  mutating statement;
- concurrent exact activation returns one unchanged anchor, changed-evidence
  competition has one winner, and duplicate request anchors fail as corruption;
- clock/generation/fence/epoch/revocation and preliminary-snapshot races, wrong
  pins, expired grants, expired leases, terminal reopen, invalid generated IDs,
  and exact bigint boundaries fail closed;
- one post-lock database timestamp controls created/updated/lease-expiry edges;
  PGlite covers deterministic behavior and focused real Postgres proves
  locking, concurrency, independent-scope progress, and rollback; and
- no DDL, legacy session, `/invoke/*`, root export, route, or storage-generation
  activation changes.

#### [x] O03-B2a — Reload One Exact Running Attempt

Status: complete as a private, non-routing, read-only exact-attempt reload. The
JSON-safe selector is inert lookup identity; every load freshly resolves
placement, validates under `clock -> session -> lease` locks, and mints a new
process-local capability. O04 is complete as a separate pure snapshot-read
kernel; C03 is the first operational point-read consumer.

Outcome:

- Define a strict JSON-safe selector containing only deployment, asserted scope,
  session, and canonical positive signed-int64 attempt-fence text. The asserted
  scope is an identity check, not placement authority; physical placement,
  generation, snapshot, lease, expiry, and grant authority are never caller-
  authored.
- Resolve placement freshly on every load. In one non-mutating transaction, lock
  the scope clock, exact session row, and exact current lease in that order;
  then use database time to reject a missing, terminal, expired, corrupt, or
  stale attempt and any epoch, generation/fence, or revocation drift.
- Mint a fresh process-local exact-attempt capability only after successful
  validation. It binds the verified selector and pinned snapshot observed at
  that transaction's linearization point. B2b revalidates in its own
  transaction. C03 must compose fresh exact-attempt revalidation with O04's
  snapshot-read semantics before exposing a syscall; O04 alone is deliberately
  not continuing execution authorization.

Exit gate:

- a serialized selector survives a fresh service instance while unsafe numeric
  fences, non-canonical decimal text, extra authority-shaped fields, wrong
  deployment/scope/session/fence, and structural impostors fail before a
  capability is minted;
- successful exact reload leaves the clock, session, lease, and timestamps
  unchanged, resolves placement every time, and returns a distinct frozen
  process-local capability;
- terminal, expired, missing, corrupt, and authority-drifted attempts fail
  closed, while a still-live older snapshot remains valid after the current
  commit sequence advances; and
- PGlite proves deterministic validation and exact bigint boundaries, while
  focused real Postgres proves lock order, concurrent-load behavior, post-lock
  database-time expiry, and independent-scope progress.

#### [x] O03-B2b — Terminalize Exact Attempts

Status: required pre-consumer terminalization gate complete through O03-B2b1.
The formerly ordered B2b2 renewal step is now a conditional operational
extension and does not determine this parent's completion.

##### [x] O03-B2b1 — Terminalize One Exact Attempt

Status: complete as a private, non-routing exact abort/expiry terminalization
boundary with idempotent first-terminal-state observation. This closes the
required O03-B authority core. O04 and O05 are complete; standalone C01 is
retired, C02's inert logical protocol, C03's trusted point journal, and C04A's
stored-attempt authentication plus C04B1's current commit-authority
authentication and C04B2's private-C07 final-value proof are complete. C04C
is now split: C04C1 logical point planning is complete, while
C04C2 remains conditional and unapproved.

Outcome:

- A trusted abort consumes a genuine process-local loaded-attempt capability;
  an exact expiry consumes only B2a's strict JSON-safe selector so cleanup can
  survive process restart after the live-only loader correctly refuses an
  expired attempt. Neither input carries physical placement or mutable
  authority.
- Resolve placement freshly, use one short transaction, and lock scope clock,
  exact session, then the exact optional lease. Revalidate the exact fence,
  generation/fence, epoch, revocation, protocol, grant/hard-expiry, and snapshot
  structure before reading database time after the locks.
- Treat `running` and the accepted future `finishing` lifecycle as lease-bearing
  active states. A live abort records `aborted`; at or after the earliest lease,
  hard, or grant expiry, abort and expiry canonically record `expired`. An exact
  expiry before that boundary returns a typed no-mutation failure.
- Atomically delete the exact lease and update the parent lifecycle and
  `updated_at` from the same database timestamp. First terminal state wins;
  repeated exact abort/expiry calls observe the stored terminal lifecycle and
  original timestamp without DML, relabelling, or recreated authority.
  `committed` may be observed but is never written by B2b1.
- Require one exact lease for an active row and no lease for a terminal row.
  Stable `created`, `committing`, or `retrying` rows, an active row without its
  child, a terminal row retaining a child, or abort-side same-fence snapshot
  substitution fail as invalid authority/corruption.
- Remain private, non-routing, and schema-neutral. Authority-drifted expired
  rows remain inert and fail closed until a separately preflighted maintenance
  consumer owns reclamation; B2b1 does not add a scanner or retention-floor API.

Exit gate:

- capability impostors fail before abort persistence, while an exact serialized
  selector survives a fresh expiry service and remains inert lookup identity;
- abort/expiry use `clock -> session -> lease -> database time`, stale fences
  cannot delete a newer attempt's lease, and exact bigint boundaries pass;
- live abort, database-proven expiry, first-terminal-wins replay, active-child
  enforcement, and rollback after either DML statement pass on PGlite; focused
  real Postgres proves abort-versus-expiry serialization, post-lock time edges,
  independent-scope progress, and rollback; and
- renewal, legacy sessions, `/invoke/*`, exports, routing, finish/commit/retry,
  retention, and storage-generation activation remain unchanged.

##### [ ] O03-B2b2 — Conditionally Renew Long-Running Attempts

Status: deferred, conditional operational extension outside the current master
order. Re-preflight immediately before the first runtime or retention consumer
that proves a bounded attempt must outlive its initial lease. If the initial
lease can cover the maximum attempt deadline plus safety margin, retire this
gate without implementation.

Required preflight before activation:

- Identify the concrete runtime owner and signal, maximum bounded attempt
  deadline, relationship between that deadline and the initial lease, cadence,
  jitter/failure and restart allowance, and engine-history GC safety margin.
- Explain why a longer initial lease plus bounded attempt termination is not
  sufficient. Convex starts retries with a fresh transaction/snapshot and has
  no renewable attempt lease, so this is an explicit Flarex runtime/retention
  divergence rather than a portable Convex primitive.

Guardrails if activated:

- Consume only a genuine process-local loaded-attempt capability and revalidate
  the exact current `running` or `finishing` attempt. Keep request/generation
  authority on the session and snapshot-retention authority on the lease;
  never change the selector fence or snapshot token.
- Use shared fresh resolution and `clock -> session -> lease -> database time`.
  A construction-bound trusted duration may extend but never shorten the lease,
  and renewal never revives expired or terminal authority.
- Distinguish an actual extension, an unchanged already-covered deadline, and
  an unchanged hard-cap deadline. Database-time renewal is monotonic and retry-
  safe but is not strict replay idempotency because a later retry may extend
  again.
- Reject epoch rollover and stale generation/fence/revocation authority.

Exit gate:

- renewal preserves every parent and snapshot field and changes only
  `lease_expires_at` when extension is possible;
- renewal, abort, and expiry serialize at the locked exact attempt; a renewal
  that linearizes first may succeed before later terminalization, while
  terminalization-first can never be resurrected; and
- monotonic/capped deadline edges and renew-versus-abort/expiry races pass on
  PGlite and focused real Postgres without adding a route or compatibility
  bridge.

Deferred ownership after the required O03-B core:

- C03 seals while the attempt is `running`, and that sealed root rejects later
  syscalls. C04A authenticates a live `running + sealed` attempt for initial
  planning or `finishing + sealed` for reconstruction, while O03-B2a remains a
  running-only restart entry. `C05-A` locks and revalidates scalar seal identity
  before the private exact-fence transition to `finishing`; `C05-B` now reuses
  the same bounded stored-evidence snapshot and C04 verifier for a separate
  finishing-only fresh-process entry, traverses the existing compiler chain,
  and invokes the same O07-B publisher. `C06` owns endpoint orchestration;
- `O07-B` atomically deletes the exact current lease and stores `committed` only
  inside the data/result/outcome/feed/outbox transaction;
- `O08-A` supplies the checked exact-attempt replacement primitive only;
  `O08-B1` owns the bounded backoff, outcome check, replacement handoff, and
  exact fresh-attempt proof without executing user code; `O08-B2` owns the
  immediate reauthentication and trusted OCC user-code rerun; `O08-C` owns
  known-settled SQL retry, and `O08-D` owns uncertain-outcome lookup policy; and
- `O11` first introduces the active-floor query and engine-history cleanup
  consumer. S09-A committed-key lifetime and result-payload expiry remain
  separate from engine/feed, reconnect, and S09-B outbox retention.

### [x] O04 — Implement Exact-Snapshot Point Reads

Status: complete as a private persistence semantic kernel. It accepts one
strict `SnapshotToken` plus a branded table and row identity, reads only
authoritative revision history for row visibility, and returns an immutable
public document-or-null result together with the exact point dependency. One
unlocked scope-clock lookup validates the scope-to-native-UUID projection; it
is not a session-authority check, routed syscall, or broad persistence-facade
method. C03 owns the first operational composition with a freshly validated
attempt and staged read-your-writes state.

Outcome:

- Implement package-private `getAppRowAtSnapshotInTransaction` over S06's
  exact backward revision read. Its input carries the full branded snapshot
  token so scope and commit sequence cannot be supplied independently.
- Use `fx_app_row_rev` as the only row-value and visibility source. The scope
  clock is read without a lock only to validate the native scope projection;
  `fx_app_row_current` remains an unselected future optimization. Write epoch
  remains provenance and never filters visibility.
- Return a verified canonical document and a present dependency containing the
  observed revision sequence, or return public `null` with a missing
  dependency. Missing dependencies retain whether no revision was visible or
  the visible revision was a tombstone, including that tombstone's sequence,
  so O05 can fail closed on contradictory history and detect same-row writes.
- Freeze the result, dependency, and logical identity. Keep generation/fence,
  lifecycle, lease, expiry, and current-attempt authorization out of this pure
  kernel; never use wall-clock comparisons or acquire session/scope locks.
- Retention is not activated here. Before O11 removes history, it must install
  and enforce the retained-floor rule so compacted history cannot be mistaken
  for a never-visible row.

Exit gate:

- PGlite proves present, never-visible missing, tombstone-qualified missing,
  insert-after-missing, update, delete/reinsert, older snapshot, old-epoch
  untouched rows, cross-scope/table isolation, immutability, no read-side DML,
  and fail-closed canonical-evidence corruption;
- focused real Postgres proves signed-bigint exactness, the composite backward
  history lookup, and that a revision committed above the pinned snapshot never
  leaks; and
- no DDL, route, root export, legacy adapter, current-pointer fast path,
  journal, staged overlay, O05 validation, or execution-attempt facade is added.

### [x] O05 — Build The Pure Point-OCC Validator

Status: complete as a private, database-free, single-point decision kernel. It
consumes O04's frozen point-dependency contract, the full pinned snapshot token,
and a minimal authoritative row-head observation. It does not reinterpret a
developer-visible `null` as sufficient conflict evidence.

Outcome:

- Implement one side-effect-free, database-free point validator. A present
  dependency requires the same live revision; a missing dependency requires
  either no head or the exact observed tombstone. Insert, patch, replace, and
  delete preconditions later use those same dependency forms rather than a
  second write-conflict model.
- Return a strict `valid | conflict | invalidEvidence` decision. Only an exact-
  row head revision above the pinned snapshot is a retryable conflict suitable
  for a full user-code rerun. Identity mismatch, impossible sequence evidence,
  history regression, or any mismatching head at or below the snapshot is
  non-retryable invalid evidence.
- Keep SQL, row-head loading, locks, session/lease checks, epoch and generation/
  fence revalidation, and same-lane serialization in O06. Its scope-clock lock
  serializes authoritative V1 commits, so O05 does not invent a Convex-style
  in-memory pending-write interface. Keep same-row journal coalescing and staged
  read-your-writes in C03; C04C1 later lowers the verified overlay and every
  protocol-owned `LogicalReadDependencyV1` into the private logical prepared
  point plan. It does not duplicate O05's persistence-owned dependency type.
- Treat authoritative revision history as the semantic source. O06 may derive
  the minimal head observation from a current pointer only after proving its
  equivalence under the same transaction; O05 never reads or blesses the
  pointer itself.

Exit gate:

- exhaustive unit tests cover present and missing reads, insert/write
  preconditions, newer live and tombstone heads, delete/reinsert and final-
  tombstone cases, same-value newer revisions, unrelated/mismatched identities,
  scope mismatch, impossible pre-snapshot history, signed-bigint exactness, and
  immutable deterministic decisions;
- delete/reinsert cases prove that intervening history conflicts even when the
  final value or missing state resembles the snapshot. They do not authorize
  developer-facing reuse of a deleted document ID; Convex forbids that reuse,
  and any Flarex divergence requires a separate accepted design decision;
- no SQL, physical writes, root export, session/lease/epoch/generation
  authority, journal, overlay, or coalescing is added in this turn; and
- real-Postgres conflict serialization remains an O06 exit gate rather than a
  false requirement for this pure kernel.

### [x] O06 — Prove The Reusable Private Point-Commit Transaction Kernel

Outcome:

- The executor authentication/planning factory alone unwraps a genuine same-
  factory `PreparedPointCommitV1` and passes one detached, closed command over
  the explicit persistence subpath. Persistence imports no executor type and
  cannot authenticate a structural imitation.
- The reusable internal kernel configures PostgreSQL `READ COMMITTED` before
  its first statement, owns one short transaction, and follows the canonical
  scope clock -> exact session -> exact lease -> sealed root order. It freshly
  revalidates the complete scalar authority/seal identity, loads only bounded
  authoritative row heads, adapts logical dependencies losslessly into O05,
  and exercises tentative live/delete revision/current lowering through the
  same internal row functions O07-B can extend.
- O06 publishes nothing. A package-private same-factory proof adapter throws one
  private sentinel out of the transaction callback so the driver rolls back;
  only that exact sentinel becomes a frozen non-authoritative `wouldCommit`
  observation, and only after the transaction promise and rollback settle.
  Foreign SQL failures, typed stale authority/OCC/resource failures, and defects
  retain their distinct channels. Effect interruption remains masked until the
  transaction settles.
- No clock advance, row revision/current state, S08 header/change, S09-A result,
  S09-B wake, session transition, or lease deletion becomes durable, and no
  tentative commit sequence is exposed. The proof seam is package-private and
  non-routable; O07-B is the first durable publisher.

Required real-Postgres cases:

- forced rollback leaves tentative insert/delete lowering, the scope clock,
  session/lease/root authority, and every publication table unchanged;
- a waiting same-scope attempt serializes behind the clock lock, while an
  independent scope progresses;
- authority/revocation drift that wins before the lock is reported as typed
  stale authority, and a competing committed row is reported as an O05
  conflict after the O06 transaction acquires the lock;
- running rather than finishing lifecycle is stale authority, not corruption;
  interruption is not observed until the Promise-native transaction rollback
  settles; and bounded head-query plans remain index-backed.

Exit gate:

- focused PGlite and isolated real-Postgres rollback/serialization/race lanes
  pass; PGlite alone cannot close this turn;
- same-factory and structural-forgery tests prove untrusted journals cannot call
  the primitive or supply physical authority;
- the production kernel is reusable by O07-B, while the forced-rollback adapter
  remains test/proof-only and no externally routable mutation can commit through
  O06; and
- O07-B proves private exactly-one-winner publication, dense sequence allocation,
  and atomic header/change/outcome/wake settlement. O08-D/C06 retain routed finish
  orchestration and uncertain-outcome retry policy, and C07 retains the first
  complete end-to-end gate.

### [x] O07-A — Resolve Committed Point Outcomes

Outcome:

- Accept a closed, structurally validated and defensively copied lookup record
  containing scope, request key, and expected identity/policy, function, and
  canonical-request match evidence. The record is not self-authenticating
  authority; its future caller must derive it from authenticated same-factory
  provenance.
- Read the S09-A outcome, scope clock and inclusive retained floor, and optional
  exact S08 header in one bounded statement. Transfer canonical result bytes
  only through a size- and match-guarded projection, then close SQL before
  decoding, hashing, or canonical verification.
- Return exhaustive `missing`, matching `available`, or matching `expired`
  outcomes. Reject exact evidence mismatch as a typed request-key reuse
  conflict and malformed state, result evidence, future tokens, missing
  retained headers, or retained epoch mismatch as typed stored corruption.
- Preserve scope-lifetime old-epoch receipts. Compare epoch only with a retained
  exact header; a header may be absent only when its token is strictly below a
  positive retained floor. Floor equality still requires the header.
- Own no retry, polling, writer, expiry transition, session mutation, route, or
  commit authority.

Exit gate:

- focused PGlite proves states, every match mismatch, malformed/canonical
  evidence, floor boundaries, defensive ownership, and single-statement
  size-first projection;
- isolated real Postgres proves statement-snapshot publication/compaction
  behavior, post-SQL verification, and index-backed bounded plans; and
- the resolver stays absent from package roots and all host/public routes.

### [x] O07-B — Add Atomic Outcome, Idempotency, And Outbox

Outcome:

- Reuse and extend the O06 kernel as the private `CommitExecutor` capability that
  accepts only the genuine prepared logical point capability. C05-A supplies its exact
  same-process finishing capability and C05-B supplies equivalent fresh-process
  reconstruction as its first complete compiler consumer; this
  target capability never wraps or promotes legacy
  `commitInvokeSessionWrites`.
- Consume S09-A through a fast committed-outcome lookup before entering the
  transaction. A matching stored success is replayable; mismatched identity/
  policy, function, or canonical-request evidence fails. S09-A has no
  `in_progress` claim row. After locking the scope clock, recheck the exact
  request key before session/lease validation so two concurrent preflight
  misses converge on the stored winner rather than treating it as stale.
- Insert the successful encoded result and immutable commit token only in the
  same transaction as data, the S08 header/change atoms, S09-B outbox rows,
  exact-current-lease deletion, and committed session state. Failed, aborted,
  OCC-conflicted, serialization-rolled-back, and diagnostic-error attempts
  create no committed outcome.
- O06 owns the reusable actual authority-lock, revalidation, O05, and tentative
  revision/current-lowering kernel. O07-B owns sequence/time allocation and the
  first durable result/data/change/outbox publication through that kernel.
  C04C1's numeric table/row ordering is canonical logical evidence ordering
  only, not SQL lock authority.
- Retain a compact non-reusable committed tombstone after result payload expiry.

All authoritative writers use one lock order:

```text
O07-A committed-outcome lookup outside the transaction
  -> begin transaction
  -> lock data-plane scope clock/generation fence
  -> recheck the exact S09-A request key
     -> matching stored success: replay
     -> mismatched evidence: typed request-key reuse
     -> missing: continue
  -> lock exact session row and exact current lease
  -> recheck lifecycle/fence/snapshot/expiry/grant/current revocation epoch
  -> validate and publish
  -> insert the S09-A success receipt together with S08/S09-B evidence
```

Any future O03-B2b2 renewal and O03-B2b1 abort/expiry use the same scope-clock
then session then lease order whenever they touch those authorities. O08-A adds
the sealed root after the lease lock; its distinct FK-safe mutation order is
`finishing -> retrying -> delete root/cascading children -> delete lease ->
advance fence -> insert lease -> insert pristine root -> running`.

Exit gate:

- repeated private publication returns the same outcome; routed repeated finish
  remains C06 work;
- mismatched request-key reuse fails;
- concurrent duplicates apply once;
- an uncertain response resolves from the stored outcome;
- failed or rolled-back attempts do not appear committed; and
- no committed/terminal session retains an active snapshot lease.

### [ ] O08 — Separate Attempt Replacement And Three Retry Coordinators

#### [x] O08-A — Replace One Exact Conflicted Attempt Atomically

The persistence-owned package-private operation consumes detached correlation
evidence derived from a genuine same-factory finishing plan, but independently
resolves placement and revalidates authority, request outcome, session, lease,
sealed root, database-time liveness, and a reproducible O05 conflict. One READ
COMMITTED transaction locks clock -> outcome -> session -> lease -> root, enters
`retrying`, deletes the root and its children before the exact lease, advances
the signed-int64 fence, inserts a fresh clock-snapshot lease and pristine open
root, then returns to `running`. Response-loss convergence accepts only the
exact fence+1 live pristine attempt. The observation is lifecycle evidence, not
a rerun permit; no backoff, retry budget, user-code execution, SQL retry, or
uncertain-outcome policy exists in O08-A.

#### [ ] O08-B — Authorize Trusted OCC User-Code Rerun

A known typed O07-B OCC conflict is now split at the execution boundary.

##### [x] O08-B1 — Authorize One Fresh OCC Rerun Handoff

The same executor factory captures only the exact `PointCommitConflictV1Error`
object emitted by its genuine O07-B finishing publication and irreversibly
claims that ticket before its first asynchronous yield. Attempts at fences 1
through 4 use Convex-compatible full jitter with upper bounds 100, 200, 400,
and 800 milliseconds; fence 5 is exhausted. After backoff, O07-A is checked
before O08-A. Matching available/expired outcomes close the operation, and only
O08-A `replaced` may continue. O03-B2a then reloads the exact fence+1 attempt;
the handoff is minted only when deployment/scope/session/request, storage
generation/fence, epoch/schema pins, advanced conflict-visible snapshot, live
lease, and pristine open zero-accounting journal facet all match. The opaque
handoff is factory-local and single-use. It executes no user code and grants no
crash-safe redispatch authority.

##### [ ] O08-B2 — Reauthenticate And Rerun User Code

Immediately before execution, consume the B1 handoff once, consult O07-A again,
and reauthenticate exact current liveness plus the complete canonical execution
inputs. B2 owns the fresh runtime-neutral execution context, deterministic
attempt-local state, repeated-conflict loop, and crash-safe redispatch policy.
Dynamic Worker remains an adapter rather than the coordinator authority.

#### [ ] O08-C — Retry Known-Settled SQL Transactions

Only a confirmed pre-decision PostgreSQL `40001` or `40P01` may retry the same
authenticated logical/closed command within a strict bound. Every attempt opens
a new transaction and freshly derives locks, physical rows, commit/outbox
sequences, IDs, and database timestamps. It never reruns user code and cannot
reuse a physical SQL plan.

#### [ ] O08-D — Resolve Uncertain Outcomes

An uncertain connection outcome consumes O07-A/C05-B before any retry or rerun.
Matching success replays; mismatched, corrupt, or expired evidence fails closed;
the coordinator does not duplicate the authoritative outcome resolver.

No request silently crosses a generation fence during an active OCC retry. The
current clean-replacement path has no legacy request-rebind obligation. If
shipped request identities are later discovered, their no-commit/terminal-
anchor rebind rule requires a separately preflighted migration capability.

Every O08-C retry opens a new transaction, reacquires the scope clock, rechecks
session/generation/epoch/idempotency, and derives tentative commit/outbox
sequences, IDs, timestamps, and transaction locks again. The authenticated
logical/closed command contains none of those transaction-derived facts.

Exit gate:

- O08-A rollback, response-loss convergence, duplicate replacement, O07-B/
  abort/expiry races, independent-scope progress, and index-backed queries pass
  on PGlite and isolated real Postgres;
- O08-B1 accepts only exact same-factory conflicts and never executes user code;
- O08-B2 OCC conflicts do rerun it after immediate reauthentication;
- O08-C SQL retries do not rerun user code;
- a successful uncertain commit is never applied twice;
- authorization, validation, codec, and deterministic constraint errors are not
  retried;
- real-Postgres serialization and deadlock tests pass.

### [ ] O09 — Add Multi-Row Atomicity And Unique Conflicts

Outcome:

- Expand the prepared plan to multiple rows with deterministic lock/write
  ordering and same-row write coalescing.
- Validate and publish unique claims in the same transaction.
- Translate database constraint races into stable typed conflicts/errors.

Exit gate:

- all-or-nothing multi-row writes, competing unique claims, delete/reuse,
  deterministic ordering, and sidecar rollback pass on PGlite and real
  Postgres;
- Payload and Medusa behavior remains excluded.

C04C1 rejects more than one material logical row. O09, not C04C1, owns the
first accepted multi-row and unique-lock/write ordering contract.

### [ ] O10 — Prove One Exact Indexed Dependency

Outcome:

- After the schema and compiler provide the ordered-key codec and index
  sidecars, implement one exact indexed dependency including codec version,
  bounds, empty range, insertion/deletion, key movement, and pagination
  frontier.
- Add complete local read-your-writes overlay for that exact supported query
  shape before enabling it in mutations.

Exit gate:

- phantom insert/delete/key-move tests pass on PGlite and real Postgres;
- unsupported range, relation, scan, or pagination shapes still reject rather
  than fall back;
- this turn does not claim all query shapes.

### [ ] O11 — Enforce Retention Floors

Outcome:

- Introduce the read-only minimum-unexpired-active-snapshot query when this
  retention consumer first needs it; do not create an earlier standalone floor
  API in O03-B.
- Compute engine-history retention from that active snapshot-lease floor plus
  a safety margin. Consume reconnect floors only after roadmap 21 supplies an
  accepted reconnect contract and separately preflighted DDL.
- Persist and advance `oldest_available_commit_seq` only after compaction
  succeeds so restart can reject tokens below the actual retained floor.
- For every row identity and index-entry membership identity, retain the newest
  revision/tombstone at or before the floor plus every required later revision,
  or materialize an equivalent checkpoint. Deleting all pre-floor rows would
  make snapshots at the floor incorrect.
- Advance the global floor only after row, index, commit/change, and required
  dependency histories are mutually safe at that floor.
- Keep engine revision retention, S09-A result-payload expiry, scope-lifetime
  committed-key retention, Payload user-visible versions, S09-B outbox
  delivery retention, and roadmap-21 reconnect retention as separate policies.
- Return an explicit reset/out-of-retention outcome for a token below the floor
  or from another epoch.

Exit gate:

- active sessions prevent required history deletion;
- expired leases release history;
- a row revised at 5 and 100 still returns revision 5 at snapshot 50 after the
  floor advances to 50;
- a row/index membership deleted before the floor remains absent rather than
  resurrecting after compaction;
- pending/claimed outbox rows are never collected;
- epoch rollover does not hide or delete untouched data.

### Conditional Live Migration Branch

Status: dormant. The former `O12` canary drain/cutover protocol is not an active
gate because neither prototype has a recorded shipped scope, active customer
session, or reconnect population. Do not build drain, shadow authority,
same-transaction legacy publication, reverse catch-up, or runtime rollback for
internal fixtures.

If live shipped state is later proven, a new preflight must define the exact
affected scopes, final legacy watermark, request-outcome handling, subscription
reset/rebind behavior, one-commit-authority rule, rollback promise, and
retirement condition. That conditional branch must never let an active OCC
attempt cross a generation fence or serve silent legacy fallback.

### [ ] O13 — Retire Prototype OCC And Runtime Authority

This gate follows the target point-commit proof, target generation routing, and
target-only sync/reconnect/reset recovery. It is a clean internal replacement,
not a customer-data cutover. It may use bounded sub-checkpoints, but each
temporary bridge must name its remaining caller and immediate deletion gate.

Retirement gate:

- the owner-declared no-shipped-obligation state is still current, or any newly
  discovered obligation has been handled by its separate migration branch;
- local, test, backend, executor, artifact-runtime, and sync callers route only
  through accepted FlarexDB authority;
- no prototype session, lease, reconnect cursor, public partition route,
  Wrangler binding, or fallback remains reachable;
- still-intended semantics have target-owned tests; tests that assert only the
  obsolete architecture are removed;
- PGlite, real Postgres, private Worker Fetch, artifact-runtime, local/test, and
  sync integration gates pass without a legacy engine; and
- remove PartitionDO/ExecutionDO app-data authority, legacy document/index OCC,
  the `legacy_v1` invoke-session/read/write staging families, prototype tables,
  generation defaults, and prototype-only fallbacks rather than leaving an
  indefinite compatibility layer. The accepted target Postgres journal remains
  when `C07A` does not select facet placement; HTTP/Nitro host-adapter retirement
  remains a separate caller/parity decision; and
- the pre-release migration history is rebaselined so a fresh database creates
  only target schema. Development databases reset or use an explicitly bounded
  internal upgrade lane; do not preserve a permanent create-prototype-then-drop-
  prototype chain without a newly proven shipped schema obligation.

## Future Adapter Participation

Reserve trusted entry paths rather than a generic raw transaction callback:

```text
AppCommitExecutor
PayloadTransactionAdapter
MedusaTransactionAdapter
SystemWriteAdapter
```

- The app compiler derives app rows and sidecars.
- Payload later owns Payload request semantics and conformance.
- Medusa later preserves its repository/workflow transaction and joins the
  same scope clock, commit/change, and outbox protocol.
- All paths validate scope/generation and use one commit lane, but they do not
  pretend to share one journal or physical schema.

## Verification Template

Fast gates for every OCC turn:

```sh
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
```

Lock, conflict, idempotency, retry, outbox, and cutover turns additionally run:

```sh
corepack pnpm --filter @flarex/persistence-postgres test:postgres
corepack pnpm --filter @flarex/executor test:postgres
```

Phase checkpoints run both package builds and workspace `typecheck`, `test`,
and `build`. Significant code turns update only active roadmaps whose durable
truth changed; compatibility inventories remain historical evidence. Both
standing diff reviewers run before the automatic checkpoint commit.
