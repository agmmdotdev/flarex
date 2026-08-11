# Indexed Range OCC

Status: Accepted design plus completed `O10-PF2`, `O10-P0`, `O10-A`, and
private production-inert `O10-B`. The exact mutation runtime now admits the one
bounded ascending developer-index range operation, including durable staged
overlay and commit-time phantom validation. No public developer API or
production route is active. The `O10-C` preflight gap recorded as
`ST-CORE-019` is closed by the accepted production-inert C08 developer
ordered-index build prerequisite, so O10-C may resume as the next separately
approved capability. This checkpoint does
not authorize relations, scans, filters, search, vectors, external pagination,
or production routing.

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

## O10-PF2 Identity Inventory

The 2026-08-10 implementation inventory found one existing authority chain,
not an empty integration surface:

| Concern | Exact current owner and consequence |
| --- | --- |
| Canonical logical journal | `flarex-protocol/commit-protocol` owns `SessionJournalV1`, whose `LogicalReadDependencyV1` currently has only `appRowPoint`. O10 directly extends that one private union and refreshes its canonical vectors; it does not add a parallel range journal. |
| Open-attempt storage | Migration `0028_glossy_galactus` and `sessionJournalStore` own `fx_system_tx_journal`, the coalesced `fx_system_tx_journal_point` overlay/dependency set, ordered write events, the latest-syscall replay receipt, counters, and seal materialization. |
| Syscall replay | `fx_system_tx_journal_latest_receipt` is intentionally one overwritten row per attempt. It can authenticate only the latest syscall and therefore cannot own the complete indexed dependency set. |
| Attempt admission | `transactionSessionActivation` owns the exact running-attempt transaction, lock order, lease/claim checks, and journal-root lock. Its current path locks the scope clock `FOR UPDATE` for every point syscall. |
| Stored-attempt and planning | `storedAttemptEvidence`, `storedCommitAuthority`, and `executor/storedAttemptAuthentication` authenticate, decode, normalize, and plan the one sealed journal. O10 must extend this chain rather than bypass it with SQL-owned dependencies. |
| Final publication | `pointCommitTransaction` owns the existing scope-clock lane, OCC decision, allocation, row/index/unique sidecars, result, feed, outbox, and outcome publication. O10 adds one validation input to this transaction and no alternate commit owner. |
| Runtime API | `function-runtime/functionApiCore` and the candidate-bound runtime target currently expose only point CRUD and `maximumPointReads`. O10 needs a separately committed indexed-query capability and budget. |
| Index history | Migration `0040_lush_tenebrous`, `fx_app_index_entry_rev`, and `appIndexEntries` own immutable S10 history and snapshot range access. The existing supporting order is key-first: `(scope_uuid,index_definition_id,encoded_key,row_id,commit_seq desc)`. |
| Routed generation | `executor/appDataEngines` registers only `legacy_v1`; the foundation README records `flarexdb_v1` as private and runtime-unreachable. Repository evidence therefore supports direct replacement of the private journal contract, but does not claim knowledge of manually populated external databases. |

Because the existing point-only journal values remain valid members of the
expanded union and all new counters default to zero, O10 does not need dual
acceptance or a body migration. The implementation migration remains additive.
If deployment evidence later shows a production-routed `flarexdb_v1` consumer,
stop and reopen this conclusion before changing the journal identity.

## Durable Indexed Dependency Storage

Use one necessary bounded child table,
`fx_system_tx_journal_index_range`, rather than storing interval bodies in the
journal root or abusing the latest receipt.

The reasons are structural:

- the latest receipt is constant-cardinality and is deleted/replaced on every
  accepted syscall;
- the exact running-attempt kernel currently selects the complete journal root
  on every syscall, so a growing root byte blob would repeatedly fetch and
  rewrite toasted interval evidence even for unrelated point operations; and
- an indexed dependency is a distinct bounded collection with its own
  cardinality, ordering, corruption checks, and seal projection. It is not a
  second copy of app rows, source bytes, index-entry history, or query results.

The child is owned by the existing journal root through a restrictive update
and cascading-delete foreign key. It stores at most 32 canonical merged rows
ordered by a contiguous small ordinal. Each row stores only structured
authority: table ID, immutable physical index-definition ID, key-codec version,
physical-spec SHA-256, ascending direction, and nullable typed lower/upper
composite endpoints with explicit inclusive/exclusive/unbounded kinds. Keys and
row IDs retain the existing 2,048-byte and 16-byte bounds. It stores no
documents, result pages, SQL, developer names, or S10 revision copies.

The journal root adds three independent bounded counters:

- indexed-query syscall count, maximum 32;
- canonical merged indexed-dependency count, maximum 32; and
- canonical indexed-dependency evidence bytes, with a protocol-owned ceiling
  selected and pinned by O10-A vectors.

One indexed syscall holds the existing exact-attempt transaction, verifies the
current child rows and root counters, merges the new interval canonically,
rewrites at most 32 child rows in ordinal order, records returned-document point
dependencies, replaces the latest receipt, and advances all counters in the
same transaction. Seal loads at most 33 child rows, rejects count/order/bound
or digest mismatches, and emits the single canonical journal. This is one
authority and one atomic replay boundary.

## Snapshot Query And Read-Your-Writes

The trusted query operation performs this bounded sequence:

1. Authenticate the session, attempt, snapshot, candidate/schema, exact
   physical definition, enabled build, target authority, and journal owner.
2. Enter only the O10-P0 shared scope-clock read admission plus the attempt
   journal owner needed to serialize the syscall. Do not enter the exclusive
   commit lane or hold a SQL transaction while user code is running.
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

### O10-PF2 PostgreSQL 18.3 Evidence

The preflight used an isolated local PostgreSQL 18.3 cluster and a standalone
table with the exact relevant S10 column/index order. The populated history had
400,000 old in-range revisions plus bounded recent out-of-range revisions. The
numbers are diagnostic local evidence, not an SLA.

| Negative-overlap case | Access path | Buffers | Execution time |
| --- | --- | ---: | ---: |
| One broad interval, existing key-first index only | `o10_s10_key_first_idx` | 5,618 hits | 39.752 ms |
| Same broad interval, with commit-first support | `o10_s10_commit_first_idx` | 201 hits + 105 reads | 1.223 ms |
| One narrow interval, key-first only | key-first | 58 hits | 0.361 ms |
| Same narrow interval, commit-first available | commit-first | 300 hits | 0.194 ms |

The accepted maximum-work fixture then populated exactly 128 post-snapshot
commit sequences with 256 S10 revisions per commit and validated 32 disjoint
canonical dependencies. PostgreSQL used 4,096 bounded index searches over the
commit-first index. The warm run used 12,294 buffer hits and 5.416 ms; after a
server restart it used 12,168 hits plus 138 reads and 13.379 ms. A naive
per-dependency lateral shape was also observed choosing the key-first index and
doing substantially more work, so plan shape and chosen index must be asserted,
not inferred from index presence.

The admitted O10 supporting index is therefore:

```sql
(scope_uuid, index_definition_id, commit_seq, encoded_key, row_id)
```

Retain the existing key-first index for snapshot page reads. Use the new index
only as the post-snapshot history-validation access path. O10-B must use one
set-based dependency relation, assert the genuine-PostgreSQL plan, and preserve
deterministic conflict ordering.

The measured bound also freezes
`MAX_INDEX_RANGE_OCC_COMMIT_SPAN_V1 = 128`. If
`lockedLastCommitSeq - snapshotCommitSeq` exceeds 128, validation reports a
conservative OCC conflict before reading S10 history and enters the existing
O08 full-attempt replacement/rerun policy. With C08's existing maximum of 256
developer-index entry revisions per commit, this caps candidate history at
32,768 revisions before the 32-dependency join. Raising either ceiling requires
new populated-history and lock-hold evidence.

## O10-P0 Shared Read-Admission Prerequisite

PF2 found a conflict between the accepted query contract and the current
kernel: `lockPointMutationSessionClock` uses `FOR UPDATE`, and every exact point
syscall reaches it before locking the session, attempt structure, journal root,
and execution claim. Reusing that path would serialize every indexed read with
all reads and commits in the scope. That is not an acceptable hidden cost and
contradicts this roadmap's requirement that a snapshot query not enter the
exclusive commit lane.

O10-P0 now supplies one bounded transaction-kernel capability:

1. add an exact running-attempt **read/syscall admission** mode that takes the
   scope clock `FOR SHARE`, then preserves the existing session, lease, journal,
   execution-claim, epoch, fence, revocation, and database-clock checks;
2. expose it only as a package-internal facet reserved for the future indexed
   query syscall;
3. leave every existing point CRUD, activation, terminalization, replacement,
   commit, OCC, and lock-order behavior unchanged; and
4. hold the shared lock only for the bounded syscall transaction, never while
   user code runs.

`FOR SHARE` is deliberate: concurrent read syscalls may proceed together while
epoch, generation, revocation, and commit writers cannot cross the admission
transaction. Removing the scope lock entirely would weaken current read
authorization semantics and is not approved.

The implementation keeps the existing mutation symbol on `FOR UPDATE` and adds
the separate
`RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1` facet on `FOR SHARE`.
Both paths reuse the same exact session, lease, journal-root, execution-claim,
authority, and database-clock checks. The factory snapshots no weaker parallel
authority, and the new facet remains absent from public package exports.

Focused PGlite evidence proves exact context, unchanged lock order after the
scope clock, callback-failure rollback, deferred interruption settlement, and
stale epoch, storage-generation-fence, and revocation rejection. Genuine
PostgreSQL 18.3 proves two different attempts in one scope can hold read
admission concurrently, an existing update-lock exact-attempt writer remains
blocked after the first reader settles, and it proceeds only after the second
reader settles. No indexed query, schema, migration, point-operation, commit,
activation, routing, or production behavior was added.

## O10-A Private Indexed Snapshot And Journal Checkpoint

O10-A now extends the one private candidate-bound point-mutation target and the
one authoritative logical journal; it does not expose a second index-query API.
The candidate target commits to operation
`flarex.system/app-index-range-query/v1`, 32 indexed-query syscalls, a 128-row
page, 32 merged range dependencies, and 262,144 canonical range-evidence bytes.
The exact refreshed protocol vector digest is
`36a0fb8a39e0bc60b147d989189c56aa1b3038b9fa1c5a77aace9fb147f9c98c`.
Generated function-runtime sources remain byte-identical because this private
operation is deliberately not injected into mutation user code in O10-A.

The package-internal persistence capability authenticates the exact attempt,
schema/table/index definition, enabled build, and O10-P0 shared admission. It
reads one ascending S10 page at the attempt snapshot, fetches returned app-row
revisions in fixed eight-row set-based batches, re-lowers each document to
verify its stored composite position, and stops as soon as the cumulative
16 MiB semantic-read budget is exceeded. This prevents a valid 128-row request
from materializing up to 128 MiB of document bodies before its deterministic
limit outcome. Successful calls record ordinary returned-row point evidence
plus the canonical consumed range in the same syscall transaction. Empty and
exhausted pages protect the complete requested interval; a truncated page ends
at its last consumed composite position. Repeated compatible intervals are
normalized and merged before persistence.

Migration `0051_chemical_gorilla_man.sql` adds the single bounded
`fx_system_tx_journal_index_range` child plus independent root counters for
indexed-query calls, range cardinality, and range-evidence bytes. The child
stores only structured range authority, never user documents or S10 revision
bodies. Fresh install, exact `0050 -> 0051` upgrade, injected migration failure,
rollback, replay, six named constraints, and non-public-schema portability are
proved in PGlite and genuine PostgreSQL 18.3. The complete PGlite migration
suite passes with 52 exact receipts and five journal-owned tables.

Focused O10-A evidence proves exact replay, frontier capture and merge, empty
range capture, point/range/root counter agreement, sticky syscall exhaustion
before index data I/O, staged-overlay refusal, stored document/position mismatch
rejection, bounded early semantic-budget termination before a later unread
corrupt row, and transaction rollback after both point and range evidence writes.
Seal authenticates and emits point and range dependencies in one canonical
journal. The current stored-attempt planner explicitly rejects a range
dependency as unsupported, so it cannot be silently omitted before O10-B owns
commit-time validation.

O10-A intentionally failed closed when the table had staged rows. O10-B now
replaces that temporary refusal with the accepted bounded overlay and owns the
commit/runtime integration described below. The larger simulation and
acceptance matrix remains O10-C work.

## O10-B Private Overlay, Commit, And Runtime Checkpoint

O10-B keeps one journal, one planner, one scope-clock commit lane, and one O08
replacement/rerun owner. It does not create a parallel index-query API, OCC
validator, commit path, retry policy, or production trigger.

The indexed syscall now loads at most the admitted material-row overlay,
authenticates each staged point, lowers its final live document through the
exact C08 developer-index definition, removes replaced or deleted snapshot
positions, merges staged live positions with the bounded S10 snapshot stream,
and only then orders and limits the result. Focused evidence covers patch
movement plus combined staged patch, delete, and insert ordering before a
truncated page frontier. Returned documents continue to record ordinary point
dependencies; the consumed composite frontier records the range dependency.

The stored-attempt planner carries canonical range dependencies into the
existing point-commit command. Under the already-owned scope-clock lock, one
set-based S10 history query searches only
`(snapshotCommitSeq, lockedLastCommitSeq]`, deterministically selects the first
overlap, and returns the stable `appIndexRange` conflict. The validator refuses
work before history I/O when the snapshot is below retained history or when
the commit span exceeds `MAX_INDEX_RANGE_OCC_COMMIT_SPAN_V1 = 128`. O08 stores
and reproduces the exact point-or-range conflict before replacing the attempt;
the existing full-attempt jitter/backoff policy remains unchanged. A disjoint
post-snapshot index write publishes successfully.

Migration `0052_last_old_lace.sql` adds only the measured S10 supporting index:

```sql
(scope_uuid, index_definition_id, commit_seq, encoded_key, row_id)
```

PGlite and genuine PostgreSQL prove fresh application through the ordinary
migration path, exact `0051 -> 0052` upgrade, injected post-DDL failure with no
index or receipt left behind, replay/idempotency, and non-public-schema
portability. Genuine PostgreSQL `EXPLAIN` for the exact conflict lookup selects
`fx_app_index_entry_rev_commit_range_idx`; the complete point-commit suite also
retains its concurrency, rollback, interruption, uncertainty, and replay
evidence.

The exact mutation Worker and both mutation internal-call profiles expose the
same private `queryIndexRange(table, indexDescriptor, bounds, limit)` facade from
the shared Function API Core. The nested service-binding RPC preserves opaque
table and index capabilities and disposable child stubs. Runtime decoders
reject sparse, oversized, underfilled non-final, cross-table, or otherwise
malformed pages before returning them to application code. The analyzer lowers
only the reserved exact operation and rejects direct private platform access,
wrong arity, and unsupported shapes. Generated cores and the private analyzer
release identity are refreshed once; no parallel ABI is accepted.

The focused final validation is 135/135 PGlite persistence cases, 28/28
genuine-PostgreSQL persistence cases, 72/72 executor cases, 48/48 generated and
Workerd backend cases, and 52 targeted analyzer ABI cases, with all affected
package typechecks and deterministic generated-source checks green. Exact
environment timings remain task/commit evidence rather than roadmap policy.

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
2. **O10-PF2 — complete with this checkpoint.** The inventory selects one
   bounded journal child, confirms repository-level production inaccessibility,
   selects the commit-first supporting index and 128-commit validation span,
   records PostgreSQL 18.3 plans, and identifies the exclusive-lock blocker.
3. **O10-P0 — complete.** The separate package-internal shared exact-attempt
   read/syscall admission facet and its PGlite/PostgreSQL concurrency,
   authority, rollback, and interruption evidence are complete. Every existing
   caller remains on the update-lock path.
4. **O10-A — complete.** The exact candidate-bound query identity and budgets,
   composite consumed-interval dependency, durable bounded journal capture,
   set-based document verification, protocol vectors, migration evidence, and
   generated-closure checks are complete. Staged rows and stored-attempt
   planning remain fail-closed, and the capability remains unavailable to
   mutation user code.
5. **O10-B — complete.** The bounded staged overlay, set-based S10 history
   validator, 128-commit refusal, exact O08 conflict replacement, measured
   supporting index, private analyzer ABI, RPC, and exact runtime capability
   are integrated without a second OCC/commit/retry owner.
6. **O10-C — ready for its next approved slice.** `ST-CORE-019` is closed by
   the accepted C08 developer ordered-index build prerequisite. Continue with
   PGlite and genuine-PostgreSQL concurrency/plan/rollback evidence and a
   Standard cooking-app scenario that makes a real business decision from an
   indexed range. The simulation must continue through the real build and
   readiness owners and may not seed enabled C4 state.

Each implementation-bearing capability owns one commit, focused validation,
both mandatory exact-final reviewers, fixes, and re-review. No slice activates
production routing or continues into R01, R02, S12, C09, or O10-R without the
next explicit direction.
