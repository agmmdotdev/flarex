# QSYNC-FX02-C Application Query Evidence And Evaluator Boundary

## Status

**Status:** accepted on 2026-09-01 and implemented on 2026-09-02 for
`QSYNC-FX02-C1` only. The completed producer vertical remains private,
unrouted, and production-inert.

This record authorizes one medium, production-inert application-query evidence
slice. It does not authorize query registration in `DeploymentSyncDO`, a
hosted evaluator route, a durable query-material catalog, production routing,
client delivery, or any public API.

FX02-A, FX02-B, and FX02-C1 are complete. FX02-C as a whole remains incomplete
until a later accepted checkpoint composes
trusted registration, durable evaluation material, the executor/artifact-
runtime boundary, and the existing portable evaluation coordinator.

## Decision

Keep the clean application `runQuery()` facade unchanged and add a separate,
private selection-bound evaluation operation. That operation must execute the
same application query semantics while producing one coherent evidence
receipt from issuer-owned inputs and the application-query snapshot:

```text
trusted active selection + canonical arguments + effective identity
  -> private application-query evaluation operation
       -> one Scope-owned application-query snapshot
       -> existing application worker and nested-query runtime
       -> successful point/index reads record logical dependencies
       -> final snapshot revalidation and evidence finalization
  -> canonical query key evidence
     + exact snapshot/authority/dependency receipt
     + canonical result evidence
  -> existing Flarex query-sync evaluation projector
```

This is not an alternate query engine. The application query runtime remains
the execution owner, Postgres remains data and snapshot authority, and
`@flarex/query-sync` remains the only rerun/publication state machine.

## Why This Preflight Is Required

The accepted FX02 roadmap correctly forbids constructing query-sync evidence
from an ordinary result by assertion. Current code confirms the missing seam:

- `ApplicationSelectionQueryPort.runQuery` returns only a canonical runtime
  value;
- `ApplicationQuerySnapshot` owns the active selection, logical snapshot
  sequence, storage generation/fence, schema and read budget, but exposes no
  completed dependency receipt;
- point and index reads already pass through one Scope-owned snapshot
  capability, including reads performed by nested `ctx.runQuery` calls;
- the application worker result wire should therefore remain result-only;
- `captureScopeSyncQueryEvaluationProjectionV1Result` already maps trusted
  Flarex query, authority, dependency and result evidence into the portable
  `QueryEvaluationArtifact`; and
- the clean application `runQuery()` facade deliberately projects invocation
  failures and validates only the declared result contract. Sync metadata does
  not belong in that API.

The receipt belongs beside the query execution owner, not in the Durable
Object, the portable engine, or a client adapter.

## Important Registration Gap Found By This Preflight

The existing canonical Flarex query key contains argument and identity/access-
policy **digests**, not the canonical arguments or effective execution
identity. That is sufficient for deterministic identity and invalidation, but
it is not sufficient to execute a rerun after process or Durable Object
recreation.

The portable `QueryEvaluator` receives a durable `QueryDescriptor`; it does
not receive a live client request. Therefore FX02-C must eventually provide
durable, bounded, trusted evaluation material or a durable opaque resolver.
An in-memory map, captured callback, active WebSocket, Fiber, or client retry
cannot be that authority.

FX02-C1 does not hide this gap by placing raw arguments or user claims into
the current query identity. That value is retained with query/publication
state and may cross a later delivery adapter. Nor does C1 add an unapproved
Postgres registry or non-atomic side table. The exact storage, privacy,
idempotency, cleanup and registration-transaction contract requires the
separate FX02-C2 preflight described below.

## Authority And Package Ownership

| Owner | FX02-C1 responsibility | Must not own |
| --- | --- | --- |
| `flarex-protocol` | existing canonical query/dependency/authority contracts; exact query-policy identity and canonical value digests | snapshot authority, evaluator retries, transport status |
| `@flarex/persistence-postgres` | Scope-owned logical snapshot; successful-read dependency accumulation; final revalidation; detached completion receipt | portable query descriptors, result publication, user-facing APIs |
| `@flarex/standard-application-invocation` | private selection-bound evaluation operation; arguments/identity policy capture; existing worker execution; coherent result assembly | durable rerun registry, DO state, public Query result shape |
| `flarex-backend/deploymentSync` | existing Flarex-to-portable projection and focused projection proof | importing standard invocation, executing application queries, storing client material in C1 |
| `@flarex/application-invocation` | no C1 change | sync options, evidence return types, subscription behavior |
| `@flarex/query-sync` | no C1 change | Flarex identity, Postgres receipts, application runtime details |

No new workspace package is justified. In particular, C1 must not create a
query-evidence, query-runtime, sync-executor, or shared error package.

## Package Direction And Hosted Topology

Current package direction is intentional:

```text
@flarex/application-invocation
  -> @flarex/standard-application-invocation
       -> @flarex/persistence-postgres
       -> flarex-backend application runtime contracts

flarex-backend DeploymentSyncDO
  -> @flarex/executor-http private client contract
  -> @flarex/query-sync
```

`flarex-backend` cannot import `@flarex/standard-application-invocation`
without creating a cycle. The backend sync actor must eventually call a
strict private executor operation instead.

The deployed executor owns Hyperdrive/Postgres. The artifact-runtime Worker
owns R2 source access and `WorkerLoader`. A later hosted evaluator therefore
needs an explicit executor-to-artifact-runtime application-query execution
boundary; adding R2 or a second database authority to the wrong Worker merely
to reuse a local constructor is not accepted by C1.

C1 proves the domain receipt over the current injectable local execution host.
C2 must freeze the hosted service topology before implementing it.

## Query Identity Evidence

The private evaluation operation receives only issuer-owned values:

- a nominal `ApplicationActiveSelection`;
- a public query function path;
- normalized canonical arguments; and
- a decoded `ExecutionIdentity` representing the effective runtime identity.

It derives the canonical query identity from the exact active basis and
runtime policy, never from caller-authored hashes. At minimum the derivation
must pin:

- scope UUID and epoch;
- activation sequence and active-head digest;
- the selected source artifact/package identity with one documented exact
  mapping from the active basis;
- schema version;
- the accepted query execution policy version;
- component path (`null` while the current Application runtime has no
  component-routing authority);
- exact public function path;
- canonical argument digest; and
- canonical effective identity/access-policy digest.

The query-specific policy is read-only and must be derived from the same
effective identity passed to the worker. It must not reuse the point-mutation
policy name or its write capabilities. If the existing generic identity-
access-policy codec can express the exact query policy, C1 adds only a
query-owned policy constant/capability set beside that protocol owner. It does
not add a transaction grant or pretend a digest grants authority.

The current field named `sourcePackageSha256Hex` has no proven mapping in the
application-query producer. C1 must prove whether the selected source-artifact
root is the contractually intended value before using it. If those concepts
are not exact, stop and version/correct the private protocol contract in this
bounded slice; do not silently relabel one digest as another.

## Snapshot Dependency Receipt

### Capture rules

Dependency capture is enabled only for the private evaluation operation. The
ordinary `runQuery` path remains compatible and may use the same internal
mechanics without returning evidence.

The snapshot records logical dependencies only after a read completes
successfully:

- every successful point read, including a missing row, records
  `appRowPoint(documentId)`;
- every successful index-range read, including an empty page, records the
  conservative `appTable(tableId)` dependency;
- duplicate logical dependencies are retained once; and
- all nested query calls share the same RPC capability and therefore the same
  dependency accumulator.

The sync model deliberately uses a coarse table dependency for index reads.
OCC range evidence, physical index identifiers and row revisions are different
contracts and must not leak into this receipt. The current application query
API exposes no native relation traversal, so C1 does not fabricate
`appRelationIncoming` dependencies. A future relation syscall requires a
separate exact capture rule.

### Finalization rules

After the worker boundary has closed and drained, and after the returned value
has been canonically captured, the producer finalizes the snapshot under the
existing read semaphore. Finalization must:

1. prove the snapshot is still open;
2. revalidate the active selection, epoch, storage generation/fence and active
   head through the existing trusted located-read path;
3. detach the initial logical snapshot commit sequence;
4. detach the authority evidence needed by
   `ScopeSyncQueryAuthorityEvidenceV1`;
5. detach the bounded successful-read dependency set; and
6. close the evidence state so no later read can mutate a returned receipt.

The receipt is immutable owned data. It contains no transaction, Drizzle
database, Semaphore, Ref, Scope, callback or caller-owned mutable value.

A committed change during evaluation does not rewrite the snapshot sequence.
The query result and reads remain evaluated at the initially captured logical
snapshot. The existing query-sync catch-up/completion protocol decides whether
the generation must rerun. An active-head, epoch or storage-authority change
during finalization fails closed and produces no successful receipt.

### Bounds

The existing query snapshot read/document/semantic-byte budgets remain the
first execution limits. C1 must also prove the final canonical dependency
count and bytes fit the existing scope-sync protocol and portable model limits.
It must reject max-plus-one before returning evidence. It must not truncate,
sample or silently widen a coarse dependency.

## Operation And Error Boundary

Use one named `Effect.fn` for the reusable private evaluation operation. Keep
the dynamic snapshot operation-scoped and Scope-owned; do not put a query
snapshot, query receipt or effective identity in a singleton Context service.

Expected failures remain typed at their source:

- invalid function, arguments or identity;
- active selection/snapshot authority and history failures;
- source/worker composition failures;
- application/user-code execution failures;
- canonical argument, policy, result, query, authority or dependency evidence
  failures; and
- explicit query/dependency/result budget failures.

Unexpected property access, crypto/platform defects, invariant violations and
foreign implementation bugs remain defects. C1 adds no retry. Retry and
terminal-refusal projection belong to the later hosted `QueryEvaluator`
adapter because it owns `EvaluationCallBudget` and remote uncertainty.

Do not add a catch-all `unknown -> QueryEvaluatorUnavailableError` mapping to
the producer. The eventual adapter must classify only known transient source,
host and timeout failures; stored corruption, invalid canonical evidence and
authority mismatch are terminal or defective according to their owning
contract.

## QSYNC-FX02-C1 — First Medium Slice

C1 is one complete producer-side vertical:

1. freeze the exact read-only query policy identity and query-key derivation;
2. extend the application-query snapshot with bounded successful-read
   dependency accumulation and an atomic finalization receipt;
3. add a separate private selection-bound evaluation operation that reuses the
   existing application worker, nested-query behavior, snapshot and result
   semantics;
4. canonically capture query key, authority, dependencies and result without
   assertions or duplicate codecs;
5. pass the receipt through the existing backend Flarex evaluation projector;
   and
6. prove the complete local vertical with focused protocol, PGlite,
   invocation/runtime and projection tests.

C1 may refactor the smallest internal query-execution composition helper so
ordinary and evidence-producing queries cannot drift. It must preserve the
existing `ApplicationSelectionQueryPort.runQuery`, `ApplicationQuerySystem`,
`invokeApplicationQuery`, application `runQuery()`, worker request/result wire,
query authority, Scope lifetime, failure order and runtime semantics.

## C1 Proof Matrix

| Proof family | Required evidence |
| --- | --- |
| identity | anonymous and user identities; identity-claim change; argument change; function/head/schema/policy change; invalid source-identity mapping fails closed |
| point reads | present, missing, duplicate, different rows, failed read excluded |
| index reads | nonempty, empty, duplicate pages, different tables, failed read excluded, coarse table invalidation |
| nested query | root plus nested point/index reads appear in one receipt; call budget and failure behavior unchanged |
| coherence | result, initial snapshot sequence, authority and dependencies arise from one Scope-owned snapshot; head/epoch/generation drift fails closed |
| races | unrelated commit during evaluation; relevant commit during evaluation; active-head change during finalization; no wall-clock freshness inference |
| limits | exact and max-plus-one read, document, semantic, dependency-count, canonical-dependency-byte and result-publication limits |
| errors | application error, user-code failure, worker timeout, history unavailable, corruption, canonicalization failure and defect preservation |
| compatibility | ordinary selection query and public `runQuery()` result/error contracts unchanged; worker wire unchanged |
| projection | complete receipt maps through `captureScopeSyncQueryEvaluationProjectionV1Result`; every independent authority mismatch fails |
| activation | no route, DO registration, hosted evaluator, query-material store, publisher, client API or production caller |

Focused PGlite evidence proves the current logical snapshot and dependency
receipt only. It must not be reported as real-Postgres, deployed Workerd or
Cloudflare restart evidence. C1 needs the normal TypeScript and code-quality
reviews before commit because it changes behavior and internal contracts.

## Required FX02-C2 Preflight

C2 is not authorized by this record. Before C2 code, freeze all of the
following together:

1. **Durable evaluation material:** exact canonical arguments and effective
   identity required for rerun, privacy/redaction policy, encryption if
   required, deterministic-key collision behavior, size limits, idempotent
   registration, orphan handling, release/expiry and reset behavior.
2. **Registration atomicity:** a crash must never leave a runnable query with
   missing material. If material is stored before portable `beginQuery`, the
   bounded orphan and recovery contract must be explicit; if co-located in DO
   SQLite, the host-specific atomic transaction seam must be explicit.
3. **Hosted execution topology:** backend DO -> bearer-protected executor ->
   Postgres snapshot, with an explicit executor -> artifact-runtime boundary
   for R2 source and `WorkerLoader`; no dependency cycle and no duplicated R2
   or database authority.
4. **Private wire contracts:** strict request/response media type, semantic and
   byte budgets, generation/descriptor pins, typed remote failure classes,
   timeout/uncertainty semantics and capability disposal.
5. **Lifecycle:** recovery after DO and Worker recreation, single-flight rerun
   coalescing, stale generation completion, authority drift and deterministic
   cleanup.

The C2 decision must not assume that query-key digests are executable data.
It also must not expose raw evaluation material through the portable
`queryIdentity`, publication identity, logs, diagnostics or client delivery.

## C1 Implementation Receipt

Completed on 2026-09-02 in the implementation checkpoint containing this
record:

- `flarex-protocol` owns the canonical read-only `policy_query_v1` identity
  policy and detached anonymous/user claim evidence;
- `@flarex/persistence-postgres` enables dependency capture only for explicit
  evaluation snapshots, deduplicates successful point and coarse table reads,
  and atomically revalidates/finalizes an immutable receipt under the snapshot
  read gate;
- `@flarex/standard-application-invocation` exposes a separate private
  selection-bound evaluation port while ordinary `runQuery()` retains its
  original snapshot-open path, result contract and worker wire;
- the producer validates that `sourcePackageSha256Hex` is exactly the selected
  canonical Application Source Artifact root shared by the active basis and
  manifest, and fails closed on disagreement; and
- the completed receipt passes the existing backend Flarex-to-portable
  evaluation projector without adding a route, durable material store or
  production caller.

Validation passed with 11 focused protocol tests, 10 Application query runtime
tests, 24 existing backend projection tests, and all 41 PGlite Application
readiness tests. `lint:core` passed. The worktree-wide diff lint had no C1
finding; its two remaining diagnostics were in unrelated concurrent
relational/migration work. Both required final reviewers reported no findings
after the evaluation-only capture correction. This evidence is local/PGlite;
it is not a real-Postgres, deployed Workerd, Cloudflare restart, or portability
claim.

## Explicitly Not Authorized

This checkpoint does not authorize:

- changes to portable query-sync models, reducers, transition plans, state
  operations, budgets, retries or publication semantics;
- a new engine, OCC path, transaction journal, commit/change feed, outbox or
  committed-data authority;
- a query-material registry/table/column, schema migration, encryption scheme,
  cleanup lease or refcount;
- `DeploymentSyncDO` registration/evaluation behavior, an executor route,
  artifact-runtime entrypoint, service binding or hosted proof;
- query options or sync metadata on the public application `runQuery()` API;
- relation-query syscall expansion, mutation/action/task cleanup, or Legacy
  sync changes;
- production initialization/reset, public fetch/RPC, delivery selection,
  client subscriptions, FX02-D, FX03, CF01 or R03-B; or
- production-readiness, deployed-Cloudflare, runtime-portability or product-
  parity claims.

## Accepted Checkpoint

Accepted on 2026-09-01 with these decisions:

1. the application-query producer owns the coherent evidence receipt;
2. the public Query facade and application worker wire remain unchanged;
3. point and coarse table dependencies are captured inside the existing
   Scope-owned snapshot across nested query calls;
4. final authority/dependencies are detached only after worker completion and
   final snapshot revalidation;
5. the current Flarex-to-portable evaluation projector is reused;
6. C1 is the completed private producer-evidence implementation slice; and
7. durable evaluation material and hosted evaluator composition require the
   separate C2 preflight because the current digest-only query key cannot
   execute a restart-safe rerun.
