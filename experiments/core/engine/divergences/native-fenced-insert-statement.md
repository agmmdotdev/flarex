# Mechanism: opening lease fence and inserts in one statement

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

One statement computes the fence and gates both inserts on it, returning the fence
row. No row means `leaseLost` with no inserts. The final `FOR SHARE` is unchanged.
Batches above 1,024 rows per table, overwriting backfills and empty batches keep the
previous statements.

## Preserved and changed guarantees

Preserved: a stale owner inserts nothing and reports `leaseLost` before any constraint
can fail; the final share-lock fence, chunk bound and rollback behavior. Changed: one
statement carries the check and both inserts, so a statement timeout covers all three.

## Required witnesses and remaining limits

- `test/core/persistenceScenarios.ts` covers a stale owner on PGlite and ordinary-role
  PostgreSQL, including a batch that would otherwise raise a duplicate key.
- `test/core/persistence.postgres.test.ts` still steals the lease after materialization.
- Reassess if a pipelining driver or Hyperdrive support is selected.
