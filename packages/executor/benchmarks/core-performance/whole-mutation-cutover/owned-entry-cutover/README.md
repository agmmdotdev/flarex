# Owned finite entry and logical capture measurement

These frozen reports measure the complete owned finite start and logical
metadata/receipt capture replacement. Each scenario retains twenty quiet
requests after three warmups and one separate SQL diagnostic request. All five
business checks pass; numerical acceptance remains open under
[preflight 24](../../../../../../roadmaps/mixed-mutation-core/24-whole-mutation-redesign-preflight.md).

| Scenario | Median ms | P95 ms | SQL dispatches | Transactions |
| --- | ---: | ---: | ---: | ---: |
| Payload create | 78.87 | 92.35 | 136 | 9 |
| Standalone Medusa workflow | 318.34 | 656.22 | 295 | 13 |
| Mixed Application + Product | 190.43 | 200.42 | 157 | 13 |
| Mixed + Payload | 213.20 | 222.45 | 165 | 14 |
| Mixed + workflow + Payload | 407.00 | 445.30 | 276 | 27 |

Product misses both its 100 ms median and 200 ms P95 gates. Mixed Payload misses
its 200 ms median gate and passes its 400 ms P95 gate; mixed workflow passes its
500/1,000 ms gates. Report status and `quietAcceptance` describe successful
business assertions and measurement mode, respectively; neither closes a
numerical gate. SQL fell by five commands and one transaction in the mixed
scenarios relative to the dependency comparison, without a material latency
improvement. Standalone Medusa variability also prevents a latency-saving claim.

The separate Product diagnostic attributes 73 commands and ten short
transactions to storage mechanics inside the native Product update, including
20 transaction-control commands, ten installation/placement/authority projection
commands, ten canonical-anchor reads, ten fresh storage-frontier reads, ten
index/unique reads, nine historical row reads and four other clock/build-state
commands. This is Flarex storage work inside native business execution, rather
than evidence that the native ORM itself requires 73 commands. Diagnostic
awaited times are attribution evidence, not exclusive CPU time or the quiet
latency distribution. Nested server statements remain additional work.

Local PostgreSQL uses ordinary execution roles with fsync, synchronous commit
and full-page writes enabled. Statement tracking is disabled during quiet
timing; agents are idle and source is frozen. Raw reports retain every sample,
maximum, setup cost and command receipt. These are complete workload
measurements, rather than matched native-method overhead or hosted performance.
The selected finite storage capture replacement is subsequent work and is not
represented by this measurement.
