# Retained settlement and ordered stored proofs

This connected cutover removes finite final-document recanonicalization and
replaces per-tuple stored row/index proof queries at their existing page
barriers. Complete native-relative performance acceptance still fails. The
[focused contract](../../../../../../roadmaps/mixed-mutation-core/24-whole-mutation-redesign-preflight.md#selected-retained-settlement-and-ordered-stored-proofs)
owns its boundaries and the remaining redesign gates.

The private finite root now issues a closed transfer bound to its actual
evaluator and attempt. Freeze adopts one detached canonical graph and derives
prepared row intents from it. Publication borrows those complete codec values
after genuine origin and dependency checks. Validator and public inspection
projections detach their values; ordinary foreign commands retain canonical
acceptance. The displaced raw intent copy and finite final-row recoding are
removed. Actual publication tests spy on the codec after freeze and verify
committed readback without recoding the final documents.

Installed row/index writers retain sequential predecessor, revision RETURNING,
pointer and page barriers. One later ordered joined proof checks complete
Drizzle-owned revision tuples and current pointers, including actual AFTER
trigger effects on earlier pages. For 512 rows in 32-row pages, source topology
changes from 1,984 proof SELECTs to 16 queries over the same 992 expected tuples.
These are internal proof queries, not removed client exchanges or a measured
512-row latency result. Other proof families retain their actual owners.

## Complete quiet comparison

Both runs use the existing measurement SDK's `compare` with the small
`mixed-product` graph, five warmups per lane and 30 fresh alternating matched
pairs. They verify actual committed Application insert/patch and native Product
update/retrieve/indexed lookup. Setup, seed, verification and cleanup are outside
request timers; actual Flarex finalization remains inside its call. No CPU, SQL,
timeline or server collectors are bound in either comparison.

| Complete call | Held predecessor median / P95 ms | Final runtime median / P95 ms |
| --- | ---: | ---: |
| Native business reference | 11.5022 / 15.0422 | 10.6645 / 13.1717 |
| Flarex | 168.3989 / 199.7439 | 162.8821 / 187.2933 |
| Actual per-pair added latency | 155.5486 / 181.8260 | 152.0179 / 177.6848 |
| Maximum accepted added latency | 5 / 10 | 5 / 10 |

Execution, source/settings stability, cleanup, sampling and committed-result
gates pass in each run. Both added-latency gates fail. The observed 3.5307 ms
reduction in added median does not establish a causal speedup: the independent
native control is faster too, and these are two separate runs. This slice does
not explain or eliminate the remaining approximately 152 ms added median.
Paired percentiles use actual pair differences, not subtraction of lane
percentiles.

- Held predecessor: [report](4e284633-966d-4ac6-8514-6bc406566105.md), [raw JSON](4e284633-966d-4ac6-8514-6bc406566105.json.gz). Clean baseline `85a0b09a4013452442777ee296ebc7710ea17c2f`; stable source digest `1a96027a2120306f8afb4ae4ead1d3b6fec9ef61f5d6c7b27b07edb5257e3919`.
- Final runtime: [report](32fc88b2-e78f-4591-9915-bedbf3e3ac57.md), [raw JSON](32fc88b2-e78f-4591-9915-bedbf3e3ac57.json.gz). The owned runtime diff was present; stable source digest `302419a71697ff9d02f3a4ad009b40173ee7d370fc78b14d1ea29f612812bf41`.

Both source inventories contain 6,561 files. Reports retain the actual dirty
state and their source fingerprints; they preceded this scoped commit. Local
PostgreSQL 18.3 uses ordinary execution roles, with synchronous commit, fsync and
full-page writes enabled. Native framework calls commit independently and the
Application reference uses a SQL surrogate. They do not reproduce Flarex atomic
publication, OCC, revision history or durable outcomes. The excess includes
required semantics and avoidable implementation cost whose exact shares remain
unresolved. Stable tails, numerical metadata scaling, cold capacity, other
graphs and production Cloudflare behavior remain separate gates.

## CPU attribution without SQL and timeline observers

[CPU summary](cpu-summary.json) and three complete sanitized raw exports
([sample 0](cpu-sample-0.json.gz), [sample 1](cpu-sample-1.json.gz),
[sample 2](cpu-sample-2.json.gz)) retain the existing SDK collector and analysis
for actual call windows. Five real requests warm the same scenario; three fresh
requests are profiled separately and their committed results verified afterward.
The real scenario factory leaves SQL trace and Effect diagnostic bindings
undefined, and spies on both exposed setters record zero calls. No structural
SQL observer appears in the retained CPU/allocation frames or definite CPU
sample ancestry. CPU/allocation profiling still adds instrumentation. These
samples are attribution evidence, not quiet latency acceptance or an
observer-cost subtraction.

| CPU diagnostic | Complete call ms | Thread CPU ms | Event-loop idle ms | GC call overlap ms |
| --- | ---: | ---: | ---: | ---: |
| Sample 0 | 199.931 | 140 | 75.919 | 5.604 |
| Sample 1 | 202.148 | 110 | 70.230 | 1.662 |
| Sample 2 | 188.867 | 110 | 67.633 | 1.975 |

Thread counters show material CPU activity while event-loop counters show
material waiting. These measures overlap; they are not additive causal phases.
Their instrumentation and windows prevent assigning them directly to the quiet
152 ms excess. Process CPU is 156/140/110 ms and includes other process threads.
The largest individual sampled frame is idle; authored CPU work is spread across
acceptance, projection, indexing, codecs and their Effect/Schema composition.
No individual function is established as the dominant quiet bottleneck. GC
overlaps these calls by approximately 1.7–5.6 ms and does not explain the complete
gap in these samples. Major GC events lasting 26–32 ms occur after the calls.

Across all three captures, Effect's `makeFn` has 13 definite self samples and
Schema object parsing has 11. The hottest authored self functions have only two
samples each. `runBoundedPromiseEffect`'s `finish` callback has 21 descendant
samples, but it resumes Effect continuations containing ordinary decoding and
application work. Inclusive ancestry does not attribute that work to the few
lines of the callback or establish Effect overhead.

CPU clock alignment retains 21.179–24.918 ms uncertainty and 16–19
boundary-ambiguous samples. Sample spacing is elapsed weighting, not exact
scheduler CPU. Estimated allocation is approximately 50 MB per entire profiler
window, which extends after the call through CPU-profile sanitization before
heap stop. Identified SDK sanitization ancestry contributes approximately
6.5–7.0 MB per capture. Allocation samples have no timestamps, so neither those
bytes nor inclusive Effect ancestry establish request-phase allocation.
Private JSON snapshot and byte-to-hex conversion are identifiable allocation
owners and investigation hypotheses, not ranked quiet latency causes.
Profiler coordinates may refer to Vitest-transformed modules; authored symbols
were located before source attribution. No source-map projection or independent
source fingerprint is captured by this private CPU harness. External contention
and exact wait causes remain unavailable.

These results identify where to investigate the connected historical capture and
publication acceptance flow. A replacement still requires an inventory proving
repeated semantic work or avoidable waits and owner correctness proofs; these
profiles alone do not select a broad redesign. They do not justify another
representation-only change as a solution to the complete gap, dropping fresh
authority checks, guessing relation prefetch, or changing framework hooks and
locks. Ten Product captures select distinct required memberships; reducing them
requires an ordered population contract preserving refusal and budget order.

## Lossless plan identity

The SDK now retains the plan's direct-root `Query Identifier` separately from
logged `%Q` context. Bounded syntax-validated token extraction preserves exact
signed-int64 decimal bytes, including IDs beyond JavaScript's safe integer range.
Duplicate or malformed root identifiers fail; absent IDs remain unavailable.
Nested/string lookalikes and logged context cannot substitute for the plan ID.

The [replay summary](plan-replay-summary.json) and [sanitized plans](plan-replay.json.gz)
replay the actual retained PostgreSQL log window from the earlier server
diagnostic through the current collector. All 701 plans, 2,580 nodes and 62
trigger records survive, with no foreign database plans or collector failures.
687 plan IDs differ from their header contexts. The 36.728 ms plan retains ID
`1582043952536896051` and header context `8824363535827441841` independently.
The private SQL/parameter log is excluded; historical SDK artifacts remain
unchanged. This checks the observed log window, with flush completeness unproven.

## Validation and installation

The final scoped owner and connected consumer lanes completed:

- SDK plan/report/server tests: 69 passed, one explicitly gated skip.
- Finite root ownership and detached projections: eight passed.
- PGlite materialization composition: 16 passed; row/index suites: 16 passed.
- Ordinary-role PostgreSQL composition and row/index suites: 22 passed.
- Complete Workerd finite settlement, both drivers: 40 passed, one explicitly gated skip. It includes actual final-document codec and committed-readback witnesses.
- Focused complete Application/Product/Pricing/Link/Payload workflow: two passed across the two drivers; 18 unrelated tests were unselected.
- Actual managed populated-installation upgrade: one passed; actual server-plan replay: passed; three CPU diagnostic samples: complete and verified.
- Affected persistence, backend and performance typechecks, core/diff lint, and both final project reviews passed. Reviews reported no actionable findings.

[Managed upgrade receipt](managed-upgrade.json) retains the controlled private
reconstruction of predecessor row/index function bodies and a pending 0137
journal receipt. The actual maintenance owner keeps the installation drained;
the actual managed Postgres constructor migrates, verifies exact installed
bodies and reopens under restricted runtime credentials. Old capabilities are
refused, fresh admission succeeds, PUBLIC execution remains denied and explicit
runtime execution remains available. Three row revisions, two row pointers, one
index revision and one index pointer remain byte-identical. This is a controlled
populated predecessor witness, not a live old-deployment migration claim.
Migration 0137 replaces only the two function bodies and revokes PUBLIC execution;
no business data, history, anchor, journal or outcome reset is performed.

Same-page earlier RETURNING refusal still outranks later trigger failure. The
final-page proof observes earlier non-key row/index corruption, with complete
transaction poisoning and rollback. Existing row-before-index/search, unique
repair and callback barriers remain covered. The owned runtime was drained with
no diagnostic databases, roles or client sessions remaining, then stopped;
its PID file and port were verified absent.

## Integrity

[Integrity manifest](integrity.json) records original SHA-256, original byte size
and retained byte size. Every gzip restoration and unchanged report/receipt copy
was verified byte for byte. CPU raw exports contain both sanitized `evidence`
(including CPU/allocation profiles) and its full `analysis`. Private environment
files, credentials, raw PostgreSQL logs and failed development attempts are not
archived.
