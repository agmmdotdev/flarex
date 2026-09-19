# CE1 Bounded Index Batch Application

Status: bounded index application is implemented under standing owner authorization.
Unique ownership application remains subsequent CE1 work.

## Outcome And Boundary

Replace the scalar online index writer with a batch Effect operation at
`appIndexEntries.ts`. Native/CMS shared materialization supplies intrinsic and
developer transition sets. The existing backfill entry point keeps historical
authority/parent semantics and uses the same decoded batch application for its
single transition. No new schema, transaction, lifecycle authority or framework
capability is introduced. Unique ownership remains a subsequent CE1 slice.

The row-batching checkpoint leaves index scope/head/parent reads and writes
linear per transition. Authenticate the online scope/epoch once per batch call,
reuse canonical physical specs within that call, read authenticated membership
heads through the existing bounded reader, and validate current parents as a set.
Keep both preparation-time omission checks and application-time transition
checks; earlier preparation is not a new grant of write authority.

## Correctness And Bounds

One online call carries one scope, epoch and commit sequence, with unique index/
key/row positions. Reject repeated positions before applying any transition.
Use groups of at most 32; the protocol caps encoded keys at 2,048 bytes, so key
payload and parameter counts are bounded as well. Preserve exact definition,
codec, key digest, current-pointer/latest-history and parent-table identity
checks. Historical backfill may refer to a currently tombstoned parent; ordinary
live membership may not. Missing parents still reject.

Revision inserts, current creates and conditional current deletes verify the
exact scope/index/key/row/sequence result set without assuming RETURNING order.
A count alone is not evidence. Missing revision writes remain duplicate-revision
failures; lost current writes and malformed/unexpected returned evidence fail
closed. No concurrent SQL, mid-batch commit, conflict suppression or local retry.
All failures escape to the owning transaction for complete rollback.

## Breaking Changes And Retirement

Remove the old scalar Promise/Result API, single-head wrapper, scalar parent
query, and local rejected-revision cleanup after migrating all production and
fixture callers. Keep only the backfill entry point with its distinct actual
consumer and authentication contract. Its single-item call is semantic reuse,
not a retained online fallback. Existing scalar index revision input shapes and
projected revision values remain owned by this module.

Online writes now apply as sets; private intrinsic/developer hooks retain one
notification per action after their set succeeds. Tests may not infer committed
state or individual SQL execution from a hook. Failure order across actions
changes to batch validation/application. There is no public API or data migration.
Private `intrinsicIndexBatchWriting`/`intrinsicIndexBatchWritten` observations
bracket scope authentication, membership/parent checks and writes for measurement.

## Proof And Completion

Exercise 1/32/33/128 transitions, shared keys across row/table identities, live
and tombstone transitions, missing/tombstoned parents, duplicate/repeated actions,
stale epoch, digest/pointer corruption and later-batch rollback. Inject incorrect
RETURNING identities and malformed stored columns without weakening validation.
Retain native/CMS mixed mutation, unchanged membership, unique swap, historical
build and retention regressions on PGlite and ordinary-role PostgreSQL. Measure
the same isolated publication workload as the row-batching checkpoint. Require
affected typecheck, core/diff/staged lint, both project reviews and cleanup before
commit. This does not complete CE1, CE0 references or wider scalability acceptance.
