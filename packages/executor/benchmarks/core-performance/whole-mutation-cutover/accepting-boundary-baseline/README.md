# Accepting-boundary redesign baseline

Frozen local ordinary-role PostgreSQL measurement before the accepting-boundary
replacement in [preflight 24](../../../../../../roadmaps/mixed-mutation-core/24-whole-mutation-redesign-preflight.md).
Runtime identity is `runtime-checkpoint.json`, base `5c9152621`, manifest SHA256
`9C0B5863EF9000369D9DFEF31E5D8F05894B64D7224887E9C6B010ABACEA1EB3`.
The command used three discarded warmups, twenty retained requests per workload,
and a separate SQL diagnostic: `pnpm perf:core --all --full --sql`.

| Workload | Median ms | P95 ms | SQL dispatches | Transactions |
| --- | ---: | ---: | ---: | ---: |
| Payload create | 77.94 | 84.81 | 136 | 9 |
| Medusa workflow | 293.50 | 317.05 | 310 | 13 |
| Mixed Product | 230.05 | 246.96 | 230 | 19 |
| Mixed Product/Payload | 261.96 | 286.66 | 243 | 20 |
| Mixed workflow | 478.15 | 1,342.11 | 411 | 33 |

All business/result assertions passed. The fixed mixed Product median/P95,
Product/Payload median and workflow P95 targets failed. The workflow's retained
maximum was 1,461.05 ms. Raw samples and all setup, seeding, publication and
diagnostic observations remain in the reports; no outlier is removed.

The diagnostic attributes Product admission to 31 activation plus 8 initial
renewal statements; Application's first storage demand additionally resolves
placement in two control transactions. Product's actual native update uses ten
checked storage frontiers and 92 target statements. Final publication uses
13 control statements in three transactions plus 70 target statements in one
transaction; workflow publication uses the same fixed control work and 118
target statements. Awaited SQL, diagnostic phase spans and server timings overlap
and do not establish exclusive CPU or network round trips.

`native-server.json` is a separate two-pair diagnostic with tracking enabled.
It proves positive installed/placement/authority/anchor/serving/liveness work;
its timings cannot satisfy quiet gates. Tracking was restored to `none` before
the complete quiet run. Durability settings stayed enabled. Executing native and
promoted framework builds were not rebuilt. These local measurements do not
claim hosted or production readiness.
