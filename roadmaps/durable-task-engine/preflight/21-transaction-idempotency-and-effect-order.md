# DTE04-P21: Transaction, Idempotency, And Effect Order

## Status

**Status:** Draft transaction authority. No adapter implementation is
authorized until the isolation, clock, retry, and creation-error decisions in
this file are closed.

## Objective

Specify where the Effect boundary sits and how one Postgres transaction
preserves lifecycle decisions, idempotent replay, requested-effect ordering,
scope authority, and foreign failure classification.

## Domain/Adapter Boundary

`RunAttemptLifecycle` remains an Effect domain service. It calls the existing
scope-bound `TaskSystemRunAttemptStore`; it never receives Drizzle, SQL, a
database client, a transaction handle, retry policy, or an ID generator.

The adapter owns:

- located scope and transaction capability;
- database clock acquisition;
- row lock/load/decode/correlation;
- attempt-ID and fence allocation;
- invocation of the pure `decide` callback;
- compare-and-swap and requested-effect inserts;
- commit/rollback and bounded conflict retry; and
- mapping expected foreign failures into the closed store-error union.

The callback is synchronous and returns `Result`. It performs no Effect,
Promise, I/O, logging, time/random read, or mutation. The adapter may reinvoke
it after a whole-transaction retry.

## Lifecycle Mutation Sequence

The admitted implementation sequence is:

1. Resolve/provide a store already captured to one fresh located scope. Do not
   accept a scope string in the lifecycle request.
2. Start a writer transaction on the captured physical target.
3. Revalidate the scope authority facets required by DTE02—epoch, storage
   generation, physical locator, and deployment binding—inside or immediately
   adjacent to the transaction according to their owning contract.
4. Obtain one database-time millisecond value. The same value is supplied to
   the decision and returned in the receipt.
5. Load the run by `(scope, run ID)` from the writer and acquire the exact row
   lock/isolation protection closed below.
6. If no row is visible, return the non-disclosing unavailable error. Do not
   probe another scope or database.
7. Normalize and detach the driver row, decode the persistence envelope and
   aggregate, and correlate every authority-bearing projection.
8. For `start_attempt` only, allocate a candidate attempt ID and monotonic fence
   inside the transaction. Allocation failure is typed; an unused candidate
   leaves no attempt/effect row.
9. Invoke `request.decide` with the owned aggregate, database time, and optional
   candidate.
10. If the callback returns a decision error, roll back/no-write and preserve
    that exact typed failure.
11. If it returns `no_change`, perform no run/effect mutation. Return the
    reconstructed idempotent or current receipt from decoded state.
12. If it returns `commit`, validate the expected current version, exactly-one
    next-version advance, legal next aggregate, evidence/replay correlation,
    and contiguous requested-effect range.
13. Derive the relational projection once from the validated next aggregate.
14. Update the run with a predicate including scope, run ID, and expected
    version. A zero-row update is a transaction conflict/current-state race,
    never permission for a blind retry outside the admitted policy.
15. Insert every requested-effect intent in array/sequence order with the
    scope/run/sequence unique key and accepted run version.
16. Commit once. Return detached/frozen domain values; never return a row,
    driver result, or live transaction-owned object.

No user code, queue call, logging exporter, object-store write, HTTP request, or
effect delivery may occur between steps 2 and 16.

## `no_change` Semantics

Both `idempotent` and `current` decisions are read-only:

- no aggregate rewrite or `updated_at` touch;
- no evidence/effect reinsert;
- no fence/counter consumption visible after commit;
- no wake/notification side effect; and
- no repair of a malformed row.

The transaction may commit a read-only observation or roll back according to
the chosen driver helper, but logical persisted state is byte-for-byte
unchanged.

## Effect Ordering Contract

For a committed decision with effects:

1. current aggregate cursor is the predecessor;
2. the first effect sequence equals predecessor plus one;
3. subsequent sequences are contiguous in provided array order;
4. the final effect sequence equals `next.requestedEffectSequence`;
5. every effect names the same run and accepted next run version required by
   its domain variant;
6. all effect rows insert in the same transaction as the aggregate update; and
7. a unique-key collision that is not the same already-accepted replay fails
   closed and rolls back the whole transaction.

Requested-effect row order is durable intent order. It does not promise queue
delivery order, exactly-once external effects, or lifecycle authority to a
consumer. Roadmap 05 must reacquire scope and current state when an effect kind
requires freshness.

## Creation Transaction

Run creation is a separate private operation, not a synthetic lifecycle
command. Its candidate sequence is:

1. capture trusted located scope, active application selection, immutable task
   definition revision, creation authority, decoded task policy, and bounded
   caller inputs;
2. open a writer transaction and obtain one database-time value;
3. derive the versioned canonical request digest;
4. check/insert the scope-local idempotency identity using a unique constraint;
5. if absent, allocate a run ID, construct and domain-decode the only legal
   initial aggregate, derive projections, and insert run plus initial effects;
6. if present with the same digest and immutable binding, decode and return the
   original creation receipt;
7. if present with a different digest or binding, return a typed conflict and
   do not mutate the original run; and
8. commit and return only a detached domain receipt.

The exact conflict type and creation service owner remain blocking decisions.
They must not be squeezed into `TaskSystemRunAttemptStoreErrorV1` if that would
misdescribe a valid caller conflict as storage failure.

`INSERT ... ON CONFLICT DO NOTHING` followed by a scoped primary read is a
candidate mechanic, not the contract. The final SQL must prove correct behavior
under two simultaneous first writers and commit-response loss.

## Inspection Transaction

Inspection:

1. uses the captured primary/authority path, not an unproven read replica;
2. validates scope authority and obtains one database observation time;
3. loads by scope/run without exposing cross-scope existence;
4. decodes and correlates the complete aggregate; and
5. returns an owned inspection snapshot.

It performs no lifecycle write and does not emit a requested effect or live
notification. Roadmap 07 may later build safe projections over this or another
private read-model service; it does not expose this aggregate directly.

## Due Discovery Transaction

The candidate discovery contract is a bounded query with:

- one captured scope and due kind;
- an inclusive database-time ceiling;
- a hard maximum result count;
- a stable cursor ordered by due time then run ID; and
- receipts containing only the identifiers/version basis needed to request a
  later lifecycle operation.

Discovery does not grant or expire an attempt. It may use a short transaction
and row locking/`SKIP LOCKED` only if the final contract also owns a durable
claim. Without such a claim, locking while reading gives no authority after
commit and is unnecessary complexity.

The initial recommendation is an indexed, non-mutating bounded scan. Duplicate
and stale receipts are expected; the later lifecycle transaction decides the
winner. Roadmap 05 may add scheduler ownership separately if performance or
fairness evidence requires it.

## Isolation And Locking Decision

The lifecycle operation needs one of these closed strategies:

- **row lock plus expected-version update** at the package's supported
  isolation level; or
- **serializable transaction plus expected-version update** with a bounded
  whole-transaction retry.

The implementation must not mix an assumed row lock, an autocommit read, and a
later write on another connection. The transaction capability type must expose
every Drizzle operation actually required.

Before DTE04-B, a real-Postgres race harness must decide the strategy by proving
simultaneous start, heartbeat/completion, completion/lease-expiry, and duplicate
creation behavior. PGlite alone cannot close production locking semantics.

## Database Clock Decision

The adapter reads exactly one authoritative millisecond snapshot per decision.
Preflight closure must choose the existing scope-clock operation or exact SQL
clock expression and record whether it is transaction-start or wall-clock time.

The choice must preserve:

- monotonic scope-clock policy already owned by persistence;
- exact safe-integer milliseconds;
- one value across decision and receipt;
- retry semantics—a retried transaction may obtain a newer value; and
- no process clock fallback.

`Date.now()`, caller timestamps, and silently rounded `timestamptz` values are
rejected.

## Retry And Uncertain Commit Policy

Retries are allowed only around the entire database transaction and only for an
explicit classifier such as admitted serialization/deadlock SQL states. The
policy must define maximum attempts and observability without exposing secrets
or logging the entire aggregate.

Map failures as follows:

| Condition | Domain treatment |
| --- | --- |
| Decision callback `Failure` | Preserve `RunAttemptDecisionErrorV1`; rollback/no write. |
| Missing or cross-scope row | `TaskSystemRunAttemptUnavailableError`. |
| Malformed envelope/aggregate/projection/effect order | `TaskSystemRunAttemptCorruptionError`. |
| Stale located authority facet | `TaskSystemRunAttemptStaleScopeAuthorityError`. |
| Admitted serialization/deadlock conflict after retry budget | transient `transaction_conflict`. |
| Connection unavailable or admitted timeout | corresponding transient store error. |
| Unsupported driver/placement/transaction/serialization or exhausted allocation | exact terminal store error. |
| Unknown thrown cause, callback defect, invariant bug | Effect defect; do not launder into `driver_failure`. |

An ambiguous client response after Postgres may have committed cannot safely be
classified merely from the thrown driver error. The caller retries the same
domain command on a fresh scope capability; stored acceptance then reconstructs
the idempotent receipt. Run creation similarly reuses its creation-idempotency
identity. No cleanup write runs on the uncertain connection.

## Effect Implementation Shape

Use installed Effect v4 semantics:

- a domain service operation is an `Effect.fn`/`Effect.gen` or readable
  pipeline over the store service;
- the persistence adapter has one narrow Promise-to-Effect boundary for the
  Drizzle transaction, with a typed expected-failure channel;
- pure row/envelope/domain decoders use `Result`, entering Effect once with
  `Effect.fromResult` at the adapter boundary;
- `Effect.mapError` translates only a known typed lower-level error;
- acquire/release of long-lived pools is Layer/scoped-resource work; and
  operation-scoped located stores are composed at their actual lifetime.

Do not:

- import Effect v3 SQL/Drizzle integrations;
- use `Effect.tryPromise` around every query independently;
- catch all causes into a retryable store error;
- call `Effect.runPromise` inside reusable domain or persistence modules;
- make a scope-bound store a global singleton; or
- let an `Exit` fold erase interruption/defect causes.

## Logging And Diagnostics

The adapter may log only at a boundary that owns the final failure decision.
Diagnostics may include safe operation, SQL-state classification, retry count,
and opaque run/scope correlations under existing redaction policy. They must
not log full aggregate payloads, task input/result material, authorization
receipts, raw SQL parameters, or secrets.

Corruption is observable and fail-closed. Ordinary stale duplicate delivery is
an idempotent/current receipt, not error noise.

## Open Decisions Blocking DTE04-B

1. Row-lock/read-committed versus serializable transaction strategy.
2. Exact scope-clock operation/expression and retry observation semantics.
3. Exact SQL-state classifier and bounded retry budget.
4. Attempt-ID and fence allocation mechanism inside the captured transaction.
5. Creation service/error/receipt types and simultaneous-writer algorithm.
6. Whether discovery remains a non-mutating scan or acquires an admitted
   durable scheduler claim.
7. Exact Effect Layer composition entry point from `postgres.ts`/`pglite.ts`.

The real-Postgres experiments in Preflight 22 must close items 1, 2, 3, and 5
before the first live adapter checkpoint.
