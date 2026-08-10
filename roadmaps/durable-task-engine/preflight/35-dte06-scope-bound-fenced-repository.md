# Preflight 35: DTE06-C2 Scope-Bound Fenced Repository

## Status

**Decision:** DTE06-C2 is complete and production-inert. It owns only the
private scope-bound transaction repository over the DTE06-C1 dispatch and
cancellation tables. The repository, PGlite and genuine-PostgreSQL proofs,
boundary gates, and required reviewer receipts have passed. Its separately
approved stale-generation correction now closes an older provider cancellation
as terminal non-receipt evidence after exact identity/generation correlation.
DTE06-C3 is admitted separately under Preflight 36.

**Prerequisite resolved:** the approved bounded C1 correction replaces the
non-reconstructable full binding in the prepared subject with an owned,
immutable runtime-binding commitment decoded from the durable canonical
definition bytes. No fallback, schema widening, or process-local binding
injection was introduced.

**Implementation receipt:** C2's first internal seam extracts the exact
full requested-effect and attempt-identity ledger correlation from the DTE04
run-attempt store into one package-owned helper with caller-supplied corruption
mapping. The existing store and C2 therefore share lifecycle evidence mechanics
without sharing error authority. C1 also exposes pure canonical dispatch and
acceptance byte encoders for use inside the transaction callback, while
its Effect APIs continue to own hashing and public evidence snapshots.

The production-inert repository now owns scope-bound dispatch
preparation, initial/retry/uncertain-replay acquisition, database-time claim
leases, opaque repository-local handles, delivery-start accounting, renewal,
pre-delivery release, canonical acceptance settlement, and the closed known-
failure projection behind the admitted private persistence subpath. Retryable
provider rejection/transport facets schedule database-time `retry_wait` below
the configured ceiling; non-retryable failures and exhausted attempts settle
to closed safe reason codes without retaining foreign causes. Uncertain
provider outcomes remain outside that mutation boundary. The PGlite proof now
covers live-claim exclusion, fenced reacquisition, handle closure, expired-
delivery takeover, exact accepted replay, retry admission, terminal exhaustion,
safe transport projection, uncertain-outcome rejection, and final-attempt
uncertain replay beyond the known-failure retry ceiling. All cancellation
operations are now implemented behind the same private repository: acquisition
locks and correlates the linked dispatch checkpoint before the cancellation
checkpoint, persists `waiting_dispatch` without inventing provider evidence,
derives the exact cancellation request only from accepted dispatch evidence,
and owns initial/retry/uncertain-replay fencing, start accounting, renewal,
pre-delivery release, canonical receipt settlement, and safe known-failure
projection. A delivered receipt is cleanup evidence only and never
acknowledges Task cancellation. The focused PGlite proof now also covers
waiting-to-ready promotion, fenced cancellation reacquisition, exact receipt
replay while Task cancellation remains requested, started terminal-race
cleanup, lifecycle supersession across waiting/live-prestart/future-retry
availability, known-failure exhaustion, uncertain-outcome rejection, and
final-attempt uncertain replay beyond the known-failure ceiling. The focused
23-case PGlite proof now also covers hostile request and acceptance inputs,
invalid claim-owner UUIDs, forged/cross-operation/cross-repository handles,
stored dispatch and cancellation digest corruption without evidence
regeneration, one direct retryable rollback and retry exhaustion, decision
uncertainty, cleanup failure, raw defects, and interruption that waits for
transaction settlement before closing the dispatched handle. The focused
7-case genuine-PostgreSQL lane runs under an ordinary role in a temporary
schema and proves independent claim races, expiry takeover, run-lock lifecycle
serialization, dispatch-before-cancellation lock order, lock and statement
timeout rollback with connection reuse, whole-transaction termination with
client discard and replacement, committed-response-loss uncertainty with
durable recovery, and cleanup without database-creation privileges.

### Shared C1 Decoder Defect Exposed By C2 Hostile Proof

**Reproducible scenario:** acquire a valid dispatch claim, then call
`recordDispatchAcceptance` with a revoked `Proxy` as the unknown acceptance
value. The C2 repository correctly rejects other accessor-backed requests and
foreign handles before SQL, but the shared
`validateTaskComputeDispatchAcceptanceV1` path reaches
`captureExactDataRecord` in `packages/durable-task/src/computeProvider/Schema.ts`.
That helper evaluates `Array.isArray(input)` before its exception boundary.

**Expected:** the shared compute-provider decoder classifies every hostile
unknown input as its recoverable typed validation failure. The C2 repository
then maps it to `invalid_acceptance`, dispatches no SQL, and leaves the current
claim handle open.

**Actual:** `Array.isArray` throws `TypeError: Cannot perform 'IsArray' on a
proxy that has been revoked`. The defect escapes the typed error channel, so
the focused C2 PGlite hostile-input regression fails before the repository can
apply its admitted invalid-input policy.

**Affected owner and evidence:** this is a DTE06-C1 compute-provider codec
boundary defect in `@flarex/durable-task`, not a C2 persistence transaction or
test-harness defect. The failing regression is
`taskComputeDeliveryRepositoryV1.test.ts` under the case named `rejects hostile
acquisition values and foreign handles before SQL without closing a current
handle`; the other 22 focused C2 cases pass.

**Disposition:** the user separately approved the bounded C1 correction. The
complete initial structural classification, including `Array.isArray`, now
runs inside the existing capture exception boundary. Direct pure decode and
validation tests plus the Effect provider-contract test prove a revoked Proxy
returns the exact typed failure, and the C2 hostile regression proves no SQL is
dispatched and the current handle remains usable. This correction changes no
provider, lifecycle, schema, transaction, or activation authority.

This admission changes no runtime code by itself. DTE06-C1 commit `201d85b4`
is the required storage prerequisite. DTE06-C3 connected discovery and provider
composition, every real provider or Cloudflare adapter, Worker/Queue/cron host
wiring, deployment configuration, public API, and production activation remain
unadmitted.

## Question

What is the smallest repository that can turn one exact persisted
`dispatch_attempt` or `request_execution_cancellation` effect into fenced,
recoverable delivery evidence without copying Task lifecycle logic, trusting a
checkpoint as authority, or calling a compute provider inside a database
transaction?

## Sources Rechecked

- `packages/durable-task/src/runAttempt` for the authoritative aggregate,
  requested-effect union, attempt/fence/lease/cancellation projections, and
  existing lifecycle decisions;
- `packages/durable-task/src/computeProvider` for the exact dispatch,
  acceptance, cancellation, receipt, and typed provider-failure contracts;
- `packages/persistence-postgres/src/taskSystemRunAttemptStoreV1.ts`,
  `taskSystemRunRowV1.ts`, `taskSystemRequestedEffectRowV1.ts`, and
  `taskSystemScopeAuthorityV1.ts` for the existing Task transaction, row-codec,
  ledger-correlation, and locked-scope patterns;
- `packages/persistence-postgres/src/taskComputeDeliveryEvidenceV1.ts` and the
  DTE06-C1 tables in `schema.ts` for the canonical evidence and legal stored
  states;
- `packages/persistence-postgres/src/postgresLocatedReadCommitted.ts` and the
  DTE05-E2 checkpoint/deadline work for settlement classification, checked-out
  connection ownership, timeout, and quarantine evidence; and
- the pinned Trigger.dev source only for duplicate delivery, lost response,
  restart, and cancellation race scenarios. No Trigger persistence, Prisma,
  Redis, organization, or compute-host contract is admitted.

## Resolved Prepared-Subject Evidence Gap

### Reproducible Scenario

1. Create a definition revision and run through the current DTE04 storage
   contracts while the trusted full `TaskDefinitionRuntimeBindingV1` exists in
   the creating process.
2. Lose that process and later acquire the persisted `dispatch_attempt` by
   only `runId` and requested-effect sequence, as C2 requires.
3. Load the current definition row, run row, requested effect, and C1 delivery
   tables without consulting an application/runtime host.
4. Attempt to construct the then-current
   `TaskComputePreparedExecutionV1.runtimeBinding` field.

Expected: persistence reconstructs and correlates the complete immutable
`TaskDefinitionRuntimeBindingV1` from its durable evidence.

Actual:

- the then-current `TaskComputePreparedExecutionV1` required the full runtime binding, including
  its canonical manifest;
- `encodeTaskDefinitionRuntimeBindingPreimageV1` deliberately stores the
  runtime entry, runtime-object references, and digests but omits the full
  `manifest` value;
- `fx_system_durable_task_definition_revision_v1` stores those binding bytes
  and digest columns but no canonical task-manifest bytes;
- no other PostgreSQL table owns the missing manifest; and
- the run aggregate retains its bound execution/retry policy but not the
  payload validator, output validator, and complete original manifest needed
  to recreate `TaskDefinitionRuntimeBindingV1`.

The current process-local binding supplied to run creation is therefore not a
durable reconstruction source. A decoder cannot manufacture the omitted
fields, and accepting a caller-supplied replacement during C2 acquisition
would violate the trusted, identity-only acquisition contract.

### Affected Owner And Boundary

This is a mismatch between the DTE04 immutable definition evidence and the
DTE06-C1 prepared-subject contract. It is not a defect in the proposed C2
claim transaction, the DTE06-B provider contract, or the test harness. C2 may
not repair it by changing Task lifecycle logic, reading object storage inside
the transaction, trusting a host-supplied full binding, or silently using the
run's partial bound policy as a manifest.

### Correction Options

1. **Recommended — commitment handoff:** replace the C1 prepared subject's
   full `runtimeBinding` field with an owned, decoded immutable runtime-binding
   commitment derived from the definition row and canonical binding preimage.
   C2 returns that commitment with the provider request and input reference.
   DTE06-D's artifact/runtime owner later loads the full binding and manifest,
   validates every commitment, and only then constructs the runtime ABI. This
   requires a bounded C1 private-contract and documentation correction but no
   schema migration.
2. **Manifest persistence:** add canonical task-manifest bytes and codec/digest
   evidence to the definition storage owner. This requires a separate schema,
   migration, definition-write, existing-row/backfill, PGlite, and genuine-
   PostgreSQL preflight. It is not admitted by C2.

The commitment handoff is smaller and preserves domain ownership: Postgres
authorizes the exact immutable definition evidence, while the later artifact
runtime owner reconstructs executable material. It does not weaken provider
identity or allow DTE06-D to choose a different definition.

### Current Disposition

The commitment-handoff correction is complete. Standard Application now owns
the canonical commitment encoder/decoder; C1's prepared execution carries that
owned commitment and no manifest. C2 may reconstruct and correlate it from the
definition row. DTE06-D remains the only future owner allowed to load the full
binding and manifest and must verify every commitment before constructing the
runtime ABI. C2 completion claims and C3 admission remain prohibited until the
repository's own completion gate passes.

## Reuse Decision

DTE06-C2 does not implement Trigger's Prisma `RunStore` over Drizzle and does
not add a generic requested-effect delivery engine. It reuses Flarex owners at
their narrow seams:

- lifecycle meaning stays in `@flarex/durable-task`; the repository decodes and
  correlates the existing aggregate and requested effects but never recreates
  a lifecycle transition;
- provider request and receipt meaning stays in the existing private
  `@flarex/durable-task/internal/compute-provider-v1` contract;
- canonical bytes and prepared-subject ownership stay in the DTE06-C1 private
  evidence module;
- scope freshness uses `requireLockedTaskSystemScopeAuthorityV1` and the
  existing located READ COMMITTED transaction capability;
- exact run-row and requested-effect decoding reuse their current package-local
  owners; if C2 needs the full-ledger correlation mechanics currently private
  to `taskSystemRunAttemptStoreV1.ts`, those exact mechanics may be extracted
  package-locally with caller-supplied error mapping while the existing store
  retains identical behavior and tests; and
- genuine-PostgreSQL timeout and connection-disposition proof reuses the
  existing located connection lifecycle. The Task-repair scheduler row,
  checkpoint handle, and reason/error types are not reusable compute-delivery
  authority.

No generic helper is extracted merely because two tables both contain claim
columns. Dispatch and cancellation retain separate domain outcomes and legal
states. Exact low-level claim mechanics may be shared inside this one module
only when operation-specific correlation and result types remain explicit.

## Admitted Private Boundary

DTE06-C2 adds one private persistence subpath:

`@flarex/persistence-postgres/internal/task-compute-delivery-repository-v1`

The module owns:

- `createLocatedTaskComputeDeliveryTargetV1`, a package-private construction
  seam over the metadata database, physical locator, and existing located READ
  COMMITTED runner;
- `makeTaskComputeDeliveryRepositoryV1`, which captures one already-located
  trusted scope authority and validated configuration;
- operation-specific dispatch and cancellation acquire/results;
- opaque repository-local claim handles and fenced transition operations;
- typed configuration, input, stale-authority, stale-claim, corruption,
  resource, confirmed-rollback, decision-uncertain, and SQL failures; and
- closed privacy-safe known-failure projections from the DTE06-B provider
  errors. It does not accept or persist an arbitrary reason string or foreign
  cause.

The repository is an Effect-returning operation-local capability. It is not a
singleton `Context` service because the located scope and physical target are
dynamic values. C2 adds no Layer or background process. C3 may later inject a
factory at its host composition root without widening this repository into a
global transaction service.

### Construction And Configuration

Construction captures each caller-owned field once, validates it, and freezes
the resulting policy. The admitted configuration contains no implicit default:

- positive safe-integer claim duration;
- a non-empty, bounded sequence of positive safe-integer retry delays;
- a bounded maximum delivery-attempt count consistent with that sequence;
- a UUID factory used only to mint a new claim owner, injectable for tests; and
- the already configured located transaction runner.

Database time alone calculates `claimed_at`, `claim_expires_at`,
`delivery_started_at`, `next_attempt_at`, `settled_at`, and takeover
eligibility. No JavaScript clock is accepted. C2 does not claim that its claim
duration bounds a future provider call; C3 must prove its provider timeout plus
settlement reserve fits inside the admitted claim/renewal policy.

The repository does not create a second PostgreSQL transaction wrapper. Its
genuine-PostgreSQL harness may reuse the already proved DTE05 deadline-policy
configuration to construct a disposable connected target, but that scheduler-
named policy is test/operability evidence rather than compute-delivery domain
authority. A future production host must own the final pool configuration.

## Requests, Handles, And Outcomes

### Acquisition Inputs

The dispatch and cancellation acquisition requests contain only validated
`runId` and `requestedEffectSequence`. Trusted `scopeId`, deployment binding,
physical locator, storage generation/fence, and epoch come only from the
captured located authority. Callers cannot supply or override them.

The repository snapshots the request before opening a transaction. A candidate
or persisted continuation grants no row, scope, provider, or lifecycle
authority.

### Claim Handles

A successful committed acquisition mints an opaque, repository-instance-local
handle containing only the operation kind, exact checkpoint primary key,
claim-owner UUID, claim fence, and local call phase. The handle:

- is minted only after the acquisition transaction is known committed;
- cannot be constructed or serialized through the private API;
- cannot cross repository instances or operation kinds;
- grants no trusted scope, Task lifecycle, provider, application, runtime, or
  input authority;
- serializes concurrent operations on the same process-local handle; and
- closes permanently after settlement, release, stale authority/claim,
  decision uncertainty, cleanup failure, or a defect/interruption after
  transaction dispatch.

The repository rechecks scope authority and every stored claim correlation on
each operation. Process-local handle state is only an early rejection and
ordering guard; PostgreSQL remains authoritative.

### Dispatch Acquire Result

The closed dispatch result union is:

- `claimed`, carrying an owned `TaskComputePreparedExecutionV1`, the handle,
  and `deliveryMode: "initial" | "retry" | "uncertain_replay"`;
- `busy`, carrying only the database-owned claim expiry observation;
- `not_due`, carrying only the database-owned next-attempt observation;
- `accepted`, carrying the exact decoded stored acceptance and whether current
  Task lifecycle treats it as `current` or `cleanup_only`; or
- `closed`, carrying `rejected | obsolete | quarantined` plus its closed safe
  reason code.

`claimed` with `uncertain_replay` is the only result that may replay a row that
was already `delivering`. It reuses the same canonical request and provider
idempotency identity. It never allocates a new Task attempt, execution fence,
or requested effect.

### Cancellation Acquire Result

The cancellation result union is:

- `claimed`, carrying an owned exact cancellation request, the handle, and the
  same three delivery modes;
- `waiting_dispatch`, when the exact dispatch acceptance needed to construct
  the cancellation request does not yet exist;
- `busy` or `not_due` with database-owned observations only;
- `delivered`, carrying the exact decoded stored receipt and `current` versus
  `cleanup_only` lifecycle disposition; or
- `closed`, carrying `rejected | obsolete | quarantined` plus its safe reason
  code.

`waiting_dispatch` never mints a handle. When the exact linked dispatch
checkpoint exists but is not accepted, the repository may persist the C1
`waiting_dispatch` row. When that dispatch checkpoint does not yet exist, the
repository returns `waiting_dispatch` without inserting a cancellation row,
because the C1 foreign key is deliberate and cancellation acquisition cannot
manufacture or claim a dispatch checkpoint. It cannot fabricate request
evidence or an execution reference in either case.

## Fresh Correlation Contract

Every acquire transaction proves the following from current stored owners:

| Prepared field | Required source and correlation |
| --- | --- |
| `scopeId` | Captured trusted located authority plus the locked current scope clock |
| `runId` and effect sequence | Validated acquisition identity plus the exact immutable requested-effect row |
| accepted run version | Requested-effect evidence, full ledger position, and decoded run aggregate |
| attempt ID/number and execution fence | Exact dispatch effect, current/known attempt identity, and aggregate projections |
| lease version | Dispatch effect/current aggregate; stale lease projections cannot start a new delivery |
| cancellation projection | Current aggregate and the generation applicable to that exact dispatch |
| definition revision | Run row, dispatch effect, immutable definition row, and creation authority |
| compute profile and maximum duration | Exact dispatch/lifecycle evidence and definition policy already admitted by the Task domain |
| `runtimeBindingCommitment` | Decode the canonical immutable definition binding bytes and correlate every stored digest commitment; do not load or construct the full binding or manifest, which remains DTE06-D authority |
| input reference | Immutable run input columns and creation authority |
| cancellation execution reference | Exact accepted dispatch evidence for the linked dispatch checkpoint |

The implementation must use the existing domain codecs and compare all
correlated values. It must not rebuild a different canonical provider request
from a stale checkpoint, normalize mismatching stored text, fall back to a
newer definition, or trust a TypeScript row type as runtime evidence.

If the run/effect/definition/input authority cannot be established, no claim is
minted and no provider call is possible. Row-local checkpoint corruption may be
atomically quarantined only after its primary identity and owning Task rows are
trusted. Corruption that prevents safe target identification returns a typed
failure without mutation. Neither path regenerates evidence.

## Transaction And Lock Order

Every operation executes in one located READ COMMITTED transaction and follows
one lock order compatible with the existing Task lifecycle store:

1. validate the process-local request or handle before dispatching SQL;
2. lock the current scope authority row `FOR SHARE` and correlate the physical
   locator, deployment binding, epoch, storage generation, and generation
   fence;
3. lock the exact Task run row `FOR UPDATE` before any delivery row, so
   lifecycle mutation and delivery preparation cannot pass each other;
4. decode the aggregate and correlate the complete immutable requested-effect
   and attempt-identity ledgers;
5. read and decode the immutable definition binding, creation authority, and
   input reference;
6. for cancellation, lock/read the exact dispatch checkpoint before the
   cancellation checkpoint; and
7. insert-if-absent, then lock and transition the exact operation-specific
   checkpoint row.

Requested-effect, attempt-identity, and definition rows are immutable under
their existing owners; the locked run row supplies serialization with lifecycle
changes. An insert race must use a uniqueness-safe insert/reload path and then
perform the same full correlation. No operation may reverse dispatch-before-
cancellation ordering or lock a delivery row before the run row.

Provider calls, object-store reads, runtime binding materialization, and user
code are prohibited inside these transactions.

## State Transition Contract

### Dispatch

| Current stored state | Acquire/operation | Legal result or next state |
| --- | --- | --- |
| no row, lifecycle current | acquire | insert canonical `prepared`, advance claim fence, return `claimed/initial` |
| no row or `prepared`, lifecycle no longer startable | acquire | persist/return `obsolete`; no handle |
| `prepared`, unclaimed or expired | acquire | advance claim fence and return `claimed/initial` |
| due `retry_wait`, unclaimed or expired | acquire | advance claim fence and return `claimed/retry` |
| future `retry_wait` | acquire | `not_due`; no mutation or handle |
| `delivering`, expired claim | acquire | advance claim fence and return `claimed/uncertain_replay` with identical request |
| any claim with unexpired different owner | acquire | `busy`; no mutation or handle |
| `accepted` | acquire | decode/digest/correlate and return the exact stored acceptance |
| `rejected`, `obsolete`, or `quarantined` | acquire | exact `closed` result |
| `claimed` in any delivery mode | mark delivery started | require current claim; set/retain `delivering`, increment attempt count once, and record database start time before each provider call |
| current `delivering` handle | record acceptance | validate exact receipt correlation, store canonical evidence, set `accepted`, settle, and release claim atomically |
| current `delivering` handle | record known failure | accept only the closed known-failure union; choose `retry_wait` or `rejected`, set safe code/DB retry time, and release claim |
| current handle before its start marker | release before delivery | clear only the claim; preserve canonical evidence and delivery state |
| current claimed handle | renew | extend expiry from database time without changing lifecycle or evidence |

An unknown, uncertain, malformed, interrupted, or defect outcome after the
start marker has no `recordKnownFailure` projection. The repository leaves the
row `delivering`; the claim expires and exact takeover/replay recovers it.

### Cancellation

| Current stored state | Acquire/operation | Legal result or next state |
| --- | --- | --- |
| no row and linked dispatch checkpoint absent | acquire | return `waiting_dispatch` without insertion or claim |
| no row and linked dispatch checkpoint exists but is not accepted | acquire | insert/return `waiting_dispatch`; no claim |
| `waiting_dispatch` and dispatch becomes accepted | acquire | derive exact request evidence, set `prepared`, advance claim fence, return `claimed/initial` |
| `prepared` or due `retry_wait` | acquire | return `claimed/initial` or `claimed/retry` after current-generation proof |
| `delivering` with expired claim | acquire | return `claimed/uncertain_replay` with identical request |
| future retry or live foreign claim | acquire | `not_due` or `busy` |
| `delivered` | acquire | return the exact stored correlated receipt |
| `rejected`, `obsolete`, or `quarantined` | acquire | exact `closed` result |
| lower/superseded generation with no prior start | acquire | lifecycle obsoletion dominates waiting/live-claim/not-due availability; set/return `obsolete`, or return the same logical result without a row when the dispatch FK does not yet exist; no provider call |
| lower/superseded generation in `retry_wait` after a definite started attempt | acquire | lifecycle obsoletion dominates `not_due`; settle as `rejected/lifecycle_obsolete` while preserving the attempt count and start timestamp required by C1 evidence |
| started lower/superseded generation | acquire | uncertain replay remains legal only to recover exact cleanup evidence; it grants no Task acknowledgement |
| current claimed handle | start, renew, known failure, or pre-start release | same fenced rules as dispatch with cancellation-specific types |
| current `delivering` handle | record cancellation delivery | validate identity, execution reference, and generation; store exact receipt, set `delivered`, settle, and release claim atomically |

Cancellation delivery never mutates the Task aggregate and never acknowledges
Task cancellation. A later lifecycle command remains the sole authority for
that acknowledgement.

## Known Failure And Retry Policy

The repository accepts no `unknown`, `Error`, provider message, stack, URL,
header, response body, or arbitrary reason code. It owns separate closed
dispatch/cancellation known-failure inputs derived only from:

- definite `TaskCompute*RejectedError` values and their validated provider
  reason/retryable facet; or
- definite `TaskCompute*TransportError` values reduced to the retryable facet
  without retaining the foreign cause.

`TaskCompute*UncertainError`, provider contract/malformed-receipt errors,
interruption, defects, and unknown foreign failures are not known failures and
must leave the started row recoverable through exact replay.

For a retryable known failure below the captured ceiling, the repository uses
the captured delay indexed by the new delivery-attempt count and PostgreSQL
time to write `retry_wait`. At the ceiling, or for a definite non-retryable
failure, it writes `rejected`. Safe stored codes are a closed mapping from the
typed provider reason and retry disposition; callers never choose their text.
An uncertain row is never changed to `rejected` merely because the retry
ceiling was exhausted.

## Settlement, Retry, And Interruption

The located READ COMMITTED transaction owner remains responsible for begin,
callback, commit/rollback settlement, checked-out client error observation,
release, and discard/quarantine.

- Success is returned and a handle is minted/advanced only after commit is
  known settled.
- Pre-dispatch input/configuration failure or interruption performs no SQL and
  does not close an otherwise current handle.
- A direct-class confirmed rollback may retry the identical already-captured
  command once when the located runner and remaining reserve allow it. A
  changed retry, second rollback, stale correlation, or expired claim fails
  closed.
- Decision uncertainty never retries the mutation and never guesses whether a
  claim, marker, receipt, or failure checkpoint committed.
- Callback cleanup failure, transaction termination, connection error, or
  discard failure remains distinguishable from a domain/stale outcome.
- After SQL dispatch, decision uncertainty, cleanup failure, interruption, or
  defect permanently closes that process-local handle. Recovery starts with a
  fresh scope resolution and acquire operation.

An Effect timeout alone is not a hard database bound. The genuine-PostgreSQL
gate must use the existing server-side lock, statement, and whole-transaction
deadline pattern and prove the connection has been released healthy or
discarded before the repository operation returns.

## Error And Outcome Boundary

Expected current database state is a success result, not an exception:
`busy`, `not_due`, `waiting_dispatch`, already accepted/delivered, and closed
checkpoint states remain in the operation result union.

The typed Effect error channel is reserved for:

- invalid construction or operation input;
- stale located scope authority or stale/foreign/closed handle;
- stored run, ledger, definition, input, or checkpoint corruption;
- bounded resource/configuration exhaustion;
- confirmed rollback exhaustion;
- decision-uncertain settlement;
- classified SQL/infrastructure failure; and
- evidence codec or cryptographic failure owned by C1.

Unexpected defects and interruption remain outside the typed domain channel.
Cause composition must preserve a typed callback failure together with cleanup
or release defects rather than replacing one with the other.

## Validation Matrix

### Pure And PGlite

C2 must prove at least:

- configuration capture, hostile accessors, UUID validation, and repository-
  local handle ownership;
- exact dispatch preparation from current aggregate/effect/definition/input
  evidence and rejection of every individual correlation mismatch;
- exact cancellation preparation only after correlated dispatch acceptance;
- initial claim, busy duplicate, pre-start release, renewal, start marker,
  retry wait, terminal rejection, exact acceptance/receipt replay, and closed
  outcomes for both tables;
- delivery-attempt accounting and database-time backoff with no JavaScript
  clock participation;
- lower/newer provider cancellation ordering and cleanup-only late receipts;
- terminal `provider_stale_generation` settlement with no receipt or Task
  cancellation acknowledgement, plus hostile and correlation rejection;
- lifecycle-current dominance before start and uncertain replay after start;
- canonical byte/digest validation, owned snapshots, corruption quarantine,
  and no regeneration/fallback;
- stale owner/fence/state/operation/repository handle rejection;
- exact one-retry confirmed-rollback policy, decision uncertainty, cleanup
  failure, defects, and interruption; and
- all existing DTE04 lifecycle/store and DTE06-C1 schema/codec tests unchanged.

### Genuine PostgreSQL

The ordinary-role, temporary-schema PostgreSQL lane must prove:

- two independent repositories race one effect and only one claim fence wins;
- a live claim excludes a second host and database-time expiry admits exactly
  one takeover;
- lifecycle mutation and acquisition serialize on the run lock so stale
  preparation cannot cross a committed lifecycle advance;
- dispatch acceptance and cancellation preparation serialize in dispatch-
  before-cancellation order without deadlock;
- a blocked row lock stops at `lock_timeout`, rolls back, and leaves the
  connection reusable;
- a long statement stops at `statement_timeout`, settles rollback, and leaves
  the connection reusable;
- whole-transaction termination produces decision/cleanup evidence, discards
  the checked-out client, and the next operation uses a healthy replacement;
- a committed-but-response-lost harness returns decision uncertainty rather
  than a false rollback/success and recovery observes the durable row;
- a provider newer-before-older cancellation outcome closes the older row as
  `provider_stale_generation` with no receipt and exact closed replay; and
- all clients and temporary schemas settle and clean up without admin-only
  database creation privileges.

PGlite is the fast semantic lane. It cannot replace genuine PostgreSQL lock,
session termination, connection disposition, or commit-response uncertainty
evidence.

## Implementation Sequence

The admitted implementation remains one C2 checkpoint, executed in this order:

1. add the private models, configuration capture, target/factory, typed
   outcomes/errors, and boundary exports;
2. implement shared transaction settlement classification and dispatch
   acquire/transitions with focused PGlite proof;
3. implement cancellation acquire/transitions using dispatch-before-
   cancellation locking and focused PGlite proof;
4. add hostile ownership, corruption, retry, rollback, uncertainty, and
   interruption cases;
5. add the ordinary-role genuine-PostgreSQL concurrency/deadline/disposition
   lane; and
6. run package/workspace typechecks, C1 migration/schema/codec regressions,
   lifecycle/source-map/package/Effect boundaries, and both required project
   reviewers against the final code diff.

No partial step may be described as completed C2. A dispatch-only repository,
PGlite-only transaction proof, or repository without connection-disposition
evidence is incomplete.

## Completion Gate

DTE06-C2 is complete only when:

- the one private repository subpath is implemented without a public/root
  export or raw transaction callback;
- every acquire and transition follows the fixed authority, lock, state,
  failure, and settlement contracts above;
- DTE06-C1 schema and evidence require no semantic weakening or new migration;
- focused PGlite and genuine-PostgreSQL matrices pass;
- existing DTE03/DTE04 lifecycle behavior and DTE05 scheduling behavior remain
  unchanged;
- Trigger/Prisma/Redis/Node-host/Cloudflare/deployment boundary checks remain
  clean; and
- the TypeScript/Effect and code-quality reviewers accept the final significant
  code diff after all fixes.

## Stop Boundary

DTE06-C2 does not authorize:

- changing the Task aggregate, requested-effect union/ledger, lifecycle
  transitions, run-creation authority, due discovery, or DTE05 scheduling;
- adding a generic effect/outbox repository or exposing raw Drizzle/transaction
  capabilities;
- calling `TaskComputeProvider`, reading input object bytes, materializing a
  runtime, invoking user code, or settling a Task attempt;
- operation discovery, directory traversal, continuations, connected sweeps,
  fairness budgets, or uncertain replay orchestration owned by DTE06-C3;
- a Cloudflare/Worker Loader adapter, service binding, Queue/cron handler,
  Wrangler or deployment configuration;
- heartbeat, completion, result publication, cleanup supervision, observability
  APIs, or output streaming owned by DTE06-D/E/F/Roadmap 07; or
- public API exposure or production activation.
