# Prepared database investigation

This frozen Product investigation follows
[immutable preparation](../immutable-preparation/README.md). It covers reuse of
pure finite-capture and installed-authority SQL compilation through the actual
database owner. Fresh transaction/session bindings, authentic claim and placement
checks, post-wait time checks and installation acceptance remain per execution.
It precedes the connected materialization composition replacement and establishes
**no accepted performance improvement**.

The complete mixed Application + Product business outcome passes. Three warmups
precede twenty retained requests; one separate request records SQL diagnostics.

| Median ms | P95 ms | Maximum ms | SQL commands | Transactions |
| ---: | ---: | ---: | ---: | ---: |
| 167.06 | 200.29 | 200.36 | 47 | 2 |

[The report](./mixed-product.json) retains every sample.
[Integrity hashes](./integrity.json) identify the frozen report and inventory
bytes. Command run `e6ef592d-8dab-4a66-b2e0-923f7ae6ba36` records dirty source at
shared revision `c6bbd01c5d9a9347e4475ff8d894294cb493f474` and 66905 ms CLI time.
The diagnostic still has six admission, two Application, eleven Product and
twenty-eight publication commands. Its cold, instrumented 341.02 ms duration and
129.23 ms sum of driver awaits do not explain exclusive costs in the retained
quiet samples.

[The before inventory](./source-before.json) was captured before measurement;
[the after inventory](./source-after.json) records unchanged revision, owned
paths, component paths, bounded runtime source and harness source. These are
source fingerprints, not executing-module traces. The database inventory records
an ordinary role and zero other selected-database client backends before the run.
It does not establish exclusive machine CPU use throughout measurement, surviving
connection plan reuse, or an after-run database inventory. Compiled native output
was not fingerprinted for this run.

This is an iteration measurement. `quietAcceptance` is false and `pairedExcess`
is null. The stored native numbers are a separately measured reference; their
percentiles cannot be subtracted from this request distribution. Changes to the
earlier measurement harness and that run's uncontrolled conditions prevent a
causal claim about the difference from immutable preparation.

The [complete native acceptance contract](../../../../../../roadmaps/mixed-mutation-core/26-native-business-baseline-preflight.md)
requires complete matched root pairs, at most 5 ms added median / 10 ms added P95,
final-source sampling of at least thirty retained requests after five warmups
(with one hundred preferred), stable tails, metadata scaling and genuine cold capacity. Those gates
remain open. Pre-existing installation and seed work are reported separately;
actual fresh authentication and readiness are included in every request.
