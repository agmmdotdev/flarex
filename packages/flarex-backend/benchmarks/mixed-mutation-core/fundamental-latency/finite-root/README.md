# Finite mixed root performance

The [first traced smoke](./initial-traced-smoke/manifest.json), [clean traced
smoke](./traced-smoke/manifest.json), and [full untraced series](./untraced/manifest.json)
retain 16/16, 16/16, and 104/104 successful samples respectively. Each dataset
keeps the original report bytes, a gzip of the exact raw JSON bytes, every sample
in CSV, explicit exclusions, and byte and SHA-256 manifests. The three raw
records have the same revision, working fingerprint, 34 measured source hashes,
and selected business profiles. The existing [selected-evidence
series](../../selected-evidence/README.md) is unchanged.

The first smoke overlapped a repository root file inventory scan. The overlap
is observed interference; it does not establish the cause of its high mixed
warm sample. **All 16 first-smoke samples are excluded from latency
conclusions**, while their raw data and structurally consistent SQL counts are
retained. The clean smoke supplies structural attribution. Its two warm samples
per workload do not support a p95. The full untraced run supplies the warm
distribution and three cold samples per workload; SQL and phase observations
were intentionally unavailable there.

## End-to-end cost

Outer invocation wall times are milliseconds. Warm p95 is descriptive over 20
requests, using the nearest rank. Cold p50 uses three requests. The earlier
selected-evidence series and the finite-root series ran sequentially on the
same local PostgreSQL host and four business graphs, including fresh single-use
Workers for mixed requests. Their different source revisions and the finite
series' per-fixture restricted runtime login prevent treating the difference
as an isolated causal speedup.

| Workload | Earlier warm p50 | Finite warm p50 | Finite warm p95 | Finite cold p50 | Clean trace dispatch / transaction |
| --- | ---: | ---: | ---: | ---: | ---: |
| Product | 2,271.3 | 1,758.7 | 1,815.9 | 1,754.2 | 2,748 / 85 |
| Product + Payload | 3,303.2 | 2,420.2 | 2,682.7 | 2,703.5 | 3,802 / 112 |
| Mixed finite workflow | 6,698.6 | 5,284.0 | 5,533.7 | 5,896.5 | 7,228 / 205 |
| Standalone finite workflow | 338.2 | 342.7 | 386.1 | 350.8 | 470 / 6 |

The proposed mixed warm p50 goals of 100 / 200 / 500 ms and p95 goals of
200 / 400 / 1,000 ms remain unmet. The standalone warm p50 is below its
400 ms ceiling and is about 1.3% above the earlier 338.2 ms median, inside
the strict less-than-10% regression gate. The clean smoke's observed SQL dispatches and
transaction intervals are identical in both warm requests for each workload;
the excluded first smoke records the same structural counts. All traced
samples report zero unknown statements, query errors, unobserved or lost
dispatches, and incomplete spans. The full untraced samples have no trace
objects, so these observations are unavailable there, not zero.

Retained row/index/commit/event growth per successful warm request is
`1/1/1/1` for Product, `2/3/1/1` for Product + Payload, `7/36/1/7` for the
mixed workflow, and `5/33/1/6` for the standalone workflow. Each ends with
zero live journal rows. Median sealed journal bytes in the full untraced run
are 12,180 / 19,401 / 34,109 for the three mixed graphs; standalone has no
mixed journal. Fresh Worker construction remains inside the request wall
interval, with warm medians of 84.1 / 83.1 / 85.4 ms for those graphs.

The private bridge and local PostgreSQL measurements do not establish hosted
Cloudflare latency, native ORM parity, or production capacity. The [08
preflight](../../../../../../roadmaps/mixed-mutation-core/08-fundamental-latency-redesign-preflight.md)
owns the next connected cost owner and remaining capability gates.
