# Shared finite frontier candidate: matched native quiet method

The [raw quiet report](./shared-frontier-native-quiet-01-quiet.json) records the
dirty candidate labelled `8c394df77-plus-shared-frontier-candidate`; it does not
claim a committed or final validated checkpoint. This fixed Worker-based
comparison is separate from the direct mixed-workflow request benchmark.
All numerical reports here are initial-candidate evidence from before the latest
`sourceAdmission` full-callback issuer-retry correction. They do not measure or
validate that correction.

Each branch discards three warmups and retains thirty serial alternating pairs
of pinned native `retrieveProduct(id)` and the actual private finite Product
operation. Every finite hit is the first Product storage demand in a fresh
authenticated attempt. Missing Products retain the native name/type/message
through the Commerce adapter cause and poison that attempt. Complete default
DTO structure and every non-generated value are compared; both authoritative
stores' generated timestamps are retained and validated separately.

The method interval includes native service construction, storage, operation
close and receipt validation. The complete finite request includes admission,
fresh Worker startup/execution/disposal, seal, publication and fixture disposal.
The runner now calls `series.prepareAttempt` before each alternating pair:
disjoint fixture preparation is recorded as `finiteDataPreparationMs` and
charged to series setup outside both operation and request timing. This test-only
repair preserves the Worker execution wrapper. Module/schema/seeding costs
remain separately recorded for their actual series lifetime.

| Quiet branch | Native median / P95 | Finite method median / P95 | Paired method excess median / P95 | Finite complete request median / P95 |
| --- | ---: | ---: | ---: | ---: |
| Hit | 2.636 / 3.076 ms | 14.705 / 25.344 ms | **12.200 / 22.308 ms** | 327.390 / 382.741 ms |
| Miss | 2.271 / 5.120 ms | 11.626 / 71.989 ms | **9.510 / 69.944 ms** | 368.904 / 1,148.652 ms |

**Both branches fail the fixed median <=5 ms and P95 <=10 ms paired method
excess gates.** Paired excess is computed sample by sample, then summarized;
subtracting independently summarized native and finite quantiles gives a
different statistic. The report's result/error assertions passing does not mean
the performance gates pass. The Worker request samples are noisy, especially
misses, and remain reported without subtracting entry or settlement work.

The existing original native comparison under
`work/validation/mixed-query-read-20261003/native-read-baseline/` is historical
`91ec5f560` evidence. It is not the same-runtime `8c394df77` baseline used by the
direct workflow ledger. No same-base whole-Worker-request regression conclusion
is established here. The fixed absolute method gates can still be evaluated
and fail without that historical comparison.

The report fingerprints 27 selected source files and checks those selected
hashes before/after the run. This is not an exhaustive dirty-runtime fingerprint
or proof of all executing framework build outputs; candidate executing-build
provenance is not supplied by this JSON. A later runtime correction requires its
own measurements or an explicit unchanged-source comparison. Native database
startup/search-path setup failures contribute no accepted samples.

The reported PostgreSQL settings retain fsync, full page writes and synchronous
commit; quiet mode has `pg_stat_statements.track=none` and disabled auto-explain
logging. Quiet mode supplies no per-demand SQL, decoded-result or source-byte
counters. Those observations belong to the separate
[trace/scaling ledger](../frontier-candidate-scaling/README.md). Driver wire
bytes, network round trips, server execution time and isolated CPU are
unavailable. No final correctness, review, commit, latency acceptance or hosted
activation claim is made by this ledger.
