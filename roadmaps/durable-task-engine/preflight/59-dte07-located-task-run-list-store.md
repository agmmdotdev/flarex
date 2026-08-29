# DTE07 located Application Task-run list store

Status: implementation checkpoint completed privately on 2026-08-30 in
PGlite and disposable PostgreSQL 18.

Depends on the private Task-run listing contract introduced by `4dfdf789`.
This checkpoint implements only the located PostgreSQL/PGlite store. It does
not expose the clean Application API, add a production caller, or activate a
runtime route.

## Boundary

The constructor accepts one already-resolved `LocatedTrustedScopeAuthority`
and returns the private `ApplicationTaskRunListStoreShape`. It captures the
authority and target once. Callers cannot supply a scope, deployment, physical
locator, epoch, or storage generation to `listRuns`.

Each page executes in the target's located READ COMMITTED transaction. Before
reading runs it locks the scope clock `FOR SHARE` and revalidates physical
locator, deployment binding, epoch, storage generation, and storage-generation
fence. The observation timestamp comes from PostgreSQL `clock_timestamp()` in
that same transaction.

## Query and data budget

The store filters `definition_generation = 'application_v1'` and orders by:

1. `created_at_ms DESC`
2. `run_id COLLATE "C" DESC`

The keyset cursor applies the exact inverse boundary to both fields. The query
requests `pageSize + 1`, returns no more than `pageSize`, and derives `hasMore`
only from the extra row. Inserts newer than the cursor are therefore excluded
from later pages; this is keyset pagination, not a snapshot across calls.

The query must not load the persisted lifecycle aggregate into application
memory. PostgreSQL constructs only the bounded projection state from selected
JSONB scalar paths. Result SHA-256 bytes are selected as their canonical
base64url persistence spelling and converted to the projection's lowercase
hex spelling before the durable-task decoder validates the compact row.

A partial index on `(scope_id, created_at_ms DESC, run_id COLLATE "C" DESC)`
for Application-generation rows owns this access path.

## Failures

- authority mismatch: `stale_scope_authority`
- malformed database clock or compact row: `corrupt_data`
- connection, timeout, serialization, deadlock, or uncertain settlement:
  `transient`
- transaction setup unsupported by the connected target: `unsupported`
- target acquisition unavailable: `unavailable`
- unexpected callback or driver failures remain defects

The read adapter does not retry. Cleanup failure preserves the typed callback
failure together with the cleanup defect cause.

## Proof gate

PGlite proves captured-authority and stale-authority handling, deterministic
tie ordering, cursor advancement, database observation time, compact-state
decoding, persisted-envelope and correlation validation, and typed transient,
cleanup, and corruption behavior. A disposable PostgreSQL 18 instance then
proved C-collated ordering, migration application, and ownership of the
partial-index access path. The focused PostgreSQL lane passed 1/1 and
the instance was stopped and removed after the proof.

## Stop

The real-PostgreSQL acceptance proof passed. Wiring the store to the clean
unversioned `listTaskRuns()` facade remains owned by preflight 60.
