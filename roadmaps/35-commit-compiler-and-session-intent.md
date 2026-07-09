# Commit Compiler And Session Intent

## Session Intent And Commit Compiler Design

Previous completed checkpoint: `523a006` Refactor FlarexDB schema to enhance
app data storage and indexing.

What changed:

- Added this focused design record for the final commit compiler and
  SessionDO-backed execution intent model.
- Accepted the direction that Postgres remains the only authoritative commit
  store, while Durable Object SQLite can own temporary per-invocation read-set
  and staged-write intent.
- Defined the target final-commit shape as a compiled `CommitIntent` /
  `CommitPlan` that minimizes SQL round trips inside the physical transaction.

Why it changed:

Current and near-term executor code can stage reads and writes in Postgres, then
finish by validating and publishing from those staging rows. That is a correct
foundation, but it creates avoidable database traffic during user-code
execution:

```txt
read -> record read-set in Postgres
write -> stage write in Postgres
read -> record read-set in Postgres
write -> update staged writes in Postgres
finish -> validate and commit in Postgres
```

The target runtime should keep the authoritative reads and final commit in
Postgres, but move mutation-local intent recording into a SessionDO/ExecutionDO
SQLite journal:

```txt
read -> Postgres snapshot read + SessionDO read intent
write -> SessionDO staged write intent
read -> Postgres snapshot read if needed + SessionDO overlay
finish -> SessionDO compiles compact CommitIntent
commit -> Postgres validates and publishes in a short transaction
```

This reduces round trips before final commit, keeps failed or aborted function
runs from leaving Postgres staging garbage, and gives the final executor a
compact write/read dependency plan instead of many scattered session rows.

## Authority Boundaries

| Component | Owns | Must not own |
| --- | --- | --- |
| Postgres/PGlite authoritative executor | committed document/index/system rows, commit log, outbox, freshness, OCC validation, commit timestamps | long-running user-code execution |
| SessionDO/ExecutionDO SQLite | invocation `beginTs`, read-set journal, staged write journal, read-your-writes overlay, coalesced final write set | authoritative committed data |
| Dynamic Worker user code | calls generated `ctx.db` APIs through restricted syscalls | raw Postgres, raw DO storage, transaction handles |
| KV/cache layers | optional non-critical cache hints | mutation intent, read-set authority, idempotency authority |

Do not use Cloudflare KV for mutation intent. KV can be eventually consistent
and is not the right place for correctness-critical read-set, write-set, or
idempotency state. Durable Object SQLite is the intended local intent store
because it is colocated with the session authority and can update session state
transactionally.

## Begin Timestamp Semantics

`beginTs` is the stable snapshot timestamp for one function attempt:

```txt
beginTs = latest committed timestamp visible when the invocation starts
```

Reads during that attempt mean:

```txt
Postgres data as of beginTs
+ SessionDO staged write overlay
```

At final commit, Postgres checks whether any recorded read dependency changed
after `beginTs`. If it did, the commit is rejected as an OCC conflict and the
mutation can be retried from a newer snapshot.

This is not a long Postgres lock. It is optimistic concurrency control:

```txt
user code runs without holding a SQL transaction
read dependencies are recorded
final commit opens a short SQL transaction
final commit validates dependencies and publishes writes
```

Short locks may still be used during final commit for timestamp allocation,
lock rows, uniqueness, or serializable write publication. Those locks must not
span arbitrary user code.

## User-Code Execution Path

The target execution path is:

```txt
Dynamic Worker
  -> ctx.db syscall
  -> SessionDO/ExecutionDO
  -> Postgres authoritative read when needed
  -> SessionDO read-set/write-set journal
```

Read syscalls:

- read authoritative data from Postgres at `beginTs`;
- merge the result with the SessionDO staged-write overlay;
- record read dependencies in SessionDO SQLite;
- return a Convex-like result to user code.

Write syscalls:

- validate obvious local API shape and table/schema availability;
- stage insert/patch/replace/delete intent in SessionDO SQLite;
- coalesce repeated writes to the same document or row when possible;
- update the read-your-writes overlay;
- do not publish authoritative rows.

Read-your-writes is mandatory. A second `ctx.db.get(id)` after a staged patch
must observe the patched value even though Postgres still contains the old
committed value. Simple document reads can use direct overlay replacement.
Indexed reads, relation reads, table scans, Medusa queries, and Payload nested
field reads need either overlay-aware local filtering/merging or conservative
read dependencies until precise overlay query evaluation exists.

## CommitIntent Shape

At finish time, the SessionDO compiles local state into a pure data intent. The
intent should be independent of a specific SQL renderer:

```ts
type CommitIntent = {
  scope: {
    deploymentId: string;
    projectId?: string;
    tenantId?: string;
    schemaVersion: string;
  };
  attempt: {
    sessionId: string;
    mutationId?: string;
    beginTs: number;
    idempotencyKey?: string;
  };
  reads: ReadDependencyBatch[];
  writes: WriteIntentBatch[];
  locks: LockIntentBatch[];
  uniqueness: UniqueConstraintIntentBatch[];
  freshness: FreshnessIntentBatch;
  outbox: OutboxIntentBatch;
};
```

The Postgres executor compiles this into a physical `CommitPlan`:

```txt
CommitIntent
  -> classify app, Payload, Medusa, workflow, lock, freshness, and outbox work
  -> build set-based read/range/lock/unique validation batches
  -> build bulk document/entity/row/edge/link/index write batches
  -> build commit/freshness/outbox/workflow-state batches
  -> execute as one short physical transaction
```

The planner should fail before opening the SQL transaction when the intent is
malformed, references unsupported schema features, exceeds quotas, or contains
write shapes that cannot be validated safely.

## Final Commit Round-Trip Strategy

The optimization should progress in layers.

### Level 1: Bulk Persistence Helpers

Replace per-row loops with bulk helpers while TypeScript still owns most
planning:

- `validateReadSetBulk(...)`
- `insertDocumentRevisionsBulk(...)`
- `insertIndexEntriesBulk(...)`
- `insertCommitOutboxFreshnessBulk(...)`

This is the lowest-risk migration from the current implementation. It should
reduce `N` staged writes from `N` insert calls to a small fixed number of calls.

### Level 2: CTE-Based Commit

Render the commit plan into set-based SQL using arrays, `unnest(...)`,
`jsonb_to_recordset(...)`, temporary validation CTEs, or generated validation
tables.

A practical target is two database round trips inside the final transaction:

1. Allocate/lock the commit lane and run set-based validation, returning typed
   conflict/precondition errors.
2. If validation passes, run one write CTE that publishes document/entity rows,
   index rows, commit rows, outbox rows, freshness rows, and workflow state.

One larger CTE can combine validation and writes later, but two calls preserve
cleaner typed error mapping while still keeping the transaction short.

### Level 3: Database-Side Commit Function

For high-complexity commits, the renderer may call a database-side boundary:

```sql
select flarexdb_commit($1::jsonb)
```

This can reduce the final commit to one Worker-to-database round trip. It must
remain an optimization boundary, not a new authority. FlarexDB still owns the
commit protocol, tenant/deployment scope, schema version, OCC rules, write
policies, idempotency, freshness, outbox semantics, and adapter contracts.

## Concurrency And Deadlock Rules

This design is concurrency-friendly because user code does not hold Postgres
transactions or connections. It is not automatically deadlock-proof. The commit
compiler must enforce deterministic final-transaction behavior:

- no user code, external network calls, schema compilation, or repository loops
  inside the SQL transaction;
- acquire lock targets in deterministic sorted order;
- sort writes by stable table/key order before physical publication;
- validate before publishing writes;
- use set-based validation for read sets, index ranges, locks, and uniqueness;
- preserve idempotency through mutation/session identifiers;
- retry boundedly on serialization and deadlock errors;
- emit compact commit summaries for post-commit freshness and live sync.

## Convex References

Implementation work should re-check these Convex source areas before changing
the executor path:

- `crates/database/src/committer.rs`
  - validates reads before writes become visible, computes writes, and publishes
    commit/write-log state.
- `crates/database/src/transaction.rs`
  - keeps transaction-local read/write state and read-your-writes behavior.
- `crates/sync/src/worker.rs`
  - consumes committed write information for subscription invalidation work.
- `crates/sync/src/state.rs`
  - keeps active query/read-set state and suppresses unchanged results.

## How Flarex Differs

Convex can keep much of the transaction and committer state in one backend
process. Flarex has a Cloudflare runtime boundary:

- user modules run in Dynamic Workers;
- session intent can live in Durable Object SQLite;
- authoritative data and OCC validation live in Postgres/PGlite;
- Hyperdrive and Worker placement make transaction duration and round-trip count
  critical;
- post-commit live-sync work may wake Durable Objects rather than run in the
  same process.

That split is acceptable only if SessionDO state is temporary intent and
Postgres remains the final commit authority.

## Known Limitations And Follow-Up Work

- The current code does not yet implement a general `CommitIntent` or
  `CommitPlan` type.
- Current Postgres staging helpers still exist and are useful for correctness
  tests, but they are not the target hot path.
- Precise overlay semantics for indexed queries, relation queries, Medusa
  filters, Payload nested fields, and table scans need separate design and
  tests.
- The final commit function boundary should wait until bulk helper and CTE
  renderers prove the plan format.
- PGlite and real Postgres must both be tested; real Postgres remains required
  for lock, isolation, deadlock, and query-plan correctness.

## Verification

Docs-only checkpoint:

```sh
git diff --check
```
