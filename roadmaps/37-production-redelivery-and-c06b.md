# Production Redelivery And C06-B

## Status And Scope

Status: active focused execution plan. P00 records the accepted boundary, P01
selects the exact-attempt runtime-host contract, and P02a freezes the
host-neutral protocol and generated Dynamic Worker entrypoint; all three are
complete. P02b adds the executor-owned one-shot journal RPC adapter and is also
complete. P02c.3, proving stored-attempt composition, is the current gate.

This plan owns the remaining production portion of
`O08-B2b2b2b1b2b2b` and the subsequent `C06-B` endpoint/response policy:

- production wake-up and bounded scheduler-run hosting;
- exact-attempt redelivery into the already accepted execution authority;
- operational retry, deadline, cleanup, and liveness policy at that host;
- stable finish/lost-outcome dispatch after the production redelivery path is
  proven; and
- direct post-commit wake composition without creating a second state machine.

This plan does **not** authorize:

- runtime-topology-probe investigation or implementation;
- deployment, paid Cloudflare resources, production target activation, or
  secret provisioning;
- legacy route or storage-generation removal;
- a public scheduler endpoint;
- a second execution/session authority; or
- broad compiler, persistence, backend, or artifact-runtime refactoring.

## Why This Plan Exists

The durable scheduler pieces below the host are already implemented:

- a fixed-key Postgres checkpoint and fenced checkpoint repository;
- bounded scope enumeration and exact-selector redelivery;
- bounded multi-scope/repeated-page composition; and
- one host-neutral, count- and time-bounded scheduler run.

Those pieces deliberately cannot execute an attempt from serialized evidence.
The runtime-neutral OCC runner requires an already-authenticated exact attempt,
verified grant and metadata, execution context, and a same-process capability-
bound journal. The current artifact-runtime invoke path starts the ordinary
invoke protocol; it does not yet prove that it can resume that exact admitted
attempt without creating a new session, authority, or syscall path.

Adding a Cloudflare cron trigger before closing that boundary would make the
timer real while leaving execution authority ambiguous. This plan therefore
settles the exact-attempt runtime host first, proves one bounded production
scheduler invocation second, and activates a trigger only after both are true.

## Sources Of Truth

- [`flarexdb-foundation/02-occ-and-transactions.md`](./flarexdb-foundation/02-occ-and-transactions.md)
  owns OCC, exact-attempt claims, redelivery, and scheduler semantics.
- [`flarexdb-foundation/03-commit-compiler.md`](./flarexdb-foundation/03-commit-compiler.md)
  owns `C06-B`, finish/lost-outcome dispatch, and its ordering after durable
  publication.
- [`35-commit-compiler-and-session-intent.md`](./35-commit-compiler-and-session-intent.md)
  records the accepted compiler/session boundary.
- [`../design-notes/flarex-db-accepted-design.md`](../design-notes/flarex-db-accepted-design.md)
  records the accepted hosted topology and trust boundaries.
- Current code and focused tests remain authoritative for implemented behavior.
  This roadmap records intent and gates, not a commit journal.

## Current Implemented Boundary

The current production-shaped topology is:

```text
public backend Worker
  -> artifact-runtime Worker
  -> generated Dynamic Worker
  -> private executor Worker
  -> cache-disabled Hyperdrive / Postgres
```

`apps/executor` currently owns the private executor Worker and request-scoped
Postgres client lifecycle for Fetch. It does not yet expose a scheduled-event
host. `pointMutationRedeliverySchedulerRun.ts` composes one bounded scheduler
run but remains host-neutral. The scheduler checkpoint row is the sole durable
restart truth; no in-memory timer or Cloudflare trigger is durable authority.

The unresolved bridge is not merely “call the runner from cron.” The host must
show how an inert selected attempt becomes the exact already-admitted runtime
input without:

- minting authority from stored identifiers, signatures, or scheduler state;
- starting an ordinary invoke session;
- sending a privileged capability through user-visible bindings;
- routing syscalls through a different journal or transaction owner; or
- creating an executor-to-artifact-runtime-to-executor re-entry cycle whose
  authentication, lifetime, and failure semantics are undefined.

## Accepted Decisions

1. `apps/executor` owns the Cloudflare scheduled event, event-scoped database
   connection, exact-attempt claim/liveness process, journal, commit pipeline,
   and deterministic cleanup.
2. `apps/artifact-runtime` retains source-package validation, Worker Loader
   construction, and fresh Dynamic Worker loading. It receives exact reruns only
   through a named private RPC entrypoint, never through its ordinary invoke
   Fetch route.
3. One scheduled event invokes at most one bounded scheduler run. The existing
   count and monotonic-time admission bounds remain authoritative.
4. The Postgres checkpoint is due/restart truth. A Cloudflare cron is only a
   wake hint and cannot mint an execution claim or prove that work is due.
5. Scheduled work is awaited through the platform event lifetime. Detached
   background work is not accepted for checkpoint or attempt settlement.
6. Platform wake authority is not execution authority. Only the existing
   locked exact-attempt acquisition/admission path may mint process authority.
7. No public HTTP scheduler route is added. Any new Worker-to-Worker protocol
   must be private, versioned, authenticated before material allocation,
   bounded, and explicit about replay and version-skew behavior.
8. In-process capabilities, including WeakMap-backed or same-factory authority,
   are never serialized. A token or signed envelope may locate or authenticate
   a request but cannot substitute for the capability constructed by the
   owning trusted process.
9. The runner passes one invocation-scoped journal RPC capability through the
   artifact-runtime entrypoint to the Dynamic Worker. The RPC object reference,
   not a serialized handle, is the syscall authority. It expires with the
   originating execution contexts and is never cached in Worker code or env.
10. New package surfaces use intentional subpath exports. This work does not
   add a package-root catch-all barrel.
11. No Wrangler scheduled trigger is enabled until the default deployed Worker
   can construct and run the real exact-attempt operation with deterministic
   cleanup.
12. `C06-B` composes the existing claim, publication, outcome, uncertainty, and
    commit-wake owners. It does not introduce a parallel retry coordinator or
    terminal-state machine.

## Risks To Pressure-Test

- **Re-entry cycle:** executor -> artifact-runtime -> Dynamic Worker -> executor
  can deadlock, recurse, or cross an unproven authority boundary.
- **New-session drift:** ordinary artifact invocation can create a new session
  instead of resuming the selected exact attempt.
- **Capability forgery:** a serialized locator or grant can be mistaken for the
  same-process execution capability.
- **False durability:** cron cadence or isolate memory can be treated as
  durable scheduler state instead of the fenced database checkpoint.
- **Duplicate delivery:** platform retry can invoke the same wake more than
  once; correctness must come from existing claims and idempotent settlement.
- **Lifecycle leak:** database clients, heartbeats, runtime processes, streams,
  or leases can survive the event that owns them.
- **Second state machine:** `C06-B` can accidentally compete with C05-A/C05-B,
  O08-C/O08-D, or the commit-wake outbox.
- **Route-authority drift:** a convenient HTTP endpoint can expose scheduler or
  execution authority beyond the trusted host.
- **Export widening:** private runtime or persistence composition can become an
  accidental public package contract.
- **Scope drift:** runtime-topology-probe work can be pulled into this slice
  despite being explicitly excluded.

## P01 Exact-Attempt Runtime-Host Decision

### Selected Topology

The trusted executor remains the singular attempt and database owner. The
artifact-runtime remains the code-store and Worker Loader owner. They are joined
for exact reruns by one private, invocation-scoped RPC capability chain:

```text
executor scheduled event
  -> one event-owned Postgres client and exact-attempt runtime graph
  -> outcome-first acquire + same-factory claim admission
  -> executor-owned runtime-neutral runner
  -> named private artifact-runtime RPC entrypoint
  -> content-addressed source validation + one fresh exact-runtime Worker
  -> generated Dynamic Worker exact-mutation entrypoint
  -> forwarded one-shot journal RpcTarget back to the originating executor call
  -> result returned to executor
  -> executor seals, verifies, plans, enters finishing, and publishes
```

This is not the ordinary invoke path. The exact-runtime generated Worker:

- does not call `/invoke/start`, `/invoke/syscall`, `/invoke/finish`, or
  `/invoke/abort`;
- does not receive the generic `FLAREX_EXECUTOR` binding or a bearer token;
- receives no Hyperdrive, `pg`, Drizzle, persistence, claim, or transaction
  handle;
- receives only strict structured execution evidence plus a one-call journal
  RPC stub; and
- runs with `globalOutbound: null`.

The Dynamic Worker wrapper hides the raw journal stub behind the restricted
mutation context. Developer code receives only the database operations already
represented by `PointMutationOccBoundJournalV1`.

### Why The Exact Runtime Is Fresh

Worker Loader `get()` may reuse an isolate, while Convex-compatible mutation
semantics require an invocation clock, seeded RNG, and no user-module state from
an earlier attempt. P02 therefore uses Worker Loader `load()`, whose documented
contract creates a fresh Dynamic Worker for each call. `get()` is no longer an
accepted exact-attempt path.

The host still computes an immutable definition identity from artifact/source
hash, compatibility date, exact-runtime profile, and protocol version for
auditing and definition agreement. That identity is not permission to cache an
isolate or module state.

The one-shot journal stub is passed as an RPC method argument for each run. It
is never placed in Worker env, module state, R2, Postgres, a continuation,
or the scheduler checkpoint. Workers RPC permits forwarding a received stub to
a third Worker, and that proxy exists only for the active execution contexts.
If implementation cannot prove this forwarding and disposal behavior in the
supported runtime, P02 stops and reopens P01; it must not fall back to a token.

### Authority And Pin Order

The existing ordering remains authoritative:

1. decode the inert exact-attempt selector;
2. resolve committed outcome first, acquire the exact database claim, and
   synchronously admit its same-factory process capability;
3. load and authenticate stored attempt/evidence, verify the signed grant and
   immutable session/package/schema/policy pins, then recheck outcome;
4. load pinned function metadata and verify artifact ID, source-package hash,
   execution module, function path/kind, schema version, and validator metadata;
5. reload the current attempt, validate the live claim and pins, and open the
   capability-bound journal;
6. derive the artifact ref only from verified grant/session evidence, require
   the artifact store to revalidate that ref against the stored source package,
   and only then execute user code; and
7. return only the user result to the executor, which seals the journal and
   retains all commit/finishing/publication authority.

The structured runner input contains arguments, semantic size, verified grant,
schema manifest, stable bindings, pinned function metadata, and execution
context. Those values are evidence, not syscall authority. The only cross-
Worker database authority is the one-shot RPC object reference created after
the genuine journal admission.

P02 must define a strict owned wire projection from that evidence. It must not
send `VerifiedTransactionGrantInspectionV1`, branded handles, class instances,
or objects with accessors wholesale merely because Workers RPC can clone some
of them. The executor projects the exact literal fields and copied byte arrays
needed by the generated runtime; the callee decodes them again without treating
the decoded shape as execution authority.

Table resolution returns a nested table capability, not a string or numeric
table handle that another caller can forge. The originating executor owns all
underlying WeakMap handles and serializes journal operations through the
existing semaphore.

### Failure, Interruption, And Cleanup Contract

- Each RPC journal method executes the original local Effect in the executor.
  The executor retains the first typed journal failure locally and sends only a
  redacted remote stop signal. After the Dynamic Worker settles, that original
  typed failure takes precedence even if user code caught the remote exception.
- A user-module throw or rejected promise becomes
  `PointMutationOccUserCodeV1Error`; it must not absorb a recorded journal
  failure.
- The current runner error union lacks artifact-load, exact-runtime protocol,
  and expected RPC transport failures. P02 must add a bounded tagged host-error
  channel. It must not misclassify infrastructure failure as user code, turn
  interruption into a typed error, or catch unexpected defects as recoverable
  failures.
- The executor awaits the full artifact-runtime and Dynamic Worker RPC chain.
  It does not detach work with `waitUntil`.
- When the Dynamic Worker returns, the journal adapter closes new admissions
  and drains every already-admitted RPC call before it accepts the result or
  begins sealing. Fire-and-forget user calls therefore cannot race commit
  sealing. Interruption also closes admission and settles admitted journal work
  before pre-finishing abort proceeds.
- The one-shot journal capability closes when the runner settles. Late calls
  fail closed, table stubs cannot outlive their parent, and RPC stubs are
  explicitly disposed where the runtime API exposes disposal.
- The generated entrypoint normalizes the returned value into its strict
  transferable result contract before crossing RPC. The executor still
  canonicalizes and validates the result while sealing; transfer success alone
  proves no Flarex value or return-validator claim.
- Pre-finishing failure continues through the existing abort owner. Finishing
  and publication keep their existing uninterruptible settlement boundaries.
- The event-owned Postgres client closes only after scheduler checkpoint/release
  and every admitted attempt lifecycle has settled.

### P02b Journal RPC Ownership

P02b is an executor-package Cloudflare adapter, exposed through an intentional
`@flarex/executor` subpath. It does not replace or widen the runtime-neutral
runner contract. The adapter is a plain attempt-scoped factory rather than a
singleton Effect service because every admitted attempt owns a distinct
capability graph and lifetime.

The factory receives only the already-bound `PointMutationOccBoundJournalV1`
whose underlying attempt handle remains in the executor. It returns:

- one parent `RpcTarget`, whose table-resolution method returns a child
  `RpcTarget` retaining the corresponding process-local table handle;
- one uninterruptible `closeAndDrain` Effect owned by the executor call; and
- no environment binding, scalar capability identifier, registry key, or
  serializable journal handle.

Every parent or child method checks and records admission synchronously before
starting its local Effect. The shared session state tracks all admitted calls
and their admission order. A failed local Effect stores its full original
`Cause<PointMutationJournalBoundaryV1Error>` locally while the remote caller
receives only one fixed stop error with no provider-authored stack or cause
detail. The RPC runtime may attach a receiving-side stack. `closeAndDrain`
first closes the entire parent/child graph, then waits for a stable empty
admitted-call set, and finally re-emits the earliest admitted local failure
cause. This preserves the original typed error object, defects, and
interruption instead of reclassifying them through a Promise rejection.

Closure is idempotent and shared by every child target. A child returned before
closure therefore cannot outlive its parent, while table resolution or
operation calls attempted after closure fail without invoking the journal.
Remote `RpcStub`s remain owned by the P02c call site that receives them and must
be disposed there in a `finally`/scope boundary; P02b proves that the real
workerd stubs expose disposal, but does not invent a local disposal operation
for server-side `RpcTarget` objects.

P02b deliberately stops before constructing a Worker Loader definition,
calling the artifact-runtime service binding, changing the runtime-neutral
runner, or translating user-code and host failures. P02c will compose one
runner call around `closeAndDrain`, give any retained journal cause precedence,
then classify the independent Dynamic Worker outcome.

### Authentication, Replay, And Version Skew

The executor-to-artifact-runtime call uses a Wrangler service binding targeted
at one named RPC entrypoint. That binding is deployment authority and the method
is not exposed by the artifact-runtime Fetch handler. The callee still strictly
decodes a literal format/version and bounded structured input before loading
source.

Replaying structured evidence alone grants no database access. A caller must
also possess the one-shot journal RPC reference created by the live admitted
executor process. The capability accepts one run, refuses use after settlement,
and is never reconstructible from attempt IDs, grants, hashes, or scheduler
state.

The exact-runtime protocol version participates in both strict decoding and the
Dynamic Worker definition identity. An executor/artifact-runtime version
mismatch fails before user code runs; there is no permissive fallback to the
ordinary invoke profile.

### Rejected Alternatives

1. **Reuse the current artifact-runtime invoke Fetch route.** Rejected because
   its generated Worker calls start/syscall/finish/abort and creates a new
   session/retry path instead of consuming the admitted exact attempt.
2. **Put Hyperdrive and the target executor graph in artifact-runtime.**
   Rejected because it duplicates the executor trust, connection, claim,
   liveness, journal, and commit owners and invites a second state machine.
3. **Add Worker Loader and R2 directly to the executor.** Technically plausible
   but rejected as the first production target because it duplicates the
   artifact-runtime's content-store/materialization owner and broadens executor
   bindings. Reconsideration requires reopening P01, not an implicit fallback.
4. **Send a journal/session token over HTTP.** Rejected because serialization
   cannot preserve WeakMap/same-factory authority and would create a forgeable
   or database-reconstructible substitute.
5. **Use Worker Loader `get()` or cache a per-attempt binding in Dynamic Worker
   env/module state.** Rejected because isolate reuse is incompatible with
   exact-attempt clock/RNG state and because loader identity is not an attempt
   lifetime or authority guarantee.

### Platform Evidence

The selected contract relies only on documented Cloudflare object-capability
semantics:

- [Dynamic Worker custom bindings](https://developers.cloudflare.com/dynamic-workers/usage/bindings/)
  are unforgeable RPC stubs controlled by the loader;
- [Workers RPC](https://developers.cloudflare.com/workers/runtime-apis/rpc/)
  can pass functions and `RpcTarget` objects and forward received stubs through
  a third Worker for the active execution contexts;
- [RPC lifecycle](https://developers.cloudflare.com/workers/runtime-apis/rpc/lifecycle/)
  defines stub disposal and automatic cleanup at the end of an event handler;
  and
- [Worker Loader API](https://developers.cloudflare.com/dynamic-workers/api-reference/)
  defines `load()` as a fresh Worker and does not guarantee isolate reuse or
  identity for `get()`, so exact-attempt correctness uses `load()`;
- [Convex runtime restrictions](https://docs.convex.dev/functions/runtimes#restrictions-on-queries-and-mutations)
  require seeded `Math.random()` and a function-start-frozen clock for mutation
  determinism.

## Execution Gates

### [x] P00 — Record The Production Boundary

Record what is implemented, why a trigger cannot be added safely yet, the
accepted host and authority rules, the risk register, and the ordered gates.

Exit gate:

- the foundation roadmaps and accepted-design note link here;
- the current gate is unambiguous after context compaction; and
- no runtime, route, trigger, deployment, or configuration behavior changes.

### [x] P01 — Define The Exact-Attempt Runtime Host Contract

Compare only the concrete trusted-host compositions that can reuse the current
exact-attempt authority. For each viable composition, trace:

- owner of runtime construction, database connection, heartbeat, and cleanup;
- exact protocol input and every authenticated or capability-bound value;
- attempt/session/package/schema/policy pins and their validation order;
- journal and syscall routing back to the singular claim-fenced owner;
- Worker-to-Worker authentication, replay, size, timeout, and version-skew
  behavior where a cross-Worker hop exists;
- failure and interruption ownership before, during, and after execution; and
- whether the topology introduces re-entry or a second session.

Choose one composition only when it preserves the current authority and
lifecycle contracts. Record rejected alternatives and the evidence that
rejects them.

P01 must not add a cron handler, Wrangler trigger, public route, or `C06-B`
endpoint.

### [ ] P02 — Compose One Production Exact-Attempt Rerun

Implement the smallest trusted runtime composition selected by P01. Reuse the
existing validators, key resolution, immutable metadata, execution-context,
claim-fenced journal, and runtime-neutral runner owners. Add focused tests for
authority forgery, pin mismatch, new-session drift, failure/defect separation,
interrupt/cleanup behavior, and exact syscall/journal routing.

- **[x] P02a — freeze the exact-runtime protocol and generated Worker
  entrypoint.** Add strict bounded request/result contracts, immutable
  worker-definition identity, pinned source-package loading, the exact mutation
  entrypoint, and generated-source tests. This slice adds no database or
  scheduled host.
- **[x] P02a.1 — author the exact-runtime core as checked TypeScript.** Replace
  the handwritten monolithic source template with a deterministic build-time
  JavaScript artifact, a tiny artifact-specific configuration module, and
  a tiny literal-import execution bridge. Preserve the P02a protocol, trust,
  import-order, failure-order, one-shot, journal, and deterministic-runtime
  behavior exactly. Pin the built runtime bytes in the internal code identity
  and verify generated-artifact freshness. This remains a host-definition
  refactor and does not call Worker Loader.
- **[x] P02b — add the executor-owned one-shot journal RPC adapter.** Preserve
  nested table capability identity, original typed journal-failure precedence,
  late-call closure, user-error separation, interruption, and stub disposal.
- **[ ] P02c — compose and prove one exact rerun.** Wire the named
  artifact-runtime RPC entrypoint to the executor runner and existing stored-
  attempt graph. Prove no ordinary invoke route, new session, generic executor
  binding, or serialized authority participates. Before either path is
  activated, make the initial point-mutation attempt and exact redelivery use
  one identical runtime profile; the current initial artifact runtime still
  exposes native asynchronous Web Crypto, WebAssembly, and advancing
  `performance.now()`, while the exact-rerun profile deliberately blocks or
  fixes them.

#### P02c Ordered Subgates

P02c does not make the cached ordinary invoke Worker into an exact runtime.
That Worker uses `loader.get()`, retains user-module state, and owns the
start/syscall/finish/abort lifecycle that P01 explicitly rejected for exact
attempts. Copying only the Web Crypto, WebAssembly, or `performance` guards
into that source would still leave different module-state, clock, RNG, timer,
cache, network, intrinsic-hardening, and authority semantics.

Runtime-profile parity is therefore structural: the future initial point-
mutation attempt and every exact redelivery must both enter the same
`PointMutationOccRuntimeNeutralRunnerV1` implementation and fresh
`FlarexPointMutationExactRuntimeV1` Worker profile. The legacy invoke route is
not evidence of parity and remains outside this point-mutation path. P02c may
construct and prove the inactive exact runner, but P04 must not activate
scheduled redelivery until the initial point-mutation host also selects that
same runner.

Implement P02c in these bounded checkpoints:

1. **[x] P02c.1 — artifact-runtime exact RPC host.** Add one named private
   `WorkerEntrypoint` that strictly decodes the request before material
   allocation, revalidates the pinned source package through the existing
   artifact store, calls `loader.load()` once, selects only the named exact
   Dynamic Worker entrypoint, forwards the invocation-scoped journal target as
   a method argument, awaits the complete call, and disposes every received
   child/entrypoint stub. Add no Fetch route or generic executor binding.
2. **[x] P02c.2 — executor exact runner.** Project the already-authenticated
   runtime-neutral input into the strict request, create the P02b journal
   session, call the private artifact-runtime binding, always close and drain
   the journal graph, give its retained cause precedence, decode the strict
   result, and distinguish user failure from the bounded host/transport error
   channel without turning defects or interruption into typed failures.
3. **P02c.3 — stored-attempt composition proof.** Install that runner only in
   the existing exact-attempt dependency graph and prove one initial execution
   of that graph plus one redelivery-shaped execution use no ordinary invoke
   route, replacement session, serialized journal authority, Dynamic Worker
   database binding, or parallel retry state machine. This is construction and
   test proof, not scheduler activation.
4. **P02c.4 — activation parity proof.** Before P04, route the production
   initial point-mutation host through the same runner and pin the full fresh
   runtime profile on both paths. Do not treat three blocked globals as a
   substitute for identical Worker freshness, deterministic inputs,
   unavailable capabilities, and intrinsic hardening.

### [ ] P03 — Host One Bounded Scheduler Event

Compose one platform event over one event-owned database client and one existing
bounded scheduler run. Preserve checkpoint-before-next-work ordering, fenced
settlement, soft admission deadlines, duplicate wake safety, and deterministic
resource closure. Pin platform retry and event-lifetime behavior in focused
host tests.

### [ ] P04 — Activate The Cloudflare Scheduled Trigger

Add the scheduled-event export and Wrangler trigger only after P02 and P03
prove the default Worker can execute real work. Keep cadence a wake hint, keep
all limits in validated runtime configuration, and perform no deployment in
this gate.

### [ ] P05 — Complete C06-B

Add stable target-native finish/lost-outcome dispatch and direct post-commit
wake composition. Reuse C05-A/C05-B terminalization, O08-C/O08-D decision
policy, the existing commit-wake outbox, and the exact-attempt redelivery owner.
Prove response idempotency and ensure direct wake is an optimization over
durable scheduler truth, not a replacement for it.

### [ ] P06 — Prove And Close

Run focused package/app tests, type checks, Effect boundary checks, required
reviewers for every significant code checkpoint, and the real-Postgres suite
for changed persistence behavior. Update the living roadmaps to match the
implemented boundary and leave deployment/activation explicitly pending unless
separately authorized.

### Current P02a Boundary

`flarex-protocol/point-mutation-exact-runtime` owns the literal V1 request and
result formats. Requests carry the verified artifact/function projection, the
complete bounded authenticated user identity with claim and key-order parity,
owned arguments, the table-ID/name projection, and deterministic execution
context. They never carry a verified grant, attempt handle, serialized journal
handle, bearer token, database client, or persistence capability.

New source packages use the explicit `sha256-framed-v1` module-digest format.
Its domain-separated, length-framed preimage distinguishes raw NUL bytes and
absent versus empty source maps. New push admission and artifact publication
require that marker. Ordinary artifact reads remain compatible with unmarked
legacy digests, but exact reruns reject them because the old delimiter format
cannot prove the same byte identity.

`flarex-backend/artifact-runtime` owns the dedicated named
`WorkerEntrypoint`, immutable worker-definition identity, pinned source-package
loading and integrity classification, frozen modules, empty env,
`globalOutbound: null`, and fresh Worker loading. The generated Worker admits
one invocation and installs the deterministic profile before importing user
modules:

- `Date`, `Math.random`, and `performance` use authenticated attempt or pinned
  module inputs;
- inherited and own timers, Cache API, fetch, MessageChannel,
  BroadcastChannel, WebSocketPair, ambient-time `File`, async WebAssembly, and
  async Web Crypto are unavailable, including through the workerd global
  prototype chain;
- import-time time is compatibility-date midnight and import-time randomness
  is seeded by source-package hash; and
- Web Crypto digest and the other blocked asynchronous platform surfaces are
  explicit Flarex exact-rerun differences. They remain unavailable until a
  deterministic scheduler can preserve their completion ordering relative to
  journal RPC.

The journal remains a method argument. Table resolution returns nested RPC
capabilities, operations receive globally ordered bigint syscall sequences,
and write values are synchronously normalized, bounded, detached, and frozen.
Handler settlement closes new database admission; already-admitted work drains
to a stable tail, while the first local or remote journal failure remains
fatal. Journal documents must preserve system fields and requested/table
identity. The generated entrypoint never calls the ordinary invoke
start/syscall/finish/abort routes.

P02a adds no database client, journal RPC server implementation, scheduled
handler, Wrangler trigger, public route, or `C06-B` endpoint. It is not yet the
initial mutation host, so P02c must not activate exact redelivery until the
initial path uses the same runtime profile.

One non-blocking adapter debt remains visible: the local executor materializer
manually reconstructs `PushSourcePackage` after storage instead of entering
through the protocol-owned decoder and then applying only the stronger
materialized-module checks. The digest-format marker had to be threaded through
that duplicate decoder in P02a, proving the drift risk. Handle this as a bounded
compatibility-preserving follow-up before P02c activation; preserve the current
package-specific validation order and messages while doing so.

### P02a.1 Checked Runtime-Source Refactor

P02a proved that the Worker Loader boundary legitimately ends in JavaScript
source text, but it currently authors the complete runtime inside one large
template literal. That representation weakens TypeScript checking, editor
navigation, safe refactoring, formatting, generated-runtime source maps, and
reviewability. P02a.1 changes how the trusted runtime source is produced, not
what authority or behavior it has.

The target module graph is:

```text
flarex-point-mutation-exact-runtime-v1.js
  build-produced from checked TypeScript; exports the named WorkerEntrypoint
  ├─ static import: flarex-point-mutation-exact-runtime-config-v1.js
  │    tiny trusted artifact-specific configuration
  └─ dynamic import after global hardening:
       flarex-point-mutation-exact-runtime-execution-v1.js
         generated literal import of the authenticated application
         execution module
```

The application execution module must not become a static dependency of the
runtime core. Static ESM dependencies evaluate before module body code, which
would let developer module initialization run before exact runtime globals are
installed. The checked core therefore remains the main module and installs its
deterministic and unavailable-capability globals before dynamically importing
the fixed internal execution bridge. Its only static local dependency is the
trusted generated configuration module. The bridge alone contains the
JSON-escaped literal application-module import.

The core JavaScript is built ahead of Worker invocation and embedded as an
owned source string. No request or rerun may invoke a runtime TypeScript
compiler or bundler. A checked-in generated source owner must expose the exact
runtime bytes and their lowercase SHA-256 identity; the package build and tests
must fail when that artifact is stale. The host code identity must include that
runtime-source identity, or an equivalent versioned proof, so trusted runtime
bytes cannot change silently under one identity.

All three internal module paths are host-owned reservations. Application source
packages must fail definition construction if they collide with the main core,
configuration, or execution-bridge path. The generated configuration module
may carry only bounded artifact-specific values already authenticated by the
host: module-evaluation time, pinned source-package hash, and protocol/profile
constants. Mutation invocation time and randomness remain authenticated
request context and must still replace the module-evaluation defaults before
the handler runs.

P02a.1 acceptance requires:

1. the checked TypeScript core and generated artifact reproduce the existing
   Node and real-workerd exact-runtime behavior;
2. global hardening demonstrably precedes developer-module evaluation;
3. request, result, auth, journal, document, and write validation order and
   error classification remain unchanged;
4. ignored and late journal work, first-failure precedence, stable-tail drain,
   one-shot admission, and fresh mutable auth projection remain unchanged;
5. generated-source freshness, byte identity, deterministic repeat builds, and
   every reserved internal path are pinned by focused tests; and
6. no `loader.load()`, database adapter, scheduler host, public route, generic
   executor binding, or P02b journal RPC server is added.

Completion receipt (2026-07-25):

- the named main module is now emitted deterministically from checked
  `PointMutationExactRuntimeWorkerCore.ts`, with a stable inline source map,
  checked-in source bytes, and SHA-256
  `66b64901b50fe3a3f1fc4c2249cf2dac29681e84c07bf8a19c113c6846e1374e`;
- the host supplies only the trusted artifact configuration and literal
  execution-module bridge, reserves canonical aliases of all three internal
  paths, and includes the main path/hash, entrypoint, and exact support-module
  path/source pairs in code identity;
- the former public single-source generator remains as a deprecated adapter
  over the checked core, while the production definition uses the three-module
  graph;
- package build and tests reproduce the generated artifact twice and reject a
  stale checked-in copy; the real-workerd test proves application module
  initialization observes deterministic time and blocked timers; and
- final post-review validation passed the backend build/typecheck, Effect
  boundary check, focused 47-test runtime suite, frozen lockfile check, and both
  required final reviewers with no remaining findings; the preceding
  package-wide backend checkpoint also passed 97 files and 879 tests before the
  final focused hardening assertions and reviewer fixes.

### Current P02b Boundary

Completion receipt (2026-07-25):

- `@flarex/executor/point-mutation-journal-rpc` now owns one attempt-scoped
  parent `RpcTarget`, nested table targets that retain the original process-
  local table handles, and one uninterruptible `closeAndDrain` Effect;
- every RPC method admits synchronously, retains its complete local Effect
  cause by admission order, returns only the fixed redacted stop error
  remotely, and shares one fail-closed lifecycle across the parent and all
  children;
- closure is idempotent, stops new parent and child calls, and drains the
  stable admitted-call set before re-emitting the earliest cause without
  turning typed failures, defects, or interruption into each other;
- the real-workerd two-Worker proof covers nested capability identity, actual
  `RpcStub` disposal, remote redaction, original typed-error identity,
  close-before-drain, late-call rejection, failure admission order, defects,
  and interruption; its explicit transferred-stream latch has no fixed-delay
  ordering assumption or provider-global cross-request Promise; and
- final post-review validation passed the executor typecheck, all 26 active
  files and 327 active package tests, the Effect runtime-boundary check,
  focused 7-test workerd suite, frozen lockfile check, diff check, and both
  required final reviewers with no remaining findings.

P02b does not load a Dynamic Worker, add an artifact-runtime or executor
entrypoint, alter the runtime-neutral runner, host a scheduled event, expose a
route, or activate redelivery.

### Current P02c.1 Boundary

Completion receipt (2026-07-25):

- `FlarexPointMutationExactRuntimeArtifactHostV1` is the only new
  artifact-runtime entrypoint. Its versioned private RPC method strictly
  decodes and owns the exact request before constructing the R2 store or
  consulting Worker Loader; no Fetch route, bearer-token substitute, or
  generic executor binding was added;
- the host reuses the content-addressed artifact store and exact-runtime
  definition owner, calls `loader.load()` exactly once per invocation, selects
  only `FlarexPointMutationExactRuntimeV1`, forwards the live journal stub as a
  method argument, awaits the complete call, and strictly decodes the result;
- the versioned host response admits only strict success or one bounded
  failure reason. Expected request, source-package, definition, load,
  user-code, journal-boundary, and invalid-result failures become data;
  unexpected Dynamic Worker rejection remains a defect rather than being
  mislabeled as a recoverable host failure;
- the artifact host disposes its received journal and Dynamic Worker
  entrypoint stubs in Effect finalizers. The generated exact Worker separately
  owns and disposes every nested table stub plus its received parent stub,
  attempts all child cleanup, reports cleanup failure as a journal-boundary
  failure on an otherwise successful run, and never replaces an already
  established execution or decode failure;
- Workers RPC adds a top-level disposer to every returned object. The host
  therefore scopes and disposes the raw Dynamic Worker result, copies its own
  data properties while removing only the platform-owned `Symbol.dispose`,
  and applies the strict protocol decoder to that plain boundary value. P02c.2
  applies the same host-response adaptation at its own RPC caller boundary
  without weakening either strict protocol decoder; and
- focused protocol, backend, and artifact-runtime tests cover strict
  version/shape rejection, decode-before-R2 ordering, fresh-load count, named
  entrypoint selection, capability forwarding, strict result validation,
  expected-versus-defect classification, and cleanup. The deployable Worker
  also passes Wrangler dry-run packaging with the existing R2, service, and
  Worker Loader bindings.

P02c.1 does not construct the executor runner, create or settle the P02b
journal session, install anything in the stored-attempt graph, add a scheduler
or trigger, alter the ordinary cached invoke route, or activate execution.

### P02c.2 Boundary

- `makePointMutationExactRuntimeRunnerV1` is the executor-owned implementation
  of the existing runtime-neutral runner contract. It projects only literal
  artifact, function, authenticated identity, argument, stable table-binding,
  and deterministic context fields into the strict P02a request; it does not
  send the verified-grant inspection, schema manifest, attempt fence, snapshot
  token, journal handle, or another process-local authority across RPC;
- anonymous and verified-bearer grant evidence become the exact runtime auth
  contract, including the established `issuer|subject` token identifier.
  `trustedDev` remains unsupported by the point-mutation policy and fails
  closed during strict request projection before the artifact binding runs;
- every invocation creates one P02b journal RPC session, passes only its live
  parent target to the private artifact-runtime method, awaits the complete
  uncancellable Workers RPC chain, and then closes and drains the journal
  graph. A pending interruption is re-emitted only after the RPC settles and
  cleanup completes, so it cannot detach a remote Worker that still owns the
  journal capability;
- journal settlement retains full `Cause` semantics and wins over the
  independent host outcome. A successful host result is accepted only after
  drain; a local typed journal failure, defect, or interruption is re-emitted
  without reconstruction, including when remote user code caught the redacted
  journal stop;
- the runner owns and disposes the top-level host RPC result, copies only its
  own data properties while removing the platform-owned `Symbol.dispose`, and
  applies the unchanged strict host-response decoder. User failure becomes
  `PointMutationOccUserCodeV1Error`; request, artifact, load, protocol, and
  adapter-proven transport failures use the bounded
  `PointMutationExactRuntimeRunnerHostV1Error` channel;
- Cloudflare propagates remote exceptions and platform call failures through
  one rejected-Promise surface. The runner therefore requires its trusted host
  adapter to positively classify an expected transport failure; every
  unclassified rejection remains a defect. This prevents a broad `catch` from
  relabeling remote defects as recoverable infrastructure errors; and
- the focused real-workerd suite covers anonymous and bearer projection,
  unsupported-auth fail-closed behavior, user/host/transport separation,
  strict excess-property rejection, response disposal, original journal-cause
  precedence, defect identity, interruption ordering, open admission until host
  settlement, and late journal rejection.

P02c.2 does not install the runner into the stored-attempt composition graph,
add an executor service binding, create another execution authority, add a
scheduler or trigger, alter the ordinary cached invoke route, or activate
execution.

## Resume Checklist

Current gate: **P02c.3 — stored-attempt composition proof.**

On resume:

1. read this plan plus the P02a protocol/runtime and P02b journal-RPC
   boundaries;
2. treat the completed P02c.1 private RPC host and P02c.2 exact runner as the
   only artifact-runtime path for exact attempts;
3. install that runner only through the existing stored-attempt dependency
   graph, with one private named artifact-runtime binding adapter and a narrow
   expected-transport classifier;
4. prove one initial-shaped execution and one redelivery-shaped execution use
   the same runtime-neutral runner without creating a replacement session,
   parallel retry machine, serialized journal authority, or Dynamic Worker
   database binding; and
5. keep the ordinary cached invoke route outside this exact-attempt path and
   leave production activation blocked for P02c.4 parity proof.

Do not add the database scheduler host, cron handler, scheduled export,
Wrangler trigger, public route, or `C06-B` response policy during P02c. P04
remains blocked until P02c.4 proves that the production initial point-mutation
host uses this same fresh exact runner; the legacy cached invoke Worker does not
satisfy that gate.

## Completion Condition

This plan is complete only when a deployed-shape trusted host can awaken from
the durable checkpoint, run bounded exact-attempt redelivery through the
singular execution authority, settle all owned resources deterministically,
and compose stable idempotent finish/lost-outcome dispatch without relying on
isolate memory, exposing a public scheduler surface, or creating a parallel
session or retry state machine.
