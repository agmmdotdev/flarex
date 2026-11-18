# Shared finite frontier baseline

This is the frozen direct mixed-workflow reference for the shared finite frontier
slice. The runtime is `8c394df7747f3a7c8cdebb1b929f53c766499bc9`.
The report records a dirty checkout: test-only phase/report instrumentation and
the new finite-observation consumer witness were present; no candidate runtime
edits were present. The existing [latest matrix](../latest/command.json) remains
separate.

The root ran `pnpm perf:core --scenario mixed-workflow --full --sql` using the
existing isolated PostgreSQL inputs. The [command receipt](./command.json) and
[scenario report](./mixed-workflow.json) retain the full observations. PostgreSQL
18.3 and Node 24.16.0 executed with an ordinary role, fsync, synchronous commit
and full page writes enabled. Three quiet warmups preceded twenty quiet request
samples. A separate first diagnostic request records SQL and spans.

Quiet requests have median **729.61 ms**, P95 **744.97 ms**, and range
**713.54–794.37 ms**. The selected command took **94.32 s**; scenario time was
**93.29 s**, including **16.15 s** loading and **21.76 s** preparation. Across the
twenty measured samples, seeding consumed **10.20 s** and persisted-result
verification **20.36 s** outside request timing. Preparation includes **8.84 s**
of index/unique-set construction and **3.33 s** logical admission. These are
setup/check costs, not request latency.

The instrumented diagnostic took **1,090.47 ms**, issued **800** client SQL
statements in **63** transactions, and left no open transactions, query errors,
unobserved dispatches, lost context or incomplete spans. Its observed SQL await
sum and interval union are both **369.16 ms**; checkout await sum and union are
both **2.00 ms**. Equal sums/unions show no overlapping observed SQL waits in
this request. These are client await intervals, not server CPU or network
round-trip counts. Instrumented timings do not belong in the quiet distribution.

| Diagnostic phase | Inclusive wall time | SQL statements |
| --- | ---: | ---: |
| Application admission preparation | 57.95 ms | 60 |
| Finite outer entry activation | 83.21 ms | 55 |
| Authenticated outer entry | 22.65 ms | 21 |
| Portable execution outside child spans | 25.13 ms exclusive | 19 |
| Application point operations | 26.28 ms total | 35 |
| Native Product operations | 133.69 ms total | 125 |
| Native Medusa workflow | 254.31 ms | 222 |
| Native Payload operations | 28.64 ms total | 12 |
| Freeze and seal | 117.11 ms | 58 |
| Stored verification and planning | 30.95 ms | 0 |
| Finishing | 13.43 ms | 21 |
| Authoritative publication | 210.64 ms | 172 |

SQL counts are assigned exclusively to their deepest observed phase path and
sum to 800. Span timings are nested; do not sum inclusive parent/child values.
Product close is inside its native operation and contributes **0.80 ms** across
two calls; Payload scope close contributes **0.20 ms**. Participant borrowing
contributes **6.24 ms** across Product/Payload calls and **6.29 ms** for workflow,
with no SQL observed in those spans.

The report's existing `stored read and source preparation` phase name denotes
`context.prepareAttempt`: Application mutation admission and activation-evidence
preparation. It does not isolate framework checked-read internals. Actual read
frontend work remains inside native Product/workflow/Payload intervals. Repeated
shared source observations are a source/test hypothesis for the selected owner
correction; this diagnostic does not establish dominant source-check CPU or
attribute the full native intervals to that work.

Candidate evidence must use a new directory and the same direct sample plan.
Whole-request comparison remains distinct from the fixed Worker-based matched
Product hit/miss method gate, its 1/100 metadata scaling evidence and the
five-scenario direct integration graph. This baseline is not slice completion
or hosted performance acceptance.
