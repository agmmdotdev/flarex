# Dependency cutover measurement

These frozen reports measure the accepting-boundary replacement plus ordered
dependency batches and entry reservation ownership. Each scenario retains twenty
quiet requests after three warmups and one separate SQL diagnostic request. All
five business checks pass. Numerical acceptance remains open under
[preflight 24](../../../../../../roadmaps/mixed-mutation-core/24-whole-mutation-redesign-preflight.md).

| Scenario | Median ms | P95 ms | SQL dispatches | Transactions |
| --- | ---: | ---: | ---: | ---: |
| Payload create | 75.03 | 80.23 | 136 | 9 |
| Standalone Medusa workflow | 269.17 | 280.28 | 295 | 13 |
| Mixed Application + Product | 190.22 | 197.55 | 162 | 14 |
| Mixed + Payload | 209.83 | 218.16 | 170 | 15 |
| Mixed + workflow + Payload | 401.44 | 416.86 | 281 | 28 |

Product passes its 200 ms P95 gate but misses its 100 ms median gate. Mixed
Payload misses its 200 ms median gate; workflow passes its 500/1,000 ms gates.
Passing report status records business assertions, not numerical acceptance.
The reports preserve every sample, maximum, setup cost and command receipt.

Local PostgreSQL uses ordinary execution roles, enabled fsync, synchronous commit
and full-page writes, disabled statement tracking for quiet timing, and no
concurrent agent work. These are complete workload measurements, not matched
native-method overhead or hosted performance results. Subsequent owned-start and
logical capture changes are not represented by this frozen comparison.
