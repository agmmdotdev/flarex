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

A page of 20 with relations takes the page plan, which this slice does not change: it
still decodes the skipped prefix and grows with the offset.

## Remaining limits

The statement still examines every live row of the order index and walks its tombstones and older revisions, so
PostgreSQL cost is linear in index history, bounded only by the examined bound, the statement timeout and temp-file
limits. Above the Source read limit the statement reports over budget, having done that work, and the complete path
runs as before; a catalog it cannot hold is still refused. A statement with a leaf fails on any examined body that is
not UTF-8 JSON, whatever its window. An indexed search and a `deleted_at`-prefixed ordered index remain
later slices. Rows and total are separate statements, each admitted on its own against the fixed limit.
Returning the first statement's total to the same prepared read would save the second; it is not built. Hyperdrive
behavior is unverified.
