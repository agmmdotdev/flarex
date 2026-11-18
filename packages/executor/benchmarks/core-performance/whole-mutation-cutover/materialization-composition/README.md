# Ordered materialization investigation

This iteration follows [prepared database reuse](../prepared-database/README.md).
The shared Application materializer now submits contiguous prepared rows, indexes,
unique admission, coverage and search through one fixed installed operation.
Actual callbacks retain their original barriers, and later preparation failures
retain their position after earlier stored proofs. Unique admission uses fresh
parents and current slots after preceding writes. Required physical lookup keys
use equality; complete stored proofs retain null-safe comparison.

The complete mixed Application + Product outcome and command cleanup pass.
Three warmups precede twenty retained requests; one separate request records SQL.

| Median ms | P95 ms | Maximum ms | SQL commands | Transactions |
| ---: | ---: | ---: | ---: | ---: |
| 161.38 | 165.98 | 169.53 | 40 | 2 |

[The report](./mixed-product.json) retains all samples. The preceding iteration
recorded 167.06 ms median, 200.29 ms P95 and 47 commands. Seven publication
submissions are removed, but complete latency remains far from native. These
observations establish **no accepted native-relative improvement**. This command
has `quietAcceptance: false` and a null paired excess; stored native percentiles
are a separate reference, not a paired request distribution.

The separate cold SQL diagnostic takes 339.50 ms and records:

| Actual phase | Commands | Sum of driver awaits ms |
| --- | ---: | ---: |
| Entry | 6 | 22.15 |
| Application execution | 2 | 19.83 |
| Product execution | 11 | 52.16 |
| Publication | 21 | 39.67 |

Product returns 21 rows and 37,726 decoded JSON UTF-8 bytes. The composed
materialization call takes 9.25 ms in this diagnostic; publication's complete
prefix takes 6.98 ms. Inclusive publication takes 84.85 ms. These instrumented
intervals do not explain exclusive costs in the quiet request distribution and
must not be substituted for its median. Initial installation, construction and
seeding are reported separately: preparation takes 23.74 seconds, and command
elapsed time is 48.99 seconds. Every actual request retains fresh checks.

[Integrity hashes](./integrity.json) bind the frozen bytes. The before/after
inventories record unchanged revision, 377 owned paths, 26 component paths, 1,275
bounded runtime sources, 43 harness sources and 349 promoted Medusa distribution
files. These are declared fingerprints, not executing-module traces. Database
inventories at both boundaries show an ordinary role, enabled durability, disabled
instrumentation and zero other selected-database clients. They do not establish
exclusive machine CPU or the absence of other clients throughout measurement.

Connected validation covers native unique refusal/ordering, malformed selected
storage, later-page trigger corruption, exact rollback, callback visibility,
search/coverage effects, maintenance backfill, real Product/Payload/workflow
settlement and lost-COMMIT recovery. Both project reviews are clear. These proofs
apply to the selected private profiles; broader hosted and production claims
remain outside their scope.

The [complete native acceptance contract](../../../../../../roadmaps/mixed-mutation-core/26-native-business-baseline-preflight.md)
still requires matched complete root pairs with at most 5 ms added median / 10 ms
added P95, at least thirty retained requests after five warmups (one hundred
preferred), stable tails, metadata scaling and genuine cold capacity. Those gates
remain open. Further redesign must address measured owner costs; reduced command
count and passing correctness alone do not finish the root.
