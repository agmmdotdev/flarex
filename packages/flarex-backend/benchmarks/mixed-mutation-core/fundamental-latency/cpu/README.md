# Request-scoped Node CPU diagnostic

The [mixed](./mixed/manifest.json) and [standalone](./standalone/manifest.json)
untraced smokes each completed 4/4 samples: one warmup, two measured warm
requests and one cold request. Existing business assertions passed; mixed
samples also passed publication checks, and inventory snapshots were retained.
This is a **Node Inspector diagnostic,
excluded from latency acceptance**. The profiler adds overhead; the native
`.cpuprofile` interval includes Inspector start/stop sampling outside the
recorded invocation wall. It samples the current Node isolate, not separate
Workerd CPU, allocations or async wait stacks. Two warm points cannot define
a stable percentile or native framework parity.

| Workload and warm point | Invocation wall (ms) | Profile window (ms) | Effect leaf weight | Drizzle leaf weight | Persistence leaf weight | Protocol leaf weight | Idle | GC | Inspector.post | Other leaf weight |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Mixed 1 | 7,294.7 | 7,807.0 | 1,420.0 | 1,150.8 | 584.6 | 266.2 | 2,391.9 | 129.3 | 510.4 | 1,353.5 |
| Mixed 2 | 7,002.0 | 7,296.3 | 1,384.0 | 1,133.6 | 536.0 | 254.4 | 2,418.8 | 77.4 | 293.4 | 1,198.6 |
| Standalone 1 | 351.5 | 711.0 | 90.1 | 46.5 | 31.0 | 12.4 | 86.7 | 6.2 | 357.9 | 80.0 |
| Standalone 2 | 387.4 | 893.9 | 76.3 | 42.0 | 27.4 | 9.3 | 153.0 | 6.1 | 504.8 | 75.0 |

All weights above sum **disjoint leaf `timeDeltas`**, grouped by frame URL or
special V8 frame. They are approximate sampled weights across the whole
profile window, not inclusive call-tree time, exact CPU accounting, request
wall components or causal speedup estimates. The `Other` bucket includes
native, Node, driver, adapter and unmatched leaves. Inspector is classified
before generic Node frames. Generated/transformed line numbers in the profile
do not identify exact original TypeScript source lines.

The mixed profile has substantial repeated Effect, Drizzle, persistence and
protocol leaf work alongside idle and Inspector samples. Nearest repository
ancestors of those library leaves include logical storage readiness, unique
and index build state, Application readiness and active-head checks. This
supports profiling **repeated admission and SQL construction** as a connected
owner; it does not support replacing Effect or Drizzle, attributing the
unobserved request remainder to CPU, or claiming the scope-clock lock is
dominant. The [08 preflight](../../../../../../roadmaps/mixed-mutation-core/08-fundamental-latency-redesign-preflight.md)
keeps the writer, durability and replay proof gates before that redesign.

Each retained run contains its byte-exact report, deterministic gzip of raw
JSON and native sanitized `.cpuprofile` files, original sidecars, a
[read-only summarizer](./summarize.mjs) and per-file SHA-256 manifests. The
[measured-source snapshots](./measurement-source/manifest.json) preserve exact
gzip copies of the three benchmark files defining the measured checkpoint.
Later harness/helper changes only affect diagnostic failure handling; the
reporter source is unchanged. Snapshot hashes match both raw environments.
Earlier reconnaissance captures remain in ignored work paths and are excluded
from this retained comparison. To reproduce the disjoint leaf summary directly
from retained gzip, run:

```sh
node packages/flarex-backend/benchmarks/mixed-mutation-core/fundamental-latency/cpu/summarize.mjs packages/flarex-backend/benchmarks/mixed-mutation-core/fundamental-latency/cpu/mixed
node packages/flarex-backend/benchmarks/mixed-mutation-core/fundamental-latency/cpu/summarize.mjs packages/flarex-backend/benchmarks/mixed-mutation-core/fundamental-latency/cpu/standalone
```

The earlier [full untraced selected-evidence series](../../selected-evidence/README.md)
remains the latency comparison. Its warm medians still exceed the proposed
100 / 200 / 500 ms mixed goals. These profiled smokes do not replace that
unprofiled endpoint record.
