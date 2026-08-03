# Third FlarexDB System API Vertical: Private Internal User-Code Calls

## Status And Scope

**Status:** implementation preflight complete; implementation is not yet
authorized. The recommended first capability is `SAP06-A1` — inline
query-to-internal-query calls inside one accepted SAP05 execution. Roadmap 43
remains closed as the first point-mutation vertical and roadmap 44 remains
closed as the second point-query vertical.

This roadmap owns the separately gated internal-call family. It does not make
all call directions equivalent and does not expose another top-level System or
Standard operation merely because user code gains one `ctx.runQuery` method.
The first slice remains private, route-independent, production-inert, and
bound to the already selected application revision.

Read this record with
[`40-host-neutral-function-runtime.md`](./40-host-neutral-function-runtime.md),
[`42-standard-application-apis.md`](./42-standard-application-apis.md), and
[`44-second-flarexdb-system-api-point-query-vertical.md`](./44-second-flarexdb-system-api-point-query-vertical.md).
Roadmap 40 retains portable execution semantics, roadmap 42 retains the
Standard API family, and roadmap 44 retains the completed PQV-A1/PQV-A2/SAP05
owners that this future slice composes.

## Current Evidence

| Existing owner | Current fact | Consequence |
| --- | --- | --- |
| `packages/flarex/src/server.ts` and `packages/flarex/src/api.ts` | `QueryCtx` already types `runQuery`; function references carry query/mutation kind plus public/internal visibility | The developer type vocabulary exists, but a structural function reference is a selector, never runtime authority |
| `packages/analysis/src/declarativeV2VerifierV1.contract.ts` and `declarativeV2VerifierExecutableV1.contract.ts` | Core V1 already defines `functionReference`, mixed-catchability `runQuery`/`runMutation`, static call targets, query-to-query permission, and query-to-mutation rejection | No analyzer semantic change or analyzer identity refresh is required for the first direction if implementation preserves this accepted contract |
| `packages/function-runtime/src/pointQuery.ts` | the accepted query kernel admits exactly one public query and exposes only `auth` plus point `db.get` | There is no executable internal-call owner today |
| `packages/flarex-protocol/src/point-query-exact-runtime.ts` | the request and syscall ABI are query-only, public-only, and contain no internal-call catalog or call budget | Existing V1 must not be silently widened |
| `packages/flarex-backend/src/artifactRuntime/PointQueryExactRuntimeWorkerCore.ts` and `PointQueryExactRuntimeHost.ts` | the exact Worker graph registers only the selected public query and shares one PQV-A1 read capability | Internal query calls require a new private target/profile/ABI, not a legacy generated-runtime fallback |
| `packages/persistence-postgres/src/applicationPointQuerySnapshotV1.ts` | PQV-A1 owns one Scope-revoked snapshot, active-head revalidation, retained-history check, and monotonic point-read/document-byte budgets | An inline callee can share this exact capability; opening a second snapshot would be incorrect |
| `packages/persistence-postgres/src/applicationRevisionQueryRuntimeTargetV1.ts` | the active candidate already authenticates canonical metadata and R2 function-entry/projection evidence, but the current claim selects one public query | The stored evidence can authenticate internal query callees without schema or migration work |
| `packages/flarex-backend/src/artifactRuntime/CandidateBoundPointQueryRuntimeTargetV1.ts` | R2 materialization verifies the whole transaction projection and manifest, while its target frame binds only one public query | The new target can reuse R2 bodies and commitments but must bind an exact ordered internal-query catalog |
| `packages/standard-application-invocation/src/querySystemV1.ts` and `v1.ts` | SAP05 owns active read, PQV-A1 open, PQV-A2 target preparation, Workerd dispatch, result validation, and Scope | SAP06-A1 extends only this private query execution composition; it adds no client-call API |
| `packages/standard-application-invocation/src/systemV1.ts`, `packages/executor/src/pointMutationJournal*.ts`, and `packages/flarex-backend/src/artifactRuntime/PointMutationExactRuntimeWorkerCore.ts` | SAP04/FSV06 owns one mutation attempt, one journal, mixed catchability, OCC, and one authoritative outcome | Mutation-to-query and mutation-to-mutation calls need later transaction-aware gates and cannot enter SAP06-A1 |
| `packages/flarex-backend/src/artifactRuntime/GeneratedWorkerSource.ts` | the legacy generated runtime has structural nested calls and a depth counter | It is compatibility evidence only; it is not an authority or fallback for the accepted exact runtime |

No current package export implements an exact internal call. No current
database row stores call-site or call-chain authority. The candidate already
stores the function metadata, function-group manifest, entry references, and
transaction projection required to authenticate same-candidate internal query
targets. Therefore SAP06-A1 needs a new private protocol/runtime identity but
no schema, migration, transaction owner, package extraction, or production
route.

## Call-Class Decision

| Call class | Decision | Owner/gate |
| --- | --- | --- |
| external/System caller -> internal query | Forbidden. `invokeApplicationPointQueryV1` continues to accept only a public query | Existing SAP05 boundary |
| external/System caller -> internal mutation | Forbidden. SAP04 continues to accept only a public mutation | Existing SAP04 boundary |
| public or internal query handler -> internal query | **First slice.** Inline execution in the same exact query Worker and PQV-A1 snapshot | `SAP06-A1` |
| query handler -> any mutation | Forbidden by the Core capability matrix and by runtime defense | Permanent query rule |
| public or internal mutation handler -> internal query | Deferred. It must read through the mutation attempt's live overlay, not PQV-A1 | Separate `SAP06-A2` preflight |
| public or internal mutation handler -> internal mutation | Deferred. It must append inline to the same C03/C07 journal and outcome | Separate `SAP06-A3` preflight |
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

The recommended target binds the ordered set of all exact internal transaction
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
`flarex.system/point-query-syscall-abi/v1` spellings. SAP06-A1 requires these
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
capable path when SAP06-A1 is accepted. The PQV-A2 V1 identities remain frozen
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

## Implementation Assignment After Explicit Approval

Implement one medium capability, `SAP06-A1 — Inline Query-To-Internal-Query`,
without another preflight if and only if the private identity/trust decision
above is accepted.

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

## Acceptance Matrix

| Lane | Required proof |
| --- | --- |
| Analyzer contract | exact static internal-query reference accepted; dynamic/forged reference, query-to-mutation, wrong kind, and host-failure observation rejected; analyzer identity unchanged unless behavior actually changes |
| Protocol vectors | all new identity fields, ordering, bounds, catalog perturbations, duplicate ordinals/paths, wrong visibility/kind/group/module/export, and defensive decode |
| Function runtime | nested success/missing read; auth/time/random inheritance; args/result validation; application catchability; host failure poisoning; sequential repeat; direct/indirect recursion; depth/count/byte budgets |
| R2 and target | warm/cold materialization, exact catalog and manifest correlation, missing/corrupt/codec/length/digest/reference/module failures, target replay, and no PostgreSQL bodies |
| Workerd | genuine root public query -> internal query execution, Scope revocation, cancellation/drain, cleanup uncertainty, deterministic replay, forbidden syscall/direction, and resource return |
| PGlite | complete SAP05 composition, same snapshot for parent/child, repeated reads, injected read rollback/integration failure, stale/closed/superseded/mixed authority, and exact zero mutation publication |
| PostgreSQL | zero-skip multi-connection snapshot/writer behavior, cold reconstruction, cancellation/cleanup uncertainty, stale fence/epoch/head, and before/after app-row/journal/outcome/feed/outbox counts with server version |
| Regressions | PQV-A1, PQV-A2, SAP05, SAP04/FSV06 mixed catchability, generated mutation/query identities, typechecks/builds, Drizzle metadata, Effect boundaries, and diff checks |
| Final review | exact-final TypeScript/Effect and code-quality reviewers both clean after all behavioral fixes |

## Material Decisions Requiring Approval

Implementation requires explicit approval of one coherent decision:

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
