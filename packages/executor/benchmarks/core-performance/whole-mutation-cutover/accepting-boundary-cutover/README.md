# Accepting-boundary cutover measurement

These frozen reports measure the connected accepting-boundary replacement with
three warmups, twenty retained quiet requests per scenario, and a separate SQL
diagnostic request. All five business checks pass. Numerical acceptance remains
open under [preflight 24](../../../../../../roadmaps/mixed-mutation-core/24-whole-mutation-redesign-preflight.md).

| Scenario | Median ms | P95 ms | SQL dispatches | Transactions |
| --- | ---: | ---: | ---: | ---: |
| Payload create | 78.27 | 83.69 | 136 | 9 |
| Standalone Medusa workflow | 274.74 | 287.48 | 310 | 13 |
| Mixed Application + Product | 193.99 | 254.21 | 175 | 14 |
| Mixed + Payload | 223.21 | 263.00 | 185 | 15 |
| Mixed + workflow + Payload | 428.32 | 487.12 | 321 | 28 |

Product misses both 100/200 ms gates. Mixed Payload misses its 200 ms median
gate; workflow passes its 500/1,000 ms gates. These are complete workload targets,
not matched native-method overhead results. The reports retain samples, maxima,
source fingerprints, setup costs and the command receipt. Their passing status
records business assertions, not acceptance of these latency targets.

Local PostgreSQL uses ordinary execution roles with fsync, synchronous commit
and full-page writes enabled, statement tracking disabled for quiet timing,
and no concurrent agent work. Subsequent source changes are not represented by
this frozen comparison. No hosted or production performance is established.
