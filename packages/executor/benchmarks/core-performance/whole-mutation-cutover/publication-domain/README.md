# Publication domain comparison

This frozen comparison measures the connected historical original-row capture,
complete finite publication observation, shared bounded materialization and final
prefix/clock submission replacement after the
[complete-entry comparison](../complete-finite-entry/README.md).

`pnpm perf:core --daily --full --sql` retains twenty quiet requests after three
warmups per scenario, with a separate SQL diagnostic request. All five business
results pass. Mixed Payload and workflow meet their latency gates; Product still
misses its median gate. Lower command counts do not establish whole acceptance.

| Scenario | Median ms | P95 ms | SQL commands | Transactions |
| --- | ---: | ---: | ---: | ---: |
| Payload create | 75.84 | 80.62 | 124 | 9 |
| Standalone Medusa workflow | 318.01 | 355.82 | 272 | 13 |
| Mixed Application + Product | 169.52 | 178.96 | 47 | 2 |
| Mixed + Payload | 191.80 | 201.29 | 49 | 2 |
| Mixed + Medusa workflow + Payload | 391.51 | 421.51 | 70 | 2 |

Product meets its 200 ms P95 gate but misses its 100 ms median gate. Product/Payload
meets its 200/400 ms gates; workflow meets its 500/1,000 ms gates. All retained
samples and maxima remain in the reports. No outliers are removed.

The separate Product diagnostic records six entry, two Application, eleven Product
update and twenty-eight publication commands. Their summed SQL await is 20.18,
17.14, 44.89 and 41.45 ms. Instrumented entry, Product-update and publication spans
are 65.48, 102.94 and 83.19 ms, with a 305.04 ms instrumented complete request.
These diagnostic spans are not quiet CPU measurements. The actual publication
count exceeds its proposed nineteen-to-twenty-three command budget; that proposal
does not replace the unchanged complete latency gates. No effectful transaction
callback is installed in this healthy scenario.

The [matched native report](./matched-native-quiet.json) alternates native and
finite unique retrieval for thirty retained hit and miss pairs after three warmups
per branch. Full DTO and exact missing-error comparisons pass. No SQL or CPU
observer runs in the quiet timed methods.

| Branch | Native median/P95 ms | Finite method median/P95 ms | Paired added median/P95 ms | Complete finite request median/P95 ms |
| --- | ---: | ---: | ---: | ---: |
| Hit | 2.41 / 2.97 | 8.61 / 10.55 | 6.14 / 8.19 | 158.93 / 196.11 |
| Miss | 1.97 / 2.40 | 6.80 / 9.93 | 4.85 / 7.66 | 168.22 / 449.84 |

Hit meets the added 10 ms P95 gate but misses the 5 ms median gate. Miss meets both
added-cost gates. Complete miss-request tail latency has regressed relative to
the preceding frozen comparison and remains unresolved: later retained requests
take roughly 322–476 ms. All are retained; no cause is claimed. These paired
requests and the daily Product update have different business graphs, so their
percentiles cannot be subtracted. The eight 1/100 metadata-scaling quiet series
remain required against the final corrected runtime.

The separate [two-pair diagnostic](./matched-native-trace.json) confirms one actual
storage capture per hit or miss. Returned rows include authentic metadata and the
hit's business document; the whole returned payload is not pure metadata overhead.
Preparation accounting does not grow during retrieval. Its instrumented times
are diagnostic evidence, not another quiet acceptance series.

Run `051a5507-c528-4d9e-8fff-fc7834f9ae0c` records dirty source at base
`5c9152621a6d4c177be8c314fa336d525e92c585` and 256768.47 ms CLI time.
The [runtime checkpoint](./runtime-source-checkpoint.json) fingerprints 250 owned
files and two deletions. [After-run verification](./source-after.json) finds no
owned runtime changes or restored deletions. Its twenty-seven-source harness
inventory is an after-run snapshot compared with the preceding frozen harness,
not a separate before-run inventory for this series. Only the already recorded
root-owned fixture seams differ from that preceding harness. Report paths in the
command receipt alone are normalized. Its `quietAcceptance` field describes the
sampling policy, not numerical success.

The [before](./executing-before.json) and [after](./executing-after.json) executing
inventories preserve the matching 1,396 promoted framework outputs and twelve
pinned native entries. They are bounded fingerprints, not dynamic module traces.
Ordinary-role PostgreSQL 18 retains enabled durability; statement tracking is
disabled on both selected databases. No heavy validation overlaps these quiet or
native measurements. Local results do not establish hosted behavior.
