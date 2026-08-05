# DTE05-P28: Cloudflare Queue Wake Hints

## Decision

**Outcome: DTE05-D complete; admit no deployed Queue host.** The completed
slice adds a portable wake-publication seam, a publishing variant of the
existing scope-bound scheduler composition, and one Cloudflare-Queue-shaped
adapter that remains unreachable from every Worker entrypoint and Wrangler
binding.

The adapter may publish and consume low-latency wake hints. PostgreSQL due
state remains authoritative. A message never proves that a run is due, that a
transition settled, or that a scope is authorized.

## Platform Evidence

The current Cloudflare Queue contract was rechecked against the official
JavaScript API, batching/retry, and delivery-guarantee documentation and the
installed `@cloudflare/workers-types` package before this decision.

- producer `send()` resolves only after the message is written to Queue
  storage;
- Worker consumers receive at-least-once, best-effort-ordered batches;
- an individual `ack()` or `retry()` wins over later batch settlement;
- an unacknowledged failed batch is retried, while explicit per-message
  settlement allows already-processed messages to stay settled;
- Queue retry delay is advisory and bounded to 24 hours; and
- the installed Worker types expose `Queue.send`, `MessageBatch.queue`,
  `Message.body`, `Message.attempts`, `ack`, and `retry` with the required
  structural contract.

Primary references:

- <https://developers.cloudflare.com/queues/configuration/javascript-apis/>
- <https://developers.cloudflare.com/queues/configuration/batching-retries/>
- <https://developers.cloudflare.com/queues/reference/delivery-guarantees/>

Cloudflare documentation and installed types are platform evidence, not
Flarex lifecycle authority.

## Trust And Envelope

The first envelope contains exactly:

- codec identity `flarex.task-queue-wake-hint.v1`;
- one bounded, nonblank opaque `partitionHint`;
- `dueKind: start_attempt | handle_lease_expiry`; and
- no other properties.

It contains no tenant, project, environment, scope, physical locator, run ID,
attempt ID, fence, lease, transition receipt, payload, claims, or database
handle. The first adapter uses the deployment ID spelling as the opaque
partition hint, but only a freshly resolving persistence capability may
interpret it. The message cannot provide a scope or authority record.

The Queue callback is authenticated by Cloudflare's Worker/Queue binding. The
adapter additionally correlates `MessageBatch.queue` with one captured exact
queue name and accepts no HTTP or user-request body. The envelope is still
decoded as untrusted input. This checkpoint does not add an HMAC because it
adds no independently reachable transport. A future HTTP, pull-consumer, or
cross-account producer path requires its own cryptographic authentication
preflight.

Possession of a Queue producer binding is privileged. A guessed partition
hint can at most cause bounded resolution and durable discovery: current
control-plane metadata, provisioning evidence, the located scope clock, and
the task scope authority are re-read before the scheduler is constructed.

## Publication Seam

The host-neutral scheduling package may add a narrow
`TaskWakeHintPublisherV1<Failure>` for only persisted `wake_retry` and
`wake_lease_expiry` requested effects. It must not become a generic requested-
effect delivery engine.

A new publishing candidate-handler composition must:

1. run the existing lifecycle operation unchanged;
2. receive its durable service receipt only after transaction settlement;
3. select wake effects from that persisted receipt in sequence order;
4. publish them sequentially through the captured publisher; and
5. preserve the exact publisher failure without wrapping it.

No Queue operation may run inside the lifecycle transaction. Idempotent replay
may publish a duplicate hint; current/no-change outcomes with no persisted wake
effect publish nothing. Publication failure does not roll back the already-
settled transition and does not make Queue authoritative.

The Queue producer maps `wake_retry` to `start_attempt` and
`wake_lease_expiry` to `handle_lease_expiry`. It may derive a best-effort
`delaySeconds` from the persisted database `notBeforeMs` and an injected host
clock, clamped to Cloudflare's 24-hour limit. The database due predicate is
still re-read at consumption time, so early, late, duplicated, or lost hints
remain safe.

## Fresh Partition Resolution

Persistence may add one private resolver that accepts only the opaque
deployment hint plus a captured wake publisher. It must:

1. resolve current located scope authority using the existing trusted
   resolver;
2. construct the publishing variant of DTE05-C1 over that exact target; and
3. return only deployment/scope selectors plus the scheduler.

It exposes no locator, database, transaction, clock, authority record, or
control-plane row. It is callable in production only by the admitted Queue
adapter and remains inaccessible from Worker entrypoints.

## Consumer Settlement

The adapter processes at most Cloudflare's 100-message batch limit and handles
messages sequentially. For every message it captures the ID, attempts, body,
and settlement methods once, then:

- acknowledges an invalid envelope without resolving a partition;
- freshly resolves a valid partition and runs the existing scheduler core for
  the envelope's due kind with a fresh cursor;
- acknowledges successful, stale, idempotent, current, and empty scheduler
  outcomes;
- acknowledges a post-commit wake-publication failure as
  `acknowledged_publication_lost`, because retrying the original due-kind hint
  cannot replay the derived wake after the durable transition changes that due
  kind;
- acknowledges a post-settlement lifecycle or handler contract failure as
  `acknowledged_contract_failure` without transient classification;
- retries only a pre-transition resolver or lifecycle failure classified
  transient by the captured host policy and only below the captured total-
  attempt budget;
- acknowledges terminal and exhausted-transient failures with a bounded,
  non-disclosing receipt; and
- propagates defects and interruption without converting them to ordinary
  message failures.

An `ack` or `retry` callback failure is its own typed Queue-settlement error.
The returned receipt contains only message ID, due kind when valid, settlement
disposition, and bounded scheduler counts/reason. It contains no typed failure
object, foreign cause, run identity, or scope authority.

## Loss And Repair Semantics

No run identity is carried by the envelope. A later valid hint for the same
partition and due kind discovers all currently due rows, including work whose
earlier publication was lost. Duplicate or reordered hints re-run durable
discovery and lifecycle revalidation.

DTE05-D proves that property but does not guarantee that another hint will
arrive. A post-commit publication failure is acknowledged rather than retried
through the stale source message and is explicitly repair-required. DTE05-E
remains the first bounded directory-driven cron repair host and the eventual
recovery owner after publication loss, total Queue loss, or retry exhaustion.

## Validation Gate

DTE05-D requires:

- durable-task tests proving after-settlement publication, persisted-effect
  order, idempotent duplicate publication, no publication for current/no-wake
  outcomes, and exact publisher failures;
- PGlite and genuine-PostgreSQL proof that Queue publication observes the
  committed transition and that durable discovery remains sufficient after a
  dropped publication;
- adapter tests for exact envelope decoding, wrong-queue rejection, duplicate
  and reordered delivery, invalid-message acknowledgement, typed transient
  retry, post-commit publication-loss acknowledgement, terminal/exhausted
  acknowledgement, callback failure, bounded batch handling, and non-
  disclosing receipts;
- exact package-boundary checks admitting only the publishing composition and
  the private Queue adapter while rejecting every Worker/app activation path;
- unchanged Wrangler files with no Queue producer or consumer binding;
- package/workspace typecheck and existing scheduling, lifecycle, provenance,
  source-map, and boundary gates; and
- both required project reviewers on the final significant diff.

## Stop Boundary

DTE05-D does not authorize:

- importing the Queue adapter from a Worker or other production entrypoint;
- adding `queue()` to an exported Worker handler;
- adding Queue producer/consumer/DLQ configuration to Wrangler;
- a directory scan, cron sweep, alarm, HTTP route, or persisted host cursor;
- direct execution, compute dispatch, cancellation delivery, or observability
  publication;
- Queue-message authority over tenant, scope, placement, lifecycle, or time;
- a generic requested-effect delivery engine;
- automatic retry of unclassified failures, corruption, defects, or
  interruption; or
- production activation.

DTE05-E may add the first bounded repair host over the trusted partition
directory after its own preflight.

## Completion Evidence

The final slice passed the workspace typecheck, all 75 durable-task tests, all
347 active executor tests, both DTE05-D PGlite cases, the C1/C2 PGlite
regressions, the two/four/two DTE05-D/C2/C1 genuine-PostgreSQL lanes, the
installed Cloudflare Queue structural-type proof, and all 58 script tests. Both
required reviewers accepted the final diff. Boundary checks still reject every
production Worker/app import of the Queue adapter or fresh resolver, and no
Wrangler Queue binding exists.
