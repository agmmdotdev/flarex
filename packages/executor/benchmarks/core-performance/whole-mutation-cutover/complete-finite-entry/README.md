# Complete finite entry comparison

This frozen comparison measures the complete finite-entry and compact metadata
replacement after the [immutable evidence comparison](../immutable-evidence-reuse/README.md).
Entry uses the installed authority acceptance, complete request/context observation
and ordered metadata/completion commands. Original deadlines, complete post-trigger
anchor correlation and acknowledged settlement remain required.

`pnpm perf:core --daily --full --sql` retains twenty quiet requests after three
warmups per scenario. One separate diagnostic request records SQL. All five
business results pass; the complete numerical gates remain open.

| Scenario | Median ms | P95 ms | SQL commands | Transactions |
| --- | ---: | ---: | ---: | ---: |
| Payload create | 86.17 | 105.57 | 130 | 9 |
| Standalone Medusa workflow | 360.72 | 385.69 | 295 | 13 |
| Mixed Application + Product | 196.44 | 227.13 | 77 | 2 |
| Mixed + Payload | 231.06 | 266.03 | 80 | 2 |
| Mixed + Medusa workflow + Payload | 421.37 | 475.17 | 112 | 2 |

Product misses its 100/200 ms median/P95 gates. Product/Payload misses its 200 ms
median and meets its 400 ms P95 gate. Workflow meets its 500/1,000 ms gates.
All samples and maxima remain in the reports; Product's maximum is 358.93 ms.
No tail sample is removed. Lower counts do not establish latency acceptance.

The separate Product diagnostic records six entry commands, two Application
commands, fourteen Product commands and fifty-five publication commands. Their
summed SQL await is 22.86, 19.09, 64.46 and 32.28 ms respectively. Instrumented
entry/publication intervals are 54.98/75.55 ms. These diagnostic intervals and
their remainders do not establish quiet CPU attribution. Publication still
reconstructs lowering context and submits separate row/index/unique/search and
terminal writes. Actual acceptance, OCC, maintenance and final reference proofs
must survive any submission redesign.

The [matched native report](./matched-native-quiet.json) alternates native and
finite unique lookup for thirty retained hit and miss pairs after three warmups
per branch. It has no SQL or CPU observer in the timed method.

| Branch | Native median/P95 ms | Finite method median/P95 ms | Paired excess median/P95 ms | Complete finite request median/P95 ms |
| --- | ---: | ---: | ---: | ---: |
| Hit | 3.04 / 5.62 | 11.72 / 25.26 | 8.68 / 20.18 | 180.64 / 372.84 |
| Miss | 2.45 / 4.03 | 5.24 / 7.88 | 2.78 / 5.21 | 161.37 / 177.35 |

Miss meets the added 5/10 ms median/P95 gate; hit misses both. These paired
requests and the daily Product update have different business graphs. Their
percentiles cannot be subtracted. The hit path's current historical unique
membership and uncached row hydration are separate captured demands; this is
a concrete redesign candidate, not a measured cause of the complete excess.
Unrelated-metadata scaling and complete capacity acceptance remain separate.

Run `1b3f0e46-810c-4762-b336-4b3852e4446b` records dirty source at base
`5c9152621a6d4c177be8c314fa336d525e92c585` and 314422.45 ms CLI time.
The [runtime checkpoint](./runtime-source-checkpoint.json) contains 211 owned
files and two deletions. The [harness checkpoint](./benchmark-harness-source-checkpoint.json)
records the executing twenty-seven harness sources, including the separate
uncommitted measurement expansion. [After-run verification](./source-after.json)
found no changes in either source set. Receipt report paths alone are normalized
for portability. The CLI's `quietAcceptance` field selects its sampling policy;
it does not certify the numerical gates above.

The [executing inventory](./executing-evidence.json) preserves the matching 1,396
promoted framework outputs and pinned native entries. This is bounded fingerprint
evidence, not a dynamic module trace. Ordinary-role PostgreSQL 18 retains enabled
durability; statement tracking is disabled. No heavy validation runs overlap the
quiet or native measurements. Local results do not establish hosted behavior.
