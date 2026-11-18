# Native snapshot read pushdown

Status **Implemented.** Flarex baseline `e79c02484`. Convex
`db914cf06e2b06ee985646611b9e12ed7a770318`.

Mechanism and its difference from Convex:
[PostgreSQL filters read-only snapshot reads](../divergences/native-snapshot-predicate-pushdown.md).

## Measured attribution

200 Products, read-only host. `listProducts({ q }, { take: 20 })` captured the complete active table: about 215
decoded documents and about 28 ms CPU, against 0.5 ms for native Medusa. Above 2,048 identities or 8 MiB the read
was refused. The [list read slice](./native-list-reads.md) left totals and `q` open.

## Independent challenge

One read-only challenger inspected current Core and pinned Convex. The worker verified each point in code.

| Finding or proposal | Outcome |
| --- | --- |
| Read mode fixes its snapshot, has no pending write and discards its token | Confirmed. Originals, point reads and the overlay are skipped on this path. |
| Snapshot visibility is already resolved in the scan SQL | Confirmed. Predicate, order, window and count run outside that subquery. |
| Long index keys are re-sorted in JavaScript | Not needed here. `(key_prefix, key_suffix)` is the complete key order. |
| Reuse the captured-candidate SQL renderer on stored documents | Rejected. Its `->>` text comparison merges JSON types and absent fields. A typed renderer was added beside it. |
| `textLikeAscii` has no admitted PostgreSQL form | Resolved. `lower(… COLLATE "C") LIKE … ESCAPE ''` agrees with the JavaScript matcher in the differential tests. |
| Stored JSON equals the row JavaScript sees | Holds for strings, booleans, null and ordinary numbers. `$integer`, `$float` and `$bytes` differ and never satisfy an admitted leaf. |
| Index-key order equals the JavaScript order and tie-break | Holds for a complete index on exactly the order column. A compound index keeps the complete path. |
| Keep the 2,048-identity budget as the examined bound | Not kept. Examined live documents bound each statement against the fixed translated Convex read limit and are not charged; returned rows are charged to the Source and native budgets, as the complete read charges them. |
| Refuse when the statement is over its examined bound | Rejected in review. The complete read may hold a narrower cohort, so an over-budget statement falls back to it and only it refuses. |
| Count tombstoned keys as examined | Rejected in review. Only live documents count; tombstones are walked. |
| Push down write-mode or receipt-carrying reads | Rejected. They keep the complete path. |

## What was built

| Owner | Change |
| --- | --- |
| `CorePersistenceSnapshot` | Optional `filter`: one statement returning the window, exact count, examined entries and bytes. |
| Relational compiler | Marks a predicate whose every leaf has a stored-document form. |
| Predicate renderer | Closed typed forms over the stored document for those leaves. |
| Core transaction | `filterSnapshot`: none unless the operation is a read-only snapshot with a complete order index, an evaluator, a statement inside the fixed limit and budget for the returned rows; otherwise capture before and after, returned-row charges, decode, validation and native charges. |
| Core database | Hands the physical snapshot's `filter` through explicitly, past the index cache. |
| Native relational read | Selects the statement for eligible full-set reads and re-checks every returned row; otherwise the complete path. |
| Native store | Offers the statement only where reads carry no receipts. |

## Owner decisions

| Question | Decision |
| --- | --- |
| Unreturned rows | No longer validated for stored corruption on these reads. Approved. |
| Examined bound | Fixed Source read limit per statement: 32,000 live documents and 16 MiB by default; an admission bound, not a charge. Above it the complete path runs and decides. |
| Returned rows | Unchanged validation; native identity and byte budgets. |

## Measured outcome

Ordinary-role PostgreSQL, one local host carrying other load, one caller. CPU per request
and median latency; the 200-Product row is the median of three alternating rounds against
a clean baseline clone, the 3,000-Product row one run of 50 requests on each side. The
before/after ratio is the evidence; absolute values are inflated by the host.

| Read | Native | Core before | Core after |
| --- | --- | --- | --- |
| `q` search, 200 Products | 0.5 ms CPU | 40.8 ms CPU, 43.6 ms, 2 round trips | 4.5 ms CPU, 9.0 ms, 1 round trip |
| `q` search, 3,000 Products | not measured | refused: complete index capture limit | 6.8 ms CPU, 44.9 ms, 1 round trip |
| Page of 20 by `id` with relations, 3,000 Products | not measured | 110 ms CPU, 6.5 round trips | unchanged within noise |

At that baseline a page of 20 with relations still took the examined page, decoding its skipped prefix. The
[paged-list section](#read-only-paged-lists) below routes it to the statement's page form.

## Read-only paged lists

Baseline `0b0f6bc7f`. `listProducts({}, { take, skip, order, relations })` without a total still took the examined
page. The Product profile marks such a list pageable, the read-only store reports `pageReplacesFind`, and the read
window then calls `findPage`; the statement had been wired only into `find` and `count`. Each page decoded its skipped
prefix and lookahead because the soft-delete residual runs per examined document.

| Question | Finding |
| --- | --- |
| What the examined page guarantees | The window of matches in index-key order, a "has more" flag from one lookahead match, no total, no identity list, refusal past the native identity budget. Relation population reads the returned rows' keys, not page state. |
| What the statement must reproduce | The same window, order and tie-break, and "has more". The page form's one lookahead match gives "has more", or a walk that saw the whole index; its order equals the page's when the page's index is the single-field one, which is required. |
| Unsound or a new guarantee change | Neither. Skipped rows unvalidated is the approved change. Serving a deep skip the examined page refuses is the returned-window budget rule already recorded. |

Built: `executeCoreNativeRelationalPage` asks the statement first for a query it admits, and the native store offers
it only where reads carry no receipts. Write operations, receipt-carrying reads, compound page indexes and unproven
leaves keep the examined page.

A page does not use the counting form. Review measured that form at 143 to 395 ms for the first page of a 20,000-row
table, against about 1 ms of database work for the examined page, because it walks and counts the whole index. Pages
use a page form (`filterPage` in `persistence.ts`):

| Step | Detail |
| --- | --- |
| Bounded walk | The first `walk` live entries in index order, `walk` starting at twice the window's end (at least 64). The innermost query levels carry no join, so the planner takes `walk` as the row target of the ordered index scan. |
| Window | Those entries are joined to their exact revision and parsed; matches are sorted by full key and cut at `skip`, `take + 1`. Bodies are read again for the window only. |
| Verdict | The statement also returns how many entries it walked and the last walked key prefix. Fewer than `walk` means the whole index was seen, so the window and its end are exact. Otherwise the window stands when its lookahead was found and its last row lies before the last walked prefix, since unwalked entries can share only that prefix. |
| Bounds | Before any body is parsed the statement sums the walked entries' stored bytes and checks each has its intact revision. Over the Source byte limit it parses nothing and reports over budget. |
| Undecided | The walk is repeated four times wider, up to one entry past the Source read limit: at most six statements at the reference limit of 32,000. A final walk that long proves the index exceeds the limit; if it still leaves the window undecided, that is the counting form's over-budget verdict, so the read goes to the examined page without a counting statement. |

This is a bounded walk, not a row-at-a-time stream: the walked entries are materialised and sorted, about twice the
window's end. A streaming plan could not be had in one query. PostgreSQL plans a subquery beneath a sort or a join
for total cost, so the ordered index scan was replaced by a sequential scan and full sort whenever the outer query
ordered by full key. Giving the planner the small row target directly is what keeps the walk off the table.

A broken entry anywhere in a walk, from 64 entries up to the Source limit on the widest repeat, fails the page as
`corruptData`, including an entry beyond the window that the examined page would never have read. That is a
recorded consequence of handing validation of unreturned rows to PostgreSQL.

Plans on ordinary-role PostgreSQL 17, 28,000 rows of about 700 bytes with two revisions each, one in seven
soft-deleted, a second index of the same size, page of 20 (`test/core/snapshotPagePlan.postgres.test.ts`):

| `skip` | Ascending | Descending | Index rows scanned | Plan |
| --- | --- | --- | --- | --- |
| 0 | 1.1 ms | 0.4 ms | 129 / 127 | Index scan, incremental sort (ascending only), unique, limit 64 |
| 1,000 | 11.6 ms | 10.3 ms | 4,097 / 4,083 | The same, limit 2,042 |
| 19,000 | 680 ms | 250 ms | 56,000 | The walk covers the table: sequential scan and sort ascending, index scan descending, two merge joins to documents |

A page that deep costs more than the counting form's 140 ms, because the headers and then the bodies are joined in
separate steps. Timings on a shared machine vary by a factor of two.

Documents decoded per page of 20, 200 Products with one variant and one image each, PGlite, counted at the document
decoder:

| Page | Examined page | Statement |
| --- | --- | --- |
| `skip` 0, with relations | 102 | 100 |
| `skip` 100, with relations | 202 | 100 |
| `skip` 180, with relations | 281 | 100 |
| `skip` 100, no relations | 122 | 20 |

The parents fall to the 20 returned. Relation population decodes 80 child documents for 20 parents at every offset,
so it follows the returned rows, not the table.

Ordinary-role PostgreSQL, one local host, one caller, 60 requests per case, pages spread across the table; CPU per request / median latency / round trips.

| Read | Core before | Core after |
| --- | --- | --- |
| Page of 20 with relations, 200 Products | 31.0 ms / 32.8 ms / 3.4 | 17.4 ms / 26.4 ms / 3 |
| Recent page of 20 with relations, 200 Products | 29.3 ms / 34.1 ms / 3.8 | 17.4 ms / 29.7 ms / 3 |
| Page of 20 with relations, 3,000 Products | 91.3 ms / 101.0 ms / 7.3 | 18.6 ms / 33.0 ms / 3 |
| Recent page of 20 with relations, 3,000 Products | 96.7 ms / 113.8 ms / 11.6 | 20.1 ms / 33.9 ms / 3 |

Retrieve, list by IDs and search did not change. The remaining cost of a page is relation population, about 80 child documents for 20 parents.

## Remaining limits

The statement still examines every live row of the order index and walks its tombstones and older revisions, so
PostgreSQL cost is linear in index history, bounded only by the examined bound, the statement timeout and temp-file
limits. Above the Source read limit the statement reports over budget, having done that work, and the complete path
runs as before; a catalog it cannot hold is still refused. A statement with a leaf fails on any examined body that is
not UTF-8 JSON, whatever its window. An indexed search and a `deleted_at`-prefixed ordered index remain
later slices. Rows and total are separate statements, each admitted on its own against the fixed limit.
Returning the first statement's total to the same prepared read would save the second; it is not built. Hyperdrive
behavior is unverified.
