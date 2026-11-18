# Finite storage capture comparison

This frozen comparison measures the connected named finite storage capture
replacement, before subsequent protocol parsing reuse. Run
`pnpm perf:core --all --full --sql` with three discarded warmups and twenty
retained serial requests per scenario; a separate request supplies SQL diagnostics.
All five business result checks pass. Numerical acceptance fails.

| Scenario | Median ms | P95 ms | SQL commands | Transactions |
| --- | ---: | ---: | ---: | ---: |
| Payload create | 72.54 | 79.99 | 130 | 9 |
| Standalone Medusa workflow | 297.56 | 312.44 | 295 | 13 |
| Mixed Application + Product | 225.75 | 251.63 | 93 | 2 |
| Mixed + Payload | 248.92 | 263.15 | 96 | 2 |
| Mixed + Medusa workflow + Payload | 460.11 | 1015.05 | 131 | 2 |

Product fails 100/200 ms median/P95, Product/Payload fails its 200 ms median
while meeting 400 ms P95, and workflow fails 1000 ms P95 while meeting 500 ms
median. Preserve maxima and all samples, including the workflow outlier.

Compared with [owned entry](../owned-entry-cutover/README.md), captures reduce
mixed commands and transactions but regress median latency. The separate Product
diagnostic attributes 14 commands and 81.53 ms summed driver await inside native
Product work, versus 73 commands and 41.17 ms previously; Application points use
2 commands and 17.50 ms versus 7 and 4.87 ms. Admission and publication remain
separately charged. These diagnostic intervals include instrumentation and are
not quiet component timings or exclusive CPU attribution.

The CLI receipt records run `3ad7863e-0026-4e50-9022-06f90c04785a`, source revision
`5c9152621a6d4c177be8c314fa336d525e92c585` with dirty source fingerprints, and
268950.34 ms total. Raw reports retain setup, source hashes, runtime settings,
all measured samples and diagnostic dispatch groups. Only command receipt paths
are normalized for portability. Agents, tests and reviews were idle during the
quiet run; PostgreSQL statement tracking was disabled, then client SQL diagnostics
ran separately. Local ordinary-role PostgreSQL evidence establishes neither
network round trips nor hosted or arbitrary-framework performance.
