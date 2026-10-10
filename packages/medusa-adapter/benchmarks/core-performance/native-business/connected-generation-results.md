# Connected generation measurement checkpoint

This is a historical correctness-validated, measured implementation checkpoint, not native-relative performance acceptance. All five complete quiet graphs failed the unchanged **5 ms paired added median / 10 ms paired added P95** gates. The [CPU execution correction checkpoint](./cpu-execution-results.md) records the successor implementation and current measurements; the numbers below remain this earlier cohort's evidence.

The implementation replaces repeated protected static preparation with original generation-owned evidence across Application, Payload, Commerce and AtomicCommerce. It preserves fresh authentication, liveness, native acceptance, dynamic readiness, OCC, locks, atomic publication, cancellation and recovery. Initial finite entry refreshes the whole graph once before business. Frozen retry and persisted cold redispatch have explicit contracts on the same replacement owner. Migration 0140 extends the metadata writer interlock; installed databases require that migration before the protected profile accepts them. No durable business data is deleted.

## Complete request latency

Milliseconds. Thirty alternating matched pairs and five warmups per lane for each graph. Paired excess is calculated per pair before taking percentiles; subtracting independently reported medians is not equivalent.

The native lane is the [complete business reference](./README.md), not an equivalent atomic Application/OCC/history/publication implementation. Its Application writes are PostgreSQL JSON surrogates and native framework calls commit independently. Flarex-only authentication, fencing, idempotency, history and durable outcome/publication costs remain inside the measured excess and the unchanged budget. The results do not classify every millisecond of that excess as avoidable.

| Graph | Native median | Flarex median | Added median | Added P95 | Flarex maximum | Native gate |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Mixed Product | 11.91 | 131.29 | 117.18 | 159.76 | 178.23 | Fail |
| Payload create | 1.43 | 46.64 | 44.80 | 52.64 | 55.79 | Fail |
| Medusa workflow | 21.18 | 223.23 | 200.89 | 401.24 | 695.85 | Fail |
| Mixed Payload | 17.48 | 146.97 | 130.27 | 143.30 | 163.86 | Fail |
| Mixed workflow | 36.96 | 296.11 | 259.34 | 300.89 | 345.89 | Fail |

All 150 matched pairs completed and verified committed business results. Every graph passed source stability, durable settings, cleanup, sampling and complete-request gates. No measured Flarex request reached one second. Medusa nevertheless has a substantial tail: its maximum was 695.85 ms. Its added P95 worsened; that observation is retained and its precise cause is not established by this cohort.

## Latency comparison

Values are paired added median / P95 in milliseconds. The previous candidate is the first complete authenticated cutover cohort, not the intermediate SDK run that exposed 90 repeated catalogue exchanges. Comparisons across separate runs are descriptive; within-run native pairs provide the acceptance evidence.

| Graph | Original baseline | Previous candidate | Current checkpoint | Added-median reduction from baseline |
| --- | ---: | ---: | ---: | ---: |
| Mixed Product | 209.67 / 234.00 | 122.13 / 151.32 | 117.18 / 159.76 | 44.11% |
| Payload create | 81.50 / 105.00 | 114.40 / 212.32 | 44.80 / 52.64 | 45.03% |
| Medusa workflow | 282.62 / 319.13 | 209.47 / 243.22 | 200.89 / 401.24 | 28.92% |
| Mixed Payload | 174.65 / 198.81 | 124.19 / 142.29 | 130.27 / 143.30 | 25.41% |
| Mixed workflow | 367.47 / 393.64 | 263.67 / 316.94 | 259.34 / 300.89 | 29.43% |

## Database cost

Cells contain **driver exchanges / checkouts / explicit transactions** per measured Flarex business graph. One warmup, one observer-calibration call and one diagnostic call per graph. These are measured driver exchanges, not Effect dispatches or framework method counts. Statements are reported separately. Native SQL counts were not independently collected in this lane; native request latency and CPU were matched separately.

| Graph | Original baseline | Previous candidate | Current checkpoint | Current observed statements |
| --- | ---: | ---: | ---: | ---: |
| Mixed Product | 40 / 16 / 2 | 33 / 16 / 2 | 33 / 16 / 2 | 33 |
| Payload create | 111 / 16 / 8 | 169 / 33 / 17 | 44 / 1 / 1 | 44 |
| Medusa workflow | 252 / 16 / 13 | 122 / 1 / 1 | 122 / 1 / 1 | 122 |
| Mixed Payload | 42 / 17 / 2 | 34 / 17 / 2 | 34 / 17 / 2 | 34 |
| Mixed workflow | 58 / 33 / 2 | 50 / 33 / 2 | 50 / 33 / 2 | 50 |

The actual SDK integration separately passed both PGlite and ordinary PostgreSQL cases. Its mixed Product ledger returned to **33 exchanges, 16 checkouts, two transactions**, from the failed intermediate SDK ledger's 123 exchanges, 17 checkouts and three transactions. All three zero-warm-static-catalogue SQL assertions passed. The 90-exchange catalogue replay is removed; the other measured request work remains.

The standalone Payload regression is corrected: its current graph uses one checkout and one explicit transaction. Medusa also uses one checkout and one explicit transaction, yet retains 122 exchanges. Mixed Product, mixed Payload and mixed workflow retain 16, 17 and 33 checkouts respectively. Fewer transactions alone therefore do not establish native-relative latency.

## Root CPU

Milliseconds; five measured pairs and five warmups per lane. Thread CPU measures the root JavaScript thread; process CPU includes sibling threads. These exclude PostgreSQL server CPU and are not exclusive per-owner CPU profiles. Windows readings show approximately 15–16 ms steps, so a reported native zero means below observed counter resolution rather than no work. CPU values come from a separate run and must not be subtracted from quiet latency to invent an exact wait budget.

| Graph | Native thread | Flarex thread | Paired added thread | Native process | Flarex process | Paired added process |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Mixed Product | 0.00 | 63.00 | 63.00 | 0.00 | 63.00 | 63.00 |
| Payload create | 0.00 | 31.00 | 31.00 | 0.00 | 46.00 | 46.00 |
| Medusa workflow | 16.00 | 203.00 | 187.00 | 16.00 | 235.00 | 218.00 |
| Mixed Payload | 16.00 | 94.00 | 93.00 | 16.00 | 109.00 | 93.00 |
| Mixed workflow | 32.00 | 203.00 | 171.00 | 46.00 | 219.00 | 203.00 |

| Graph | Original added thread / process | Current added thread / process |
| --- | ---: | ---: |
| Mixed Product | 94.00 / 109.00 | 63.00 / 63.00 |
| Payload create | 46.00 / 63.00 | 31.00 / 46.00 |
| Medusa workflow | 172.00 / 266.00 | 187.00 / 218.00 |
| Mixed Payload | 125.00 / 141.00 | 93.00 / 93.00 |
| Mixed workflow | 187.00 / 187.00 | 171.00 / 203.00 |

The previous candidate's mixed Product CPU run failed during warm preparation and supplied no valid pairs; it is not replaced with an inferred value. This checkpoint completed all five CPU graphs. The 187 ms added root-thread CPU for Medusa and 171 ms for mixed workflow demonstrate that substantial application-side work remains alongside SQL costs. Exact remaining CPU function/stack attribution is not established by these totals.

## Setup cost

Seconds for complete cohort setup, shown separately from warm request latency. Includes fixture provisioning, preparation and seeding; these are laboratory setup totals, not a production cold-request claim. Per-sample seeding, result verification and cleanup are retained in the raw reports.

| Graph | Quiet setup | CPU setup | Database setup |
| --- | ---: | ---: | ---: |
| Mixed Product | 25.39 | 29.58 | 21.21 |
| Payload create | 15.08 | 14.43 | 14.08 |
| Medusa workflow | 38.26 | 30.85 | 27.20 |
| Mixed Payload | 25.26 | 25.80 | 23.16 |
| Mixed workflow | 32.67 | 35.20 | 29.39 |

## Proven changes and limits

- Original construction-only loans bind static catalogues and templates to their actual Current generation and exact protected pair. Same-host epoch refresh, source replacement, stale-token refusal and cancellation rollback are proved across all three framework profiles and both drivers.
- Finite initial entry, replacement and cold recovery retain their actual native guards. Invalid supplied certificates cannot fall back to recovery. Constructor cancellation drains before cleanup and generation release, preserving typed, compound and foreign failures.
- Authentic closed roots and canonical results reuse their original evidence; restored or foreign bytes still validate. Generated insertion occupancy retains tombstone/history checks and genuine-read conflict precedence.
- The measured native targets remain failed. This checkpoint does not prove production load, Cloudflare deployment, scaling, or precise attribution of every remaining CPU/wait cost. Source-specific simultaneous control-reader and rollback failure still lacks a genuine dynamic injection witness; generic Cause/drain tests and source cancellation cover related boundaries.

Validation included persistence, executor, SDK and all five Medusa strict configurations; core/diff lint, Effect and complete Medusa source guards; 317 SDK unit tests; actual SDK integration; six source-generation cases; eight native generation/frozen obligations across retained corrected receipts; ten selected both-driver Workerd replacement/recovery/replay/cancellation cases; fourteen Cause/drain bridge tests; and prior unchanged writer-interlock, generated-history and publication proofs. Both final reviewers cleared the frozen 244-path source checkpoint after removal of the unused unique-owner wrapper. Runtime tests passing establishes correctness of the examined paths, not latency acceptance.

## Reproducible evidence

Base: **a0c0337190360698180c6e08cf685ae6006c3dd9**. Candidate branch: **codex/connected-core-performance-redesign**. The source manifest is archived below; Git records the final code and documentation. Baseline and current report files retain exact source digests, settings, graph cardinality, samples, gates and cleanup. They were collected serially with reviewers idle for the complete cohort, PostgreSQL 18.3 on the same local Windows machine, ordinary serving roles, and durability enabled. Only fixture provisioning used the provisioning endpoint. No silent retries or changed thresholds were used.

Quiet attempt: **2026-10-09T14-11-08-742Z-3eac50d5-5599-48dc-8365-cb737c7854f6**.
CPU attempt: **2026-10-09T14-18-57-172Z-b65abde8-b142-4852-b81a-10a7eaf66402**.
Database attempt: **2026-10-09T14-25-02-493Z-27c80f48-a7e3-4770-8d65-6713b15ccc29**.

[Complete comparison](reports/connected-generation/comparison.json.gz), [previous comparison and its failed CPU-attempt disposition](reports/connected-generation/previous-comparison.json.gz), [reviewed source checkpoint](reports/connected-generation/source-checkpoint.json.gz), and [archive checksums](reports/connected-generation/archive.json).

| Graph | Checkpoint | Lane | Compressed original report |
| --- | --- | --- | --- |
| Mixed Product | baseline | quiet | [9245a250-7cc0-4ced-b3b7-86e647f2c436](reports/connected-generation/baseline/mixed-product/quiet-9245a250-7cc0-4ced-b3b7-86e647f2c436.json.gz) |
| Mixed Product | candidate | quiet | [7a2c03d1-3778-423f-86c8-b51d98b0cbda](reports/connected-generation/candidate/mixed-product/quiet-7a2c03d1-3778-423f-86c8-b51d98b0cbda.json.gz) |
| Mixed Product | baseline | root-counters | [8cf9d69a-ac02-4b61-bfbb-97fd3884c818](reports/connected-generation/baseline/mixed-product/root-counters-8cf9d69a-ac02-4b61-bfbb-97fd3884c818.json.gz) |
| Mixed Product | candidate | root-counters | [1031ba41-24dc-46fd-9e87-61a32bfb7b52](reports/connected-generation/candidate/mixed-product/root-counters-1031ba41-24dc-46fd-9e87-61a32bfb7b52.json.gz) |
| Mixed Product | baseline | database | [6ceed965-9b0b-4c16-b6ca-bc0474926319](reports/connected-generation/baseline/mixed-product/database-6ceed965-9b0b-4c16-b6ca-bc0474926319.json.gz) |
| Mixed Product | candidate | database | [cfbdae58-1412-44a6-8a69-acf2a5107a47](reports/connected-generation/candidate/mixed-product/database-cfbdae58-1412-44a6-8a69-acf2a5107a47.json.gz) |
| Payload create | baseline | quiet | [ed9b2a10-60bf-47b3-a0cb-2134df662c29](reports/connected-generation/baseline/payload-create/quiet-ed9b2a10-60bf-47b3-a0cb-2134df662c29.json.gz) |
| Payload create | candidate | quiet | [306d8a87-9b35-4f28-a3c3-f1bfbbd8541a](reports/connected-generation/candidate/payload-create/quiet-306d8a87-9b35-4f28-a3c3-f1bfbbd8541a.json.gz) |
| Payload create | baseline | root-counters | [9f5ec3c1-7280-4e80-ade6-42e6bb11274c](reports/connected-generation/baseline/payload-create/root-counters-9f5ec3c1-7280-4e80-ade6-42e6bb11274c.json.gz) |
| Payload create | candidate | root-counters | [d6a8ab8b-2942-4fd1-8c98-b9f135afd310](reports/connected-generation/candidate/payload-create/root-counters-d6a8ab8b-2942-4fd1-8c98-b9f135afd310.json.gz) |
| Payload create | baseline | database | [a0e720e2-fbbd-4a3b-856f-edce6bb3a5e8](reports/connected-generation/baseline/payload-create/database-a0e720e2-fbbd-4a3b-856f-edce6bb3a5e8.json.gz) |
| Payload create | candidate | database | [b5c32ecb-a9e0-48ce-a885-34198734ac0a](reports/connected-generation/candidate/payload-create/database-b5c32ecb-a9e0-48ce-a885-34198734ac0a.json.gz) |
| Medusa workflow | baseline | quiet | [131d2659-dcc1-43e2-9ff6-cfdf2044c66a](reports/connected-generation/baseline/medusa-workflow/quiet-131d2659-dcc1-43e2-9ff6-cfdf2044c66a.json.gz) |
| Medusa workflow | candidate | quiet | [6f5f633e-c4c2-445c-a834-1dbb806570d4](reports/connected-generation/candidate/medusa-workflow/quiet-6f5f633e-c4c2-445c-a834-1dbb806570d4.json.gz) |
| Medusa workflow | baseline | root-counters | [984aede5-d1c4-444c-af21-e9698dd21e3e](reports/connected-generation/baseline/medusa-workflow/root-counters-984aede5-d1c4-444c-af21-e9698dd21e3e.json.gz) |
| Medusa workflow | candidate | root-counters | [c42f071a-34fd-435c-8a7d-db1291ccdab2](reports/connected-generation/candidate/medusa-workflow/root-counters-c42f071a-34fd-435c-8a7d-db1291ccdab2.json.gz) |
| Medusa workflow | baseline | database | [01d9e9b9-7eda-4b94-9d41-261ed75d42be](reports/connected-generation/baseline/medusa-workflow/database-01d9e9b9-7eda-4b94-9d41-261ed75d42be.json.gz) |
| Medusa workflow | candidate | database | [ae92850f-b99a-4a7a-94f2-2192abde917c](reports/connected-generation/candidate/medusa-workflow/database-ae92850f-b99a-4a7a-94f2-2192abde917c.json.gz) |
| Mixed Payload | baseline | quiet | [adbac30f-0453-41ec-ba1e-1d9491882ce8](reports/connected-generation/baseline/mixed-payload/quiet-adbac30f-0453-41ec-ba1e-1d9491882ce8.json.gz) |
| Mixed Payload | candidate | quiet | [cf99a83f-95ca-4576-8c75-1769213296cb](reports/connected-generation/candidate/mixed-payload/quiet-cf99a83f-95ca-4576-8c75-1769213296cb.json.gz) |
| Mixed Payload | baseline | root-counters | [0f921344-7d21-43ec-a43b-046441889c32](reports/connected-generation/baseline/mixed-payload/root-counters-0f921344-7d21-43ec-a43b-046441889c32.json.gz) |
| Mixed Payload | candidate | root-counters | [1eb72667-ed28-496d-9fc3-fff6caeba704](reports/connected-generation/candidate/mixed-payload/root-counters-1eb72667-ed28-496d-9fc3-fff6caeba704.json.gz) |
| Mixed Payload | baseline | database | [a7bc08d7-db7d-4346-9caa-d693cbc91aac](reports/connected-generation/baseline/mixed-payload/database-a7bc08d7-db7d-4346-9caa-d693cbc91aac.json.gz) |
| Mixed Payload | candidate | database | [b09a64fe-f632-49bc-9569-5ae96740aafd](reports/connected-generation/candidate/mixed-payload/database-b09a64fe-f632-49bc-9569-5ae96740aafd.json.gz) |
| Mixed workflow | baseline | quiet | [d90b27be-fe62-46e8-9db3-40fa8a96ae4b](reports/connected-generation/baseline/mixed-workflow/quiet-d90b27be-fe62-46e8-9db3-40fa8a96ae4b.json.gz) |
| Mixed workflow | candidate | quiet | [ddf7f89b-4ec7-43a2-bc51-8f9cc1d6e0ec](reports/connected-generation/candidate/mixed-workflow/quiet-ddf7f89b-4ec7-43a2-bc51-8f9cc1d6e0ec.json.gz) |
| Mixed workflow | baseline | root-counters | [20f61716-227f-4248-8965-3cb0971d9ca3](reports/connected-generation/baseline/mixed-workflow/root-counters-20f61716-227f-4248-8965-3cb0971d9ca3.json.gz) |
| Mixed workflow | candidate | root-counters | [b3381f4b-41e3-494c-a1b0-afa2e64a118d](reports/connected-generation/candidate/mixed-workflow/root-counters-b3381f4b-41e3-494c-a1b0-afa2e64a118d.json.gz) |
| Mixed workflow | baseline | database | [d8b42c80-16dc-441e-870d-282313c4bb15](reports/connected-generation/baseline/mixed-workflow/database-d8b42c80-16dc-441e-870d-282313c4bb15.json.gz) |
| Mixed workflow | candidate | database | [5d83d505-dfeb-4333-ad46-f620925a40a7](reports/connected-generation/candidate/mixed-workflow/database-5d83d505-dfeb-4333-ad46-f620925a40a7.json.gz) |
