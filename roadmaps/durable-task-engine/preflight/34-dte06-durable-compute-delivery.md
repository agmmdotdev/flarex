# Preflight 34: DTE06 Durable Compute Delivery

## Status

**Decision:** DTE06-C0's docs-only schema and transaction preflight and
DTE06-C1's canonical delivery evidence and schema checkpoint are complete.
DTE06-C remains divided into separately reviewed, production-inert checkpoints:
C2 owns the scope-bound fenced transaction repository, and C3 owns a bounded
connected runner against the deterministic compute provider.

DTE06-C1 adds only a private evidence export, two Task-owned tables, migration,
and their focused proofs. It adds no transaction repository, effect consumer,
provider call, Worker route, binding, deployment configuration, or production
activation. DTE06-C2 is complete under
[`35-dte06-scope-bound-fenced-repository.md`](./35-dte06-scope-bound-fenced-repository.md),
and the approved prepared-subject commitment correction has removed its
implementation pause without changing the schema. The approved bounded C2
provider-stale cancellation-generation settlement is also complete without
DDL or Task lifecycle changes. C3 is admitted as the next production-inert
checkpoint. Its contract is recorded in
[`36-dte06-connected-mock-delivery.md`](./36-dte06-connected-mock-delivery.md)
with its connected-flow prerequisite and exact proposed boundary.

## Question

How can one persisted `dispatch_attempt` or
`request_execution_cancellation` effect be prepared, claimed, delivered, and
recovered without making provider state authoritative, weakening Task lifecycle
fences, or creating a generic requested-effect delivery engine?

## Sources Inspected

### Flarex Task And Persistence Owners

- the run-attempt aggregate, requested-effect models, and existing lifecycle
  operations in `packages/durable-task/src/runAttempt`;
- the ID-centric provider request, acceptance, cancellation, and error contracts
  in `packages/durable-task/src/computeProvider`;
- `fx_system_durable_task_definition_revision_v1`,
  `fx_system_durable_task_run_v1`, and
  `fx_system_durable_task_requested_effect_v1` in the PostgreSQL schema;
- scope-bound run creation, lifecycle transactions, due discovery, and the
  deliberately read-only requested-effect ledger;
- Standard Application's canonical durable-task runtime binding and immutable
  task definition revision; and
- DTE05's fenced repair checkpoint and database-deadline work as transaction,
  takeover, and uncertainty evidence, not as a reusable delivery table.

### Trigger Compatibility Source

The pinned Trigger.dev run-engine and supervisor paths were inspected for queue
dequeue, exact run/attempt snapshot correlation, warm-start verification, lost
dispatch evidence, and uncertain provider response behavior. They remain
semantic and failure-scenario input only. Their Prisma, Redis, organization,
deployment, and compute-host records are not Flarex storage or authority.

## Findings

### 1. Requested Effects Are Intent, Not A Delivery Queue

The lifecycle transaction already atomically appends the durable intent. The
requested-effect ledger is immutable and run-scoped; it intentionally has no
claim, acknowledgement, retry, or provider state. Adding those meanings to the
ledger would mix lifecycle authority with host delivery coordination.

**Decision:** preserve the ledger unchanged. DTE06-C adds operation-specific
subordinate evidence referencing an exact requested-effect sequence. It does
not add a generic outbox consumer or generic effect acknowledgement.

### 2. Preparation Must Close The Authority Gap Without A Package Cycle

`TaskComputeDispatchRequestV1` is deliberately ID-centric. It carries trusted
scope, run, effect, attempt, fence, definition, lease, compute-profile, and
cancellation projections, but not Standard Application binding or input bytes.
That keeps `@flarex/durable-task` independent: Standard Application already
depends on durable-task, so moving its binding into the provider contract would
create the wrong dependency direction.

Before delivery, a scope-bound persistence transaction must nevertheless load
and correlate the immutable definition binding and the run's input reference.
The transaction returns an owned private **prepared execution subject** with:

- the exact frozen provider dispatch request;
- the decoded, correlated Standard Application
  `runtimeBindingCommitment`, reconstructed from canonical definition bytes
  without the full manifest;
- the immutable `TaskInputReferenceV1`;
- the delivery checkpoint identity and fenced process-local claim handle; and
- only the content commitments needed to prove those values match stored
  canonical evidence.

This subject belongs to the private persistence/backend composition seam, not
the public provider wire contract. DTE06-D will consume it at the existing
artifact-runtime owner, load the full binding and manifest, verify every
commitment, and define the private task runtime ABI. C1-C3 must not materialize
that binding, invent that ABI, or send raw task input through the provider
request.

### 3. Dispatch And Cancellation Need Distinct Evidence

Dispatch acceptance and cancellation delivery have different identities,
receipts, prerequisites, and replay rules. One mutable generic row would either
erase cancellation generations or make nullable columns define an implicit
union.

**Decision:** C1 adds two Task-owned tables:

#### `fx_system_durable_task_compute_dispatch_v1`

One row is subordinate evidence for one exact `dispatch_attempt` effect.

- primary identity: trusted `scope_id`, `run_id`, and
  `requested_effect_sequence`;
- immutable correlation: accepted run version, definition revision, attempt ID
  and number, execution fence, lease version, compute profile, and the
  cancellation projection captured during preparation;
- canonical evidence: bounded versioned provider-request bytes plus SHA-256;
- delivery state: `prepared`, `delivering`, `accepted`, `retry_wait`,
  `rejected`, `obsolete`, or `quarantined`;
- claim state: nullable owner UUID, monotonic claim fence, database-owned claim
  and expiry timestamps, with all-or-none constraints;
- retry evidence: delivery-attempt count, database-owned next-attempt time, and
  a bounded privacy-safe reason code rather than a raw provider cause;
- accepted evidence: bounded canonical acceptance bytes plus SHA-256, present
  only in `accepted`; and
- foreign keys to the exact Task run and requested-effect row, plus a uniqueness
  constraint on scope/run/attempt/fence so two effect rows cannot claim the same
  granted attempt.

#### `fx_system_durable_task_compute_cancellation_v1`

One row is subordinate evidence for one exact
`request_execution_cancellation` effect.

- primary identity: trusted `scope_id`, `run_id`, and cancellation requested-
  effect sequence;
- immutable correlation: dispatch effect sequence, attempt ID, execution fence,
  and cancellation generation;
- canonical evidence: bounded versioned cancellation-request bytes plus
  SHA-256, including the accepted provider execution reference;
- the same fenced claim and bounded retry mechanics, with operation-specific
  `waiting_dispatch`, `prepared`, `delivering`, `delivered`, `retry_wait`,
  `rejected`, `obsolete`, and `quarantined` states and reason codes;
- bounded canonical provider delivery-receipt bytes plus SHA-256 only after the
  exact interruption request is accepted; and
- a foreign key to the exact dispatch checkpoint plus a uniqueness constraint
  on scope/run/attempt/fence/cancellation generation.

The exact Drizzle names, SQL enum/check spelling, byte ceilings, indexes, and
constraint names are C1 implementation details, but they must preserve this
closed shape. JSONB is not canonical evidence. Raw payloads, input bytes,
results, logs, traces, provider messages, stack traces, tokens, and foreign
causes are prohibited from both tables.

### 4. A Claim Is Coordination; The Call Boundary Needs A Durable Marker

Calling a provider inside the database transaction would hold locks across a
foreign boundary and still would not make an uncertain response atomic.
Calling after claim acquisition without a marker would make a crash
indistinguishable from no call.

**Decision:** the repository exposes operation-specific transitions with an
opaque process-local handle containing the database identity and claim fence:

1. `acquireDispatch` / `acquireCancellation` prepare or reload exact evidence,
   acquire or take over an expired claim, and return either a claimed subject or
   a closed typed outcome;
2. `markDeliveryStarted` changes `prepared` or `retry_wait` to `delivering` in
   its own committed transaction before the provider call;
3. `renewClaim` extends only the coordination deadline while the same claim
   fence remains current;
4. `recordAcceptance` / `recordCancellationDelivery` decode and correlate the
   exact provider receipt, store canonical evidence, and release the claim;
5. `recordKnownFailure` stores only a classified retryable or terminal reason
   and a database-owned next-attempt time; and
6. `releaseBeforeDelivery` is legal only before `markDeliveryStarted` and can
   never manufacture a known provider outcome.

Every transition freshly locates trusted scope authority, uses database time,
checks the exact operation/row/owner/fence/state, and returns a typed current,
busy, stale, corrupt, or uncertain outcome. A handle grants no scope, lifecycle,
provider, runtime, or application authority. Provider calls occur outside every
database transaction.

### 5. Uncertainty Must Replay Exact Evidence

After `markDeliveryStarted`, timeout, interruption, connection loss, process
death, or an unknown throw cannot prove rejection. The row remains
`delivering`; expiry takeover replays the canonical request with the same
provider idempotency identity. It never allocates a new attempt or effect.

If Task lifecycle is still current, recovered acceptance may proceed to the
later supervision checkpoint. If lifecycle has advanced, the recovered receipt
is cleanup evidence only. It cannot revive, extend, heartbeat, complete, or
cancel the stale attempt. A late acceptance must flow to DTE06-E's fenced
cleanup/cancellation policy.

An unstarted stale dispatch is marked `obsolete` without a provider call. An
already-started uncertain dispatch is not marked obsolete merely because
lifecycle advanced: exact replay is required to learn or re-establish the
provider identity needed for cleanup. Cancellation delivery follows the same
uncertainty rule and remains distinct from Task cancellation acknowledgement.

### 6. Fresh Lifecycle State Dominates The Checkpoint

For a new dispatch preparation, one transaction locks or otherwise establishes
the exact scope authority, requested effect, run, and definition snapshot and
rejects any mismatch in:

- requested-effect kind, payload, sequence, and accepted run version;
- current attempt ID/number, execution fence, and lease version;
- cancellation state/generation and dispatch admissibility;
- definition revision, application revision, runtime binding, runtime object
  commitments, and compute profile; or
- immutable input reference and stored creation authority.

The checkpoint never changes the run aggregate. Current lifecycle outcomes
always win over stale checkpoint projections. Corrupt stored evidence is a
typed/quarantined storage failure, never a reason to regenerate different
bytes, fall back to another definition, or call the provider.

### 7. Cancellation Waits For Exact Dispatch Acceptance

A cancellation effect can be prepared only for its exact attempt, fence, and
generation. It cannot be delivered until the dispatch checkpoint contains a
correlated accepted provider execution reference. Until then it is a waiting
candidate, not a fabricated cancellation receipt.

Lower generations cannot cancel or acknowledge a newer generation. Duplicate
delivery of the same generation returns the stored exact receipt. Runtime
interruption evidence still does not acknowledge cancellation in the Task
aggregate; only the existing fenced lifecycle command can do that.

### 8. Discovery Is Bounded And Fair, Not Authority-Bearing

The current run-specific ledger reader is insufficient for connected delivery.
C3 adds private, operation-specific candidate discovery under a freshly located
scope. Discovery must include both unseen effects and due/expired checkpoint
rows, use a stable database high-water snapshot, and page in deterministic
`eligible_time`, run-ID, effect-sequence order. Candidate pages carry identity
only and must be revalidated by acquisition.

Dispatch and cancellation have separate budgets so a cancellation backlog
cannot be hidden behind dispatch work. A connected sweep uses the existing
trusted replacement-scope directory pattern, but directory candidates never
carry a locator or authority. Empty filtered pages advance their cursor. Count,
page, operation, and wall budgets reserve unknown work conservatively and
return an exact canonical continuation. C3 remains mocked and unwired; it does
not modify DTE05 scheduling or Queue wake-hint semantics.

### 9. Deadline, Retry, And Retention Policy

- Claim timestamps, expiry, retry eligibility, and takeover decisions use
  PostgreSQL time only.
- Claim duration, per-call timeout, page/count budgets, known-failure retry
  ceiling, and backoff bounds are captured once from validated positive safe-
  integer configuration at composition.
- A timeout at the Effect layer is not advertised as a hard database bound.
  C2 must reuse or deliberately extend the DTE05 PostgreSQL deadline owner and
  prove connection disposition on genuine PostgreSQL.
- Known retryable failures consume the configured retry ceiling. An uncertain
  call is never relabelled a definite rejection to satisfy that ceiling; if
  operational recovery is exhausted it becomes a quarantined/operator-visible
  uncertain row, not `rejected`.
- Terminal rows may be garbage-collected only after the owning run and
  observability retention gates permit it. Dispatch evidence cannot be deleted
  while cancellation evidence references it, and uncertain/in-flight rows are
  never age-deleted.

Exact default durations and numeric ceilings remain configuration decisions for
C2/C3, where installed PostgreSQL and host evidence can validate them. The
schema must support the bounded policy without encoding a misleading wall-clock
guarantee.

## Race And Failure Contract

| Scenario | Required outcome |
| --- | --- |
| Two hosts acquire one unstarted effect | One claim fence wins; the other observes busy/current evidence |
| Claim expires before provider call | Takeover may prepare and deliver the same canonical identity |
| Host crashes after durable start marker | Takeover replays the same canonical request |
| Provider accepts but response is lost | Remain uncertain; exact replay recovers the same acceptance |
| Definite retryable rejection | Record bounded safe reason and DB-time retry |
| Definite terminal rejection | Record terminal evidence; DTE06-E later owns lifecycle settlement |
| Lifecycle advances before delivery starts | Mark subordinate dispatch obsolete; no provider call |
| Lifecycle advances after an uncertain call | Recover exact provider evidence for cleanup only; never revive attempt |
| Cancellation precedes dispatch acceptance | Wait for the exact accepted execution reference |
| Duplicate cancellation generation | Return the original correlated delivery receipt |
| Newer cancellation generation races an older one | Newer lifecycle generation dominates; older receipt grants no acknowledgement |
| Stored bytes/digest/correlation are corrupt | Fail closed and quarantine; no regeneration or provider call |
| Database outcome is uncertain | Settle the transaction/connection boundary before reuse; never guess the row state |

## Planned Implementation Sequence

### DTE06-C1: Canonical Delivery Evidence And Schema — Complete

- add private prepared-subject and dispatch/cancellation checkpoint models,
  strict codecs, typed failures, and bounded canonical evidence;
- add the two Task-owned tables, constraints, indexes, migration, and migration
  journal evidence;
- prove seed/constraint/corruption behavior in PGlite and ordinary-role genuine
  PostgreSQL using temporary-schema isolation; and
- add no transaction repository, effect discovery, provider call, or host.

Implementation receipt: the private
`@flarex/persistence-postgres/internal/task-compute-delivery-evidence-v1`
boundary owns canonical JSON/UTF-8/SHA-256 evidence capped at 16 KiB for the
four provider delivery values plus the prepared execution subject. Immutable
compute-profile correlation uses a versioned, lossless big-endian UTF-16
code-unit representation so every domain-valid JavaScript string round-trips
through PostgreSQL without narrowing the DTE06-B contract. Migration
`0050_absurd_terror.sql` adds
`fx_system_durable_task_compute_dispatch_v1` and
`fx_system_durable_task_compute_cancellation_v1` with identity, correlation,
evidence, claim, delivery-state, reason, time, foreign-key, uniqueness, and due
index constraints. Focused codec/ownership/corruption tests, current-head
PGlite migration and constraint tests, and temporary-schema genuine PostgreSQL
tests prove this checkpoint without admitting C2 operations.

### DTE06-C2: Scope-Bound Fenced Repository — Admitted

- implement acquire/takeover, start marker, renew, exact receipt checkpoint,
  known-failure, and pre-delivery release transactions;
- freshly correlate scope/effect/run/attempt/fence/lease/cancellation/definition/
  binding/input evidence;
- prove duplicate-host exclusion, expiry takeover, rollback versus uncertainty,
  lifecycle-current dominance, and connection settlement in PGlite and genuine
  PostgreSQL; and
- add no connected sweep or real provider.

The implementation-ready authority, operation/result contracts, lock and state
tables, settlement policy, validation matrix, and stop boundary are fixed in
[`35-dte06-scope-bound-fenced-repository.md`](./35-dte06-scope-bound-fenced-repository.md).
Its bounded C1 prerequisite is now complete: the prepared subject carries the
durably reconstructable runtime-binding commitment, while DTE06-D retains full
binding and manifest materialization authority.

### DTE06-C3: Bounded Connected Mock Delivery — Admitted

- add operation-specific candidate discovery and canonical continuation;
- compose fresh trusted scope resolution, the C2 repository, and the existing
  deterministic provider only;
- prove fairness, crash/restart, uncertain replay, cancellation ordering, exact
  resume, and conservative budgets; and
- add no Worker Loader route, Cloudflare adapter, scheduled host, Queue consumer,
  deployment configuration, or activation.

Preflight 36 found and bounded the missing provider-stale cancellation-
generation settlement. That prerequisite now records a terminal
`provider_stale_generation` outcome in PGlite and genuine PostgreSQL without a
receipt or Task acknowledgement. C3 may now implement only the connected,
production-inert boundary fixed by Preflight 36; no wider workaround is
admitted.

Each checkpoint is intentionally medium-sized: C1 proves storage truth, C2
proves transaction truth, and C3 proves orchestration truth. A table without
transactions, or a transaction API without connected recovery, is not described
as complete delivery.

## Validation Gates

Every applicable implementation checkpoint requires:

- durable-task and persistence package typechecks and focused tests;
- strict codec, ownership, hostile-accessor, canonical-byte, and corruption
  tests;
- migration and constraint proof in PGlite and genuine PostgreSQL;
- genuine-PostgreSQL duplicate-host, expiry, lock/statement/transaction-timeout,
  and connection-disposition evidence for C2;
- exact restart/high-water/fairness and unknown-progress accounting for C3;
- existing lifecycle, source-map, package-boundary, migration, and Effect gates;
  and
- both required project reviewers against the final significant code diff.

## Stop Boundary

This preflight does not authorize:

- changing the requested-effect ledger or Task lifecycle transitions;
- a generic effect-delivery/outbox framework;
- Standard Application types in `@flarex/durable-task` or raw input in the
  provider request;
- additional DTE06-C2 implementation outside Preflight 35, or any DTE06-D/E/F,
  or DTE05-E3 implementation without its own admission;
- a real provider, Worker Loader task route, service binding, R2 input loader,
  heartbeat, completion, result publication, or observability API; or
- Queue/cron consumers, Wrangler/deployment changes, public APIs, or production
  activation.
