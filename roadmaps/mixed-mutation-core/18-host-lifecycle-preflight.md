# Conditional host lifecycle redesign

Status: **conditional dependent draft; planning only, runtime scope unapproved.**
Include or skip this package after attributable evidence from the connected
[15](./15-admission-protection-preflight.md),
[16](./16-batched-read-execution-preflight.md) and
[17](./17-batched-settlement-preflight.md) cutovers. It is not an automatic fourth
implementation or permission to pool/reuse Workers, clients or capabilities.
The [successor roadmap](./14-execution-redesign-roadmap.md) owns the sequence.

## Conditional outcome and current evidence

Remove attributable startup, serialization or transport cost only if it blocks
the agreed latency target and a separately accepted lifecycle/trust contract can
remove it. Deliver a real host/core consumer cutover with isolation, cancellation,
cleanup and recovery, rather than an unused reusable-host abstraction. If evidence
does not justify it, record why this slice is skipped; do not run repeated
profiling-only optimization turns.

The [existing ordinary-Postgres benchmark](../../packages/flarex-backend/benchmarks/mixed-mutation-core/bundled-dependency-validation/README.md)
creates, readies, invokes once and disposes a fresh Worker for each mixed request,
even in warm series. It includes private bridge, signed argument parsing and
issuer work. This makes startup a possible structural floor; it does not identify
the cause of Product's tail or establish Cloudflare host performance. No exact
startup number or native parity conclusion is assumed from this local comparison.

The [accepted hosted design](../../design-notes/flarex-db-accepted-design.md#hosted-runtime-topology)
keeps hosts as adapters, untrusted execution separated by restricted capabilities,
private executor service binding and cache-disabled Hyperdrive. Worker database
clients are invocation scoped and closed by their owner; module-scope pooling
is not authorized by a benchmark floor. Changes to that contract need their own
explicit accepted-design and host decision.

## Existing owners and boundaries

| Owner | Proposed investigation and bounded responsibility |
| --- | --- |
| [Performance workload](../../packages/flarex-backend/test/mixedMutationPerformance.postgres.test.ts) and its retained artifact package | Attribute local construction/readiness/invocation/disposal and bridge/argument costs without relabeling them hosted evidence |
| [Exact mutation Worker source](../../packages/flarex-backend/src/artifactRuntime/PointMutationExactRuntimeWorkerSource.ts) and [exact runtime](../../packages/flarex-backend/src/artifactRuntime/pointMutationExactRuntimeWorker/flarex-point-mutation-exact-runtime-execution-v1.ts) | Exact content-addressed source, one-invocation isolation and restricted attempt capability lifecycle |
| [Artifact runtime Worker](../../apps/artifact-runtime/src/worker.ts) | Source/Worker loading and transport adaptation; no journal, database or commit authority |
| [Executor Worker](../../apps/executor/src/worker.ts), [HTTP adapter](../../packages/executor-http/src) and [executor core](../../packages/executor/src) | Invocation-owned host resources around trusted root/retry/settlement; no host-owned second lifetime or outcome ledger |
| [Attempt kernel](../../packages/persistence-postgres/src/transactionSessionAttemptKernel.ts) and [journal](../../packages/persistence-postgres/src/sessionJournalStore.ts) | Exact scope/fence/claim lifetime and retained recovery remain authoritative despite changed transport |

Native Product, selected Payload Local API and finite Medusa workflow callbacks
keep their current owners and trust levels. Reusing source compilation or trusted
preparation does not prove that untrusted mutable globals, captured callbacks,
pending rows or attempt capabilities can survive across invocations.

## Evidence gate and actual decisions

1. Complete attributable phase measurements inside the existing connected
   acceptance question: startup/readiness/teardown, source loading, argument/result
   serialization and bytes, bridge/driver/transport, sandbox/framework CPU,
   decode/hash and DB/server/waits/seal/publication. Mark unavailable attribution;
   driver await does not isolate server time. Preserve all samples and outliers.
2. Decide include or skip using the remaining target gap and an identified host
   owner. Distinguish unavoidable admitted isolation from removable test harness
   cost and actual production host cost. If host cost blocks a target, record
   that target separately; do not claim whole-goal completion from core gains.
3. Compare retaining fresh execution, reusing only immutable compilation/source,
   reducing bounded serialization, changing private transport, or a deliberately
   isolated lifecycle redesign. Select one concrete contract based on evidence.
   No default pool, cross-request Worker reuse, global client or speculative
   supervisor follows from this draft. A host that cannot safely meet the target
   may need a revised target discussion, not reduced correctness.
4. Specify exact artifact identity, scope/placement/source revisions, invocation
   and attempt fences, permitted state, capability issuer/revocation and cleanup
   boundary. Fresh live scope/binding/generation/revocation/session/lease/claim
   and post-lock DB-time checks still occur at every actual DB boundary; host
   identity never becomes cached admission or settlement authority.
5. Prove no untrusted globals, promises, callbacks, buffered results, pending
   working set, events, credentials or cancelled capability can cross invocation
   boundaries. If any reuse is proposed, specify concurrent request isolation,
   taint/quarantine, crash/disposal and bounded saturation behavior. Preparation
   lifetime follows the accepted 15 attestation contract, including reconnect.
6. Keep no SQL transaction across framework/sandbox callbacks, waits or effects.
   Only executor/persistence settles; COMMIT uncertainty resolves retained evidence
   before callback replay. Cancellation revokes calls and preserves actual outcome,
   including cleanup failures without replacing the primary error.
7. Keep local Workerd/Node compatibility and production Cloudflare host evidence
   distinct. Any hosted implementation/activation is a separate approved gate;
   a local startup improvement is not a hosted latency, scale or throughput claim.

Challenge weakening one-invocation isolation to meet a sub-startup target,
benchmarking a permanently warm host unlike the admitted profile, and moving
trusted root state into a host actor. Prefer removing evidenced immutable-source
or serialization waste while keeping the accepted authority boundary. A materially
different lifecycle or transport needs explicit scope agreement before runtime.

## Breaks, budget and cutover

Inventory exact runtime/source/transport contracts, capability messages, host
adapters and all real callers before changing them. Include generated artifacts,
retained attempts/outcomes, artifact identities and deployed environments; choose
explicit rebuild/drain/migration/isolated-reset and activation disposition. Do not
reinterpret old protocol bytes or silently delete named durable evidence.
Migrate selected consumers and remove displaced wrappers/transports/fixtures/
exports within the slice, retaining a distinct compatibility host only for a
named supported caller and removal gate. No fallback host or second engine.

Before implementation, agree numeric per-graph startup/serialization/transport
limits and bounded byte/message/concurrency/cleanup formulas from the actual
graph, alongside SQL/transactions/round trips and server-work limits. Keep
structural preparation, live acceptance, data and seal/publication separate.
The [shared latency goals](./14-execution-redesign-roadmap.md#budget-and-attribution-gate)
remain mixed p50 100/200/500 ms and p95 200/400/1,000 ms; standalone median
below 400 ms with regression strictly below 10%. These are goals; host feasibility
and exact numeric structural budgets are unresolved until the evidence gate.

## Validation and exit

Prove actual host/core Product/Payload/workflow success and failures, scope/fence
misuse, cross-invocation contamination, concurrent/cancelled requests, late
capability calls, taint/quarantine, crash/teardown and bounded saturation. Use
PGlite for fast lifecycle semantics and distinct-connection ordinary-role Postgres
for DB-boundary freshness, reconnect/attestation, OCC, lock/time, events and uncertain
COMMIT recovery. Preserve whole-root fresh retry, rollback-only and no duplicate
callback/event on retained replay. Keep standalone and supported host regressions.

Run applicable source identity/generated-artifact/Worker bundle guards, types,
builds, lint, Effect/error/lifetime review, both project reviewers on the final
diff, substantive-fix re-review, cleanup, staged lint and one scoped commit after
successful validation. Shut down owned runtimes and close invocation resources.

Exit is either a justified documented skip or one accepted lifecycle cutover with
real consumers, explicit durable disposition, removed displaced paths and preserved
isolation/recovery. Runtime functional delivery remains distinct from measured
latency acceptance; match workload, host lifecycle and zero-exclusion evidence,
retaining all samples/outliers. An implemented slice must pass its agreed
graph-derived stage budget alongside correctness and cleanup; reconcile a failed
budget or explain a changed contract before further work. State any still-unmet target and attributable
cost owner. No new framework/query support, public APIs, automatic host pooling,
hosted activation, waits/effects/resource locks or advanced evolution is admitted.
