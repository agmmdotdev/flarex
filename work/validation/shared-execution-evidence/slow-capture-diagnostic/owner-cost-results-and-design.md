# OCC, materialization, publication and remaining client attribution

Recorded campaign status, before the ongoing OCC correction: diagnostic and
proposed design only. This campaign changed no runtime sources or durable
settings and established no complete performance improvement. The
[current cost inventory](../../../../packages/medusa-adapter/benchmarks/core-performance/native-business/cost-inventory-proposal.md)
owns the active implementation status. Complete performance acceptance remains
unmet; the updated measurements below retain their original cohort boundaries.

## Updated measurement interpretation

The [correlated pricing follow-up](../price-wait-investigation/correlated-results.md)
supersedes the wait attribution, not this campaign's retained values. Historical
172.1902 ms is a single pricing driver wait, not added CPU, and remains unresolved.
Eight fresh source-stable full diagnostics measure pricing median 2.6064 ms,
maximum 13.2492 ms. Seven other capture waits take 192.4477-728.0731 ms with
PostgreSQL IO/WalWrite observations and advancing client/independent heartbeats.
Logged Parse/Bind/Execute times omit implicit transaction completion at Sync;
their difference from the client await can include server WAL I/O. Do not
reclassify that difference as client CPU or solely transport time.

The pre-OCC mixed added thread CPU is **125 ms median**, with quiet native/Flarex
medians **34.76/252.58 ms**, paired added median/P95 **219.55/251.80 ms**, in
[metadata-key results](../metadata-key-reuse/results.md). The newer
[fixed OCC campaign](../occ-vector/results.md) measures **109 ms median added
thread CPU**, quiet native/Flarex **42.04/276.83 ms**, and paired added median/P95
**234.15/349.75 ms**. Complete performance acceptance remains failed; the OCC
implementation is uncommitted. These are separate cohorts, and the approximately
one Windows-counter-tick CPU difference does not establish causal savings.
The [paired client CPU investigation](../cpu-excess-investigation/results.md)
locates the largest CPU phase in business execution, followed by publication and
admission; it retains diagnostic/source boundaries and establishes no large safe
removable CPU block. Reclassifying waits changes no CPU counter. Logging-off/
partial pricing follow-ups retain their failed source-stability/setup gates.

## Campaign and measurement limits

- `owner-server`: three observed complete mixed workflows after warmup and
  calibration, ordinary-role isolated PostgreSQL databases. Nested statistics,
  source/settings stability and cleanup gates passed. No SQL parameters or setup
  statements were published; retained delta templates have literals removed.
- `owner-client`: five profiled complete mixed workflows, with five quiet observer
  pairs and three warmups. Numeric whole-owner spans, driver boundaries and
  authored Effect factory calls were retained. Every business request and SDK
  source/settings/cleanup gate passed. Paired observer elapsed median +9.436 ms;
  range -48.136 to +19.684 ms. Do not subtract this from individual requests.
- `owner-compiler`: twenty complete workflows after three warmups, ten numeric
  observer-on and ten observer-off roots, alternating order. All requests and SDK
  gates passed. Paired observer elapsed median +7.127 ms, range -2.680 to +32.610 ms.
  The Effect namespace facade remained installed in both lanes; this is calibration,
  not quiet native performance acceptance. The initial package-import failure was
  before test execution and is retained in `owner-compiler-init-failure.log`.
- `owner-plans`: all three business roots succeeded, but the SDK diagnostic was
  **incomplete**, failing its unchanged 8 MiB `logByteLimit`. The observed request's
  existing 20,263,734-byte window was parsed separately with a declared 24 MiB window
  cap, 512 KiB per-plan cap and fewer than 10,000 headers. This yielded 2,495 plan
  records; it does not make the SDK lane complete or prove asynchronous log flushing
  captured every record. Auto-explain inflated latency substantially. Use those
  plans for witnessed call chains/row counts, not normal timing or savings.

These are separate cohorts. Do not subtract a server-stage median from a client
median to estimate transport. Server durations are elapsed execution/planning,
not server CPU. Parent function durations include children. Whole client spans
include required work and instrumentation. Medians of partitions need not sum.

## Exact statement inventory and costs

Each workflow retains 60 actual driver exchanges, 41 checkouts and all 38 distinct
or fresh captures. PostgreSQL reports 63 `toplevel` executions and 2,438 nested
executions. The extra three top-level-classified statements are the deferred
`fx_check_scope_execution_authority` trigger's two locking reads and pair-integrity
read, witnessed at the end of the plan window and installed by migration 0126.
They are not three extra driver calls. Nested executions include PL/pgSQL
expressions as well as storage SQL; neither count measures network round trips.

| Stage | Calls | PostgreSQL execution, three roots ms | PostgreSQL planning, three roots ms |
| --- | ---: | --- | --- |
| Current-index OCC query | 1 | 0.238 / 0.251 / 0.259 | 5.229 / 5.398 / 5.648 |
| Application acceptance | 1 | 5.046 / 5.255 / 5.404 | 0.226 / 0.221 / 0.359 |
| Application materialization | 1 | 19.047 / 18.764 / 20.499 | 0.198 / 0.244 / 0.208 |
| Durable publication prefix | 1 | 6.185 / 5.361 / 5.211 | 0.021 / 0.018 / 0.026 |

Within the same five client roots, child driver awaits can be removed from each
whole owner envelope. This separates awaited time from the remaining elapsed
envelope; the latter is **not exclusive CPU**.

| Complete owner | Whole median ms | Child-await median ms | Median per-root elapsed outside those awaits ms |
| --- | ---: | ---: | ---: |
| OCC contribution validation, including metadata | 15.832 | 10.257 | 5.612 |
| Application acceptance | 14.398 | 6.896 | 7.355 |
| Application materialization, including fresh binding reads | 31.662 | 24.531 | 7.351 |
| All 38 captures | 68.543 | 52.942 | 15.615 |

The OCC query has **43,712 characters, 156 bound parameters, 26 copies of the range
query and 25 UNION ALL joins**. This is one already-batched driver request, not
26 redundant range observations. Actual synchronous dialect rendering medians:
OCC 0.409 ms, acceptance 0.612 ms, materialization 0.867 ms, prefix 0.020 ms,
16 other render calls 1.144 ms. Entire rendering median: **3.051 ms**. SQL tree
construction and downstream decoding are outside this particular rendering timer.

Materialization executes 9 row-revision inserts, 7 current-row inserts and
2 current-row updates; 42 index-revision inserts, 39 current-index inserts and
3 current-index deletes; 10 unique claims and 2 releases; 3 search inserts,
3 search deletes and 3 search-build updates. These are distinct persisted effects
of nine document revisions across their indexes, uniqueness and search contracts.
Nested index-revision inserts account for 3.44–4.12 ms and current-index inserts
2.49–2.60 ms in the server-statistics cohort; these intervals overlap the outer
materialization and their triggers. They are not removable CPU estimates.

Across the whole workflow, nested statistics show 120 explicit installation-lock
calls, 252 installation-row locking reads, 159 build-state reads and 100 maintenance
obligation reads. Additional DML guards contribute to the 252. Parent lock durations
overlap their reads/advisory locks. All 159 build reads total 0.445–0.465 ms; the
100 maintenance reads total about 0.96–1.00 ms. Repetition is not permission to cache
authorization or readiness across statements/transactions.

The prefix has one header insert, one family append for 9 row facts, one for
7 events, one for 7 deliveries, one outcome insert, one wake insert and one session
completion update. Its final stored proof remains necessary: later-family triggers
can mutate an earlier stored family. No duplicate facts or removable family write
has been established.

## Remaining client CPU: what is and is not proved

The earlier observer-free matched five-pair cohort is the pre-OCC CPU comparison:
native median 31 ms, Flarex median 156 ms, paired added median **125 ms**, with
roughly 16 ms Windows counter resolution. The historical pricing **172.1902 ms**
is one driver-await duration, not added CPU; it did not recur in the prior
100-workflow campaign and its original cause remains unresolved.

The new client lane counts **2,550 authored Effect factory invocations** per root,
including 1,792 `fnUntraced` calls. Complete factory-construction elapsed median
is **10.528 ms**, including observer cost and required construction; the untraced
subset is about 2.587 ms. Factory construction is not the cost of interpreting
the resulting effects. Rendering and these timers overlap larger owners and
cannot be added as an exclusive CPU partition or treated as savings.

Clock landmarks outside the request/counter windows tighten profile alignment
to a 0.299 ms interval under a constant clock-offset assumption across this short
process. Only the first profile retained distinct landmark frames; all profiles'
command brackets constrain the interval. This does not align PostgreSQL clocks.
Many short owner/driver boundaries still leave **53.167 ms median active sample
spacing phase-ambiguous**. Stable location weights include 54.055 ms in the broad
entry/business/finalization envelope, 7.083 ms in materialization, 6.150 ms in
acceptance and 4.626 ms in OCC. These are sampled elapsed weights, not exclusive
CPU, native-subtracted excess or removable work. See `owner-client-breakdown.json`.

Current code already compiles commerce decoders once, reuses authentic private
JSON children and immutable metadata keys, and preserves required foreign input
and result interpretation. The Medusa Promise owner is the actual framework ABI
boundary; cancellation, sticky refusal, runner joining and closure cannot be
removed because Effect/Promise frames appear in a profile. **No large remaining
client CPU removal is yet proved.** In particular, a broad Effect/Result rewrite,
another canonical cache or a SQL-rendering rewrite is unsupported as a remedy for
125 ms excess. Any future CPU experiment must test a concrete repeated operation
inside the 54 ms broad envelope, with caller/identity evidence and unchanged
lifetimes, rather than assign async library samples to invented callers.

## Concrete removal design for discussion

**Replace the repeated OCC query structure at the existing current-index reader.**
Keep all 26 exact demand validations and their current transaction snapshot. The
removable work is the 26 SQL copies, repeated expression construction and dynamic
whole-query planning structure, not the semantic range checks or any of the 38
captures. The observed 5.2–5.6 ms planning cost establishes a target envelope;
actual savings and plan reuse still require the candidate measurement.

1. Keep ordered input decoding and scope resolution at
   `consumeCurrentAppIndexPagesInTransactionEffect`. Prepare the same successful
   prefix before a later preparation failure. Preserve the current maximum
   32 demands and 262,144-byte projected-output bound.
2. Pack the already-validated per-demand index ID, exact start/end bounds,
   key/row cursor, limit and ordinal into bounded typed vectors. Use one static
   ordinal/lateral range statement with the existing current-pointer/latest-revision
   membership join. Scope and identifiers remain trusted owner inputs; no foreign
   SQL, caller-authored reusable evidence, result cache or new authority.
3. Retain one empty-page sentinel per ordinal, exact key/row sorting, limit+1,
   absence and membership checks. Keep envelope validation and ordered body
   decoding/consumer refusal exactly where they are. An earlier conflict must
   still win before a later input/body error.
4. Reuse the actual statement shape on its physical session. Prove planning
   reuse and index access with the actual parameter distribution; a prepared
   name alone is insufficient. Keep first-use setup visible. Do not force a
   global planner setting, retain sessions across untrusted work, or change
   host/pool ownership. Prefer the existing statement owner over a new registry
   or an installed SQL capability unless a measured plan requires that contract.
5. Migrate the current batch reader's consumers and remove the repeated-UNION
   builder in the same eventual slice. Single-range readers need no speculative
   API change. No durable rows/formats need deletion for a statement replacement.

This is a **bounded planning correction**, not a complete performance solution.
Do not represent it as a 125 ms CPU remedy or start a broader cutover from these
measurements. Runtime implementation remains pending user discussion.

**Retain materialization write barriers and publication proofs.**
`verifySamePageReturningOrder` corrupts the first row/index's returned tuple and
raises a different error on the next row. Immediate RETURNING validation must win
before the later trigger executes; the transaction must become unusable and roll
back. A bulk multi-row INSERT followed by one aggregate check changes that winner.
Likewise, prior-page/AFTER-trigger proofs catch later changes to earlier writes.
Removing those checks or guarded writes is outside the accepted failure contract.

Build-state reads repeated inside the same apply statement before physical DML
are a possible small follow-up at the existing transition acceptor. Reads across
accept/apply remain fresh. Any local reuse must preserve the earlier acceptance
and later transition refusal order and cannot trust a caller-supplied tuple or
GUC to bypass the raw SQL helper's authority checks. The entire 159-read family
costs less than half a millisecond here; this is not the next CPU deliverable.

Required eventual OCC correction gates: malformed later input/envelope/body and
earlier consumer refusal; empty, bounded, cursor and duplicate-ordinal cases;
exact dependency/pending-overlay behavior; rollback and concurrent insert/delete,
metadata/binding/expiry/revocation changes; affected PGlite and ordinary-role
PostgreSQL consumers; both reviewers and removal of the displaced batch builder;
then complete matched five-graph CPU and quiet latency measurements. Retain
added median CPU <=16 ms and paired added median/P95 latency <=5/10 ms. There is
no candidate yet, so those implementation proofs were not rerun.

## Reproducibility and disposition

The ignored configs/tests/facade and analyzers are in this directory. SDK raw and
human reports plus request ledgers are retained in `owner-server`, `owner-client`,
`owner-compiler` and `owner-plans`; summaries are `owner-server-breakdown.json`,
`owner-client-breakdown.json`, `owner-client-wall-breakdown.json` and
`owner-compiler-breakdown.json`. Failed initialization and plan-cap logs remain
retained. No failed business sample was silently replaced. Server log contains
setup SQL and must not be published; only sanitized request-window summaries
are evidence exports. The owned PostgreSQL fixture is stopped at handoff.
