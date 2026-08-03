# DTE03: Run-Attempt Lifecycle Model And Deterministic Transitions

## Status

**Status:** Active. DTE03-A, the current Trigger-to-Flarex lifecycle and
transition inventory, is complete. DTE03-B, the exact phase and aggregate
model, is next. The Roadmap 03 lifecycle-model gate remains closed, so DTE-IP01
package creation is not yet authorized.

This roadmap owns the host-neutral run-attempt lifecycle contract required by
the already-admitted private `@flarex/durable-task` package. It refines the
Trigger.dev status, retry, failure, cancellation, heartbeat, and stalled-run
semantics admitted by DTE01 into exact Flarex domain models under the identity,
authority, command, and store-port contract admitted by DTE02.

It does not authorize a package implementation, database schema, migration,
Postgres adapter, scheduler, queue, compute host, backend route, observability
API, public SDK, deployment, or production activation.

## Mandate

Roadmap 03 must answer seven connected questions without redesigning the
engine from a blank state machine:

1. which lifecycle facts from Trigger's run-status and execution-snapshot
   status axes belong in the first Flarex aggregate;
2. which phases, terminal outcomes, and orthogonal cancellation/lease facts
   make illegal combinations unrepresentable;
3. how success, failure, retry, cancellation, heartbeat, and lease-expiry
   commands decide accepted, idempotent, current, conflict, or typed-failure
   outcomes;
4. what retry, OOM, attempt-ceiling, and terminal-failure policy is evaluated,
   and in what order;
5. which transition evidence and requested external effects are committed
   atomically with state;
6. which replay evidence reconstructs the same receipt after ambiguous
   delivery; and
7. which translated compatibility scenarios prove that the adapted model
   retains admitted Trigger behavior while enforcing Flarex authority.

The result must be exact enough that DTE-IP01 implements closed Effect Schema
unions and pure decisions rather than inventing temporary variants.

## Fixed Inputs

### DTE01 Source Closure

DTE01 admitted one connected run-attempt capability from the pinned Trigger
commit, not whole files or a Trigger runtime dependency. Roadmap 03 must work
from the executable source map and its selected symbols:

- status predicates and the two current status axes;
- retry eligibility, attempt ceilings, configured backoff, immediate versus
  queued retry, and OOM escalation;
- attempt start, success, failure, cancellation, permanent failure, and
  terminal cleanup ordering;
- latest execution evidence, heartbeat behavior, and stalled-snapshot recovery;
- the semantic transaction/read-your-writes requirements of the selected
  run-store operations; and
- the admitted failure, cancellation, heartbeat, replica-lag, and uncertainty
  tests.

Trigger Prisma records, Redis locks and queues, worker jobs, organization and
environment identity, billing projections, waitpoints, checkpoints, batches,
child-run fan-out, and public result shapes remain excluded.

### DTE02 Authority And Service Contract

Roadmap 03 may not change the following incidentally:

- the already-created `TaskRunIdV1` and stored immutable task-definition
  revision are inputs to this package;
- attempt ID and execution fence are allocated by the authoritative start
  transaction;
- database time, run version, lease version, cancellation generation,
  heartbeat sequence, effect sequence, retry jitter, and result commitment
  keep their admitted meanings;
- the service has exactly `startAttempt`, `heartbeatAttempt`,
  `completeAttempt`, `requestCancellation`, `handleLeaseExpiry`, and
  `inspectCurrentAttempt`;
- the store port has exactly `transactRunAttempt` and `inspectRunAttempt`;
- mutation decisions are pure and may be invoked again by the adapter;
- commands contain no raw scope, product, persistence, clock, random, queue,
  host, or runtime authority; and
- state, replay evidence, transition evidence, and requested effects are one
  authoritative transaction result.

A real conflict returns to the owning DTE02 receipt. Roadmap 03 does not widen
the command or store port merely to make the lifecycle model easier.

## Lifecycle Modeling Direction

Trigger persists both a product-facing `TaskRunStatus` and a latest
`TaskRunExecutionStatus` snapshot. That split is compatibility evidence, not
an instruction to copy two independently mutable status columns. It currently
permits states such as a product run already marked `CANCELED` while execution
is still `PENDING_CANCEL`.

The Flarex model will instead derive read projections from one authoritative
run-attempt aggregate containing:

- one closed lifecycle phase;
- an optional current attempt and its fence;
- lease state and renewal evidence;
- cancellation request, generation, and acknowledgement facts;
- retry policy and the stored jitter needed for deterministic replay;
- an optional terminal outcome and bounded failure evidence;
- monotonic run version; and
- ordered accepted evidence and requested effects.

DTE03-B must fix the exact types and valid combinations. This direction does
not yet approve a particular phase name or field shape.

## Checkpoints

### DTE03-A: Current Lifecycle And Transition Inventory — Complete

[`preflight/12-current-lifecycle-and-transition-inventory.md`](./preflight/12-current-lifecycle-and-transition-inventory.md)
records:

- both Trigger status vocabularies and their first-vertical disposition;
- source transitions for start, heartbeat, success, failure, retry,
  cancellation, and stalled execution;
- retained invariants, translated seams, deliberate divergences, and excluded
  capabilities;
- source error classification and retry decision order;
- source effects and transaction/uncertainty gaps; and
- the exact decisions remaining for DTE03-B through DTE03-G.

The receipt is an inventory, not the final Flarex state model.

### DTE03-B: Phase, Terminal Outcome, And Aggregate Model — Next

Define and admit:

- `RunAttemptPhaseV1`;
- the terminal success, cancellation, and failure outcome unions;
- current-attempt, lease, cancellation, retry, and terminal invariants;
- `TaskRunAttemptAggregateV1` with its ownership and runtime-freeze contract;
- legal initial aggregate states received by DTE-IP01; and
- exhaustive valid/invalid combination tables.

This checkpoint must explicitly decide whether scheduling facts are aggregate
phases or inputs owned by the later Task System API. It must not claim support
for waitpoint or checkpoint phases.

### DTE03-C: Completion, Failure, Retry, And Attempt Policy

Define and admit:

- `RunAttemptPolicyV1` and its bounded values;
- `TaskExecutionFailureV1` and terminal classification;
- success and failure completion values used in completion identity;
- cancellation recognition before ordinary failure classification;
- the exact global and definition-specific attempt ceilings;
- retry eligibility, configured retry, stored jitter, backoff, OOM escalation,
  compute-class request, and immediate-versus-durable retry decisions;
- database-time calculation and overflow behavior; and
- exact first-failure/error ordering.

The checkpoint must resolve Trigger's start-versus-completion attempt-ceiling
boundary difference instead of copying it silently.

### DTE03-D: Cancellation, Heartbeat, Lease, And Recovery Tables

Define exhaustive transition tables for:

- first and duplicate cancellation requests;
- cancellation generation acknowledgement and completion races;
- heartbeat loss, gap, duplicate, stale fence, and terminal delivery;
- accepted lease renewal and stale lease-expiry wake;
- lease expiry before attempt start, during execution, and while cancellation
  is pending;
- completion racing lease expiry; and
- worker-loss retry exhaustion.

Terminal cancellation must not be recorded merely because a request was sent.
Heartbeat acceptance must durably renew the lease at most once per accepted
sequence.

### DTE03-E: Operation Outcomes, Evidence, Effects, And Error Order

Define and admit:

- one closed outcome union for each of the five mutation operations;
- `RunAttemptInspectionV1` for the read operation;
- `TaskRunAttemptEvidenceV1`;
- stored replay receipts for accepted and idempotent delivery;
- `TaskRequestedEffectV1` and exact run-local effect order;
- accepted/idempotent/current/conflict distinctions; and
- `RunAttemptLifecycleErrorV1` with operation-specific decode, absence,
  corruption, stale-authority, transient-store, and terminal/invariant
  behavior.

Requested effects describe post-commit work. They do not contain a queue,
Worker, runtime artifact loader, backend client, or product event payload.

### DTE03-F: Compatibility Vectors And Executable Gate

Produce canonical JSON-safe scenario and receipt vectors for the admitted
Trigger behaviors, including:

- competing and duplicate start;
- immediate retry then success;
- durable retry;
- no retries remaining;
- non-retryable failure;
- OOM escalation and OOM exhaustion;
- executing and pre-start worker loss;
- pending cancellation acknowledgement and expiry;
- stale heartbeat and stale lease wake;
- completion/expiry races; and
- identical versus conflicting completion redelivery.

Every semantic difference must be named in the vector metadata. The harness
may execute the frozen Trigger workspace separately, but active Flarex source
must not import it.

### DTE03-G: Final Lifecycle Admission

Audit DTE03-A through DTE03-F as one contract and choose `admit`, `revise`,
`defer`, or `reject`. Only `admit` opens DTE-IP01.

The final receipt must consolidate the exact type inventory, transition
tables, policy order, effects, errors, compatibility vectors, package gates,
and reopening rules. It must identify the first implementation action without
authorizing Roadmap 04 persistence or host work.

## Lifecycle-Model Exit Gate

DTE03-G may admit the package model only when all of the following are fixed:

1. every aggregate phase and terminal outcome has one unambiguous meaning;
2. every aggregate field combination is legal by construction or rejected by
   the schema;
3. all five mutation commands have exhaustive transition and outcome tables;
4. inspection cannot expose an impossible or authority-bearing state;
5. retry and failure policy is deterministic from stored state, database time,
   command evidence, and stored jitter;
6. attempt-ceiling, cancellation, heartbeat, and lease races have one accepted
   result and an idempotent/current response path;
7. completion replay distinguishes identical delivery from conflict;
8. state, evidence, replay receipt, and requested effects commit atomically;
9. effect order is stable and delivery never becomes state authority;
10. typed errors preserve operation order and do not turn defects or corrupted
    state into ordinary domain outcomes;
11. compatibility vectors cover every admitted source branch and deliberate
    divergence; and
12. no DTE01 source/dependency boundary or DTE02 identity/authority/store-port
    contract has been reopened silently.

Until all twelve conditions are accepted, `packages/durable-task/` must not be
created.

## Reopening Rules

Return to DTE01 if Roadmap 03 needs another Trigger source symbol, another
runtime dependency, a public export, a host API, or a materially different
source-reuse classification.

Return to DTE02 if Roadmap 03 needs another command or store operation, changes
an identity representation, moves scope authority into the domain, changes
allocation ownership, or makes database time, fence, lease, cancellation, or
effect versions mean something different.

Changes confined to phase names, aggregate fields, lifecycle outcomes,
failure policy, evidence, requested effects, and deterministic decision order
belong here.

## Non-Goals

Roadmap 03 does not define or authorize:

- run creation or its idempotency key;
- due-run discovery, queue fairness, delayed scheduling, or wake delivery;
- Drizzle tables, migrations, indexes, transactions, or adapter code;
- waitpoints, checkpoints, batches, child runs, debounce, cron, TTL expiry, or
  pause/resume;
- compute-provider protocols, machine catalogs, or runtime payloads;
- observability read models, logs, traces, live cursors, UI APIs, or streams;
- Trigger organization/environment/deployment compatibility;
- public task APIs; or
- production routing, activation, dual execution, or fallback.

## Authority And Evidence

This roadmap is governed by:

- [`01-source-reuse-and-package-admission.md`](./01-source-reuse-and-package-admission.md)
  and its DTE01 receipts and executable source map;
- [`02-task-definition-identity-and-scope.md`](./02-task-definition-identity-and-scope.md)
  and its DTE02-A through DTE02-G receipts;
- [`preflight/12-current-lifecycle-and-transition-inventory.md`](./preflight/12-current-lifecycle-and-transition-inventory.md);
- the frozen Trigger source at the DTE01 pinned commit; and
- current Flarex code only for implemented authority and package-boundary
  evidence.
