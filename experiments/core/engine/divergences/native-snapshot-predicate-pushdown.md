# Mechanism: PostgreSQL filters read-only snapshot reads

Design status: **Accepted**, including the guarantee change below.
Implementation status: **Implemented** for full-set native relational reads on read-only snapshot operations.
Measurement status: **Required gates unmet**; local load only, in the owning slice.

## Ownership and decision

- Owning slice: [Native snapshot read pushdown](../slices/native-snapshot-read-pushdown.md).
- Owners: `filter` beside `scan` in `packages/persistence-postgres/src/database/corePersistence/persistence.ts`;
  `nativeFilterSnapshot` in `src/core/transaction.ts`; selection in `src/core/nativeRelationalQuery.ts`; the closed
  stored-document renderer in `src/database/postgresRelationalPredicate.ts`.
- One guarantee changes, with owner approval. No durable data or public contract changes.

## Pinned Convex mechanism

- Revision: `db914cf06e2b06ee985646611b9e12ed7a770318`.
- `crates/database/src/query/filter.rs:58-70`: a filter is a runtime operator applied to each document after the
  index range produced it. The storage layer never evaluates a predicate.
- `crates/database/src/query/index_range.rs:173-185,222-227`: every document the range yields is read and counted,
  whether or not the filter keeps it.
- `crates/common/src/knobs.rs:646-651`: a transaction may read 32,000 documents and 16 MiB, then fails. Nothing is
  truncated. `CoreAccounting` already translates these limits.
- Convex has no OFFSET and no exact total; a caller pages by cursor.

## Current core and proposed direction challenge

- A native read with no indexed selection captured the complete table through `find`, decoded and validated every
  row twice, inspected and sorted it in JavaScript, and was refused above 2,048 identities or 8 MiB. On 200 Products
  a `q` search decoded about 215 documents for a 20-row page.
- Read mode fixes one snapshot, admits no pending write and discards its read token, so remembered originals, per-row
  point reads and the pending overlay do no work for these reads.
- The scan statement already resolves snapshot visibility in SQL. The predicate, order, window and count can run
  outside that subquery without changing which revision is visible.
- Rejected: pushing the predicate into write-mode or receipt-carrying reads. They need the complete observed cohort.
- Rejected: reusing the captured-candidate renderer unchanged. It compares `->>` text, so a JSON number `7` equals the
  string `"7"` and an absent field is NULL; the JavaScript evaluator distinguishes both.

## Why a difference is necessary

Admin lists need an exact total, OFFSET and a substring search. Convex offers none of them, and its filter-after-index
shape costs one decoded document per examined row in the host. That is the measured read cost. PostgreSQL holds the
documents and can evaluate the same closed predicate without shipping them.

## Replacement mechanism and implementation

One statement per read, on a snapshot's optional `filter`:

1. Visibility: the scan's `DISTINCT ON (key_prefix, key_sha256) … ts <= at … ts DESC` over the whole index. Tombstoned
   keys are dropped and the live ones limited to `maxExamined + 1`, then joined to their exact document revision for
   its header and body length only.
2. `facts`: live examined documents, their stored body bytes, and entries whose revision is missing, deleted or of
   another table.
3. The JSON parse and the predicate run only when both bounds hold and no entry is broken. The body is joined where
   the predicate runs and again for the returned window; it is never carried through an intermediate result.
4. Matches are ordered by `(key_prefix, key_suffix)`, which is the complete key order, so keys longer than the
   2,500-byte prefix need no second sort. OFFSET, LIMIT and `count(*)` follow.

Retention is validated before the statement and again before its result is released. The transaction captures the
source before and after, as `matchRelational` does. The result is not an index page: the database hands the physical
snapshot's `filter` through explicitly, past the index cache, the resident reader and `verifyPercent`.

A read takes this path only when all of these hold. Otherwise `filterSnapshot` answers none and the read keeps the
complete captured path unchanged.

| Condition | Reason |
| --- | --- |
| Operation has `visibility: "snapshot"` | Fixed snapshot; a read-mode operation cannot write, so no overlay exists |
| The store carries no read receipts | A receipt presents the complete observed cohort |
| No indexed selection, storage-insertion order or identity list | Those reads are already bounded or need every identity |
| Every leaf is `and`, `or`, `in`, `isNull`, `textNotEqual`, `greaterThan`, `lessThan` or `textLikeAscii` | The leaves with a proven stored-document form |
| A complete index has exactly the order column | It lists every live row once, in the complete read's order and tie-break |
| The snapshot offers `filter` | Fixtures and other snapshots may omit it |
| Live documents and their bytes fit the fixed Source read limit, and the returned rows fit the remaining budgets | The complete path may read a narrower cohort and alone decides a refusal |

`coreNativeUnconditionalIndex` in `nativeRelationalQuery.ts` is the one owner of "complete index"; the page read uses
its `leading` shape and this path its `exact` shape.

Stored-document forms compare typed JSON (`jsonb` equality, `jsonb_typeof`) and coalesce to false, so an absent field,
a wrongly typed value or a tagged `$integer`/`$float`/`$bytes` value never matches, as in JavaScript. `textLikeAscii`
is `lower(… COLLATE "C") LIKE lower(…) ESCAPE ''`. Under `"C"`, `lower` folds only ASCII A-Z; the `translate` form used
for captured candidates gives the same result and measured about sixty times slower on 630-character values.

Budget. The examined bound admits each statement and charges nothing: its live documents and their stored bytes
must fit the fixed Source read limit (32,000 documents and 16 MiB by default), whatever the operation has already
read. Only returned rows are charged, as the complete read charges the rows it reads: one Source document read at its
semantic size, a native identity, and the native retained bytes of its body and key, plus the retained program as a
captured-row program is charged. Returned rows are a subset of the complete read's cohort, so this path never spends
more Source budget than the complete path would. The 2,048-identity and 8 MiB read-host budget therefore bounds the
returned window, not the table.

This path does not refuse for budget. A statement over its examined bound, or a returned window that the remaining
Source budget, native identities or native retained bytes cannot take, charges nothing and leaves the read to the
complete path, which reads only its own cohort (for example the `deleted_at IS NULL` anchor) and succeeds or refuses
exactly as before this change. Tombstoned keys are not examined entries, so a row whose order key changed many times
does not consume the bound. One exception: a returned document above the per-document byte limit is refused here,
as the complete read refuses it.

Each returned row is decoded and validated by the transaction, then validated, re-evaluated by the JavaScript
predicate and checked against the complete read's order. A row PostgreSQL returned that JavaScript rejects, or one out
of order, fails as stored corruption.

## Preserved and changed guarantees

Preserved: one fixed snapshot; exact total; the complete read's order, identity tie-break and window; refusal instead
of truncation, and a budget refusal only from the complete read;
authority and metadata checks before and after; retention checks before and after; full decode and validation of
every returned row; unchanged behavior for writes, receipts and every unlisted predicate.

Changed, with owner approval: a stored row that the read does not return is no longer decoded or validated in
JavaScript. A corrupt row outside the window no longer fails the read, and a count returns no row at all.

Hazard: PostgreSQL parses a body only where a leaf reads it. A statement without a leaf never parses, so an
unparseable body it does not return passes unseen. A statement with any leaf parses every examined body, so one
body that is not UTF-8 JSON fails every filtered read with a leaf on that table, whatever its window, as
`corruptData`. Only SQLSTATE 22021, 22P02 and 22P05 reported by PostgreSQL with a severity are classified that way;
every other failure keeps its ordinary classification.

Changed: the examined bound is the fixed Source read limit per statement, not the native identity budget. A returned
document's native bytes are charged on every statement that returns it, because nothing is remembered between
statements; when they no longer fit, the complete path takes the read.

## Required witnesses and remaining limits

- `test/core/snapshotFilterScenarios.ts`: the statement against the JavaScript evaluator over the complete scan, for
  match set, order, ties, count and windows at two snapshots, with tombstones, older revisions, absent fields, wrongly
  typed values, Unicode and case, long keys and empty results; bound reporting; retention before and after; a missing
  revision. PGlite and ordinary-role PostgreSQL.
- `test/core/nativeSnapshotPushdownScenario.ts`: the pushed path against the complete path through the installed Core
  owner at the current and an earlier snapshot; fallback for a write operation, an unproven leaf, an indexed selection
  and a snapshot without `filter`; statement admission, returned-row charges and the forty/thirty-six/eight budget case; a retention advance after the statement; source
  withdrawal before and after; a corrupt returned and unreturned row. Both lanes.
- `packages/medusa-adapter/test/core-product-snapshot-pushdown.test.ts`: Product search and list against the complete
  path on one read host, and a search over a table larger than the identity budget. Both drivers.
- The same files cover: an over-budget statement falling back for a mostly soft-deleted table and for rows whose order
  key changed more often than the bound; tagged values in a filtered and an ordered column; a 200,000-character title;
  invalid UTF-8 and unparseable bodies with and without a leaf; wrongly typed comparison operands; several revisions of
  one key at each snapshot; a read-mode operation that still cannot write.
- Limits. PostgreSQL work is bounded only by the examined bound, the statement timeout and the server's temp-file
  limits. `DISTINCT ON` walks every historical revision and every tombstone of the index up to the bound, and a
  statement that reports over budget has walked as much as one that is served; the complete read then runs as well.
  Cost stays linear in table size: a 20,000-row, 14.5 MB index took about 140 ms on one local PostgreSQL 17. Rows and
  total are two reads and two statements; each is admitted on its own, so a table above 32,000 live documents or
  16 MiB of bodies goes to the complete path. Relation population keeps the complete
  path. An order column without a complete single-field index keeps the complete path. Agreement of index-key order
  with the JavaScript order relies on NUL-free text and ASCII document identities, which the relational row contract
  and the ID codec provide. The `"C"` folding rule and the query plan are checked on PostgreSQL 17 and PGlite only.
  Hyperdrive is unverified.
