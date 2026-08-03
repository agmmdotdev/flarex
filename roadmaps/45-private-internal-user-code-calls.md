# Third FlarexDB System API Vertical: Private Internal User-Code Calls

## Status And Scope

**Status:** `SAP06-A1`, `SAP06-A2`, and `SAP06-A3` are complete as private,
route-independent, production-inert capabilities. One public query may call an
authenticated same-candidate internal query inside one accepted SAP05
execution. One public mutation may call authenticated same-candidate internal
queries inside the existing SAP04 Worker, attempt, journal, and live overlay.
The combined `SAP06-A3` profile now lets admitted public or internal mutations
call authenticated same-candidate internal mutations while retaining the same
Worker, journal, overlay, OCC retry, and single parent publication. Roadmap 43
remains closed as the first point-mutation vertical and roadmap 44 remains
closed as the second point-query vertical.

This roadmap owns the separately gated internal-call family. It does not make
all call directions equivalent and does not expose another top-level System or
Standard operation merely because user code gains internal-call methods.
All three implemented slices remain private, route-independent, production-inert,
and bound to the already selected application revision.

Read this record with
[`40-host-neutral-function-runtime.md`](./40-host-neutral-function-runtime.md),
[`42-standard-application-apis.md`](./42-standard-application-apis.md), and
[`44-second-flarexdb-system-api-point-query-vertical.md`](./44-second-flarexdb-system-api-point-query-vertical.md).
Roadmap 40 retains portable execution semantics, roadmap 42 retains the
Standard API family, and roadmap 44 retains the completed PQV-A1/PQV-A2/SAP05
owners that this implemented slice composes.

## Current Evidence

| Existing owner | Current fact | Consequence |
| --- | --- | --- |
| `packages/flarex/src/server.ts` and `packages/flarex/src/api.ts` | `QueryCtx` already types `runQuery`; function references carry query/mutation kind plus public/internal visibility | The developer type vocabulary exists, but a structural function reference is a selector, never runtime authority |
| `packages/analysis/src/declarativeV2VerifierV1.contract.ts` and `declarativeV2VerifierExecutableV1.contract.ts` | Core V1 defines `functionReference`, mixed-catchability `runQuery`/`runMutation`, static call targets, query-to-query permission, and query-to-mutation rejection | SAP06-A1 found that the executable admitted missing and dynamic nested-call operands despite that contract. The direct fix now requires one canonical literal `{ _path: "module:export" }` operand and direct `await` consumption; it refreshes only the private analyzer implementation identity and persists no call graph |
| `packages/function-runtime/src/pointQuery.ts`, `pointQueryInternalCall.ts`, `pointMutationInternalQuery.ts`, and `pointMutationInternalCall.ts` | the accepted PQV-A2, SAP06-A1, and SAP06-A2 kernels remain frozen; SAP06-A3 owns the combined mutation internal-call kernel | SAP06-A3 composes query and mutation children with the mutation journal rather than PQV-A1 or a child transaction |
| `packages/flarex-protocol/src/point-query-exact-runtime.ts` | the request and syscall ABI are query-only, public-only, and contain no internal-call catalog or call budget | Existing V1 must not be silently widened |
| `packages/flarex-backend/src/artifactRuntime/PointQueryExactRuntimeWorkerCore.ts` and `PointQueryExactRuntimeHost.ts` | the exact Worker graph registers only the selected public query and shares one PQV-A1 read capability | Internal query calls require a new private target/profile/ABI, not a legacy generated-runtime fallback |
| `packages/persistence-postgres/src/applicationPointQuerySnapshotV1.ts` | PQV-A1 owns one Scope-revoked snapshot, active-head revalidation, retained-history check, and monotonic point-read/document-byte budgets | An inline callee can share this exact capability; opening a second snapshot would be incorrect |
| `packages/persistence-postgres/src/applicationRevisionQueryRuntimeTargetV1.ts` | the active candidate already authenticates canonical metadata and R2 function-entry/projection evidence, but the current claim selects one public query | The stored evidence can authenticate internal query callees without schema or migration work |
| `packages/flarex-backend/src/artifactRuntime/CandidateBoundPointQueryRuntimeTargetV1.ts`, `CandidateBoundPointQueryInternalCallRuntimeTargetV1.ts`, `CandidateBoundPointMutationInternalQueryRuntimeTargetV1.ts`, and `CandidateBoundPointMutationInternalCallRuntimeTargetV1.ts` | the earlier targets remain frozen; SAP06-A3 owns the combined ordered-catalog/R2 materialization without body duplication | SAP04 selects only the combined profile; no accepted identity is widened or retained as fallback |
| `packages/standard-application-invocation/src/querySystemV1.ts` and `v1.ts` | SAP05 now selects only the SAP06-A1 internal-call query profile and keeps active read, PQV-A1, Workerd dispatch, result validation, and Scope in one private composition | This remains query regression evidence; mutation-to-query must stay inside SAP04 rather than call SAP05 |
| `packages/standard-application-invocation/src/systemV1.ts`, `packages/executor/src/storedAttemptAuthentication/exactPointMutationExecutionOperations.ts`, and `packages/executor/src/pointMutationExactRuntimeBinding.ts` | SAP04/FSV06 resolves one active selection, mints/adopts one grant and attempt, runs one exact Worker against one journal, reruns only through the accepted OCC owner, and returns one authoritative outcome | SAP06-A2 replaces only the private runtime target/profile selected inside this existing composition; it adds no invocation, grant, attempt, or outcome |
| `packages/flarex-backend/src/artifactRuntime/PointMutationExactRuntimeWorkerCore.ts`, `packages/executor/src/pointMutationJournal.ts`, and `packages/persistence-postgres/src/sessionJournalStore.ts` | Mutation `db.get` already serializes through the exact journal capability. `readLogicalPoint` reads a live/deleted staged overlay first and reaches the pinned snapshot only when no overlay exists | This is the exact read-your-writes authority for an inline internal query. PQV-A1, SAP05, a child transaction, and a savepoint are all incorrect for SAP06-A2 |
| `../../npm-packages/convex/src/server/registration.ts` | Convex documents nested `runMutation` as a sub-transaction whose writes roll back when the child throws | Flarex's current C03 journal has no child checkpoint/savepoint owner. The bounded A3 proposal therefore records an explicit first-slice divergence: caught application-owned child failures preserve already settled writes; matching Convex rollback requires a separate transaction/journal preflight |
| `packages/flarex-backend/src/artifactRuntime/GeneratedWorkerSource.ts` | the legacy generated runtime has structural nested calls and a depth counter | It is compatibility evidence only; it is not an authority or fallback for the accepted exact runtime |

The private mutation runtime now implements the exact internal-query call, but
no database row stores call-site or call-chain authority. The candidate already
stores the function metadata, function-group manifest, entry references, and
transaction projection required to authenticate same-candidate internal-query
targets. SAP06-A1 and SAP06-A2 therefore use separate private protocol/runtime
identities without a schema, migration, transaction owner, package extraction,
or production route.

## Call-Class Decision

| Call class | Decision | Owner/gate |
| --- | --- | --- |
| external/System caller -> internal query | Forbidden. `invokeApplicationPointQueryV1` continues to accept only a public query | Existing SAP05 boundary |
| external/System caller -> internal mutation | Forbidden. SAP04 continues to accept only a public mutation | Existing SAP04 boundary |
| public or internal query handler -> internal query | **First slice.** Inline execution in the same exact query Worker and PQV-A1 snapshot | `SAP06-A1` |
| query handler -> any mutation | Forbidden by the Core capability matrix and by runtime defense | Permanent query rule |
| public mutation handler -> internal query | **Complete privately.** Inline in the same exact mutation Worker and live journal overlay | `SAP06-A2` below |
| internal mutation handler -> internal query | The `runQuery` context semantics are settled by `SAP06-A2`, but no internal mutation becomes executable until `SAP06-A3` supplies legitimate inline mutation-entry authority | `SAP06-A2` runtime surface plus later `SAP06-A3` entry gate |
| public or internal mutation handler -> internal mutation | **Complete privately.** Inline in the same exact mutation Worker, attempt, journal, and live overlay | `SAP06-A3` below |
| action/workflow/scheduled/background call | Excluded | Separate action, workflow, and durable-task gates |

“Public caller” and “public function” are distinct. A remote caller never
selects an internal function. In SAP06-A1 an already admitted public query
handler may use its host-provided `ctx.runQuery` to select one registered
internal query in the same candidate.

## `SAP06-A1`: Inline Query-To-Internal-Query Calls

### Authority And Target Selection

The call remains bound to the root invocation's exact:

- FSV05 active selection, application revision, candidate, activation, and
  readiness evidence;
- scope ID, `flarexdb_v1` generation, generation fence, and epoch;
- PQV-A1 snapshot commit and retained-history/liveness checks;
- authenticated user identity, execution identity, deterministic time/random
  state, and root public query;
- canonical function-metadata digest, transaction projection, function-group
  manifest, and R2 references; and
- operation Scope and cancellation lifetime.

Cross-revision, cross-candidate, cross-scope, and active-head re-resolution are
forbidden. A callee must be an exact `kind=query`, `visibility=internal`,
`group=transaction` entry from the same canonical metadata and function-group
manifest. Its ordinal, path, logical and artifact module, export, validators,
projection reference, module membership, and R2 object commitments are checked
before Worker construction. User code supplies only the statically verified
function-reference selector and arguments; it cannot supply metadata, target
digests, snapshot tokens, R2 references, database handles, or capabilities.

The implemented target binds the ordered set of all exact internal transaction
queries in the candidate, sorted by function ordinal with path as a defensive
tie-breaker. The accepted analyzer remains responsible for proving that a
`runQuery` operand is a static function reference. A persisted call graph or
call-site digest is not required: authorization is candidate plus kind plus
internal visibility, not source-location authorization. Adding call-site
publication would create a new analyzer semantic record, candidate identity,
and storage contract and is rejected for this slice.

### Snapshot And Transaction Semantics

The root opens PQV-A1 once. Every callee receives the same live point-read
capability and the same snapshot commit. Reads consume the same atomic
`maximumPointReads` and `maximumDocumentBytes` counters and repeat PQV-A1's
scope-clock, active-head, epoch, fence, and retained-floor validation. No child
may open a snapshot, receive a token, or reset a read budget.

SAP06-A1 is read-only and owns no SQL transaction across user-code execution.
Each PQV-A1 point read retains its existing short located transaction. There
is no nested transaction, savepoint, journal, read-set owner, commit, durable
outcome, idempotency key, feed item, or outbox item.
Confirmed read-transaction rollback and foreign integration uncertainty retain
PQV-A1's existing typed failure ownership. Because no write decision exists,
SAP06-A1 adds no commit-uncertainty settlement or replay identity.

Later mutation calls are inline composition, not scheduled invocations:
SAP06-A2/A3 must reuse one existing mutation attempt, grant, session, journal,
read/write overlay, predecessor/reservation/receipt lineage, OCC retry, and
terminal outcome. They must never call SAP05/PQV-A1 from inside a mutation or
create a child C07 commit.

### Private Runtime And ABI Decision

Do not widen the accepted
`flarex.system/candidate-bound-query-runtime-target/v1`,
`point-query-exact-runtime-v1`, or
`flarex.system/point-query-syscall-abi/v1` spellings. SAP06-A1 uses these
new private versioned identities:

- `flarex.system/candidate-bound-query-internal-call-runtime-target/v1`;
- `point-query-internal-call-exact-runtime-v1`; and
- `flarex.system/point-query-internal-call-syscall-abi/v1`.

The existing root request/result value codec may be reused because the child
call is inline and creates no child host message. The new target preimage must
add the ordered internal-query catalog, its validators and entry references,
and the shared call-budget policy. Its Worker graph exposes exactly
`ctx.runQuery` in addition to the accepted query-only auth and PQV-A1 point
read. It imports the same already-verified transaction projection from R2 and
builds an exact registry for the root plus admitted internal callees. It never
uses the legacy `PushSourcePackage` runtime or structural registry as fallback.

The SAP05 private composer moves to this new profile as the sole internal-call
capable path. The PQV-A2 V1 identities remain frozen
evidence and are not dual-selected at runtime.

The host retains the opaque target and the single PQV-A1 capability behind
Scope-revoked WeakMap authority. The Worker receives only the bounded call
surface. Each call is checked against the configured catalog before handler
resolution. Scope closure, active-selection supersession, cancellation, or
read-boundary failure makes all later root and child operations fail closed.

### Identity, Call Chain, And Auth

The callee inherits the exact immutable user identity and execution identity.
There is no impersonation, service identity, auth override, new token, or
callee-specific authorization context. Time and randomness remain the root
Worker's deterministic state and are not reset per child.

An operation-local call frame records root execution ID, parent function
ordinal, callee ordinal, monotonically increasing call sequence, and depth for
diagnostics, cycle detection, and spans. This frame is not durable authority
and is not hashed into persistence. The candidate and new runtime-target digest
already commit the callable functions. A later requirement for durable
per-call provenance or source call-site attribution needs a separate protocol
and analyzer preflight.

### Validation And Failure Semantics

The host validates the complete callee catalog before Worker construction. The
Worker validates callee arguments before handler entry and validates and
canonicalizes the callee result before returning it to the parent handler. The
root result still receives SAP05's post-Worker registered return validation.

`runQuery` retains the accepted mixed-ABI rule:

- a declared `CoreApplicationErrorV1` and deterministic callee argument or
  return-validator rejection are application-owned and may be caught by the
  parent user function;
- an unknown target, wrong kind/visibility/group/module/export, inconsistent
  metadata, or missing catalog member is a target/corruption failure and is
  terminal because accepted analysis should already have rejected it;
- stale/closed/superseded/mixed authority, R2 absence/corruption, PQV-A1 read
  failure, retained-history failure, protocol/host failure, cleanup
  uncertainty, resource or call-budget exhaustion, cancellation,
  interruption, timeout, and defects remain terminal and cannot be converted
  into application success by a user catch block; and
- full `Cause` remains owned by the Effect/host boundary. Ordinary domain
  composition must not catch or flatten defects.

The Worker tracks terminal host failures outside the user Promise chain and
re-emits them when the shared read/call boundary drains, matching the accepted
fail-closed query and FSV06-A2 principles.

### Budgets, Recursion, And Cycles

The new canonical target commits these operation-wide ceilings:

- maximum internal calls: 64;
- maximum nested internal-call depth: 8;
- cumulative internal-call argument semantic bytes: 8 MiB;
- cumulative internal-call result semantic bytes: 8 MiB; and
- the existing PQV-A1 read/document, PQV-A2 module/object/raw/hash/root-result,
  Worker cancellation, compatibility-date, and platform execution ceilings.

Every attempted call charges the monotonic call counter before target lookup.
Argument/result bytes are charged before handler entry/result return. Child
calls do not reset read, R2, module, hashing, deadline, CPU, time, or random
state. No separate instruction counter exists today; the child remains inside
the root Worker/platform CPU and cancellation envelope and receives no extra
runtime allowance.

Direct and indirect recursion are forbidden initially. The runtime rejects a
callee ordinal already present on the active stack. Sequential repeated calls
to the same function after the prior call returns are allowed while cumulative
budgets remain. Depth and cycle rejection are host policy and remain terminal;
they are not catchable application control flow.

### Observability And Publication

The parent operation remains the only invocation/outcome identity. A
process-local child span may use root execution ID plus call sequence and
callee path, but it creates no durable child receipt. Query calls publish no
journal operation, app-row revision, committed outcome, commit/change-feed
fact, or outbox event.

This is not an action or background job. The child runs synchronously/inline,
shares the parent Scope and snapshot, must finish before the parent result, and
cannot survive interruption. Actions, workflows, schedules, hosted dispatch,
retries across waits, and durable task identity remain separate capabilities.

### Proposed Effect Contract

SAP05's top-level signatures and result remain unchanged. The new private
operation is an operation-scoped capability, not a singleton service and not a
public Standard function:

```ts
callInternalPointQueryV1(
  parent: AuthenticatedCandidateBoundInternalQueryRuntimeTargetV1,
  functionRef: StaticInternalQueryFunctionReferenceV1,
  args: unknown,
): Effect.Effect<
  CanonicalFlarexRuntimeValueV1,
  InternalPointQueryApplicationV1Error |
    InternalPointQueryTargetV1Error |
    ExistingPqvA1AndRuntimeOwnerErrors,
  Scope.Scope
>
```

The Worker-facing method is the corresponding Promise surface required by
user code. Only declared application/validator failures cross back as
catchable rejections. The Effect boundary retains target, R2, stale,
integration, cancellation, cleanup, and full-Cause ownership. The SAP05
`ApplicationPointQuerySystemV1` Layer remains the private composition owner;
dynamic target/call state stays per invocation.

## Implemented Path Ownership

`SAP06-A1 — Inline Query-To-Internal-Query` landed as one bounded capability
after the private identity/trust decision above was accepted.

Likely owned paths:

- `packages/flarex-protocol/src/` new target/ABI contracts, package subpath,
  and vectors;
- `packages/function-runtime/src/` a deliberate internal-call-capable query
  kernel subpath and semantic tests;
- `packages/persistence-postgres/src/` one private authority adapter over
  existing active-selection, snapshot, metadata, and publication owners;
- `packages/flarex-backend/src/artifactRuntime/` target preparation, R2
  verification, exact Worker core/host/source, and generated identity closure;
- `packages/standard-application-invocation/src/querySystemV1.ts` for the first
  real private composition consumer;
- focused analyzer-contract, protocol, runtime, Workerd, PGlite, and genuine
  PostgreSQL tests; and
- this roadmap, roadmap 42, roadmap 44 cross-reference if implementation truth
  requires it, the System API proposal, and the registry.

No package extraction or workspace dependency is expected. Stop before code if
implementation proves that call-site edges must become analyzer/persistence
authority, that a schema/migration is needed, or that the existing transaction
projection cannot materialize every authenticated internal callee.

## Implemented SAP06-A1 Boundary

SAP05 now selects only the separate internal-call-capable target/profile/ABI.
The accepted PQV-A2 V1 target and generated runtime identities remain unchanged
regression evidence and are not dual-selected. The new target authenticates the
root public query plus the canonically ordered same-candidate internal-query
catalog from canonical function metadata, the transaction projection,
function-group manifest, and exact R2 references. PostgreSQL stores no runtime
body and no call-site or call-chain record.

The exact Worker adds one private synthetic `flarex:platform` module to the
committed Worker graph. Analyzer-approved `runQuery`, `databaseGet`, and auth
operations delegate through an operation-local context stack to the same
PQV-A1 capability; exact R2 application bodies are neither rewritten nor
copied into PostgreSQL. Root and child execution share one Scope, snapshot,
read boundary, cancellation lifetime, deterministic environment, and monotonic
budgets. A child gets no transaction, journal, durable receipt, outcome, feed,
or outbox authority.

The fixed implementation identities are:

- `flarex.system/candidate-bound-query-internal-call-runtime-target/v1`;
- `point-query-internal-call-exact-runtime-v1`; and
- `flarex.system/point-query-internal-call-syscall-abi/v1`.

The generated query kernel digest is
`440d051b477bbec4ce9f1949c402d84233dd2fdcdeb999b092af89cc36f73b05` and
the generated exact Worker core digest is
`98982f46c8893bbfee4289605ac81260c8c6eb5178f902d5950e3b90ce59e65b`.
The analyzer implementation identity is
`b8d1e425b5afb3b8ca17844d486a142fdca2c10dde2a1834228436fbb1579b56`;
the refresh closes the existing-contract static-operand and child-lifetime
admission gap without introducing a new analyzer protocol identity.
SAP06-A3, production routing, and every internal-mutation call class remain
open.

## `SAP06-A2`: Mutation-To-Internal-Query

### Decision And Smallest Truthful Slice

The current owners compose without a schema, migration, persisted call graph,
new transaction owner, or change to C07 publication semantics. The smallest
truthful next implementation is:

> one externally admitted public mutation may call one authenticated
> same-candidate internal query through `ctx.runQuery`; that child, and any
> internal-query child it directly awaits, execute inline in the same exact
> mutation Worker and read only through the parent attempt's live C03 journal
> overlay.

This slice does not make an internal mutation externally selectable. It gives
the mutation runtime a read-only internal-query frame. A later `SAP06-A3` may
reuse that frame only after it establishes legitimate internal-mutation entry
authority; `SAP06-A2` itself admits only the existing public SAP04 root.

Nested internal-query-to-internal-query is included. All nested query frames
stay on the mutation overlay and one operation-local stack and budget. Deferring
that direction would require an artificial context-dependent rejection of the
already authenticated query catalog and would not create a safer authority
boundary. Query-to-mutation remains forbidden at every depth. No child may use
SAP06-A1, SAP05, PQV-A1, or a query snapshot as fallback.

Implementation requires explicit user approval of the three private identities
below. No other material boundary is open.

### Existing Mutation Owner Chain

The exact current chain to preserve is:

```text
invokeStandardApplicationPointMutationV1
  -> FSV05 coherent active selection
  -> C03-V syscall-validator capability
  -> candidate-bound R2 mutation target and route-independent binding
  -> server-prepared request + issuer/executor preparation
  -> authenticated transaction grant and current-epoch admission
  -> one point-mutation session activation and execution claim
  -> PointMutationInitialExecution / exact-attempt authentication
  -> PointMutationExactRuntime binding runner
  -> PointMutationJournal over SessionJournalStore
  -> sealed journal + authenticated commit input
  -> existing C04C1/O06/O07-B/C07 OCC and commit owners
  -> one authoritative outcome, application-row publication, feed, and outbox
```

`packages/standard-application-invocation/src/systemV1.ts` owns the private
composition and outcome-first replay. The stored-attempt graph owns exact
execution, authorized OCC rerun, finishing, uncertainty observation, and
outcome lookup. `SAP06-A2` changes none of those owners and creates no child
lineage identity.

### Exact Read-Your-Writes Authority

The child read authority is the already admitted `PointMutationJournalV1`
attempt/table capability, backed by `SessionJournalStorePersistenceV1`.
`PointMutationExactRuntimeWorkerCore.databaseForJournal` serializes each
`db.get` with the same monotonic syscall sequence and calls the same opaque
table capability as the root mutation. `SessionJournalStore.readLogicalPoint`
then:

1. loads the exact attempt/table/row journal point;
2. returns the canonical live overlay or deleted result when staged state
   exists;
3. otherwise reads at the attempt's pinned snapshot; and
4. records or reuses the same point dependency and charges the same journal
   read/document counters.

The child receives a genuinely read-only view of that live database boundary:
`get` delegates to the same journal object, while insert, patch, replace,
delete, query/index, normalization, and system operations are unavailable and
fail closed. TypeScript omission alone is insufficient; the exact Worker
surface must install rejecting operations. A child read may add the ordinary
point dependency/receipt evidence already owned by C03, but it can never append
a logical write event or change an overlay.

There is no long SQL transaction across user code. Each journal syscall keeps
its existing short transaction. Read-your-writes comes from durable exact-
attempt overlay evidence, not from an open database transaction.

### Ordering, Visibility, And Failure Effects

All root and child database operations share the existing serialized journal
tail and syscall sequence. Therefore:

- a parent insert, patch, replace, or delete that settles before `runQuery` is
  visible to every child read;
- a child read settles before a later parent operation and contributes to the
  same dependency/read accounting;
- later parent writes are visible to later child calls;
- child argument rejection occurs before handler entry and performs no read;
- a caught declared application error or child return-validator rejection does
  not roll back earlier reads or parent writes, and charged call/read/byte
  budgets remain charged; and
- a terminal child failure poisons/drains the shared boundary and prevents the
  parent attempt from sealing successfully even if user code catches the
  JavaScript rejection.

There is no child savepoint or application-visible rollback. A read-only child
cannot independently mutate journal state, and a caught application-owned
failure is control flow inside the one parent attempt rather than a nested
transaction decision.

### Candidate, Catalog, And R2 Authority

The accepted active-selection state already carries canonical function
metadata, the transaction runtime projection, function-group manifest,
function-entry references, candidate commitments, and content-addressed R2
references. The existing SAP06-A1 authority adapter proves that these owners
can derive a canonical ordered internal-query catalog without a schema or
persisted call-site edge.

The mutation adapter must authenticate:

- the existing public root mutation and exact active revision/candidate;
- every same-candidate `kind=query`, `visibility=internal`,
  `group=transaction` callee;
- each ordinal, path, logical/artifact module, export, validators, projection,
  function-entry reference, manifest membership, and R2 commitment; and
- scope, generation fence, epoch, readiness, activation, compatibility date,
  exact Worker graph, and runtime policy.

Catalog order is ascending function ordinal with path as a defensive
tie-breaker. Duplicate ordinal/path or inconsistent metadata, manifest,
projection, module, export, or reference evidence fails before executable use.
User code supplies only the analyzer-approved literal function-reference
selector and arguments. It cannot author metadata, catalog entries, target
digests, journal capabilities, snapshot tokens, grants, attempts, or database
handles.

R2 remains the only body store. PostgreSQL remains authority, relationship,
commitment, journal, and application-data storage. The new target must verify
the exact projection, manifest, module, and function-entry bodies/references
using the accepted R2 owner; it must not copy bodies into PostgreSQL.

### Private Runtime And Identity Decision

The accepted mutation identities are frozen:

- `flarex.system/candidate-bound-runtime-target/v1`;
- `point-mutation-exact-runtime-v1`; and
- the current mutation syscall surface embedded by that profile.

They bind one public mutation and expose no authenticated internal-query
catalog or `ctx.runQuery`. Widening them would change their canonical target
meaning and generated Worker graph. `SAP06-A2` therefore implements exactly:

- `flarex.system/candidate-bound-mutation-internal-query-runtime-target/v1`;
- `point-mutation-internal-query-exact-runtime-v1`; and
- `flarex.system/point-mutation-internal-query-syscall-abi/v1`.

After implementation, private SAP04/FSV06 composition selects only the new
profile. The old mutation target/profile remain frozen regression evidence and
are not dual-selected, reinterpreted, or retained as fallback. The new target
binds active/candidate/R2 authority and the catalog; the existing authenticated
grant, session, runner evidence, journal capability, and attempt fence join it
at invocation time. The target does not invent a pre-attempt or persisted child
authority.

The exact Worker registry contains the public root mutation plus the admitted
internal queries. The root mutation context retains the accepted mutation
operations and adds `ctx.runQuery`. Each query frame receives auth, read-only
`db.get`, and `ctx.runQuery`; it never receives the mutation database object.
Root and children share one Worker, Scope, auth/execution identity,
deterministic time/random state, cancellation/deadline, journal, overlay, read
set, and terminal drain.

### Analyzer And Static Reference Gate

The accepted analyzer already:

- permits `runQuery` from a mutation under the Core capability matrix;
- requires the canonical directly awaited literal
  `{ _path: "module:export" }` operand;
- rejects missing, dynamic, forged, dropped, return-wrapped, and overlapping
  nested calls; and
- treats `runQuery` as mixed while preventing pure host-failure observation.

`SAP06-A2` uses that accepted behavior unchanged, but the exact persisted
mutation fixture exposed a generated-capacity proof defect: its canonical
source plus required nonempty module path exceeded the old 128-byte admitted
domain. The analysis-owned monotonic generator now selects 156 bytes and proves
157 is the first excluded capacity while keeping the operational arena ceiling
at 67,108,864 bytes. The selected proof requires 66,819,028 bytes; the first
excluded proof requires 67,534,609 bytes. The bounds identity changed from
`db2dd17538d9c26f8d03b01f244cb8d2bfe845bb8a41e3093261778b25c9b56b`
to `0c8fa2dc3b7b720dd48da148be06e47feb49747a075b09ca6e543075703cd8a0`.
The analyzer application identity remains
`b8d1e425b5afb3b8ca17844d486a142fdca2c10dde2a1834228436fbb1579b56`
because the private port remains outside its Worker bundle. This correction
adds no analyzer protocol identity. The analyzer proves the static operand;
the runtime target proves what that path is authorized to mean. Persisted
call-site or call-graph authority remains unnecessary and excluded.

### Failure And Catchability Contract

At the child `ctx.runQuery` boundary, only these failures are
application-catchable:

- declared `CoreApplicationErrorV1` from child user code;
- deterministic child argument-validator rejection; and
- deterministic child result-validator rejection.

The root mutation's already accepted C03-V document-validation catchability is
unchanged; a read-only child cannot invoke that write-validation operation.

Unknown catalog target, wrong kind/visibility/group/module/export, candidate or
R2 mismatch, stale/closed/superseded attempt or selection, journal/overlay/read
failure, OCC or integration failure, resource/call budget exhaustion,
cycle/depth rejection, cancellation, interruption, timeout, protocol/host
failure, uncertainty, cleanup failure, and defects are terminal. They are
recorded outside the user Promise chain and rethrown when the shared boundary
drains, so a JavaScript catch cannot turn them into application success. The
Effect/host boundary preserves full `Cause`; foreign failures are mapped once
at their owning boundary rather than flattened into a universal error.

### Budgets, Frames, Retry, And Replay

The runtime target commits the same operation-wide internal-call ceilings as
SAP06-A1:

- 64 attempted internal calls, charged before lookup;
- depth 8;
- 8 MiB cumulative argument semantic bytes, charged before handler entry; and
- 8 MiB cumulative result semantic bytes, charged before return to the caller.

These counters compose monotonically with the existing mutation syscall,
point-dependency, read-document/read-byte, write-operation/write-byte,
successful-result, module/R2/hash, deadline, cancellation, CPU, platform, time,
and random limits. Children reset none of them. Direct and indirect recursion
are forbidden by one active ordinal stack; sequential repeated calls after
return are allowed within cumulative budgets.

Frames contain root execution ID, parent/callee ordinal, monotonic call
sequence, and depth for diagnostics only. They are not persisted authority and
create no receipt.

An authorized OCC rerun remains a fresh execution attempt under the existing
attempt-replacement owner. It re-executes the same root request and immutable
runtime target at the new pinned snapshot with a new attempt-local journal,
overlay, syscall sequence, and call counters. Counters cannot reset within an
attempt; only the existing OCC owner may begin the next attempt. Child calls
repeat as part of the deterministic parent execution and create no independent
retry, request key, predecessor, reservation, receipt, or outcome. Confirmed
rollback and decision uncertainty remain settled exclusively by the existing
parent owners.

### Effect, Scope, And Publication Ownership

The public/private top-level signatures remain SAP04's existing
`invokeApplicationPointMutationV1` and thin Standard consumer. The new
operation is an invocation-scoped internal runtime capability, not a Context
singleton or another System operation. Its conceptual contract is:

```ts
runInternalPointQueryFromMutationV1(
  parent: AuthenticatedCandidateBoundMutationInternalQueryTargetV1,
  functionRef: StaticInternalQueryFunctionReferenceV1,
  args: unknown,
): Effect.Effect<
  CanonicalFlarexRuntimeValueV1,
  InternalQueryApplicationFailureV1 |
    ExistingMutationRuntimeJournalAndTargetOwnerErrors,
  Scope.Scope
>
```

The Worker-facing method is the Promise ABI required by user code. The
`ApplicationPointMutationSystemV1` Layer remains the shared private composition
owner; target, attempt, journal, call stack, and runtime state stay per
invocation. The child publishes no durable outcome. Successful mutation
publication remains exactly one parent application-row change set, authoritative
outcome, commit/change-feed sequence, and outbox batch through C07.

### Implementation Capability

The completed medium capability owns:

- `packages/flarex-protocol/src/`: the new target/profile/ABI contracts,
  defensive codecs, subpath exports, and vectors;
- `packages/function-runtime/src/`: one mutation-with-internal-query kernel
  that reuses the exact child-call mechanics without widening the frozen
  mutation or query V1 kernels;
- `packages/persistence-postgres/src/`: one private active-selection adapter
  deriving the root mutation plus ordered internal-query catalog from current
  metadata/publication owners;
- `packages/flarex-backend/src/artifactRuntime/`: candidate-bound target
  preparation, R2 verification, exact Worker core/host/source, generated
  identity closure, read-only child context, and route-independent dispatcher;
- `packages/standard-application-invocation/src/systemV1.ts`: switch the
  private SAP04 composer to the new profile as its sole runtime path;
- focused analyzer, protocol, function-runtime, Workerd, PGlite, PostgreSQL,
  SAP04/FSV06, C03/C03-V/C04/C07, and generated-identity tests; and
- this roadmap plus only directly stale cross-references.

No package extraction or dependency cycle is expected. Stop before code if
implementation proves it needs a schema/migration, persisted call graph,
different journal/transaction/consistency owner, change to grant/session/OCC/
commit/outcome/feed/outbox identities, public contract, production route, or
package extraction.

### SAP06-A2 Acceptance Matrix

| Lane | Required proof |
| --- | --- |
| Analyzer | mutation `await runQuery({_path:"internal:q"}, args)` accepted; dynamic/forged/dropped/return-wrapped/overlapping forms and pure host observation rejected; query-to-mutation and wrong metadata rejected by the owning analyzer/runtime boundary; analyzer identity unchanged unless behavior actually changes |
| Protocol | deterministic vectors for all three new identities; root/catalog ordering, uniqueness, bounds, validators, call policy, graph/R2 fields, every-field perturbation, hostile decoding, and immutable outputs |
| Function runtime | root write then child read-your-writes; parent/child/later-parent ordering; existing/missing reads; nested query success; auth/time/random inheritance; child args/results and declared error catchability; terminal poisoning; repetition, cycle, depth/count/byte budgets |
| Worker and journal | same Worker/Scope/attempt/journal/overlay; read-only child context; monotonic syscall sequence; no child write event; caught child failure retains prior reads/writes and charges; terminal failure prevents seal; cancellation/drain/cleanup and resource return |
| Target and R2 | exact root/catalog/manifest/projection/function-entry/module correlation; warm/cold materialization; absent/corrupt/codec/length/digest/reference/module/export failures; no PostgreSQL bodies and no legacy fallback |
| PGlite | full SAP04 composition with write-then-child-read, delete/missing, nested child read, caught application failure, terminal failure, OCC rerun, confirmed rollback, uncertainty observation, one final authoritative outcome/feed/outbox, and no child publication |
| PostgreSQL | zero-skip multi-connection read/write-overlay and OCC-conflict proof, replacement attempt, restart/replay, cancellation, rollback/uncertainty, stale fence/epoch/selection, exact final rows/outcome/feed/outbox, and server version |
| Regressions | SAP04/FSV06, C03-V, C03/C04/C07, SAP06-A1/SAP05, frozen mutation/PQV-A2 identities, generated Worker identities, package typechecks/builds, Drizzle metadata, Effect boundaries, and diff checks |
| Final review | exact-final TypeScript/Effect and code-quality reviewers both clean after the last behavioral diff |

### Rejected Alternatives And Approval Gate

Rejected:

- invoke SAP05/PQV-A1 from a mutation;
- open a child snapshot, transaction, or savepoint;
- expose the root mutation database object to a child query;
- dispatch the child as another SAP04/SAP05 operation;
- persist call sites, call frames, child outcomes, receipts, or idempotency keys;
- silently widen the accepted mutation V1 identities;
- dual-select old/new runtimes or fall back to the legacy generated runtime;
- carry a child across interruption or schedule it as action/background work;
  or
- alter C03/C07/OCC/commit/outcome/feed/outbox behavior.

The approved implementation uses the three private identities above and
directly replaces the private SAP04 runtime selection. The generated mutation
internal-query kernel digest is
`2fdbc186a9099ad2e318d054c4f72d68987a73ea56b89fa9e12b20a4bd46cd95`; the
generated exact Worker core digest is
`ebdb95cf8aa4622717cf0581eb00a3d0d2895edfe136c8b099ff025bb398e5ca`.
It does not authorize `SAP06-A3`, FSV07, routes, production, actions,
workflows, schedules, durable tasks, relations, or public SDK work.

## `SAP06-A3`: Mutation-To-Internal-Mutation

### Decision And Smallest Truthful Slice

The current owners can support one bounded inline internal-mutation capability
without a schema, migration, persisted call graph, child transaction, new
consistency owner, or change to C07 publication:

> one externally admitted public SAP04 mutation, or an internal mutation it
> directly awaits, may call an authenticated same-candidate internal mutation
> through `ctx.runMutation`; every frame executes inline in the same exact
> Worker, Scope, mutation attempt, C03 journal, and live overlay.

Internal-mutation nesting is included. Once a legitimate internal mutation
frame exists, denying that frame `runMutation` would require another temporary
context shape and another later profile without creating a safer authority
boundary. Every internal mutation also retains SAP06-A2 `ctx.runQuery`; nested
internal queries stay on the same mutation overlay and may call further
internal queries. A query frame never receives `runMutation`, so query-to-
mutation remains forbidden at every depth.

SAP04 remains the only top-level operation and continues to admit exactly one
public root mutation. A remote/System caller cannot select an internal
mutation. No child receives a request key, invocation identity, grant, attempt,
snapshot, transaction, journal, outcome, receipt, feed item, or outbox item.

Implementation follows the accepted three private identities below, direct
replacement of SAP04's A2 profile, and the first-slice no-child-rollback
semantics. No other material boundary was opened.

### Authority And Exact Callable Catalog

The new target remains bound to the root invocation's exact:

- FSV05 active selection, revision, candidate, readiness, and activation;
- scope, storage generation, generation fence, and epoch;
- authenticated root public mutation, grant, session, attempt, execution
  claim, predecessor/reservation/receipt lineage, and pinned snapshot;
- canonical function metadata, transaction projection, function-group
  manifest, function-entry references, compatibility date, Worker graph, and
  content-addressed R2 commitments; and
- operation Scope, auth/execution identity, deterministic time/random state,
  cancellation, deadline, and resource policy.

The persistence authority adapter derives one ordered candidate-scoped
internal-function catalog from existing immutable evidence. Every callable
entry must be `visibility=internal`, `group=transaction`, and either
`kind=query` or `kind=mutation`. The entry binds ordinal, path, logical and
artifact module, export, argument and return validators, projection, function
entry, manifest membership, and R2 reference. One canonical catalog sorted by
ordinal with path as the defensive tie-breaker prevents different query and
mutation lists from disagreeing. Duplicate ordinal/path and every inconsistent
kind, visibility, group, module, export, projection, manifest, entry, or R2
relationship fail before executable use.

User code supplies only the analyzer-approved literal selector
`{ _path: "module:export" }` and arguments. It cannot author catalog entries,
function metadata, target digests, R2 references, candidates, grants, attempts,
journal/database handles, snapshots, or alternate revisions. The host checks
the selected entry's exact kind for each operation: `runMutation` accepts only
an internal mutation and `runQuery` accepts only an internal query.

R2 remains the sole body store. PostgreSQL stores only candidate/revision
authority, relationships, content-addressed commitments, journal/application
data, and durable parent evidence. No new row or body copy is required.

### Existing Transaction, Journal, And Publication Ownership

Every root and child frame reuses one existing chain:

```text
public SAP04 request and request key
  -> coherent FSV05 active selection and C03-V validator
  -> authenticated candidate/R2 runtime target
  -> grant, admission, session, execution claim, and exact attempt
  -> one PointMutationJournal over one SessionJournalStore overlay
  -> one serialized syscall sequence and read/write set
  -> sealed parent journal and authenticated commit input
  -> existing OCC replacement and C07 commit
  -> one authoritative outcome, application-row change set, feed, and outbox
```

An internal mutation is inline function composition, not a scheduled or
top-level invocation. It receives the same mutation database capability as its
parent. Its point reads and writes pass through the same journal semaphore,
table capabilities, C03-V validation, durable overlay, dependency set, and
monotonic syscall sequence. It can neither open nor commit a SQL transaction;
each syscall retains the current short persistence transaction owner.

No child transaction, savepoint, journal branch, snapshot, grant, session,
attempt, request key, idempotency identity, predecessor, reservation, receipt,
commit compiler, recovery decision, durable outcome, feed fact, or outbox item
exists. The parent remains the sole authority for OCC validation, confirmed
rollback, decision uncertainty, retry, sealing, commit, and outcome lookup.

### Ordering, Read-Your-Writes, And No Child Rollback

Accepted source uses direct `await`, and every database syscall is serialized
through the existing journal tail. Consequently:

- parent writes settled before `runMutation` are visible to the child;
- child reads observe the current live/deleted overlay before pinned-snapshot
  fallback;
- child inserts, patches, replacements, and deletes settle into the same
  overlay and are visible to the parent and later children;
- an internal mutation's `runQuery` children use SAP06-A2's read-only context
  over that same overlay;
- child argument rejection happens before handler entry and appends no journal
  operation;
- a failed C03-V write validation appends no logical write; and
- later parent/child operations retain the global monotonic syscall order.

The first slice deliberately has no child savepoint. If a child throws an
application-owned error after earlier writes and the parent catches it, those
already settled writes remain in the parent journal; call/syscall/read/write
and byte budgets remain charged. Child return-validator rejection follows the
same rule because it occurs after handler execution. If the error escapes the
root, the parent attempt does not seal and none of its staged writes commit.
Any terminal child failure poisons and drains the shared boundary and prevents
successful sealing even if JavaScript code catches the Promise rejection.

This differs from Convex's documented nested-mutation sub-transaction rollback.
Matching that behavior would require a new C03 journal checkpoint/rollback or
savepoint authority, its concurrency and recovery laws, and a separate
approval. It must not be simulated with process-local undo, inverse writes, a
second journal, or a long PostgreSQL transaction. The recommended A3 slice
records the limitation instead of inventing that owner.

### Private Runtime And Identity Decision

Neither the original mutation V1 identities nor SAP06-A2's identities may be
widened. The A2 target authenticates one public root mutation plus internal
queries and its Worker intentionally gives no frame `ctx.runMutation`.
SAP06-A3 therefore proposes one combined internal-call profile:

- `flarex.system/candidate-bound-mutation-internal-call-runtime-target/v1`;
- `point-mutation-internal-call-exact-runtime-v1`; and
- `flarex.system/point-mutation-internal-call-syscall-abi/v1`.

"Internal-call" is intentional: the executable target binds both internal
query and internal mutation entries because every mutation frame retains
SAP06-A2 `runQuery`. Naming the profile "internal-mutation" would hide part of
its authority. After implementation, private SAP04 selects only this new
profile. The accepted original mutation and SAP06-A2 profiles remain frozen
regression evidence; they are not dual-selected, reinterpreted, or used as
fallbacks.

The exact Worker registry contains one public root mutation and the complete
authenticated internal-function catalog. Root and internal mutation frames
receive auth, the same mutation database, `runQuery`, and `runMutation`.
Internal query frames receive auth, read-only `db.get`, and `runQuery` only.
All frames share one Worker, Scope, journal, overlay, call stack, terminal
drain, deterministic environment, and cancellation lifetime. The legacy
generated runtime remains compatibility evidence only.

### Analyzer And Static Reference Gate

The accepted Core contract already permits `runMutation` from mutations,
forbids it from queries, and marks it mixed-catchability. The executable's
shared nested-call gate applies to both `runQuery` and `runMutation`: it
requires a directly awaited canonical literal reference and rejects missing,
dynamic, forged, dropped, return-wrapped, and overlapping calls. The runtime
target, not the selector, proves kind, internal visibility, group, module,
export, candidate, and R2 authority.

The executable parser already owns the canonical direct-await form, so its
protocol and generated executable asset identity remain unchanged. The
completed implementation also closes the previously missing registration
join: authenticated handler lookup follows bounded, cycle-safe local and
linker-resolved artifact-import helper edges, reports whether any reachable
verified function uses `runMutation`, and registration rejects that evidence
when the semantic function kind is `query`. The private analyzer implementation
identity therefore refreshes to
`c29980af03ba0564c8fe3e794e26764651c86bcaa33adbd4e697a63d789dc586`;
no analyzer protocol identity changes. Exact mutation-focused fixtures now
prove:

- public mutation -> internal mutation and internal mutation -> internal
  mutation acceptance;
- internal mutation -> internal query acceptance;
- query -> mutation, direct external internal selection, wrong kind,
  visibility, group, module/export, and cross-candidate rejection; and
- missing, dynamic, forged, dropped, return-wrapped, overlapping, and pure
  host-failure-observation rejection.

This is an existing-contract correction at the authenticated registration
boundary, not persisted call-site or call-graph authority. Persisted call sites
or call graphs remain excluded; if legitimate authority later depends on them,
stop for a new protocol/storage decision.

### Failure And Catchability Contract

At either internal-call boundary, user code may catch only:

- a declared `CoreApplicationErrorV1` thrown by child user code;
- deterministic child argument-validator rejection;
- deterministic child return-validator rejection; and
- the already accepted exact C03-V document-validation error from a mutation
  write.

Unknown targets; wrong kind/visibility/group/module/export/candidate;
catalog/manifest/projection/R2/reference mismatch; stale, closed, superseded,
or mixed authority; journal/overlay/read/write/integration/OCC failures;
syscall, call, read, write, document, byte, CPU, deadline, platform, cycle, or
depth exhaustion; cancellation, interruption, timeout, host/protocol failure,
uncertainty, cleanup failure, and defects remain terminal. The host records
them outside the user Promise chain and the shared boundary rethrows them while
draining, so user catch cannot produce a successful seal. The Effect/host
boundary retains full `Cause` and maps foreign failures once at their owner.

Dropped and overlapping nested calls remain analyzer-rejected. Runtime defense
still tracks every admitted child to completion, closes admission on parent
settlement or cancellation, drains outstanding work, and gives journal failure
precedence where the existing owner requires it. No child survives parent
interruption.

### Budgets, Cycles, Retry, And Replay

The new target commits one combined operation-wide internal-call policy:

- 64 attempted `runQuery` plus `runMutation` calls, charged before lookup;
- maximum combined nested depth 8;
- 8 MiB cumulative internal-call argument semantic bytes, charged before
  handler entry; and
- 8 MiB cumulative internal-call result semantic bytes, charged before return.

One active function-ordinal stack spans the public root, internal mutations,
and internal queries. Direct and indirect recursion are forbidden across the
whole catalog. Sequential repeated calls after return are allowed within the
cumulative limits. A query frame cannot form a mutation edge because its
context has no `runMutation`.

All existing mutation syscall, point-dependency, read/document, write-
operation/write-byte, successful-result, R2/module/hash, CPU, deadline,
cancellation, platform, time, and random limits remain shared and monotonic.
Children reset none of them. Diagnostic frames may carry root execution ID,
parent/callee ordinal, call sequence, depth, and kind, but are process-local
and non-authoritative.

An authorized OCC replacement is a fresh parent attempt under the existing
owner. It re-executes the same root request and immutable target at the new
pinned snapshot with a new attempt-local journal, overlay, syscall sequence,
stack, and counters. No child retries independently. Confirmed rollback and
decision uncertainty are observed and settled only through the parent's
existing outcome/recovery owners; deterministic child calls replay as part of
the parent execution.

### Effect, Scope, And Result Ownership

SAP04's System and thin Standard signatures remain unchanged. The conceptual
internal operation is invocation-scoped rather than another Context service or
top-level API:

```ts
runInternalPointMutationFromMutationV1(
  parent: AuthenticatedCandidateBoundMutationInternalCallTargetV1,
  functionRef: StaticInternalMutationFunctionReferenceV1,
  args: unknown,
): Effect.Effect<
  CanonicalFlarexRuntimeValueV1,
  InternalMutationApplicationFailureV1 |
    ExistingMutationRuntimeJournalAndTargetOwnerErrors,
  Scope.Scope
>
```

The Worker-facing method remains the Promise ABI required by user code.
`ApplicationPointMutationSystemV1` stays the shared private Layer owner, while
target, attempt, journal, call stack, Worker, and runtime state stay scoped to
one invocation. A child result is returned inline only after its registered
validator succeeds. It is not a durable outcome. Successful publication is
still exactly the parent's one application-row change set, outcome,
commit/change-feed sequence, and outbox batch.

### Implemented Capability

The separately approved medium capability owns:

- `packages/flarex-protocol/src/`: combined internal-call target/profile/ABI,
  canonical catalog and budget contracts, defensive codecs, exports, and
  perturbation vectors;
- `packages/function-runtime/src/`: one mutation-internal-call kernel that
  retains A2 query frames and adds mutation frames over the same database,
  stack, budgets, failure drain, and registry;
- `packages/persistence-postgres/src/`: one private active-selection adapter
  deriving the root plus the ordered internal query/mutation catalog from
  current metadata and candidate publication evidence;
- `packages/flarex-backend/src/artifactRuntime/`: candidate-bound R2
  materialization, exact Worker core/host/source, generated closure, per-kind
  contexts, and route-independent binding;
- `packages/standard-application-invocation/src/systemV1.ts`: direct private
  SAP04 selection of the new profile with no fallback;
- focused analyzer, protocol, runtime, Workerd, journal, PGlite, PostgreSQL,
  SAP04/FSV06, SAP06-A1/A2, C03/C03-V/C04/C07, and generated-identity tests;
  and
- this roadmap plus only directly stale cross-references.

No package extraction or dependency cycle is expected. Stop before code if
implementation requires schema/migration, persisted call graph, child
checkpoint/savepoint/rollback authority, a different journal/transaction/
consistency owner, changes to grant/session/OCC/commit/outcome/feed/outbox
identities, public contract, activation/routing/production behavior, or package
extraction.

### SAP06-A3 Acceptance Matrix

| Lane | Required proof |
| --- | --- |
| Analyzer | direct-awaited literal public/internal mutation -> internal mutation and internal mutation -> internal query accepted; missing/dynamic/forged/dropped/return-wrapped/overlapping, direct external internal selection, wrong kind/visibility/group, and pure host observation rejected; authenticated registration additionally walks the completed link's bounded, cycle-safe local and resolved artifact-import helper graph so query -> mutation is rejected at every reachable depth, including dropped helper calls, without persisted call-graph authority; identity changes only if behavior truthfully changes |
| Protocol | deterministic vectors for all three proposed identities; unified catalog ordering/uniqueness/bounds; root, query, mutation, validator, graph, projection, manifest, entry, R2, and policy field perturbations; hostile decoding and immutable outputs |
| Function runtime | parent write -> child read/write -> parent read-your-writes; insert/patch/replace/delete/missing cases; mutation -> mutation -> query nesting; auth/time/random inheritance; child argument/result and declared error catchability; caught error preserves prior writes and charges; terminal poisoning; repeat/cycle/depth/count/byte limits |
| Worker and journal | genuine same Worker/Scope/attempt/grant/session/journal/overlay and monotonic syscall sequence; child writes use C03-V and existing table capability; query child stays read-only; dropped/overlap defense, terminal drain, cancellation/interruption, cleanup uncertainty, and resource return |
| Target and R2 | exact root/unified-catalog/manifest/projection/function-entry/module correlation; warm/cold materialization and deterministic replay; missing/corrupt/codec/length/digest/reference/module/export cases; no PostgreSQL bodies or legacy fallback |
| PGlite | full SAP04 composition with nested child mutation writes and A2 query reads, caught application failure preserving prior writes, uncaught/terminal failure preventing seal, OCC rerun, confirmed rollback, uncertainty observation, one authoritative parent outcome/feed/outbox, and no child publication |
| PostgreSQL | server version and zero skips; multi-connection overlay/OCC conflict, replacement attempt, restart/replay, cancellation, confirmed rollback/uncertainty, stale fence/epoch/selection, concurrency, exact final rows/journal/outcome/feed/outbox, and no child publication |
| Regressions | SAP04/FSV06, C03/C03-V/C04/C07, SAP06-A1/A2, SAP05/PQV-A1/A2, frozen original/A2 identities, generated Worker/analyzer checks, package typechecks/builds, Drizzle metadata, Effect boundaries, and diff checks |
| Final review | exact-final TypeScript/Effect and code-quality reviewers both clean after the last behavioral diff |

The bounded completed-link reachability and target-module export-index
correction refreshes the private analyzer application identity from
`b8d1e425b5afb3b8ca17844d486a142fdca2c10dde2a1834228436fbb1579b56` to
`c29980af03ba0564c8fe3e794e26764651c86bcaa33adbd4e697a63d789dc586`.
The analyzer configuration identity remains
`c0ffa918d2cbfe69cc6193807caecdccf6d50c391bc2525db300b5a4cc4ce795`,
the executable asset identity remains
`fea88d3ad2cec58bf17f3e40173c57febcc710bc56c7ad595c3893de0795a082`,
and no analyzer protocol identity or persisted call-graph authority is added.

### Rejected Alternatives And Remaining Gates

Rejected:

- dispatch a child through SAP04 as another top-level invocation;
- open a child transaction, savepoint, snapshot, journal, grant, attempt, or
  idempotency/outcome identity;
- emulate rollback with process-local undo or inverse writes;
- give a query frame `runMutation` or permit query-to-mutation;
- persist call sites, call frames, or a child result/publication;
- silently widen the original mutation or SAP06-A2 identities;
- dual-select old/new profiles or fall back to the legacy runtime;
- store source, module, projection, or manifest bodies in PostgreSQL;
- let a child survive interruption or become action/background/durable work;
  or
- alter C03/C07/OCC/commit/outcome/feed/outbox authority.

`SAP06-A3` is complete under the three accepted combined internal-call
identities, direct private SAP04 replacement, and documented first-slice
divergence from Convex child-subtransaction rollback. It does not authorize
SAP07, FSV07, routes, production, actions, workflows, schedules, durable tasks,
relations, public SDK work, schema/migrations, or a child savepoint owner.

## SAP06-A1 Acceptance Matrix

| Lane | Required proof |
| --- | --- |
| Analyzer contract | exact directly awaited static internal-query reference accepted; missing, dynamic, forged, dropped, return-wrapped, overlapping, query-to-mutation, wrong kind, and host-failure observation rejected; private analyzer implementation identity refreshed because behavior changed |
| Protocol vectors | all new identity fields, ordering, bounds, catalog perturbations, duplicate ordinals/paths, wrong visibility/kind/group/module/export, and defensive decode |
| Function runtime | nested success/missing read; auth/time/random inheritance; args/result validation; application catchability; host failure poisoning; sequential repeat; direct/indirect recursion; depth/count/byte budgets |
| R2 and target | warm/cold materialization, exact catalog and manifest correlation, missing/corrupt/codec/length/digest/reference/module failures, target replay, and no PostgreSQL bodies |
| Workerd | genuine root public query -> internal query execution, Scope revocation, cancellation/drain, cleanup uncertainty, deterministic replay, forbidden syscall/direction, and resource return |
| PGlite | complete SAP05 composition, same snapshot for parent/child, repeated reads, injected read rollback/integration failure, stale/closed/superseded/mixed authority, and exact zero mutation publication |
| PostgreSQL | zero-skip multi-connection snapshot/writer behavior, cold reconstruction, cancellation/cleanup uncertainty, stale fence/epoch/head, and before/after app-row/journal/outcome/feed/outbox counts with server version |
| Regressions | PQV-A1, PQV-A2, SAP05, SAP04/FSV06 mixed catchability, generated mutation/query identities, typechecks/builds, Drizzle metadata, Effect boundaries, and diff checks |
| Final review | exact-final TypeScript/Effect and code-quality reviewers both clean after all behavioral fixes |

## Accepted Material Decisions

Implementation followed the explicitly accepted coherent decision to:

1. add the three new private target/profile/ABI identities above;
2. authenticate the ordered candidate-scoped internal-query catalog from
   existing metadata/manifest/R2 evidence rather than adding persisted
   call-site/call-graph authority;
3. move the private SAP05 query composition to that new profile as the sole
   internal-call-capable path; and
4. adopt the exact inline snapshot, failure, cycle, and cumulative-budget
   semantics in this roadmap.

Rejected alternatives:

- silently widen the accepted PQV-A2 V1 ABI;
- use the legacy generated runtime's structural nested-call implementation;
- open a child snapshot or transaction;
- dispatch a child through SAP05/SAP04 as a second top-level invocation;
- persist a child outcome or idempotency key; or
- add analyzer call-edge storage before a real authorization/audit consumer
  requires source call-site authority.

## Exclusions

SAP06-A1 does not authorize mutation-to-query, mutation-to-mutation,
query-to-mutation, direct external invocation of internal functions, index
scans, general queries, actions, workflows, schedules, durable tasks, FSV07,
routes, bindings, triggers, public SDK stabilization, production callers,
schema/migrations, package extraction, another snapshot/transaction/OCC/commit
owner, dual acceptance, fallback, legacy removal, relations, Payload, Medusa,
or PostgreSQL artifact bodies.
