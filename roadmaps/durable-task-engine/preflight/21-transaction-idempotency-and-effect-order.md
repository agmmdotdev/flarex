# DTE04-P21: Transaction, Idempotency, And Effect Order

## Status

**Status:** Lifecycle transaction authority and DTE04-B are complete. The
focused PGlite and real-Postgres lock/time proofs pass. The canonical lane now
executes 62 transition-derived histories plus one explicit near-overflow setup
through the adapter and two invalid commands at the decoder boundary. Creation is a separate
DTE04-C checkpoint. This file does
not authorize creation, discovery, delivery, host composition, or activation.

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
4. Acquire a shared lock on the captured scope-clock row and correlate its
   epoch, storage generation/fence, scope ID, and located target with the
   preliminary trusted authority. Authority-changing operations take the
   conflicting update lock.
5. Load the run by `(scope, run ID)` from the writer with `FOR UPDATE`.
6. If no row is visible, return the non-disclosing unavailable error. Do not
   probe another scope or database.
7. Obtain one database-time millisecond value after any wait for the run lock.
   The same value is supplied to the decision and returned in the receipt.
8. Normalize and detach the driver row, decode the persistence envelope and
   aggregate, and correlate every authority-bearing projection.
9. For `start_attempt` only, allocate a candidate attempt ID and monotonic fence
   inside the transaction. Allocation failure is typed; an unused candidate
   leaves no attempt/effect row.
10. Invoke `request.decide` with the owned aggregate, database time, and optional
   candidate.
11. If the callback returns a decision error, roll back/no-write and preserve
    that exact typed failure.
12. If it returns `no_change`, perform no run/effect mutation. Return the
    reconstructed idempotent or current receipt from decoded state.
13. If it returns `commit`, validate the expected current version, exactly-one
    next-version advance, legal next aggregate, evidence/replay correlation,
    and contiguous requested-effect range.
14. Derive the relational projection once from the validated next aggregate.
15. Update the run with a predicate including scope, run ID, and expected
    version. A zero-row update is a transaction conflict/current-state race,
    never permission for a blind retry outside the admitted policy.
16. For an accepted new grant, insert its immutable scope-local attempt-
    identity row and require its run, ordinal, fence, and accepted version to
    correlate with `next`.
17. Insert every requested-effect intent in array/sequence order with the
    scope/run/sequence unique key and accepted run version.
18. Commit once. Return detached/frozen domain values; never return a row,
    driver result, or live transaction-owned object.

No user code, queue call, logging exporter, object-store write, HTTP request, or
effect delivery may occur between steps 2 and 18.

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

The exact conflict type and creation service owner remain blocked on the
task-definition, input-reference, and creation-receipt contracts listed by
Preflight 20. They must not be squeezed into
`TaskSystemRunAttemptStoreErrorV1` if that would misdescribe a valid caller
conflict as storage failure.

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

The discovery contract is a non-mutating bounded query with:

- one captured scope and due kind;
- an inclusive database-time ceiling;
- a hard maximum result count;
- a stable cursor ordered by due time then run ID; and
- receipts containing only the identifiers/version basis needed to request a
  later lifecycle operation.

Discovery does not grant or expire an attempt and does not use `FOR UPDATE`,
`SKIP LOCKED`, or a scheduler-claim write. Locking while reading would provide
no authority after commit. Duplicate and stale receipts are expected; the
later lifecycle transaction decides the winner. Roadmap 05 may add scheduler
ownership separately if performance or fairness evidence requires it.

## Isolation And Locking Decision

The decision is the existing located **READ COMMITTED** transaction runner,
with locks acquired in this global order:

1. captured scope-clock row `FOR SHARE`;
2. definition/request row only for creation operations; and
3. run row `FOR UPDATE` for lifecycle mutation.

The shared scope-clock lock permits independent runs in the same scope to
proceed concurrently while preventing a scope-authority update from completing
under the operation. The run lock serializes decisions for one run. The update
still includes expected run version as a defensive correlation check.

Serializable isolation is rejected for the first lifecycle adapter because the
domain already has one-row ownership and version/fence rules; it would add
retry/abort surface without strengthening the admitted authority. A future
multi-run/waitpoint transaction must reopen this decision.

The implementation must not mix a locked read, an autocommit query, and a later
write on another connection. Real-Postgres race tests still prove the choice;
the decision is not inferred from PGlite behavior.

## Database Clock Decision

The adapter reads exactly one authoritative millisecond snapshot per decision
using the repository's existing wall-clock spelling:

```sql
floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
```

It decodes the text as a nonnegative JavaScript safe integer and then as
`TaskDatabaseTimeMsV1`. The query runs after the run lock is acquired so lock
wait does not consume a lease/retry window before the decision sees time.

The choice must preserve:

- monotonic scope-clock policy already owned by persistence;
- exact safe-integer milliseconds;
- one value across decision and receipt;
- retry semantics—a retried transaction may obtain a newer value; and
- no process clock fallback.

`Date.now()`, caller timestamps, `transaction_timestamp()`, and silently
rounded `timestamptz` values are rejected. A retried transaction obtains a new
wall-clock snapshot.

## Retry And Uncertain Commit Policy

Retries are allowed only around the entire database transaction, with at most
three transaction executions total, and only when settlement proves rollback
and the causal
Postgres SQLSTATE is `40001` (serialization failure) or `40P01` (deadlock).
The callback may therefore be reinvoked with a new candidate and database time.
There is no statement-level retry and no retry after uncertain settlement.

Generated-ID collision handling is a separate permitted cause within that same
three-execution budget: a
proven rollback caused by the exact named attempt-identity primary-key
constraint may retry with another UUIDv4 candidate. Another `23505`, an unrecognized
constraint, or a digest/semantic uniqueness conflict is not an ID collision and
is never retried through this branch.

Map failures as follows:

| Condition | Domain treatment |
| --- | --- |
| Decision callback `Failure` | Preserve `RunAttemptDecisionErrorV1`; rollback/no write. |
| Missing or cross-scope row | `TaskSystemRunAttemptUnavailableError`. |
| Malformed envelope/aggregate/projection/effect order | `TaskSystemRunAttemptCorruptionError`. |
| Stale located authority facet | `TaskSystemRunAttemptStaleScopeAuthorityError`. |
| Admitted serialization/deadlock conflict after the three-attempt budget | transient `transaction_conflict`. |
| Exact attempt-ID primary-key collision | retry another candidate up to three, then terminal `identity_allocation_exhausted`. |
| Connection unavailable or admitted timeout | corresponding transient store error. |
| Unsupported driver/placement/transaction/serialization or exhausted allocation | exact terminal store error. |
| Unknown thrown cause, callback defect, invariant bug | Effect defect; do not launder into `driver_failure`. |

An ambiguous client response after Postgres may have committed cannot safely be
classified merely from the thrown driver error. The caller retries the same
domain command on a fresh scope capability; stored acceptance then reconstructs
the idempotent receipt. Run creation similarly reuses its creation-idempotency
identity. No cleanup write runs on the uncertain connection.

The existing `LocatedReadCommittedTransactionFailureV1` settlement facets are
preserved: only a proven callback rollback can expose its typed callback cause;
`decisionUncertain` is never internally retried or flattened into a known
rollback.

## Attempt Identity And Fence Allocation

For `start_attempt`:

- generate canonical UUIDv4 candidates inside the logical transaction, prefix
  and decode them as `TaskAttemptIdV1`, and allow at most three collision
  candidates;
- derive the next execution fence as one greater than the latest fence retained
  by the decoded aggregate/projection, or `1n` for the initial run;
- fail with the existing terminal allocation/version error when the signed
  Postgres bigint ceiling is reached; and
- persist no attempt row merely for allocation; a successful grant commit
  inserts exactly one immutable attempt-identity row together with the accepted
  aggregate and dispatch effect.

A whole-transaction retry may use another uncommitted UUID candidate, but the
fence remains derived from the newly locked current aggregate. Random ID order
never defines task order or authority.

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

The concrete target extends the existing package-internal located
READ-COMMITTED capability and retains its Drizzle database behind a unique
symbol, following current persistence target construction. A factory receives
the already-resolved `LocatedTrustedScopeAuthority`, captures its authority and
target, and constructs a `TaskSystemRunAttemptStore` service value for that
scope. The domain `RunAttemptLifecycleLive` Layer consumes that value; no Layer
performs control-plane scope resolution or caches it globally.

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

## Decision Receipt And Remaining Blocker

Closed on 2026-08-04:

1. located READ COMMITTED with scope `FOR SHARE`, then run `FOR UPDATE`;
2. wall-clock epoch milliseconds read after the run lock;
3. at most three whole-transaction attempts for proven-rollback SQLSTATE
   `40001` or `40P01` only;
4. UUIDv4 attempt IDs with three collision candidates and fence = latest + 1;
5. non-mutating bounded discovery with no scheduler claim;
6. requested-effect insertion in the lifecycle transaction; and
7. operation-scoped store construction over the existing located target,
   never a global scope-selectable Layer.

The first real-Postgres proof now confirms two deliberately blocked same-run
writers serialize and that the authoritative millisecond read is no earlier
than a server-clock sample taken immediately before the blocker releases the
run lock. PGlite confirms connected lifecycle commits, exact no-change replay
without identity allocation, collision retry, rollback, aggregate/effect/
attempt-ledger corruption, non-disclosure, and stale-authority behavior. The
canonical lane now reuses the DTE03-F preparation/oracle logic for all 65
vectors, sends 62 transition-derived histories plus one explicit near-overflow
setup through the concrete PGlite adapter, and retains the two invalid command shapes at the command-decoder
boundary. The multi-attempt histories are derived from committed starts,
heartbeats, completions, and lease expiry rather than invented ledger rows. The
durable-retry start history now uses the cursor emitted by those committed
transitions. The explicit overflow case returns typed counter exhaustion and
leaves the run row, aggregate, projections, attempt ledger, and effect ledger
unchanged. DTE04-B has no deferred canonical vector. The Standard Application task catalog,
task-definition runtime binding, creation-authority receipt, storage-neutral
input reference, and exact creation request/error contracts are complete;
their existence does not bypass the separate DTE04-C creation checkpoint.
