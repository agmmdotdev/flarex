# Task Host Adapters And Redis Replacement

Status: **accepted host-neutral direction; replacement adapters pending**.
Read the [engine](./01-engine-and-integration.md) and
[logical storage](./02-logical-storage.md) contracts together with this note.

## Responsibilities

The fork decides task transitions. FlarexDB retains durable truth. Host services
wake or execute work; their acknowledgements do not commit Task outcomes.
Retain/adapt useful current host mechanics while removing duplicated task policy.

| Trigger/Redis responsibility | Replacement owner |
| --- | --- |
| Queue eligibility, sorted pending work and capacity reservations | Logical indexed Task records plus atomic core-backed claims/releases |
| Redlock and ownership | Core transaction ordering, database-time leases and durable fencing |
| Retry/delay/heartbeat/timeout/cancellation worker jobs | Logical due work and durable Task intents; retained engine callbacks execute through bounded handlers |
| Message transport and immediate wake-up | Injected delivery adapter, initially Cloudflare Queues |
| Time-based wake-up and missed-message repair | Injected timer/scheduled host entry point and bounded durable repair |
| Runtime launch and cancellation delivery | Existing compute/session owners behind an admitted provider contract |
| Product caches | Delete unused caches; any retained cache is non-authoritative |

Replace each complete operation, not each Redis primitive. Splitting an atomic
queue reservation into independent logical reads and writes would change its
correctness. Remove Prisma/Redis/Redlock runtime dependencies from the admitted
fork; isolated upstream reference tests can still require them.

## Delivery And Timers

Queue messages are hints identifying trusted discovery work, not capabilities
or proof that a run is eligible. Resolve authority and recheck database state
before claiming. Duplicate, stale and reordered messages must be safe. Persist
delivery intent with the relevant state transition; external queue publication
occurs after settlement and has recoverable progress.

Transport retry redelivers a hint. It does not increment a business attempt or
choose the task retry policy. Queue retry exhaustion, dead-lettering or message
expiry must not delete the durable Task obligation. Repair discovers pending
work and republishes or executes the existing bounded handler.

Initial Cloudflare composition uses Queues and a scheduled repair entry point.
Delayed messages may reduce wake latency, but authoritative due times remain in
FlarexDB. Long delays must survive provider delay/retention limits. Durable Object
alarms are an optional later wake optimization, not another run-state store or
required lifecycle owner. Task scheduler leases and repair checkpoints remain
private platform logical records even when the wake source changes.

An AWS adapter could use SQS for delivery and EventBridge Scheduler for wake-ups.
This is an extension point, not an AWS implementation commitment. Provider
credentials, SDK types, acknowledgements and event envelopes stay in host code.
Use small capability contracts grounded in the engine's actual calls; avoid a
general multi-cloud service registry or a Redis compatibility layer.

## Compute And Workflow Boundaries

Reuse and adapt the current private
[Task compute-provider contract](../../packages/durable-task/src/computeProvider/Services/TaskComputeProvider.ts)
and existing Worker Loader/session owners. Dispatch acceptance is distinct from
durable completion. Preserve immutable artifact/principal binding, stable
execution identity, lost-response recovery, heartbeat supervision, cancellation
generation correlation and resource cleanup. A stale process cannot commit even
if the provider has not finished stopping it.

An SQS adapter does not make Worker-specific artifacts executable on AWS.
Another compute provider needs its own runtime/artifact/callback contract and
proof. Unsupported duration, machine or suspension capabilities fail closed.
Never keep a database transaction open while compute runs.

Cloudflare Workflows is not the implementation of this Task lifecycle: it would
add another owner for persisted steps, retries and waits. AWS Step Functions is
likewise not selected. A separately requested external workflow integration
needs explicit ownership and recovery semantics. Native Medusa workflow
orchestration remains with Medusa, using the shared Task attempt/wait primitives.

## Host Conformance

Prove identical domain outcomes with deterministic host adapters and the actual
Cloudflare composition. Cover duplicate/lost hints, unavailable transport,
delayed delivery, missed timer, retry exhaustion, expired claims, concurrent
workers, cancellation, provider uncertainty and fresh-host recovery. Database
proofs do not establish Cloudflare deployment or runtime limits; hosted activation
has its own gate. Task retries do not make arbitrary external effects exactly
once; handlers need their own admitted idempotency/reconciliation contracts.

Primary service references: [Cloudflare Queue delivery](https://developers.cloudflare.com/queues/reference/delivery-guarantees/),
[Cloudflare alarms](https://developers.cloudflare.com/durable-objects/api/alarms/),
[Cloudflare Workflows](https://developers.cloudflare.com/workflows/),
[SQS standard queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues.html)
and [EventBridge targets](https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-targets.html).
Provider limits must be checked when admitting an actual adapter.
