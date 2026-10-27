# Combined read and observation guards

Status: implemented, validated and measured. Database exchanges decrease, but
the later local cohort has worse added latency. No latency improvement or
performance promotion is accepted. Framework bridges remain unchanged.

## Hypothesis and operation shape

A framework observation previously issued separate authority, selected-definition,
command-state and expiry queries before its data query. An Application snapshot
observation issued authority, definition and expiry queries. The implementation
combines each guard into one Drizzle-built statement, followed by the existing
data query in the same short physical transaction. Standalone framework reads
combine authority and selected definitions without a mutation reservation.

| Guard | Previous statements | Combined statements |
| --- | --- | --- |
| Framework command observation | 4 | 1 |
| Application snapshot observation/check | 3 | 1 |
| Standalone framework read | 2 | 1 |

[persistence.ts](./src/persistence.ts) owns the shared query builders and command
validator. [storage.ts](./src/storage.ts) and
[equality-storage.ts](./src/equality-storage.ts) consume the combined read guards.
The former guard sequence remains only where accepting/reservation/recovery
contracts still require it; there is no displaced read fallback.

Row-locking CTEs retain their materialization boundary. Definition locking depends
on the authority row and drains all selected rows in table order. Command locking
depends on the complete selected-definition count. The database-clock projection
consumes the locked command row; snapshot time checks consume the selected-row
count. No cached object or statement-start timestamp replaces a fresh verdict.

The data query remains a separate statement: it must receive a fresh READ COMMITTED
snapshot after a guard lock wait. In particular, a current framework predecessor
changed or deleted while the guard waits must still cause a conflict. Historical
Application/equality reads retain their original exact sequence and dependencies.

## Preserved obligations

- Actual serving-role grant, enabled installation/scope and authority fence.
- Every selected table/version, including multi-table participants; unrelated
  definitions do not invalidate a root.
- WeakMap-issued command identity, token, scope, request, snapshot, profile,
  selected definitions, fence, active status and non-extended lease.
- Retention floor and database deadline after relevant lock waits, preserving
  denied/closed/expired ordering.
- Existing body/row/work limits, exact historical membership, write predecessors,
  unique and predicate evidence, rollback-only state, draining and cancellation.

Accepting clock locks, post-clock expiry/dependency queries, materialization,
recovery and publication are unchanged. No schema, durable data or native behavior
change is required. There is no compatibility or fallback execution path.
Initial command reservation and standalone snapshot opening remain separate
operations; this slice changes subsequent read guards.

## Proof and measurement

Owner/consumer regressions passed 319 distinct cases: 144 on PGlite, 157 on
ordinary-role PostgreSQL and 18 unit/corpus cases. The final five PostgreSQL
expiry witnesses passed again after review strengthened their live-lease
assertions. They observe actual lock waits, require a 100 ms live margin, then
cross database time before releasing the lock. Snapshot leases age outside
transactions. Definition retirement, concurrent accepted update/delete visibility
and native Product's observed-sequence race also pass. See the
[validation receipt](./validation/combined-read-validation.json) for exact scope,
expected skips and the assertion-strengthening rerun.

The same complete Payload, Product and mixed requests ran in separate quiet
latency, CPU and SQL processes. Latency/CPU use five warmups and thirty alternating
pairs per workload; SQL uses five warmups and two diagnostic pairs. All results,
readbacks, ordinary-role PostgreSQL 18.3 durability settings, source stability,
observer completeness and resource cleanup checks passed. The coordinated window
froze included runtime/configuration/test sources and heavy work; only excluded
Medusa tests, standalone source guards and Markdown edits were allowed.

## Results and disposition

Milliseconds. Added percentiles are calculated from paired differences. The
previous cohort remains intact; these are later measurements with their own
native controls, rather than interleaved old/new implementations.

| Request | Previous → combined pg exchanges | Previous added median / P95 | Combined reference median / P95 | Combined candidate median / P95 | Combined added median / P95 |
| --- | --- | --- | --- | --- | --- |
| Payload CRUD | **104 → 88** | 28.201 / 31.917 | 4.697 / 6.515 | 41.031 / 46.667 | **35.471 / 41.419** |
| Product | **46 → 37** | 7.776 / 9.974 | 10.516 / 11.894 | 20.681 / 25.274 | **9.777 / 13.289** |
| Mixed | **79 → 59** | 10.580 / 14.233 | 24.528 / 29.793 | 37.758 / 41.837 | **12.222 / 18.869** |

Both SQL diagnostic pairs agree. Command guards execute 5/3/4 times for
CRUD/Product/mixed; standalone-read or snapshot guards execute 1/0/4 times.
Checkouts and explicit transactions remain 12/5/10. Native Payload still uses
15 exchanges and native Product still submits 10 Knex queries (different metric).
The reference Application mutation now uses 27 exchanges, down from 31, because
it deliberately uses the same standalone candidate Application implementation.

One representative candidate result transfers 42/13/30 returned rows and
6639/2818/6061 decoded JSON bytes. These include control rows; they are not wire
bytes, document counts or exclusive server work. Exact server CPU, planning,
WAL and lock-wait attribution remain unavailable.

Added root-thread CPU median/P95 is 16/47 ms for CRUD, 1/31 ms for Product and
15/47 ms for mixed. Windows counters resolve approximately 15–16 ms. These data
do not establish a CPU saving or an exclusive cause. All outliers are retained,
including the CPU run's 242.996 ms native CRUD request and 125.921 ms candidate
Product request; their causes are unproven.

Every request misses both inherited added-latency allowances (5 ms median,
10 ms P95). Native reference medians also increased between cohorts. The
[comparison receipt](./validation/combined-read-comparison.json) lists all sixteen
source-path differences; Node and installed/compiled native dependency bytes are
unchanged in those inventories. This still does not isolate query construction,
server planning/execution, host scheduling or another exclusive cause.

Retain the safe combined guard as a measured experimental implementation and
reject the hypothesis that fewer exchanges alone establish a local latency win.
Keep performance promotion closed. The later [attribution and compiled-plan
slice](./OBSERVATION-COSTS.md) now measures client construction and observable
waits, reuses immutable Drizzle plans, and improves quiet latency while still
missing the complete-request median goal. Exact server planning/CPU and lock
attribution remain unresolved. No active-core speedup, native
atomic mixed equivalence, five-full-graph acceptance or hosted capacity follows.

Raw evidence: [latency](./validation/combined-read-latency.json),
[CPU](./validation/combined-read-cpu.json), [SQL](./validation/combined-read-sql.json)
and [validation](./validation/combined-read-validation.json). Their digest-named
source inventories preserve the exact executing bytes. Use
`FLAREX_EXPERIMENT_MEASURE_LABEL=combined-read` to reproduce distinct report names.

The PostgreSQL 18 [planner source](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/optimizer/plan/subselect.c)
excludes row-marked SELECT CTEs from inlining. Its [READ COMMITTED contract](https://www.postgresql.org/docs/18/transaction-iso.html)
explains why the following data statement keeps a fresh snapshot after waiting.
Executing database witnesses, rather than these references alone, establish the
bounded candidate's behavior.
