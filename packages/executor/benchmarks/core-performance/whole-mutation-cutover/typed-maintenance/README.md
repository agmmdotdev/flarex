# Typed maintenance investigation

The [typed maintenance cutover](../../../../../../roadmaps/mixed-mutation-core/24-whole-mutation-redesign-preflight.md#typed-activation-bound-maintenance-obligations)
replaces private maintenance certificates with protected activation-bound opening
obligations. Actual activation and serving logins remain separate; existing
Application, Product, Payload and workflow consumers use the replacement.
Strict conversion preserves authenticated retained openings, and public installer
maintenance retains exact ownership and failure-drained behavior.

This cutover establishes no accepted performance improvement. Three warmups
precede twenty complete requests; one separate request records SQL.

| Median ms | P95 ms | Maximum ms | Driver SQL statements | Transactions |
| ---: | ---: | ---: | ---: | ---: |
| 159.67 | 178.56 | 327.64 | 40 | 2 |

[The report](./mixed-product.json) retains every request. The
[held predecessor](../frozen-settlement/README.md) recorded 152.37 ms median,
161.82 ms P95 and the same 40 statements. Independent distributions establish
neither causal regression nor improvement. Complete native-relative acceptance
remains open: the stored native reference is independently measured, paired
excess is null, and this command has `quietAcceptance: false` and
`quietSamplingEligible: false`.

The separate SQL diagnostic takes 410.20 ms, with 207.78 ms summed driver awaits:

| Actual phase | Driver statements | Sum of driver awaits ms |
| --- | ---: | ---: |
| Admission | 6 | 22.21 |
| Application execution | 2 | 21.26 |
| Product execution | 11 | 57.51 |
| Publication | 21 | 106.81 |

Publication includes a single 65.90 ms COMMIT await in this diagnostic. It is
not evidence that COMMIT explains the retained request distribution. Ten Product
capture calls return 40,553 decoded JSON bytes and sum to 51.68 ms of driver
awaits. The composed materialization call takes 9.67 ms and the committed-prefix
call 7.12 ms. Coverage eligibility still returns canonical current metadata for
JavaScript verification; typed openings alone do not replace that boundary.
Preparation takes 25.16 seconds and cleanup 1.75 seconds, separately from measured
requests; command elapsed time is 51.54 seconds.

[The separate CPU diagnostic](./cpu-report.json) retains one warmup and three
independently profiled complete requests, their original raw profiles and hashes.
Its instrumented latency is not quiet acceptance. Sparse CPU samples, idle time,
GC and inspector lifecycle must remain distinct from attributed request CPU.
Time-delta weighting excludes the first inspector-start interval and separates
idle, GC and inspector stop. Remaining sampled windows are 190.52, 268.02 and
186.04 ms. Broad head/build/unique coverage stacks account for only eleven
samples, 6.17 ms across all three requests; this includes non-publication build
reads. These profiles do not support coverage reconstruction as the dominant
CPU cost. Working-set stacks recur at about 19.9 ms inclusive per request, while
Effect runtime/Result accounts for 101.26 ms sampled self time across the three
requests. Inclusive families overlap and cannot be added. The second profile
contains 66.46 ms GC; this does not identify its allocating owner. Actual median
sample intervals are about 533–537 microseconds, so precise unsampled attribution
or quiet-latency savings cannot be inferred.

[Integrity hashes](./integrity.json) bind all retained evidence. Before/after
fingerprints show unchanged HEAD, 435 declared owned paths, 89 component paths,
1,300 runtime sources, 111 harness files and 698 promoted native distribution
files, including declarations. These are declared fingerprints rather than
executing-module traces or ownership of peer changes. PostgreSQL snapshots at
both boundaries show an ordinary role, enabled durability, disabled instrumentation
and no other selected-database clients. They do not establish exclusive machine
CPU or absence of other clients throughout the requests.

Connected correctness covers both database lanes, public conversion, exact
installation privileges, protected opening pins, activation rollback, historical
ownership successors, materialization failure order and actual framework
readiness changes. The PGlite overlap witness proves complete-command exclusion
across wrappers of the same actual client and exact reopening identity. Both
project reviews are clear for the held source. Complete matched native pairs,
stable tails, metadata scaling and cold-capacity acceptance remain open.
