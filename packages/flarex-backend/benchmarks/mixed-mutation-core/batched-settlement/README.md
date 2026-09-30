# Batched authoritative settlement performance

The [full traced](./traced/manifest.json) and [full untraced](./untraced/manifest.json)
series each retain all 104 planned samples: three warmups, twenty warm requests
and three cold requests per workload. All 208 succeed, with no setup failures or
exclusions. Exact raw JSON gzip round trips, original report bytes, every CSV
sample and file hashes are recorded in the [manifest](./manifest.json).
All 73 measured source hashes match both runs and the current source checkpoint.
The previous [120-sample baseline](../bounded-read-execution/README.md) remains
byte-for-byte unchanged; its complete file inventory is retained in the manifest.

The separate [Node CPU diagnostic](./cpu-mixed-workflow/manifest.json) retains
four successful smoke samples, every sanitized profile and its original metadata.
It has observer overhead and `latencyAcceptance: false`. Its samples never enter
either full-series distribution.

## Stage and latency acceptance

Times below are milliseconds from the untraced whole-request interval. Warm p95
is descriptive nearest rank; all warm maxima remain in the raw and CSV records.
Traced SQL and explicit transaction counts agree across all twenty warm samples
of each workload. The ordinary-role PostgreSQL settings and business profiles
remain the same; this is local private evidence.

| Graph | Previous → current warm p50 | Current p95 | Cold p50 | Warm maximum | Previous → current SQL | Transactions | SQL / transaction ceiling |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Product | 635.4 → 595.6 | 616.1 | 602.8 | 623.3 | 643 → 562 | 29 → 25 | 633 / 25 |
| Product + Payload | 690.0 → 627.4 | 784.6 | 651.2 | 788.8 | 670 → 585 | 30 → 26 | 660 / 26 |
| Mixed workflow | 1,169.3 → 1,056.7 | 1,094.7 | 1,124.8 | 1,096.4 | 1,034 → 888 | 43 → 39 | 1,024 / 39 |
| Standalone workflow | 321.2 → 287.1 | 316.8 | 289.2 | 324.4 | 354 → 309 | 6 → 6 | 354 / 6 |

Every slice 17 structural ceiling passes. Mixed terminal transactions fall from
seven to three: seal, fresh finishing and independent publication. Terminal SQL
is **175 / 180 / 218**, below **228 / 236 / 321**. Whole-request reductions are
**81 / 85 / 146** dispatches, exceeding the minimum ten-wrapper removal by
**71 / 75 / 136**; those differences are aggregate evidence, not invented
per-owner row-write savings. Shared persistence batching also lowers standalone
SQL while preserving its six-transaction profile.

Warm medians improve **6.3% / 9.1% / 9.6% / 10.6%**. Standalone satisfies
**287.1 < 400 ms** and its strict comparable regression gate (**−10.6% < 10%**).
Final mixed p50 goals **100 / 200 / 500 ms** and p95 goals
**200 / 400 / 1,000 ms** remain unmet. Product + Payload's untraced p95 rises
from **751.7 to 784.6 ms**. Its traced warm p95/max are **1,472.2 / 2,181.0 ms**;
the other traced warm maxima are **636.5 / 1,223.8 / 359.6 ms** for Product,
mixed workflow and standalone. No outlier is removed or given an unobserved cause.

## Actual remaining graph and owner work

[SQL fingerprints](./sql-fingerprints.csv), [SQL families](./sql-families.csv),
[phases](./phases.csv), [transactions](./transactions.csv) and
[analysis](./analysis.json) preserve both the preceding trace and full new trace.
Family counts describe queries mentioning a table; a query can belong to several
families, so they must not be added as an independent decomposition.

| Mixed graph | Nonterminal SQL | Nonterminal transactions | Admission transactions | Product data frontiers | Workflow data frontiers | Terminal SQL / transactions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Product | 387 | 22 | 9 | 10 | 0 | 175 / 3 |
| Product + Payload | 405 | 23 | 9 | 10 | 0 | 180 / 3 |
| Mixed workflow | 670 | 36 | 9 | 10 | 13 | 218 / 3 |

Each mixed request also has one root point-table bootstrap and two Application
point transactions. Payload adds one create frontier. Pending reads and later
pending updates retain their existing local behavior. Sequential native demands,
fresh accepting checks and complete source readiness remain real obligations;
these counts do not establish a universal minimum number of frontiers.

The existing owners now batch snapshot/OCC row reads, index membership and unique
lookup, selected coverage/build reads and materialization inputs. Query families
mentioning current/revision index entries fall **15/24 → 5/14**, **16/26 → 6/16**
and **34/59 → 11/36**; unique-key mentions fall **9 → 6**, **10 → 7**, **20 → 10**.
These are driver dispatch observations from exact templates, not counts of rows
written. Protected tails, full scope/source attestation, history/tombstones,
unique/null/predicate and reference acceptance remain with their original owners.
Driver records cannot count statements executed inside functions or triggers.

The [original-demand ledger](./settlement-ledger.json) retains every captured
sample's observations, byte partitions, definition counts, chunks and unavailable
fields. [Publication owner queries](./publication-query-ledger.csv) preserve
actual observed dispatch/parameter counts; scalar parameter bytes are not total
wire bytes. Stable warm mixed cohorts are:

| Demand | Product | Product + Payload | Mixed workflow |
| --- | ---: | ---: | ---: |
| Receipts / point dependencies | 5 / 11 | 9 / 12 | 9 / 15 |
| Admitted range / page / unique demands | 10 / 0 / 4 | 11 / 0 / 5 | 26 / 0 / 15 |
| Index definition demands / distinct definitions | 219 / 73 | 227 / 75 | 269 / 117 |
| Constraint definition demands / distinct definitions | 72 / 24 | 76 / 25 | 87 / 36 |
| Canonical journal bytes | 12,106–12,180 | 19,316–19,401 | 34,020–34,127 |
| Receipt evidence bytes | 14,475–14,571 | 22,867–22,974 | 33,658–33,776 |

Each cohort uses one receipt and one point projection INSERT chunk at the
128-row bound. Final equality checks use ordered chunks of 128 expected rows,
at most 129 scalar verdicts for the last chunk, and one actual-root scalar check
before payload capture. The measured graphs have no indexed-query or relation
syscalls; their admitted range demands are separate logical observations.
Strong-reference demand counts, unobserved publication parameters, nonscalar
wire encoding and standalone original-demand capture remain unavailable.
Committed net effects cannot reconstruct those inputs.

## Node diagnostic and follow-on decision

[Leaf samples](./cpu-mixed-workflow/cpu-frames.csv),
[actual calltree ancestry](./cpu-mixed-workflow/cpu-calltree.csv) and
[diagnostic analysis](./cpu-mixed-workflow/analysis.json) retain each profile.
The two warm calltrees contain logical-storage readiness/index inspection with
weighted inclusive samples of **45.3 / 40.2 ms**, nested index-build decoding
**27.8 / 17.0 ms**, and private JSON capture **15.5 / 10.8 ms**. These are sampled
weights on real ancestry, overlap and are not exact CPU budgets. Effect and
Drizzle execution/query construction and PostgreSQL driver decoding are also
observed. No library or generated leaf is reassigned to a caller.

Idle weights **435.7 / 440.1 ms** and Inspector `post` weights
**276.8 / 439.1 ms** remain explicit; profiler windows include start/stop overhead
outside the invocation interval. No separate Workerd, server, allocation or
async-wait measurement follows. Existing metadata/admission/readiness and
preparation owners warrant investigation before choosing a host change.
Slice 18 remains conditional and unapproved; this diagnostic approves no runtime
optimization and does not attribute the whole remaining latency gap.

## Correctness evidence and limits

The final seal correction passes 17 focused PGlite finite cases and twelve
existing ordinary/finite seal regressions. The focused ordinary-role PostgreSQL
lane passes fifteen cases, and ordinary Application regressions pass eighteen.
Faults include suppressed/altered writes, late receipt changes, inflated initial
and live-point evidence, AFTER UPDATE sealed-root changes, and 129-row healthy,
missing-final and extra-final membership. They prove bounded scalar output,
rollback, withheld capture and local abort. Persistence typecheck and core/diff
lint pass; both final project reviewers report no findings. The Effect boundary
guard retains twelve pre-existing diagnostics; this slice does not claim a
repository-wide clean guard result.

Other connected failure/recovery tests remain with their owning suites and Git
validation record. This evidence does not establish hosted activation, arbitrary
framework support, public authoring APIs, throughput, native ORM parity or final
latency acceptance. [Slice 17](../../../../../roadmaps/mixed-mutation-core/17-batched-settlement-preflight.md)
owns the delivered private contract and retained recovery obligations.
