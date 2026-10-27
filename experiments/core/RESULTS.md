# Initial connected results

The latest [bounded observation composition](./COMBINED-OBSERVATIONS.md) reduces
CRUD/Product/mixed exchanges to **77/33/53**, with 357 correctness cases passing.
Matched added median/P95 becomes **23.974/29.746**, **5.627/8.210** and
**6.072/9.592 ms**. Every median allowance remains missed; Product/mixed pass
the P95 allowance. Indexed 64-row edits regress, so performance promotion stays
closed. Current native adapters remain unchanged.

The earlier [compiled-plan iteration](./OBSERVATION-COSTS.md) improves matched quiet
added median/P95 latency to **25.668/31.828 ms** for Payload CRUD,
**5.859/9.033 ms** for Product and **6.714/10.707 ms** for mixed. All 338 distinct
checks pass, but every added-median target remains missed and contention gains
are mixed. This supports retaining bounded plan reuse, not performance promotion.

The subsequent [combined read-guard iteration](./READ-OBSERVATIONS.md) lowers
CRUD/Product/mixed exchanges to 88/37/59, but added median latency rises to
35.471/9.777/12.222 ms in its later cohort. It passes correctness and source checks;
no latency win or promotion is accepted. The sections below retain the initial
cohort measurements and decision, with current follow-up guidance.

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

## Batch and contention diagnostics

The corrected ordinary-role PostgreSQL cohort passed complete SDK results,
committed readback, pending-range membership, source stability and cleanup.
Each batch cell has five warmups and five measured commands. SQL observation
runs separately afterward. At five samples P95 is the maximum, so these tails
are diagnostic; every sample and outlier is retained, with no proven outlier cause.

| Command | Rows | Median / P95 ms | pg exchanges |
| --- | --- | --- | --- |
| Insert | 1 / 16 / 64 | 11.619 / 12.636; 42.065 / 191.473; 172.862 / 283.825 | 31 / 121 / **409** |
| Insert, edit, delete and query pending range | 1 / 16 / 64 | 14.173 / 15.084; 54.332 / 201.177; 188.262 / 662.111 | 43 / 188 / **656** |
| Indexed priority edit | 1 / 16 / 64 | 8.972 / 9.513; 36.462 / 38.771; 120.408 / 122.969 | 34 / 124 / **412** |
| Unindexed, nonunique note edit | 1 / 16 / 64 | 8.251 / 8.498; 35.263 / 36.672; 120.992 / 215.571 | 34 / 124 / **412** |

Insert exchanges follow `25 + 6N` at these sizes; both edit controls follow
`28 + 6N`. This establishes repeated database work per row in this profile,
not overall CPU complexity. Equal edit counts do not establish equal index
maintenance, WAL or server cost. Adding 64 unrelated definitions and 256 retained
unrelated rows left the selective one-row command at 31 exchanges; it does not
prove constant physical scan work.

The 409 exchanges belong to one standalone Application mutation inserting 64
documents, not a Medusa workflow or 409 document writes. Its recorded trace has
64 historical point reads and 67 short transactions. Each extra document adds
one point observation with BEGIN, authority, definition, expiry, history-read and
COMMIT exchanges in this initial cohort. Final materialization already batches
history, documents, unique claims, index entries and event intents across rows;
the trace contains one INSERT for each of those physical families.

Investigate the repeated per-row observations and their protection/transaction
cost before proposing write batching. The counts identify an execution pattern,
not its exclusive latency cost or permission to remove checks. Any replacement
must preserve exact absence/conflict evidence, fresh authority and failure order.
These initial counts do not describe a later implementation without remeasurement.

Each contention cell runs 128 independent one-row Application mutations through
a shared pool with maximum four connections. Automatic retries are disabled.
All 768 commands succeeded on their first attempt, and committed documents were
verified. Successful-request throughput and complete-request latency follow.

| Concurrency | Scope distribution | Requests / second | Median / P95 ms |
| --- | --- | --- | --- |
| 1 | One scope | 128.013 | 7.586 / 8.918 |
| 1 | One distinct scope | 129.676 | 7.553 / 8.747 |
| 4 | One scope | **179.739** | 18.841 / **24.554** |
| 4 | Four scopes | **217.224** | 17.654 / **24.890** |
| 8 | One scope | 209.947 | 36.791 / 42.812 |
| 8 | Eight scopes | 229.748 | 34.828 / 36.346 |

Both concurrency-four cells pass the predeclared local diagnostic target of
100 successful requests/second, P95 below 100 ms and no failures. This is not a
capacity or production SLO proof. Distribution across scopes improved throughput
in this cohort; exact scope-lock wait, pool contention, Node CPU and scheduling
costs are not isolated. The one-scope concurrency-four maximum was 169.474 ms,
which the P95 alone does not expose.

## Initial decision and next slice

Keep separate Application/framework profiles, immutable definitions, indexed
pending state, native business behavior, short physical lifetimes and one trusted
accepting owner. Connected failure tests protect cleanup, conflicts, revocation,
cancellation/drain, replay and uncertain-outcome recovery.

The requested initial assessment is complete: **keep the ownership design,
change database execution granularity, and reject promotion of the current
implementation.** Correct native connections and a passing bounded contention
target do not compensate for missed complete-request latency goals or per-row
database chatter. The active core remains unmeasured and unchanged by this work.

Change complete storage-operation granularity at the persistence/session owner.
Fresh authorization and definition protection remain required; separate client
round trips for each gate, token/state check, expiry check and data query are an
implementation choice. The combined read-guard iteration now collapses the
pre-read protection queries while retaining a separate data statement for fresh
visibility after lock waits. It does not establish a local latency improvement.
Further operation changes must preserve exact snapshots, fresh gates,
retention/expiry checks and selected-definition locks, and remeasure the complete
native requests. Attribute remaining client construction, server execution and
transaction costs before choosing the next change. Do not fix this in
adapters, hold a transaction across callbacks, remove checks speculatively or
merge Application OCC into a universal framework transaction API.

Accepting changes need their own concurrency proof. Combining clock-lock
acquisition and validation into one SQL statement can retain a statement snapshot
from before a lock wait; preserve visibility of the writer waited behind and the
existing lock order. Do not infer safe acceptance batching from read batching.

General Application queries/reactivity, populated Product relations, the five
full business graphs, replacement proof and private Worker/Hyperdrive behavior
remain open before promotion. Source-level hypotheses are not measured complexity
or capacity.

## Evidence

- [Quiet samples](./validation/connected-latency.json),
  [separate CPU samples](./validation/connected-cpu.json) and
  [SQL observation](./validation/connected-sql.json).
- [Corrected batch/contention samples](./validation/scaling.json),
  [scaling validation](./validation/scaling-validation.json) and
  [PGlite corpus/reporter regressions](./validation/scaling-corpus.json).
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
- The [initial rejected scaling run](./validation/scaling-initial-rejected.json)
  retains a missing seed timestamp failure and a wrongly indexed edit control.
  The corrected fixture supplies required timestamps, edits an actual unindexed
  field, and reruns the complete cohort. It does not weaken the decoder.

The active baseline's last preparation failure remains in
[payload-create-failure.json](./validation/payload-create-failure.json). Its owner
is the active framework migration stored-plan/canonical verification path. No
active owner was changed or bypassed for this experiment.
