# Prepared storage capture comparison

This frozen comparison adds protocol-level named-statement parsing reuse to
[finite storage capture](../finite-storage-capture/README.md). The database binds
fresh inputs and executes actual authority, liveness, retention and readiness
checks on each demand. Parsed SQL is not a cached permission or query result.

`pnpm perf:core --all --full --sql` retains twenty quiet serial requests after
three warmups, with a separate SQL diagnostic request. All five committed business
results pass. Complete numerical acceptance still fails.

| Scenario | Median ms | P95 ms | SQL commands | Transactions |
| --- | ---: | ---: | ---: | ---: |
| Payload create | 72.75 | 77.84 | 130 | 9 |
| Standalone Medusa workflow | 290.64 | 306.13 | 295 | 13 |
| Mixed Application + Product | 196.08 | 707.57 | 93 | 2 |
| Mixed + Payload | 202.09 | 236.63 | 96 | 2 |
| Mixed + Medusa workflow + Payload | 362.54 | 407.39 | 131 | 2 |

Product fails 100/200 ms median/P95. Product/Payload fails its 200 ms median and
meets 400 ms P95. Workflow meets 500/1,000 ms. Preserve every retained sample,
including Product's 822.26 ms maximum; its tail cause remains unestablished.
The preceding capture comparison is preserved, including its failed gates.

The separate Product diagnostic attributes 21 commands and 27.86 ms summed
driver await to admission, 2 and 16.87 ms to Application work, 14 and 55.30 ms
to native Product work, and 56 and 35.44 ms to publication. Compared with the
preceding 81.53 ms native Product diagnostic, named parsing reuse reduces
observed await while leaving command counts unchanged. These instrumented
intervals are not quiet component timings or exclusive CPU attribution.

Run `ce99f461-7a4d-4e26-943b-3b2687c6e3c1` records base
`5c9152621a6d4c177be8c314fa336d525e92c585`, dirty source, and 257371.20 ms
CLI time. The [source checkpoint](./runtime-source-checkpoint.json) records the
194 runtime/document hashes and two removed files at this measurement. Raw reports
retain environment, setup, all samples and diagnostic dispatch groups. Only
command receipt paths are normalized for portability. Other agents, tests and
reviews were idle; PostgreSQL statement tracking was disabled.

This ordinary-role local PostgreSQL evidence establishes neither hosted
performance nor the separate matched native 5/10 ms and metadata scaling gates.
