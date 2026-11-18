# Finite Architectural Cutover Milestone

Status: **all five functional scenarios pass; fixed mixed latency targets fail.**
This report measures the final private finite execution cutover. Architectural
delivery and performance acceptance are separate. No terminal durability
replacement or hosted activation is exercised.

Each scenario runs a separate SQL diagnostic first, then three warmups and twenty
measured requests. These direct Node measurements exclude Worker ingress. Setup,
entry, complete invocation and cleanup remain visible in the reports.

| Scenario | Median / P95 ms | Diagnostic submissions | Diagnostic transactions |
| --- | ---: | ---: | ---: |
| Payload create | 80.445 / 102.450 | 136 | 9 |
| Medusa workflow | 279.805 / 293.862 | 310 | 13 |
| Mixed Product | 487.869 / 543.483 | 559 | 50 |
| Mixed Product + Payload | 691.111 / 739.820 | 761 | 53 |
| Mixed finite workflow | 1,444.436 / 1,528.151 | 1,511 | 69 |

The mixed targets remain 100/200, 200/400 and 500/1,000 ms median/P95 respectively.
All three fail both thresholds. `status: passed` records functional assertions;
it does not record numerical acceptance. Outliers and failed earlier checkpoints
remain preserved. SQL instrumentation belongs to the separate diagnostic.

Every diagnostic reports zero open transactions, query errors, lost-context,
unknown-statement and unobserved submissions, and incomplete spans. Awaited SQL
sums and nested intervals do not establish exclusive CPU or a latency cause.

Before/after executing-evidence supplements verify the same 1,396 promoted outputs
and twelve native entries against the original inventory. The separately recorded
authored native runner remains the sole native inventory difference. Reports
retain the actual dirty revision and run identity. The companion final native
comparison is [finite contract 05](../finite-contract-native/finite-contract-native-05-quiet.json).
Further small optimizations remain a subsequent phase of the completed private
architecture, with fixed acceptance gates unchanged.
