# Frozen settlement investigation

This iteration follows [ordered materialization](../materialization-composition/README.md).
Authentic original rows now produce canonical settlement obligations once. The
installed index and unique owners accept current state and select actual actions;
ordinary and finite materializers consume the same canonical unique pairs. Empty
intrinsic work avoids an acceptance call after its applicable validation. The
complete Product graph still has the same statement count as its predecessor.

The complete mixed Application + Product outcome and command cleanup pass.
Three warmups precede twenty retained requests; a separate request records SQL.

| Median ms | P95 ms | Maximum ms | SQL statements | Transactions |
| ---: | ---: | ---: | ---: | ---: |
| 152.37 | 161.82 | 162.51 | 40 | 2 |

[The report](./mixed-product.json) retains every sample. The predecessor recorded
161.38 ms median and 165.98 ms P95 with the same 40 statements. These independently
collected observations establish no accepted native-relative improvement and do
not attribute their latency difference to this source change. This command has
`quietAcceptance: false`, `quietSamplingEligible: false` and a null paired excess.
The stored native median of 9.28 ms and P95 of 11.38 ms are a separate reference;
subtracting independent percentiles is not paired overhead.

The separate SQL diagnostic takes 313.22 ms and records:

| Actual phase | Statements | Sum of driver awaits ms |
| --- | ---: | ---: |
| Admission | 6 | 20.43 |
| Application execution | 2 | 18.13 |
| Product execution | 11 | 45.09 |
| Publication | 21 | 38.61 |

Publication includes current-authority and metadata acceptance, original
dependency checks, current build/maintenance observations, action acceptance,
materialization, the committed prefix and final clock/metadata guard. The composed
materialization call takes 9.19 ms and the prefix call 7.04 ms in this diagnostic;
inclusive publication takes 79.90 ms. Instrumented intervals describe this
diagnostic request and must not substitute for the retained latency distribution.
Preparation takes 123.25 seconds and cleanup 1.22 seconds, separately from the
complete measured request; command elapsed time is 146.77 seconds.

[Integrity hashes](./integrity.json) bind the frozen bytes. Before/after inventories
record an unchanged revision, 395 owned paths, 34 component paths, 1,292 bounded
runtime sources, 43 harness sources and 349 promoted Medusa distribution files.
These are declared fingerprints, not executing-module traces. Database inventories
at both boundaries show an ordinary role, enabled durability, disabled
instrumentation and zero other selected-database clients. They do not establish
exclusive machine CPU or absence of other clients throughout measurement.

Connected correctness covers complete materialization and coverage, genuinely
sparse private native capacity, exact identity selection, failure order and
rollback, scalar and compound Cause preservation, finite revocation/expiry cleanup,
ordinary publication, actual framework consumers and uncertain-COMMIT recovery.
The private capacity witness does not establish standard Application source-closure
reachability or numerical scaling. The historical finishing-lock timeout remains
causally unresolved despite a passing targeted rerun. Both final project reviews
are clear for the held component source. Some broader consumer tests precede the
last empty-intrinsic-only correction, which is exercised by both database lanes.

The [selected typed maintenance cutover](../../../../../../roadmaps/mixed-mutation-core/24-whole-mutation-redesign-preflight.md#typed-activation-bound-maintenance-obligations)
was unimplemented in the held source measured here. Its current status belongs
to that preflight; this report does not measure its replacement. It moves stable opening obligations to their activation and
installation owners while preserving current authority, lifecycle and coverage
checks. It must prove actual writer authorization, retained-data conversion and
measured benefit; the remaining cost is not wholly attributed to certificate
representation.

The [complete native acceptance contract](../../../../../../roadmaps/mixed-mutation-core/26-native-business-baseline-preflight.md)
still requires complete matched pairs within 5 ms added median / 10 ms added P95,
at least thirty retained requests after five warmups (one hundred preferred),
stable tails, metadata scaling and genuine cold capacity. Those gates remain open.
Correctness and this measured iteration do not complete the redesign.
