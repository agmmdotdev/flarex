# Compact checked-access performance

The [quiet traced smoke](./traced-smoke/manifest.json) retains 16/16 successful
samples and the [full untraced series](./untraced/manifest.json) retains 104/104.
Each dataset includes the exact generated report bytes, a gzip of the exact raw
JSON bytes, every sample in CSV, explicit zero exclusions, and byte and SHA-256
manifests. Both runs share the measured revision and working fingerprint,
selected business profiles and 46 measured source hashes. All 46 hashes matched
the workspace when packaged. The fingerprint was verified before final report
and roadmap prose changed; that later prose is outside the measured checkpoint.
There are no failed samples or setup failures. The
[attempt-local admission baseline](../attempt-local-admission/README.md) remains
unchanged.

The same four graphs run on local ordinary-role PostgreSQL with the same
restricted runtime policy and fresh single-use Worker lifecycle for mixed
requests. Current traced and untraced host settings match apart from isolated
runtime-role names. The prior series has the same CPU, OS, Node, driver,
PostgreSQL settings, transport, pool limit and reported total memory
(16,421,470,208 bytes). Different source checkpoints make this an observed
comparison, not an isolated causal estimate. The trace has two warm requests
per graph and supports SQL structure, not a p95. The full untraced run has
20 warm and three cold requests per graph and supports latency distributions,
with SQL and phase observations unavailable.

## End-to-end cost

Outer invocation wall times are milliseconds. Warm p95 is descriptive nearest
rank over 20 requests; cold p50 uses three. SQL and transaction counts match
across both warm traced requests per workload.

| Workload | Before warm p50 / p95 | Current warm p50 / p95 | Current cold p50 | SQL before → current | Transactions before → current |
| --- | ---: | ---: | ---: | ---: | ---: |
| Product | 857.9 / 884.6 | 867.8 / 993.0 | 869.8 | 1,063 → 990 | 41 → 41 |
| Product + Payload | 1,000.2 / 1,053.2 | 1,067.8 / 1,212.1 | 1,146.7 | 1,378 → 1,274 | 52 → 52 |
| Mixed finite workflow | 1,782.8 / 1,808.8 | 1,954.1 / 2,677.3 | 1,971.4 | 2,173 → 1,997 | 78 → 78 |
| Standalone finite workflow | 286.5 / 339.8 | 303.8 / 388.9 | 304.3 | 361 → 354 | 6 → 6 |

Warm SQL dispatches fall by **73 / 104 / 176 / 7** per request; transaction
intervals do not change. Full warm medians rise **1.2% / 6.8% / 9.6% / 6.0%**.
Warm p95 rises **12.2% / 15.1% / 48.0% / 14.4%**. This series demonstrates
fewer dispatches and narrower selected transport, with no endpoint latency
improvement. It does not establish the cause of the distribution changes.
All warm maxima are retained: **1,013.3 / 1,216.2 / 3,801.1 / 389.7 ms**.
No sample is excluded or replaced.

The mixed warm p50 goals of 100 / 200 / 500 ms and p95 goals of
200 / 400 / 1,000 ms remain **unmet**. Standalone passes its explicit median
gate: **303.8 ms < 400 ms**, and its **6.0%** increase from the prior
286.5 ms median is strictly below the 10% regression limit. That gate does
not turn the observed standalone increase into an improvement.

## Changed owners and retained proof

The [compact access preflight](../../../../../roadmaps/mixed-mutation-core/12-compact-checked-access-preflight.md)
records the exact cutover and investigated readers. The ordinary checked kernel
now returns thirteen consumed session scalars and omits its unused callback
facet observation: **seven SELECTs become six**. Scope clock, session, lease,
journal root, claim and post-lock database time retain their order and locks.
Exact reload, acquisition and recovery still check hidden children; replay and
stored authentication retain full body verification.

The binding candidate reader combines the full candidate and complete bounded
physical lanes: **two SELECTs become one**. Selected source admission retains
the authenticated locked-head read, then starts one statement for the selected
activation, candidate and lanes after any head-lock wait: **four SELECTs become
two**. Full canonical decode, digest/correlation and exact lane membership
checks remain. Canonical activation/candidate bytes each travel once, with the
existing ten-row transport ceiling. The actual native driver observer confirms
two selected binding SELECTs; the blocked-head witness confirms the subsequent
read sees the writer's new committed activation.

In the quiet trace, Product update falls from **492 to 444** dispatches in the
same 16 checked intervals. Mixed workflow run falls from **650 to 584** in the
same 22. These phase deltas agree with the inspected one-query kernel and
two-query selected-binding savings per interval. Trace groups do not supply
source-function attribution; the owner attribution comes from the current call
graph and focused driver observers. Whole-request totals include admission,
seal, publication and standalone candidate consumers as well.

Application head/activation/schema reads retain ordered share locks and
post-wait statement snapshots. Index and unique rows retain their subsequent
fresh clock observations. Search retains its separate live physical probe
before conditional frontier reads: a combined SQL statement cannot defer
relation/privilege validation during planning until physical readiness passes.
Binding joins preserve decoder order but may surface a typed resource failure
before corruption or missing-candidate absence if a joined relation is
unavailable. Current mutable readiness, live physical identity and the full
protected catalog/epoch tail remain fresh. There is no schema, protection,
connection-attestation or publication/body-authentication change.

## Retained effects and observation limits

Warm retained row/index/commit/event growth remains **1/1/1/1** for Product,
**2/3/1/1** for Product + Payload, **7/36/1/7** for mixed workflow and
**5/33/1/6** for standalone workflow. Each ends with zero live journal rows;
mixed requests also end with zero live journal bytes. Standalone live journal
and sealed-attempt bytes are unavailable. Median sealed journal bytes remain
**12,095 / 19,305 / 34,020** in the trace and **12,180 / 19,401 / 34,109** in
the full untraced series. These separate mode plans are unchanged.

Every traced sample has zero unknown statements, query errors, unobserved or
lost dispatches and incomplete spans. Those quantities are unavailable in the
untraced run, not zero. Driver awaited time includes transport, server work and
waits; transaction intervals include application work and waits. Neither gives
pure server execution, lock-hold time, decoder/hash CPU or the cause of a tail.
No native ORM parity, hosted latency, throughput or production-capacity claim
follows from this local series.
