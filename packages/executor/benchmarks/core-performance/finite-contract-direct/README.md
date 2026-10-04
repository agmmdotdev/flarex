# Finite Execution Direct Milestone

Status: **functional checks pass; mixed latency targets fail.** Each scenario runs
one separate SQL diagnostic first, then three warmups and twenty measured requests.
These direct Node measurements exclude
Worker ingress and do not establish hosted readiness.

| Scenario | Median / P95 ms | Diagnostic submissions | Diagnostic transactions |
| --- | ---: | ---: | ---: |
| Payload create | 73.190 / 77.856 | 136 | 9 |
| Medusa workflow | 278.357 / 330.475 | 310 | 13 |
| Mixed Product | 473.507 / 521.046 | 563 | 50 |
| Mixed Product + Payload | 679.130 / 767.259 | 765 | 53 |
| Mixed finite workflow | 1,429.858 / 1,547.944 | 1,515 | 69 |

The mixed Product, Product + Payload and workflow goals remain 100/200,
200/400 and 500/1,000 ms median/P95 respectively. A report's `status: passed`
records the executing functional checks; it does not mean these targets pass.
SQL instrumentation belongs to the separate diagnostic and is not quiet timing.
Every diagnostic reports zero open transactions, query errors, lost-context,
unknown-statement and unobserved submissions, and incomplete spans.

The Product diagnostic records 700.550 ms across the complete invocation,
including 170.563 ms request admission, 184.109 ms portable execution,
137.482 ms seal/verification and 207.221 ms publication. The publication interval
includes 150 control and 69 target submissions. These intervals show where to
investigate; neither non-SQL remainder nor nested intervals establish exclusive
CPU or a latency cause. The full report retains setup and cleanup costs.

Before/after executing-evidence supplements verify the same 1,396 promoted
outputs and twelve native entries against the original inventory. The separately
recorded authored native runner remains the only native inventory difference.
The reports retain the actual dirty revision and run identity.
