# Compact-anchor baseline before the complete preparation cutover

This is the failed complete-workload acceptance baseline for the compact finite
anchor, shared pending graph and direct final settlement. It precedes the
remaining Application preparation, installed admission, publication-definition
and local-point connections selected in mixed-mutation slice 24. Keep it as
failure evidence; successful business assertions do not mean latency acceptance.

Command: `pnpm perf:core --all --full --sql`. PostgreSQL used its ordinary runtime
role with synchronous commit and fsync enabled, statement tracking disabled and
auto-explain disabled. Each quiet workload retains 20 samples after three
warmups. SQL counts come from a separate traced execution. The raw reports retain
all samples, maxima, environment, construction costs and inclusive timing spans.
Those spans do not establish exclusive CPU attribution.

| Workload | Quiet median ms | Quiet P95 ms | Traced SQL statements | Transactions |
| --- | ---: | ---: | ---: | ---: |
| Native Payload create | 79.1283 | 84.0337 | 136 | 9 |
| Native Medusa workflow | 291.5242 | 302.0714 | 310 | 13 |
| Mixed Product | 323.7659 | 606.9755 | 413 | 44 |
| Mixed Product and Payload | 331.6788 | 378.5252 | 437 | 46 |
| Mixed workflow | 633.9013 | 743.2155 | 735 | 65 |

The fixed mixed median/P95 gates are 100/200, 200/400 and 500/1,000 ms in
workload order. Product fails both gates; the other mixed workloads fail their
median gates. No retained outlier is excluded. The source checkpoint identifies
the dirty files actually measured; the Git revision alone is not that source.
The command manifest keeps its original output locations for provenance, while
the copied report files beside this README are the retained artifacts.
