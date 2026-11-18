# Fresh admission evidence performance

The [quiet traced smoke](./traced-smoke/manifest.json) retains 16/16
successful samples and the [full untraced series](./untraced/manifest.json)
retains 104/104. Each dataset includes the exact generated report bytes, a
gzip of the exact raw JSON bytes, every sample in CSV, explicit zero
exclusions, and byte and SHA-256 manifests. Both runs have the same revision,
working fingerprint, selected business profiles and 41 measured source hashes.
All 41 hashes matched the measured workspace files when packaged. There are
no failed samples or setup failures. The [checked-operation baseline](../checked-operation-composition/README.md)
is retained unchanged.

The runs use the same four business graphs, local ordinary-role PostgreSQL
host, restricted runtime policy and fresh single-use Worker lifecycle for
mixed requests as the baseline. Their different source revisions make this
an observed comparison, not an isolated causal estimate. The trace has two
warm requests per workload and supports SQL structure, not a p95. The full
untraced run has 20 warm and three cold requests per workload; it supports
latency distributions but has no SQL or phase observer.

## End-to-end cost

Outer invocation wall times are milliseconds. Warm p95 is the descriptive
nearest rank over 20 requests; cold p50 uses three. The SQL and transaction
counts are identical across both warm traced requests per workload.

| Workload | Before warm p50 / p95 | Current warm p50 / p95 | Current cold p50 | SQL before → current | Transactions before → current |
| --- | ---: | ---: | ---: | ---: | ---: |
| Product | 1,849.5 / 2,223.4 | 1,551.6 / 1,868.6 | 1,646.7 | 2,646 → 2,256 | 82 → 82 |
| Product + Payload | 2,264.6 / 2,291.8 | 2,013.6 / 2,142.7 | 2,059.2 | 3,564 → 3,018 | 105 → 105 |
| Mixed finite workflow | 4,847.1 / 5,011.1 | 4,471.4 / 4,743.6 | 4,566.3 | 6,976 → 5,872 | 199 → 199 |
| Standalone finite workflow | 318.4 / 333.3 | 308.8 / 322.3 | 312.7 | 470 → 452 | 6 → 6 |

The observed SQL reductions are **390 / 546 / 1,104 / 18** dispatches per
warm request; the checked transaction counts are unchanged. In Product
update, the quiet trace still has **49** transaction intervals per request.
Across its two warm requests, the active-head and activation query templates
each fall from 294 to 98 dispatches, revision-schema from 196 to 98, and
the selected table-frontier templates together from 294 to 196. Those are
three to one head and activation reads, two to one schema reads, and three
to two frontier reads per interval. The mixed workflow run still has **94**
intervals per request; the same template families fall from 564 to 188,
564 to 188, 376 to 188, and 564 to 376 across its two warm requests. The
phase/query mapping comes from SQL fingerprints and phase labels, not a
function stack. Required physical index, source, session and final-guard
checks remain in the request.

Full warm p50 decreases about 16.1% / 11.1% / 7.8% / 3.0% from the
checked-operation series. The proposed mixed warm p50 goals of 100 / 200 /
500 ms and p95 goals of 200 / 400 / 1,000 ms remain **unmet**. Standalone
warm p50 is below its 400 ms ceiling and below the prior 318.4 ms median,
within the strict less-than-10% regression gate. The mixed fresh Worker
construction medians are 83.6 / 79.3 / 84.0 ms; the earlier Product median
was 134.3 ms. That co-movement is not proof of why endpoint latency changed.

Retained row/index/commit/event growth per successful warm request is
`1/1/1/1` for Product, `2/3/1/1` for Product + Payload, `7/36/1/7` for
mixed workflow, and `5/33/1/6` for standalone workflow. Each ends with zero
live journal rows and zero retained live journal bytes. Median sealed journal
bytes remain 12,180 / 19,401 / 34,109 for the mixed graphs; standalone has
no mixed journal. Every traced sample has zero unknown statements, query
errors, unobserved or lost dispatches and incomplete spans. These quantities
are unavailable in the untraced run, not zero.

The package proves a selected reduction in repeated SQL within the same
checked operation. It does not establish PostgreSQL server execution,
lock wait, WAL, contention/retry latency, hosted Cloudflare latency, native
ORM parity or capacity. The private graph and controlled clock-advance
regression do not prove every concurrent publication shape. Repeated fresh
admission still dominates the selected Product and workflow phases; a later
cost slice must preserve each live authority check and short SQL boundary.

The [10 preflight](../../../../../roadmaps/mixed-mutation-core/10-fresh-admission-evidence-preflight.md)
owns the delivered internal contract and its remaining capability gates.
