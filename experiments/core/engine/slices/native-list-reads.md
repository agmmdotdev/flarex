# Bounded native Product list reads

Status **Implemented for selected Product reads.** Large-catalog totals and search stay open.

Flarex baseline `3f48bfe67`. Convex `db914cf06e2b06ee985646611b9e12ed7a770318`.

## Measured attribution

[Load benchmark](../../../../packages/medusa-adapter/benchmarks/core-performance/product-workflows/README.md)
over 200 Products. Every list read was refused: 10 Products with relations exceed
the 128-identity working set, and a page or `q` search captured every active row.
`created_at` order was refused by the Product profile and the order-column check.

## Independent challenge

- Current Core. Complete capture comes from the read path, not the observation
  model. `findPage` already provides consumed-prefix windows for Currency, ascending
  only. Workflow reads with receipts have no page equivalent.
- Pinned Convex. A limited read records only through its last consumed key, and
  filters run after the index. There is no OFFSET, and search is BM25.
- Accepted direction. Complete capture is required for totals, absence and
  in-memory sort. For plain lists it was a bounded-profile choice, and the [page
  record](../divergences/native-index-page-observations.md) is the widening path.

## Owner decisions

| Question | Decision |
| --- | --- |
| Read budget | Read-only hosts use 2,048 identities and the 8 MiB batch resources. Write roots are unchanged. |
| Totals | Exact through complete capture within the budget, refused above it. |
| `q` | In-memory scan within the budget, refused above it. Indexed search stays a later slice. |
| `created_at` | Flarex-added `(created_at)` Product index. Existing Product data is reset, with no migration. |

## Dispositions

| Owner | Change |
| --- | --- |
| Native host | Read-only hosts select the read budget by default; explicit limits still win. |
| `findPage` | Accepts `desc` through the same window and observation owners. |
| Native store | A prepared read is page-replaceable only on a read-only host, whose reads carry no receipts. |
| Product query | Selects the page plan for plain active-row lists without a total; other reads stay complete. |
| Product definition and order | Adds the index and admits `created_at`; `timestamptz` becomes an admitted order column. |
| Complete reads | Tie-breaks follow the direction so complete and page reads agree on equal order values. |
| Product offset | Admits `skip` up to the read-only budget; Core bounds the rows actually read on every host. |

## Measured outcome

200 Products, ordinary-role PostgreSQL, no added latency, one local host, median
milliseconds at concurrency 1. Skip varies, so a page examines 100 rows on average.

| Read | Native | Core before | Core budget only | Core page |
| --- | --- | --- | --- | --- |
| List 10 by ID with relations | 27 | refused | 53 | 52 |
| Page of 20 by `id` | 8 | refused | 86 | 62 |
| Page of 20 by `created_at` | 8 | refused | not run | 64 |
| `q` search | 1 | refused | 57 | unchanged path |

## Remaining limits

On write-mode requests totals and `q` still read every matching row, so catalogs above 2,048 active rows
are refused there. Read-only operations hand both to PostgreSQL through the snapshot pushdown.

The limits in the next paragraph now apply to write-mode requests and to reads the
[snapshot pushdown](./native-snapshot-read-pushdown.md) leaves on the examined page. On read-only operations a plain
list page is served by that slice's page form: soft-deleted rows ahead of the page are walked in PostgreSQL, not
captured, and a deep `skip` is bounded by the fixed Source read limit of 32,000 live rows, not by 2,033.

A page examines soft-deleted rows as residuals, where complete capture anchors on
active rows. More than 2,048 soft-deleted rows ahead of a page can therefore refuse
a plain list that complete capture would have served. A `deleted_at`-prefixed ordered
index would remove this and is not selected. Only read-only hosts select pages, and
`skip` is admitted up to the same budget. Each incomplete 128-row window also charges
its one re-read row, so a deep `skip` refuses at about 2,033 rows. Neither 2,048-row
heap nor CPU is measured.
