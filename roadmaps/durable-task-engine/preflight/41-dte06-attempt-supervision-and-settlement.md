# Preflight 41: DTE06 Attempt Supervision And Settlement

## Status

**Decision:** Approved as the implementation-ready, production-inert DTE06-E
boundary. DTE06-E1 is complete privately. DTE06-E2 through DTE06-E5 remain
pending. This document does not authorize a scheduled host,
Queue consumer, Cron Trigger, route, binding, deployment, public API,
observability feed, or production activation.

DTE06-A through DTE06-D already connect an authentic Application task run to
one accepted Worker Loader session. That path deliberately stops at provider
acceptance. DTE06-E may connect the session to the existing fenced Task System
lifecycle, but it may not create a second lifecycle, widen the provider-neutral
API with Flarex hosting details, or make process-local state authoritative.

The private Worker session contract now preserves the exact canonical terminal
value, typed runtime failure code, or explicit interruption generation and
provenance. Task cancellation, maximum-duration expiry, and host shutdown are
distinct. Because no deployed consumer or retained wire generation existed,
E1 corrected the current private contract atomically rather than introducing a
new product/runtime generation.

## Question

What is the smallest correct Flarex-owned supervisor that can take one exact
accepted Task Worker session and:

- renew only the existing fenced attempt lease through database-authoritative
  heartbeats;
- preserve a typed terminal Worker outcome instead of reducing it to local
  settlement;
- publish a successful result body before committing its bounded result
  commitment;
- acknowledge only an exact durable cancellation generation;
- submit failure and retry decisions through the existing Task lifecycle;
- remain honest when the Worker, host, R2 write, or PostgreSQL response is
  uncertain; and
- reuse the admitted Trigger control flow without importing Trigger runtime
  packages or transplanting its supervisor product?

## Current Repository Evidence

### The Durable Lifecycle Already Owns The Decisions

`@flarex/durable-task` already owns:

- monotonic attempt IDs, execution fences, lease versions, heartbeat sequences,
  and cancellation generations;
- `heartbeatAttempt`, `completeAttempt`, `requestCancellation`, lease-expiry,
  and current-attempt inspection;
- success, typed failure, retry, cancellation acknowledgement, and terminal
  transition policy;
- identical completion replay and conflicting-completion rejection; and
- database-time lease renewal and stale/current outcomes.

The scope-bound PostgreSQL store already persists those decisions atomically
with lifecycle evidence and requested effects. DTE06-E must call those owners;
it must not reproduce their transition tables in backend code.

### The Worker Session Is Process-Local Coordination Only

The current Task Worker session proves:

- exact Legacy or Application generation;
- exact scope, run, requested-effect sequence, attempt, and execution fence;
- one provider execution ID;
- accepted start before terminal settlement;
- monotonic interruption delivery;
- an absolute runtime deadline; and
- owned close, drain, and RPC disposal.

Its corrected settlement envelope owns a strict generation-specific completed
result, bounded failure code with a deliberately null safe message, or exact
interruption generation and reason. RPC loss, malformed replies, cleanup
failure, and defects remain failures rather than terminal data. The real
`WorkerLoaderTaskComputeProvider` still observes and closes the session in a
detached provider-scoped fiber, then retains only a local `settled` marker.

Therefore current settlement preserves terminal evidence but proves neither
result durability nor Task completion. The E1 pure mapper returns a
`publish_result` disposition for success and cannot manufacture a succeeded
completion before E2 provides an immutable result commitment.

### Provider Acceptance Must Remain Host-Neutral

`TaskComputeProvider` correctly owns only:

- idempotent dispatch acceptance; and
- generation-correlated cancellation delivery.

It does not own lifecycle storage, result storage, heartbeat cadence, retry
policy, or terminal completion. DTE06-E must not add those concerns to the
provider-neutral request, acceptance, or cancellation contracts.

The real Worker Loader adapter may accept a backend-private supervision
capability in its Layer composition. That capability is an adapter seam, not a
new method on `TaskComputeProvider`.

### The Immutable R2 Core Is Reusable, But No Task Result Store Exists

The backend immutable R2 core already provides:

- content-addressed conditional create;
- exact byte-length and SHA-256 verification;
- collision detection;
- reconciliation after uncertain writes;
- bounded reads; and
- distinct missing, corrupt, resource, budget, and settlement-uncertain
  failures.

Task runtime objects reuse that core through their own domain store. There is
no corresponding task-result publisher today. `TaskResultCommitmentV1` stores
only codec, byte length, and digest, as intended; it does not publish or prove
the body.

DTE06-E must add a narrow task-result owner over the immutable R2 core. It must
not reuse action result storage, place raw result bytes in Task System rows, or
give a Worker an R2 bucket capability.

## Trigger Reuse Decision

Preflight 37 and `source-map.connected-runtime-v1.json` remain the provenance
source of truth. DTE06-E implements the entries already classified there; it
does not reopen Prisma, Redis, organization, deployment-image, or workload
manager ownership.

| Connected behavior | Decision | Flarex owner |
| --- | --- | --- |
| Correlate heartbeat to exact execution | Translate | Backend supervisor calling existing lifecycle heartbeat |
| Return current state to stale execution | Preserve semantics | Existing lifecycle outcome plus supervisor stop policy |
| Publish result before completion | Translate | New task-result store over existing immutable R2 core |
| Exact completion and lost-response replay | Preserve semantics | Existing lifecycle completion replay |
| Cancellation delivery is not acknowledgement | Preserve semantics | Provider cancellation plus separate lifecycle completion |
| Missing runtime cannot acknowledge cancellation | Preserve semantics | Supervisor leaves authority to lease expiry |
| Runtime-start callback | Discard | Attempt is already granted before dispatch |
| Trigger workload HTTP API and tokens | Discard | Private capability/Layer composition |
| Trigger Node supervisor, Docker, Kubernetes, Redis, Redlock | Discard | Flarex Effect supervision, Worker Loader, PostgreSQL, and R2 |

This remains behavior-level reuse. No `@trigger.dev/*` runtime dependency,
Prisma repository, Redis queue, Redlock, Trigger organization identity, or
Trigger workspace/lockfile merge is admitted.

## Accepted Topology

```text
Task requested effect and current fenced attempt
  -> existing delivery repository and TaskComputeProvider.dispatch
  -> exact Worker start acceptance
  -> backend-private TaskAttemptSupervisor
       -> scope-bound lifecycle resolver
       -> immediate heartbeat sequence 1
       -> bounded periodic heartbeat loop
       -> exact cancellation-generation handoff
       -> corrected Worker terminal outcome
            -> successful canonical value
                 -> TaskResultStore.publish
                 -> TaskResultCommitmentV1
                 -> RunAttemptLifecycle.completeAttempt(succeeded)
            -> typed task/runtime failure
                 -> RunAttemptLifecycle.completeAttempt(failed)
            -> exact Task cancellation interruption
                 -> RunAttemptLifecycle.completeAttempt(
                      cancellation_acknowledged)
            -> session loss or unconfirmed interruption
                 -> no completion; database lease expiry remains authoritative
```

The supervisor never holds a PostgreSQL transaction while calling Worker RPC,
R2, sleeping, or awaiting another external capability.

## Authority And Package Ownership

| Concern | Owner |
| --- | --- |
| Attempt, fence, lease, heartbeat, cancellation, retry, completion | `@flarex/durable-task` existing lifecycle |
| Scope-bound transaction, database time, aggregate persistence | `@flarex/persistence-postgres` existing Task System store |
| Runtime outcome wire envelope and strict decoder | `flarex-protocol` private compatibility contract |
| Worker execution and interruption provenance | existing generated Task Worker core |
| Session RPC ownership, timeout, close, and disposal | `flarex-backend/artifactRuntime` |
| Provider acceptance and cancellation transport | existing `TaskComputeProvider` plus Worker Loader adapter |
| Per-session supervision, failure translation, and ordering | new backend-private supervisor owner |
| Canonical result bytes and immutable publication | new backend-private Task result store over immutable R2 |
| Retry decision | existing durable lifecycle policy, never the Worker or provider |
| Scheduled wake/delivery host | DTE05-E3 only after DTE06-F |
| Public reads, live status, logs, traces, output streams | Roadmap 07 |

## Required Private Session Contract Correction

The current private session must retain a strict terminal outcome instead of a
bare `settled` receipt. The corrected current contract must remain one exact
generation-discriminated envelope correlated to:

- runtime generation;
- scope, run, requested-effect sequence, attempt, and execution fence;
- provider execution ID; and
- the accepted interruption generation and its provenance.

Expected execution outcomes are data, not transport failures:

```text
completed
  -> exact generation-specific canonical Worker result

failed
  -> bounded runtime failure code and optional safe message

interrupted
  -> exact accepted interruption generation
  -> cancellation_requested | maximum_duration | host_shutdown
```

RPC loss, malformed envelopes, deadline settlement uncertainty, cleanup
failure, and defects remain in the Effect failure/cause channel. They must not
be normalized into a user failure or a successful terminal envelope.

The Worker core must classify failures at the point where it knows whether the
failure came from input validation, output validation, handler execution,
runtime definition/configuration, or admitted interruption. The host must not
guess that classification from an arbitrary thrown message.

The current private contract may be corrected atomically because it is
undeployed and production-inert. All generated Worker definitions, the host,
the provider adapter, protocol tests, source-map targets, and boundary checks
must move in the same checkpoint. Do not introduce `RuntimeV2` product
semantics or retain a silent old/new fallback. Version suffixes remain only on
the exact private wire envelope and stored lifecycle contracts.

## Supervisor Contract And Lifetime

The new shared host capability should be named by its current role, for
example `TaskAttemptSupervisor`, without a chronological suffix. Its public
operation receives only an owned, already-correlated accepted-session subject:

- the exact dispatch request;
- provider acceptance;
- the owned Worker session;
- a scope-bound lifecycle capability or resolver;
- a task-result publication capability; and
- bounded supervision policy.

The service is a shared host capability and may be a `Context.Service` with a
Layer that closes its static requirements. Each accepted execution is a
dynamic, Scope-owned session value, not a Context singleton. The Layer must not
capture one request, scope, attempt, Worker session, or transaction globally.

One accepted session gets one structured supervision fiber. Its children are:

- terminal observation;
- heartbeat scheduling; and
- exact cancellation/interruption coordination.

They share one Scope and one terminal decision gate. The first authoritative
terminal disposition stops later heartbeats and cancellation delivery, closes
the session, and waits for owned cleanup. Detached, unobserved fibers are not
admitted.

Terminal observation starts immediately beside the first heartbeat. A very
short task may validly complete from `attempt_granted` before heartbeat sequence
`1` commits. If heartbeat wins, it enters `executing`; if terminal evidence wins,
the heartbeat branch is interrupted and cannot write after completion. The
supervisor must not delay terminal observation merely to manufacture an
`executing` phase.

`Exit` may be folded only at this supervision boundary, which owns the complete
Worker/session `Cause`. Typed lifecycle, R2, and protocol failures remain typed
until the supervisor maps an explicitly admitted terminal outcome. External
interruption preserves its `Cause`, runs finalizers, and returns no fabricated
settlement receipt.

## Heartbeat And Lease Rules

1. The supervisor resolves the exact current attempt under trusted scope
   authority before beginning heartbeat scheduling.
2. The first accepted heartbeat uses sequence `1` and is the existing
   lifecycle transition from `attempt_granted` to `executing`.
3. Later sequences are strictly monotonic for that supervisor instance.
4. Every heartbeat calls the scope-bound lifecycle operation; only its
   database-time receipt can renew the lease.
5. The next delay is derived from the accepted renewed lease and an explicit
   reserve. Local `Clock` schedules the wake but never establishes lease
   validity.
6. A stale attempt, stale fence, expired lease, inactive phase, or current
   terminal state stops supervision and requests a non-cancellation Worker
   interruption. It never renews locally.
7. A transient or uncertain heartbeat result is not an accepted renewal. The
   supervisor may retry only inside a bounded policy that still leaves the
   database-owned settlement reserve. If it cannot prove renewal, it stops the
   Worker and lets lease-expiry recovery decide.
8. Provider health, session acceptance, Worker Loader liveness, and local
   progress are never reported as Task heartbeats.

The heartbeat policy must prove positive margins among lifecycle operation
deadline, retry budget, heartbeat cadence, known lease expiry, Worker
interruption deadline, and cleanup reserve. Invalid compositions fail during
Layer construction before a Worker can start.

## Cancellation Rules

The durable requested-effect path continues to call
`TaskComputeProvider.requestCancellation`. The Worker Loader adapter may also
notify its private supervisor of the exact accepted cancellation generation;
that notification is not provider acceptance and not lifecycle authority.

- lower generations remain stale;
- exact replay remains idempotent;
- a newer accepted generation replaces the process-local watermark;
- the Worker interruption request carries explicit
  `cancellation_requested` provenance;
- only a correlated Worker terminal outcome for that exact generation may be
  translated to `cancellation_acknowledged`; and
- success racing with cancellation is submitted as success, allowing the
  existing lifecycle to record cancellation as superseded by completion.

Maximum-duration expiry and host shutdown use distinct interruption
provenance. Neither may become cancellation acknowledgement. If the Worker or
RPC disappears before a correlated interruption outcome is observed, no
acknowledgement is manufactured; database lease expiry remains authoritative.

## Terminal Outcome Mapping

| Verified runtime/host evidence | Lifecycle action |
| --- | --- |
| Canonical completed value | Publish result, then submit `succeeded` with exact commitment |
| Input payload violates declared task input schema | Submit task failure `input_validation_failed` |
| Returned value violates declared task output schema | Submit task failure `output_validation_failed` |
| Handler throws or rejects | Submit task failure `handler_failed` |
| Admitted middleware failure, if later present | Submit task failure `middleware_failed` |
| Verified runtime binding/configuration is invalid after accepted start | Submit system failure `configuration_invalid` or `internal_invariant` according to exact source code |
| Exact Task cancellation generation interrupts and settles | Submit `cancellation_acknowledged` for that generation |
| Worker explicitly settles maximum-duration interruption | Submit timed-out failure `maximum_duration_exceeded` |
| Worker explicitly reports supported resource exhaustion | Submit the exact supported resource-exhaustion code |
| Session/RPC/host disappears, response is malformed, or interruption is unconfirmed | Submit no completion; stop local work and leave recovery to lease expiry |
| Lifecycle returns stale/current/terminal | Stop local work and preserve the authoritative state; do not rewrite it |
| Completion transaction is uncertain | Replay the identical command within the admitted bound; never change result/failure/cancellation evidence |

Raw exceptions, stack traces, provider error strings, and platform causes are
not task failure messages. A safe message must pass the existing bounded Task
failure-message contract; otherwise the completion uses `null` and retains the
cause only in private operational diagnostics.

Retry remains a lifecycle decision. E1 must fix an exhaustive directive table
beside the runtime-outcome mapping. Ordinary task, runtime-loss, resource, and
timeout outcomes use `use_bound_policy`; only an explicitly classified
non-recoverable configuration/invariant failure may use `do_not_retry`.
`override_delay` is not admitted in the first supervisor slice. The Worker and
provider never choose a directive, and the supervisor never sleeps and starts a
new attempt itself.

Execution duration remains `null` in the first supervisor slice unless E1
introduces and proves a bounded monotonic duration in the trusted terminal
envelope. Host wall-clock subtraction, Worker-supplied arbitrary numbers, and
database time across separate transactions are not accepted duration
authority.

## Task Result Publication

Add a domain-specific `TaskResultStore` over the existing immutable R2 byte
store. It owns:

- canonical Flarex value encoding;
- the exact result byte ceiling;
- a deterministic content-addressed object key;
- no-replace publication and collision reconciliation;
- exact byte-length and digest verification;
- construction of `TaskResultCommitmentV1`; and
- read capability needed by later Roadmap 07 APIs and retention/GC.

The durable-task owner must publish the exact result codec, byte ceiling, and
object-key derivation needed to interpret `TaskResultCommitmentV1`. The current
commitment decoder admits any nonnegative safe byte length; DTE06-E must bind it
to the protocol-owned result maximum before a runtime can create a commitment.

Publication ordering is strict:

1. capture and canonicalize the owned Worker value;
2. enforce semantic and canonical byte limits;
3. derive digest and object key;
4. publish/reconcile the immutable object;
5. verify the returned bytes, length, and digest;
6. construct the owned commitment; and
7. submit the fenced lifecycle completion.

No PostgreSQL transaction spans R2 publication. An R2 write whose settlement
is uncertain must be reconciled by exact key/content. The supervisor does not
submit success until publication is confirmed. If the host dies after
publication but before completion, the object may be orphaned and the attempt
is recovered by lease expiry. DTE06-E records that retention obligation but
does not add deletion authority. A host must never delete a possibly referenced
object after an uncertain completion response.

## Transaction, Replay, And Crash Rules

- Each heartbeat, inspection, and completion is one existing scope-bound
  located transaction.
- Worker RPC, R2, sleeps, hashing, and result encoding occur outside those
  transactions.
- Identical completion replay uses the exact same attempt, fence, completion
  kind, result commitment or failure, retry directive, cancellation
  generation, and execution duration.
- A conflicting completion is a terminal integrity failure, not a retry with a
  modified payload.
- A host crash before confirmed completion does not create durable success,
  failure, timeout, or cancellation evidence.
- A host crash after a committed completion is recovered by the existing
  persisted replay/current aggregate.
- A stale supervisor cannot renew or complete a newer attempt because every
  lifecycle command carries the original attempt ID and execution fence.
- Process-local supervision state may optimize coordination but may not be
  queried as authoritative run state.

The existing provider may retain exact settled acceptance for its bounded
Layer lifetime so provider replay cannot start a second physical Worker. DTE06-E
must not clear that record merely because lifecycle completion was accepted.

## Effect And Composition Rules

- Reusable supervisor, result-store, lifecycle-gateway, and session operations
  use named `Effect.fn` boundaries with exact success, error, and requirement
  channels.
- Expected protocol, lifecycle, R2, and runtime outcomes are tagged typed
  failures or explicit terminal data.
- Foreign Worker/R2/PostgreSQL causes are mapped only at the adapter that owns
  that foreign boundary. Defects and interruption are preserved.
- Scope owns session fibers, timers, RPC targets, and finalizers.
- `TestClock` owns deterministic local cadence/timeout tests; database time is
  provided by the real/PGlite lifecycle store and is never faked by `TestClock`
  in database-authority proofs.
- Dynamic located scopes and sessions remain explicit multi-instance values;
  they are not installed as global Context services.
- Layer construction validates deadline and capacity relationships before it
  admits work.

## Ordered Implementation Slices

### DTE06-E1: Terminal Contract And Pure Mapping — Complete Privately

- correct the current private Task Worker terminal envelope;
- preserve successful values and explicit interruption provenance;
- add strict codecs, owned snapshots, exact identity correlation, and a
  deliberately null safe-message policy;
- add a pure exhaustive disposition from verified runtime terminal evidence to
  either result publication, an existing `TaskAttemptCompletionV1`, or
  unconfirmed host shutdown; and
- regenerate both current Worker definitions atomically, with no fallback
  protocol.

This stop is enforced: E1 writes neither lifecycle state nor R2. E2 is next.

### DTE06-E2: Immutable Task Result Store

- add protocol-owned result limits and deterministic key derivation;
- add the backend Task result store over the existing immutable R2 core;
- prove canonical publication, exact replay, collision, corruption, bounded
  reads, uncertain-write reconciliation, and owned bytes; and
- add no lifecycle call or deletion/GC authority.

### DTE06-E3: Scope-Bound Lifecycle Gateway

- add a trusted resolver for the existing Legacy and Application lifecycle
  stores;
- expose only inspect, heartbeat, and completion needed by supervision;
- preserve generation-specific aggregate decoding and scope authority;
- prove database-time renewal, stale fence/lease/current outcomes, identical
  completion replay, conflicting completion, and transaction uncertainty; and
- add no Worker or provider call inside a database transaction.

### DTE06-E4: Structured Session Supervisor

- compose one Scope-owned session with E2 result publication and E3 lifecycle;
- perform immediate and periodic heartbeats;
- coordinate exact cancellation generation and interruption provenance;
- sequence terminal publication/completion and close/drain;
- preserve external interruption and unknown session loss without completion;
  and
- integrate through a backend-private Worker Loader adapter seam without
  changing `TaskComputeProvider`.

### DTE06-E5: Private Connected Proof

- extend only the private Application/Legacy system-test composition;
- prove success, task failure/retry, exact cancellation acknowledgement,
  maximum duration, stale fence, lease loss, R2 uncertainty, PostgreSQL
  completion uncertainty, duplicate delivery, and lost response;
- prove zero raw result bytes in Task System rows and zero lifecycle writes from
  provider acceptance alone; and
- remain absent from routes, scheduled hosts, Queue/Cron configuration, and
  production deployment graphs.

Every significant code slice requires the two standing project reviewers
against the final diff. Any newly discovered schema/migration, lifecycle-policy,
provider-neutral contract, deployment, or retention/GC change outside the
boundaries above stops for its own owner approval.

## Validation Matrix

| Claim | Minimum proof |
| --- | --- |
| Current private terminal contract is exact | strict encode/decode, hostile input, ownership, generation/identity/execution correlation |
| No chronological runtime split | both generated Workers and host use one corrected current contract; no old/new fallback |
| Provider remains neutral | provider package API/type tests and import-boundary checks |
| Immediate execution heartbeat | accepted start followed by sequence 1 and `enteredExecuting: true` |
| Lease authority | real lifecycle/PGlite plus genuine PostgreSQL database-time tests |
| Stale safety | stale attempt, fence, lease, phase, and already-terminal tests cause stop with no renewed lease |
| Cadence bounds | deterministic `TestClock` tests plus configuration margin negatives |
| Cancellation | lower/same/newer generations, cancel/success race, timeout-vs-cancel provenance, lost session no-ack |
| Failure mapping | every admitted Worker code maps exhaustively; unknown cause cannot become task failure |
| Result durability | canonical value, key, limit, digest, conditional create, collision, corruption, uncertain settlement reconciliation |
| Completion replay | exact lost-response replay and conflicting completion rejection |
| Transaction boundary | query observation or fakes prove no Worker/R2/sleep occurs in lifecycle transaction |
| Structured cleanup | interruption, timeout, close/drain, late RPC disposal, no unobserved child fiber |
| No false durability | provider acceptance and process-local terminal settlement produce zero lifecycle completion writes |
| Production inertness | bundle/import/composition checks exclude routes, Queue, Cron, deployment bindings, and public APIs |

Genuine PostgreSQL is required for transaction settlement, lock/deadline, and
connection-reuse claims. PGlite is the fast semantic lane, not a substitute for
those platform facts. Miniflare proves local Worker ABI and cleanup behavior;
hosted Cloudflare proof remains DTE06-F.

## Explicit Non-Goals

DTE06-E does not authorize:

- a second Task lifecycle, scheduler, retry engine, cancellation table, or OCC
  system;
- changing `TaskComputeProvider` to expose Worker sessions, lifecycle stores,
  result stores, or Flarex runtime bindings;
- reusing `ApplicationActionSystem`, Legacy action prototypes, `/invoke`,
  query, mutation, or internal-action completion paths;
- raw result bodies, exceptions, logs, traces, or output streams in Task System
  rows;
- public result reads, subscriptions, live status, or observability UI;
- Task result deletion or retention/GC execution;
- warm placement, checkpoint restore, Docker, Kubernetes, Trigger workload
  HTTP, Redis, Redlock, Prisma, or Trigger organization identity;
- Queue, Cron Trigger, Workflow, Durable Object, route, binding, deployment, or
  production activation; or
- claims of hosted recovery or end-to-end readiness from Miniflare/PGlite
  alone.

## Stop Boundary

Completing DTE06-E proves that one already accepted private Worker session can
be supervised into the existing durable lifecycle with bounded heartbeats,
exact cancellation acknowledgement, typed failure/retry settlement, and
content-addressed successful results.

It does not prove that a deployed host will always run the supervisor,
redeliver after process loss, expose public status/results, or satisfy hosted
Cloudflare/PostgreSQL operational behavior. DTE06-F remains the next gate for
the private hosted end-to-end recovery proof. DTE05-E3 may consider a scheduled
Worker/Cron host only after DTE06-F closes and receives separate deployment
approval.
