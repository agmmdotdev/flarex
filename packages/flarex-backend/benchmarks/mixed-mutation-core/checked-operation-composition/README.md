# Checked operation composition performance

The [traced smoke](./traced-smoke/manifest.json) retains 16/16 successful
samples, and the [full untraced series](./untraced/manifest.json) retains
104/104. Each dataset includes a gzip of the exact raw JSON bytes, the exact
generated report bytes, every sample in CSV, an exclusions record, and byte
and SHA-256 manifests. There are no excluded or failed samples or setup
failures. Both records have the same revision, working fingerprint, 37 measured
source hashes, and business profiles. All 37 hashes matched the measured
workspace files when packaged. The [finite-root baseline](../fundamental-latency/finite-root/README.md)
remains unchanged.

The quiet traced smoke has two warm samples per workload and supports SQL and
transaction counts, not a warm p95. The full untraced series has 20 warm and
three cold samples per workload. It supports the latency distribution but has
no SQL or phase observer. Both runs use the same four business graphs, local
ordinary-role PostgreSQL host, restricted runtime login, and fresh single-use
Worker lifecycle for mixed requests as the finite-root baseline. The two
source revisions differ, so the timing difference is an observed comparison,
not an isolated causal estimate of this code change.

## End-to-end cost

Outer invocation wall times are milliseconds. Warm p95 is descriptive over 20
requests using the nearest rank; cold p50 uses three requests. The counts are
identical across both warm samples in each quiet traced smoke. The before
columns are the finite-root clean trace and full untraced distribution.

| Workload | Before warm p50 / p95 | Current warm p50 / p95 | Current cold p50 | SQL before → current | Transactions before → current |
| --- | ---: | ---: | ---: | ---: | ---: |
| Product | 1,758.7 / 1,815.9 | 1,849.5 / 2,223.4 | 1,727.0 | 2,748 → 2,646 | 85 → 82 |
| Product + Payload | 2,420.2 / 2,682.7 | 2,264.6 / 2,291.8 | 2,284.2 | 3,802 → 3,564 | 112 → 105 |
| Mixed finite workflow | 5,284.0 / 5,533.7 | 4,847.1 / 5,011.1 | 4,927.1 | 7,228 → 6,976 | 205 → 199 |
| Standalone finite workflow | 342.7 / 386.1 | 318.4 / 333.3 | 314.9 | 470 → 470 | 6 → 6 |

The structural count reductions are 102 SQL dispatches and three transaction
intervals for Product, 238 and seven for Product + Payload, and 252 and six
for mixed workflow. The standalone graph is unchanged in traced counts.
Product warm p50 **regresses 5.2%** despite fewer counted operations. Its
median fresh Worker construction rises from 84.1 to 134.3 ms; this is an
association in the measured requests, not an established cause of the
regression. Product + Payload and mixed workflow warm p50 decrease about 6.4%
and 8.3% respectively. The proposed mixed warm p50 goals of 100 / 200 /
500 ms and p95 goals of 200 / 400 / 1,000 ms remain **unmet**. The standalone
warm p50 is below its 400 ms ceiling and below the earlier 342.7 ms finite-root
median, satisfying the strict less-than-10% regression gate.

Retained row/index/commit/event growth per successful warm request remains
`1/1/1/1` for Product, `2/3/1/1` for Product + Payload, `7/36/1/7` for
mixed workflow, and `5/33/1/6` for standalone workflow. Every warm request
ends with zero live journal rows and zero retained live journal bytes. Median
sealed journal bytes are 12,180 / 19,401 / 34,109 for the three mixed graphs;
standalone has no mixed journal. Fresh Worker construction median is 134.3 /
82.3 / 83.6 ms for the three mixed graphs.

Every traced sample has zero unknown statements, query errors, unobserved or
lost dispatches, and incomplete spans. These quantities are unavailable in
the untraced distribution, not zero. SQL awaited time includes transport and
scheduling, so it does not identify PostgreSQL server execution, lock wait,
or WAL cost. The private bridge does not establish hosted Cloudflare latency,
native ORM parity, or production capacity. Repeated live admission and exact
read work remain the next measured cost owner: the Product update trace still
contains 49 transaction intervals and the workflow's selected native phase
94. A reduction there must preserve fresh authority and short SQL lifetimes;
these totals do not justify skipping checks or holding SQL across callbacks.

Outside this measurement, one expanded regression run hit the unchanged
`migration0028` five-second test timeout; an isolated rerun passed. The cause
is unproven, and no benchmark sample was excluded for it. The preparation
cleanup-tail witness uses a mocked uncertain tail; this slice did not add a
real preparation transaction final-guard or COMMIT fault injection. Existing
aggregate-seal recovery authority is unchanged.

The [09 preflight](../../../../../roadmaps/mixed-mutation-core/09-checked-operation-composition-preflight.md)
owns the delivered bounded composition and remaining capability gates.
