# Core event delivery batches

Status: bounded core claim-batch and pump path implemented; delivery throughput
and hot-shop contention measurement remain open before scale claims.

## Trigger and owner

The shared atomic event publisher admits an explicit 256-message root budget and
persists envelopes/deliveries in bounded pages. `CommitEvents.claim` still reads,
validates, digests and locks the entire commit event family on every individual
claim. `runNext` repeats that work up to 64 times per call. For a 256-event
commit, this can reread and lock tens of thousands of rows per drain. The
generic event store and pump own the correction; a Medusa-specific event loop
or smaller adapter cap would leave the core delivery cost unchanged.

## Selected contract and breaks

Replace the internal one-at-a-time `claim` method with `claimBatch(commitSeq,
registered, maximum)` for a small, fixed maximum no greater than eight. One
short SQL session authenticates scope and the complete commit family once,
checks every envelope/delivery and the header digest, then fences the first
eligible deliveries in ordinal/subscriber order. Each returned token retains its
own immutable message and private fenced row. Handlers run only after the SQL
session closes; settling remains one independently fenced operation per token.
An expired or interrupted batch is recoverable by the existing lease path.
At most seven claimed but unhandled deliveries can remain leased after an
interruption of the first handler, adding a 30-second lease wait before the
next repair scan can reclaim them. That bounded temporary in-flight set is accepted
for the measured reduction in repeated whole-family reads.

The pump requests no more than the remaining per-run delivery allowance and
processes a batch sequentially. Eight one-second handler deadlines fit within
the existing 30-second lease with room for settlement, but timeout and database
latency remain operational budgets to measure. A claim batch does not create a
transaction around handlers or make their effects atomic with each other.

`claim` is a private store API with only current test callers; migrate them and
remove it in the same slice. No event schema, durable identity, subscriber
contract or stored data changes. Preserve exact handler order, retry/backoff,
attempt exhaustion, stale-fence refusal, corruption detection, and ordinary
absence when no registered delivery is eligible. A batch failure rolls back
all new claims from that session.

## Validation and completion

Prove a 129-event commit drains in bounded family reads and leaves every
delivery settled exactly once; replay and a second pump remain idempotent.
Exercise two-store contention, expired lease recovery, handler failure/retry,
tampered family refusal, and batch-boundary ordering on PGlite and ordinary-role
PostgreSQL where the driver supports the scenario. Observe family query count,
not a claimed throughput win. Run affected typechecks, lint, both read-only
reviews and the staged diff check before one scoped commit. Delivery throughput
and hot-shop contention measurements remain required before production scale
claims or a larger synchronous event budget.
