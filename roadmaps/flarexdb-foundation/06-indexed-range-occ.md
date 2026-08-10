# Indexed Range OCC

Status: Accepted design preflight for the private, production-inert `O10`
replacement lane. This document freezes the first exact indexed mutation-read
contract. The implementation preflight still must inventory the private
journal/runtime identities and capture genuine-PostgreSQL baseline plans. This
document does not implement or activate a runtime API, alter production
routing, or authorize relation, scan, filter, search, vector, or general
pagination support.

## Decision

Implement `O10` before relation work. The first capability is one ascending,
bounded developer ordered-index query at an exact `SnapshotToken`, with a
complete durable read-your-writes overlay and commit-time phantom validation.
It reuses S10 index-entry history, C08 index lowering, the existing session
journal, the existing scope-clock commit lane, and the existing O08 conflict
replacement/rerun owner.

This is not a second OCC system and not a port of the legacy
`invoke_session_index_reads` path. The routed `legacy_v1` index query and
freshness tables remain compatibility evidence only. They use different
identity, timestamp, storage-generation, pagination, and transaction
semantics.

## Convex Semantics To Preserve

The checked-in Convex implementation establishes the semantic reference:

- `crates/database/src/query/index_range.rs` records the ordered interval
  actually consumed by the query stream. A partial page records only through
  the last consumed index position; an empty or exhausted query records the
  complete effective interval.
- `crates/database/src/reads.rs` merges overlapping or adjacent intervals per
  immutable index and tests intervening writes against those intervals.
- Every document update contributes both its old and new index keys. This is
  what detects insertions, deletions, movement into or out of a range, and
  movement within an ordered page.
- `crates/database/src/transaction_index.rs` merges pending transaction-local
  index updates with the snapshot index stream before limiting the result.
- `crates/database/src/committer.rs` checks both the committed write log and
  accepted pending writes before assigning and publishing the commit.

Flarex preserves those observable transaction semantics but not the in-memory
implementation. Flarex runs user code without an open SQL transaction, stores
the attempt journal durably, and validates against durable Postgres revision
history while holding the existing scope-clock lock.

## First Exact Query Shape

The first supported mutation query is equivalent to:

```ts
ctx.db
  .query(table)
  .withIndex(index, q =>
    // zero or more equalities in declared field order,
    // then optional lower and/or upper bounds on the next field
  )
  .take(n)
```

The initial contract is:

- developer ordered indexes only;
- ascending order only;
- canonical equality-prefix plus optional next-field inequality bounds;
- a positive page size no greater than 128;
- at most 32 indexed-query syscalls and at most 32 canonical merged indexed
  dependencies in one attempt;
- `first()` may be derived from `take(1)`;
- `unique()` may be derived from an exhaustion-aware `take(2)`; and
- no external cursor, descending order, `collect`, post-index `filter`, table
  scan, search, vector, relation, or arbitrary pagination shape.

An unsupported shape rejects before target data I/O. It never falls back to a
table scan, legacy storage, current-row comparison, or a broader conservative
dependency.

The ceilings above are deliberately smaller than the point-read and raw-write
ceilings. Implementation may lower them if genuine-PostgreSQL evidence
requires it. Raising them is a later measured contract change, not an
incidental refactor.

## Canonical Ordered Interval

S10 orders an entry by the composite position:

```text
(encodedKey, rowId)
```

`encodedKey` contains the declared fields plus system creation time. `rowId`
is the separate immutable tie breaker. O10 dependencies therefore operate on
composite positions, not key bytes alone.

The query compiler first derives the existing half-open key bounds from the
authenticated physical specification and structured expressions. The
effective interval is then narrowed by any internally owned cursor. The first
shape has no caller-supplied cursor.

Consumed-interval rules are fixed:

- a non-exhausted `take(n)` records from the effective start through and
  including the last consumed composite position;
- an empty or exhausted query records the complete effective interval;
- an insertion strictly after the consumed frontier of a non-exhausted page
  does not conflict;
- an insertion, deletion, or key movement touching the consumed interval does
  conflict; and
- move-out-then-back and delete-then-reinsert conflict even when the final
  membership resembles the original snapshot.

Dependencies for the same exact index identity are sorted and merged when
their composite intervals overlap or are adjacent. Intervals from different
index definitions, codec versions, or physical-spec digests never merge.

## Dependency Authority

The trusted dependency commits to at least:

- exact scope and snapshot authority inherited from the attempt;
- stable table ID;
- immutable physical index-definition ID;
- ordered-key codec version;
- physical-spec digest;
- canonical composite start and end; and
- the exact supported direction, which is `asc` in this gate.

Developer names, raw SQL, caller-selected physical IDs, returned document
bodies, and Postgres transaction handles are not dependency authority.

The existing session-journal protocol currently admits only
`appRowPoint`. O10 must add an indexed dependency to the one authoritative
private journal format and its counters, canonical bytes, seal, stored-attempt
authentication, compiler, retry, and commit projections. Do not add parallel
old/new journal acceptance or a fallback dependency representation.

Before changing that private identity, implementation must verify that no
shipped or production-routed `flarexdb_v1` journal rows require compatibility.
If the repository's current production-inert/no-row assumption is false, stop
for an explicit data migration decision. Otherwise use the repository's
unshipped direct-replacement rule and refresh every canonical vector and
generated closure in the same capability.

The candidate-bound runtime projection must also commit the indexed-query
shape and its budgets. Do not smuggle index queries through
`maximumPointReads` or add them to `FunctionRuntimePointReaderV1`.

## Snapshot Query And Read-Your-Writes

The trusted query operation performs this bounded sequence:

1. Authenticate the session, attempt, snapshot, candidate/schema, exact
   physical definition, enabled build, target authority, and journal owner.
2. Lock only the attempt journal owner needed to serialize the syscall. Do not
   lock the scope clock and do not hold a SQL transaction while user code is
   running.
3. Read the S10 index page at `snapshotCommitSeq`.
4. Read the existing journal's coalesced staged rows for the table. Reject if
   the distinct staged-row overlay exceeds the accepted material-row ceiling.
5. Remove snapshot entries for staged row identities, lower every staged live
   final row with the exact C08 pure lowerer, retain positions in bounds, merge
   by `(encodedKey, rowId)`, and apply the page limit after the merge.
6. Fetch authoritative row revisions for returned snapshot positions in one
   bounded set-based operation and verify that each document lowers back to
   the selected physical position.
7. Record point dependencies for returned snapshot documents and record the
   canonical consumed index interval atomically with the syscall receipt.

To refill a page after staged deletions or key movement, the base query may
overfetch by at most the bounded distinct staged-row count plus one. With the
initial 128-row page and the existing 128-material-row ceiling, the physical
read remains below S10's 1,000-entry page ceiling. The implementation must
prove that bound rather than repeatedly fetching until full.

Staged-only documents do not invent a remote point dependency. Patch,
replace, and delete operations retain the existing point dependency required
to derive their exact base/final state.

Returned snapshot documents keep ordinary point dependencies because a
non-index-field update may change returned content without changing index
membership. This separation is why arbitrary post-index filters remain
unsupported in O10.

## Commit-Time Validation

After taking the existing scope-clock lock, final point commit:

1. revalidates the existing attempt, epoch, generation, candidate/schema, and
   exact index-maintenance authority;
2. validates point dependencies through the existing O05/O06 owner;
3. for each canonical indexed dependency, searches immutable S10 revisions in
   `(snapshotCommitSeq, lockedLastCommitSeq]` for any live or tombstone
   position overlapping the composite interval;
4. reports the first conflict in deterministic dependency/position/commit
   order; and
5. on no conflict, continues through the existing allocation, row, index,
   unique, outcome, feed, outbox, and session publication transaction.

The validator inspects change history. It must not compare the snapshot page
with current membership, because a move-out-then-back or delete/reinsert may
leave an identical final page while still invalidating the transaction.

C08's tombstone at the old position and live revision at the new position are
the old/new-key evidence. Same-key content updates of returned documents are
covered by their point dependencies.

Only an enabled, completely built definition may serve O10. After enablement,
every authoritative membership change must append S10 history in the same
scope commit lane. A backfill, repair, or rebuild must not mutate an enabled
definition behind its commit sequence or publish historical revisions that an
active dependency cannot observe. A rebuild uses a new immutable physical
definition and the existing readiness/activation gates.

An indexed conflict enters the existing O08 full-attempt replacement and
rerun policy. Replacement must reproduce at least one durable post-snapshot
overlap before issuing the next attempt. It does not create a second retry
owner or retry only the SQL commit.

## PostgreSQL Access-Path Gate

The existing S10 key-first revision index is authoritative storage, but its
ability to answer a negative post-snapshot overlap query under large history
is not assumed.

Before selecting DDL, test genuine PostgreSQL with populated history for:

- narrow and broad equality prefixes;
- no matching post-snapshot change;
- a match near the beginning and end of the commit interval;
- many old revisions at positions inside the key range;
- many recent revisions outside the key range; and
- the maximum accepted dependency collection.

Compare the existing key-first path with a commit-sequence-first supporting
index over S10 revisions. Prefer S10 history plus the smallest proven
supporting index. Do not add a global per-index version, arbitrary range-lock
table, second write log, or new transaction owner merely to make validation
convenient.

Validation must remain bounded while the scope lock is held. Use set-based
queries or a materially small dependency ceiling; do not issue one unbounded
history scan or thousands of sequential statements.

## Retention

O10 does not activate history cleanup. O11 must retain enough S10 revision
history to answer every unexpired indexed dependency, advance the durable
floor only after row/index/feed histories are mutually safe, and reject a
snapshot below the retained floor. Compacted history must never be interpreted
as "no conflicting write."

## Acceptance Matrix

PGlite and genuine PostgreSQL must prove:

- empty-range phantom insertion;
- live deletion and delete/reinsert;
- movement into, out of, and within the consumed interval;
- move-out-then-back with an identical final position;
- duplicate encoded keys ordered by distinct row IDs;
- insertion before the page frontier conflicts;
- insertion strictly after a non-exhausted frontier does not conflict;
- an underfilled page protects the remaining effective interval;
- returned-row non-index-field changes conflict through point evidence;
- staged insert, delete, patch, replace, key movement, repeated-write
  coalescing, duplicate-key ordering, and page refill;
- canonical interval sorting, merging, replay, interruption, and idempotency;
- exact conflict replacement and rerun;
- rollback and uncertain-outcome behavior with no partial publication;
- wrong definition, table, codec, physical digest, bounds, cursor, candidate,
  scope, epoch, generation, and corrupted history rejection;
- query-call, page, overlay, interval-count, evidence-byte, and commit-work
  ceilings; and
- genuine-PostgreSQL query plans and deterministic concurrent phantom
  serialization.

Unsupported filters, scans, descending reads, external pagination, relations,
search, and vector shapes must have explicit rejection tests.

## Delivery Sequence

1. **O10-PF1 — complete with this accepted design.** Reconcile roadmap truth
   and freeze the first exact shape without adding behavior.
2. **O10-PF2 — implementation preflight.** Inventory private protocol/storage
   identity, verify the no-shipped-row assumption, choose the durable bounded
   interval-set representation, and capture genuine-Postgres baseline plans.
   Stop if compatibility data, a second authority, or materially broader DDL
   is discovered.
3. **O10-A — private indexed snapshot/journal capability.** Add the exact
   candidate-bound query operation, composite consumed-interval dependency,
   durable bounded journal capture, set-based document verification, and
   protocol/generated closure. It remains unavailable to mutation user code.
4. **O10-B — overlay and commit integration.** Add the complete staged overlay,
   S10 history validator, existing O08 conflict replacement, and exact runtime
   capability. Enable only the accepted shape.
5. **O10-C — acceptance and simulation.** Close PGlite and genuine-PostgreSQL
   concurrency/plan/rollback evidence and add a Standard cooking-app scenario
   that makes a real business decision from an indexed range.

Each implementation-bearing capability owns one commit, focused validation,
both mandatory exact-final reviewers, fixes, and re-review. No slice activates
production routing or continues into R01, R02, S12, C09, or O10-R without the
next explicit direction.
