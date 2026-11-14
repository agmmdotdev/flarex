# Mechanism: fenced commit in one statement

Design status: **Accepted**.
Implementation status: **Implemented**.
Measurement status: **Required gates unmet**; local load only.

## Ownership and decision

- Owning slice: [Native write round trips](../slices/native-write-round-trips.md).
- Owner: `writeBatch` in `packages/persistence-postgres/src/database/corePersistence/persistence.ts`.
- No guarantee changes, durable data changes or public contract changes.

## Pinned Convex mechanism

- Revision: `db914cf06e2b06ee985646611b9e12ed7a770318`.
- `crates/postgres/src/lib.rs` `Lease::transact` runs an advisory unlocked lease check
  concurrently with the body, then a `FOR SHARE` precondition, then COMMIT. The lock
  runs last to minimize hold time.
- Documents and indexes use separate prepared `UNNEST` inserts, at most 1,024 rows per
  statement. Convex's driver pipelines them, so they share a network flight.

## Current core and proposed direction challenge

- Node's `pg` driver sends one query at a time, so the same six statements cost six
  round trips where Convex needs about four flights.
- Removing the advisory check was rejected. A stale writer could reach a constraint
  failure before discovering it had lost the lease, and would do wasted inserts.
- Moving `FOR SHARE` first was rejected: it can deadlock with physical maintenance.
- Removing a request lookup was rejected. The two lookups do different jobs, and the
  second registers the read witness that separates racing claimants.

## Why a difference is necessary

Pipelining would translate Convex directly, but `pg` 8.22 submits only when the
connection is ready for a query. A protocol layer would also need Sync placement, a
separately awaited COMMIT and a PGlite equivalent. Folding the statements gets the
same round-trip count and needs no driver change.

## Replacement mechanism and implementation

One autocommit statement carries the whole of `Lease::transact`:

1. `fence` reads the lease row without a lock and gates both inserts. A stale owner
   inserts nothing.
2. Both inserts return a row per inserted row.
3. `held`, a materialized last CTE, selects the lease row `FOR SHARE` and reads both
   insert counts, so its row lock follows the inserts.
4. The final select divides by the number of held rows. A lease that is gone, at open
   or at lock time, raises `division_by_zero`: the implicit transaction aborts and
   nothing is inserted.

Lock order is the accepted one. Tables are locked in textual order for an unnamed
statement, so `indexes` precedes `leases` ROW SHARE, which is what physical
maintenance requires (`indexes` ACCESS EXCLUSIVE, then `leases` EXCLUSIVE). The opening
read of `leases` takes only ACCESS SHARE. The statement must stay unnamed: a cached
plan revalidates the top-level range table first.

The driver's `write` owns the outcome of an autocommit write:

| Outcome | Classification |
| --- | --- |
| Rows returned and no client error observed | Committed |
| Server SQLSTATE `22012` | `leaseLost`; the lease is remembered as lost |
| Any other server SQLSTATE except class `08` and `57P..` | Definite non-commit, classified as a failed insert statement was before |
| No SQLSTATE, class `08`, `57P..`, or a client error after success | `uncertainWrite` |

Batches above 1,024 rows per table, overwriting backfills and empty batches keep the
four-statement transaction.

## Preserved and changed guarantees

Preserved: a stale owner inserts nothing and reports `leaseLost` before any constraint
can fail; the closing share lock is taken after materialization and held to commit, so
a lease steal cannot interleave with an in-flight commit; documents and indexes commit
together; the chunk bound.

Changed: BEGIN and COMMIT are implicit, so one statement timeout covers the whole
commit, and an acknowledgement lost for that statement is the uncertain outcome that a
lost COMMIT acknowledgement was. The row-lock order rests on dataflow between CTEs and
the table-lock order on textual order, neither a documented PostgreSQL contract; the
witnesses below pin both.

## Required witnesses and remaining limits

- `test/core/persistenceScenarios.ts` covers a stale owner on PGlite and ordinary-role
  PostgreSQL, including a batch that would otherwise raise a duplicate key, and a
  failing index insert that rolls documents back.
- `test/core/persistence.postgres.test.ts` commits a lease steal while the statement
  waits for the share lock: the write reports `leaseLost` and stores no row. It also
  discards the statement's acknowledgement and expects `uncertainWrite`.
- `test/core/persistenceDriver.test.ts` covers committed, refused and uncertain writes.
- `test/core/persistence.postgres.test.ts` also holds `indexes` ACCESS EXCLUSIVE, shows
  through `pg_locks` that the waiting write holds no lock on `leases` beyond ACCESS
  SHARE, and then takes `leases` EXCLUSIVE without a deadlock.
- A refusal is trusted only when the error carries a PostgreSQL severity and SQLSTATE.
  A pooler that synthesises such an error after forwarding a statement that committed
  would turn an uncertain write into a definite refusal. Which errors Hyperdrive emits
  is unverified and is an activation gate for that host.
- Reassess if a pipelining driver is selected, or if Hyperdrive names or caches
  statements.
