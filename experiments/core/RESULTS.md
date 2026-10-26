# Initial connected results

Decision: **retain modular ownership and native integrations, change the database
execution plan, and reject this implementation as ready for promotion.** The
first complete-request cohort misses the inherited added-latency goals. It does
not establish an improvement over the unmeasured active core.

## Measured profile

[MEASUREMENT.md](./MEASUREMENT.md) defines the actual business calls. These are
relation-free Product flows and bounded Payload CRUD with deletion of another
existing document and two actual user preferences. Mixed includes the same
authored Application function as its independently committed reference; that
reference uses a standalone candidate Application host because native frameworks
have no equivalent Application SDK implementation.

Native independent commits and mock event-bus delivery differ from candidate
atomic publication, history, dependencies and durable event intents/outcomes.
This is a business-cost reference, not equivalent native mixed semantics. No
active-core speedup, populated Product graph, deployment or all-five-graph
acceptance is claimed.

Five warmups and thirty alternating measured pairs per workload ran in a quiet
coordinated window, with separate latency and CPU processes. Complete results,
committed readbacks, native preference deletion, restricted-role/durability,
source-stability and checkout checks passed. PostgreSQL was 18.3 with `fsync`,
`synchronous_commit` and `full_page_writes` enabled. Installation, seeding,
comparison normalization, verification and cleanup are outside request timers.
Harness preparation includes disposable installation and conservative source
inventory; it is not a production cold-request measurement.

## Quiet complete-request latency

Milliseconds. Added values are percentiles of paired differences.

| Request | Reference median / P95 | Candidate median / P95 | Paired added median / P95 |
| --- | --- | --- | --- |
| Payload CRUD | 4.329 / 4.799 | 32.849 / 35.977 | **28.201 / 31.917** |
| Product update/retrieve/list | 9.474 / 11.322 | 17.257 / 19.610 | **7.776 / 9.974** |
| Atomic mixed vs independent reference | 21.942 / 26.218 | 32.531 / 36.998 | **10.580 / 14.233** |

The inherited allowance is 5 ms added median and 10 ms added P95. Every row misses
the median allowance; CRUD and mixed also miss P95. These smaller graphs cannot
establish acceptance of the five full existing graphs. Mixed additionally retains
the semantic differences above.

## Separate CPU and SQL diagnostics

Paired added root-thread CPU median/P95 was 16/32 ms for CRUD, 1/16 ms for Product
and 1/32 ms for mixed. Windows counter increments are approximately 15–16 ms;
near-zero differences are unresolved at that resolution. No precise CPU saving
or all-workload CPU acceptance follows. Every sample, including large outliers
in the CPU process, is retained; their cause is unproven.

SQL used five warmups and two diagnostic pairs outside the quiet cohorts. Both
pairs produced these counts. Native Product reports Knex submitted queries,
which are not independently observed pg driver exchanges.

| Request | Candidate pg exchanges / checkouts / explicit transactions | Native Payload pg exchanges / checkouts / explicit transactions | Native Product Knex queries | Reference Application pg exchanges |
| --- | --- | --- | --- | --- |
| Payload CRUD | **104 / 12 / 12** | 15 / 4 / 3 | 0 | 0 |
| Product | **46 / 5 / 5** | 0 | 10 | 0 |
| Mixed | **79 / 10 / 10** | 15 / 4 / 3 | 10 | 31 |

Authority gates and selected-definition queries occur 12/5/10 times for
CRUD/Product/mixed; separate expiry queries occur 8/4/9 times. Begin/commit
account for 24/10/20 exchanges. This identifies the database interaction shape;
it does not prove which checks can be removed or the latency a different plan
would save.

One representative candidate sample returned 60/22/74 rows and
7218/3040/8318 decoded JSON bytes for CRUD/Product/mixed, including control-plane
rows. These are not document counts, wire bytes, allocations or exclusive server
work. Raw records retain statements and client-observed transaction intervals.
Exact serialized-lock hold/wait, WAL attribution and exclusive server CPU remain
unavailable. Combined harness peak memory includes both lanes, bootstrap and
source inventory; it cannot establish per-lane request memory.

## Keep and change

Keep separate Application/framework profiles, immutable definitions, indexed
pending state, native business behavior, short physical lifetimes and one trusted
accepting owner. Connected failure tests protect cleanup, conflicts, revocation,
cancellation/drain, replay and uncertain-outcome recovery.

Change complete storage-operation granularity at the persistence/session owner.
Fresh authorization and definition protection remain required; separate client
round trips for each gate, token/state check, expiry check and data query are an
implementation choice. Investigate a Drizzle-generated database-local operation
returning the required authority and data evidence together. Do not fix this in
adapters, hold a transaction across callbacks, remove checks speculatively or
merge Application OCC into a universal framework transaction API.

Batch growth, indexed/nonindexed updates, unrelated retained state and
same/different-scope contention diagnostics remain open before the goal's final
assessment. Source-level hypotheses are not measured complexity or capacity.

## Evidence

- [Quiet samples](./validation/connected-latency.json),
  [separate CPU samples](./validation/connected-cpu.json) and
  [SQL observation](./validation/connected-sql.json).
- Receipts reference complete digest-named source inventories: candidate files,
  installed SQL/configuration, installed dependency closures, compiled native
  modules and the executing Node binary. Sources are checked before preparation,
  after warmup and after requests.
- Earlier manifest-resolution and invalid-warmup-handle failures remain in
  `validation/connected-smoke-manifest-failure.json` and
  `validation/connected-sql-handle-failure.json`, with test output. The latter's
  original wrapper-only projection is incomplete; its test output preserves the
  actual invalid handle. Descriptor-safe nested-cause capture and regression
  witnesses now protect subsequent reports.

The active baseline's last preparation failure remains in
[payload-create-failure.json](./validation/payload-create-failure.json). Its owner
is the active framework migration stored-plan/canonical verification path. No
active owner was changed or bypassed for this experiment.
