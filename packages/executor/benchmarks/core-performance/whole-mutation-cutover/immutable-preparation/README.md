# Immutable preparation investigation

This frozen investigation follows [publication-domain](../publication-domain/README.md).
It covers native immutable definition preparation, authenticated narrow Application
projections, working-set and ordered closure reuse, and private frozen evidence
transfer. It precedes the deeper prepared-database and settlement replacement.
It establishes **no accepted performance improvement**.

The five complete business outcomes pass. The iteration policy retains twenty
requests after three warmups and a separate SQL diagnostic request per scenario.

| Scenario | Median ms | P95 ms | Maximum ms | SQL commands | Transactions |
| --- | ---: | ---: | ---: | ---: | ---: |
| Payload create | 84.16 | 86.96 | 90.80 | 124 | 9 |
| Standalone Medusa workflow | 353.35 | 415.92 | 417.61 | 272 | 13 |
| Mixed Application + Product | 181.34 | 301.89 | 358.40 | 47 | 2 |
| Mixed + Payload | 201.26 | 222.53 | 233.50 | 49 | 2 |
| Mixed + Medusa workflow + Payload | 419.43 | 506.62 | 603.83 | 70 | 2 |

All samples, maxima, report bytes and original command paths are retained.
[Integrity hashes](./integrity.json) identify the frozen bytes. Command run
`e867e6f7-bbb7-41e4-b5d0-7126675fd243` records dirty source at shared revision
`09466e3f7ff42c0760a62e3f01861175ccbe1c58` and 283474.39 ms CLI time. Product's
diagnostic still has six entry, two Application, eleven Product and twenty-eight
publication commands; SQL reductions alone are not acceptance.

This is **not a controlled final-source quiet acceptance run**. The
[initial source inventory](./source-initial.json) was taken after command launch,
not before it. [The after inventory](./source-after.json) retains the actual
comparison: owned runtime source did not change, but the performance test, its
configuration and CLI harness changed during execution. Other benchmark work also
ran validation during this measurement period. Runtime checkpoint 39 contains
hashes rather than historical source blobs. Its three documentation/provenance
members already differed when the later initial inventory was taken. These gaps
prevent attributing the changed distribution to this correction. Original
`quietAcceptance` report fields describe the earlier harness sampling policy;
they do not establish isolation, source stability or numerical success.

The [method-level matched diagnostic](./matched-native-quiet.json) retains thirty
alternating native/finite hit and miss pairs after three warmups. Full DTO,
missing-error and committed readback comparisons pass.

| Branch | Native median/P95 ms | Finite method median/P95 ms | Paired added median/P95 ms | Complete finite median/P95/maximum ms |
| --- | ---: | ---: | ---: | ---: |
| Hit | 2.74 / 5.02 | 9.39 / 15.44 | 6.49 / 12.86 | 177.81 / 205.88 / 267.02 |
| Miss | 2.17 / 2.75 | 7.64 / 10.04 | 5.45 / 7.72 | 162.79 / 190.55 / 209.23 |

Hit misses both former method added-cost budgets; miss misses its median budget.
This also lacks proven exclusive measurement isolation. The complete request and
native lookup have different business graphs, so their percentiles cannot be
subtracted. The previous miss-request tail was not reproduced here; its cause
remains unknown. No outliers are removed.

The [selected native reference](../../../../../../roadmaps/mixed-mutation-core/26-native-business-baseline-preflight.md)
requires complete matched root pairs, at most 5 ms added median / 10 ms added P95
once per root, final-source quiet sampling, stable tails and complete business
equivalence. Neither these method probes nor the older absolute milestones close
that gate. Final metadata scaling and genuine cold capacity also remain required.
The executing-before inventory fingerprints twelve native and 1,396 promoted
outputs; it is a bounded inventory, not a dynamic module trace or an after-run
source proof. No production or hosted performance claim follows from this run.
