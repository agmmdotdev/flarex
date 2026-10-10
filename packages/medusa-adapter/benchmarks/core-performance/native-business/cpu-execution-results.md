# Shared execution CPU correction checkpoint

This is the owner-requested partial implementation commit. Correctness validation and both final source reviews pass; **complete performance acceptance remains unmet**. No new runtime correction starts from this checkpoint without recording its concrete cutover. The active scope is [preflight 27's connected CPU correction](../../../../../roadmaps/mixed-mutation-core/27-shared-execution-evidence-redesign-preflight.md#connected-cpu-execution-correction).

## Implemented behavior

- Persistence captures bounded private JSON with one direct descriptor/accounting traversal. Medusa's own-undefined omission policy shares that traversal while retaining native descriptor/node/depth refusal precedence, authentic immutable ownership and mutable workflow detachment.
- Hot readiness and participant operations use quiet Effect composition. Former named operations explicitly retain caller tracing; existing SDK-only diagnostics remain opt-in. Pure ordered metadata consumption avoids per-field Effect boundaries, and bounded mechanics retain the original metadata issuer lookup.
- Installed application publication retains positional tuple encoders derived from native Drizzle columns. Fresh parameters still execute through the actual transaction session, observer, decoder and failure owner. The displaced per-cell SQL assembly is removed; real non-publication tuple consumers remain.
- Full and selected readiness pass the coverage issuer's observation clock to unique/search consumers after concurrent publication. Original admission snapshots and OCC remain unchanged; a genuine second-connection witness covers the owner handoff.

No new database schema, durable result/journal format, host lifecycle or data deletion is introduced. Fresh authentication, liveness, actual readiness, budget accounting, first refusal, cancellation, rollback and atomic publication remain required.

## Root CPU comparison

Milliseconds, paired added root-thread CPU. Frozen runtime baseline is **33aece9bd4ecbc8edbde3cc3d9a0d95fb1e32f33**; candidate is the reviewed dirty source checkpoint captured in each report's source inventory, before the final LF formatting and authored-source receipt refresh. Those final steps do not change runtime semantics. Five alternating measured pairs and five warmups per lane, each graph in a fresh process; no diagnostic profiler or SQL observer runs inside these counter requests. Process CPU includes sibling threads and excludes PostgreSQL server CPU.

| Graph | Baseline added thread | Candidate added thread | Candidate added process | <=16 ms thread gate |
| --- | ---: | ---: | ---: | --- |
| mixed-product | 63.00 | 93.00 | 124.00 | Fail |
| payload-create | 32.00 | 46.00 | 47.00 | Fail |
| medusa-workflow | 156.00 | 109.00 | 110.00 | Fail |
| mixed-payload | 78.00 | 79.00 | 140.00 | Fail |
| mixed-workflow | 172.00 | 125.00 | 126.00 | Fail |

Standalone Medusa's observed median falls 156 to 109 ms (30.1%); mixed workflow falls 172 to 125 ms (27.3%). The historical connected-generation mixed value was 171 ms. This five-pair, approximately 15-16 ms Windows counter evidence is descriptive, not a stable precise saving claim. Mixed Product and standalone Payload medians increase; mixed Payload is indistinguishable at this resolution. No all-consumer CPU acceptance is claimed. Native zeros mean unresolved work below the counter quantum, not no work.

## Complete quiet latency

Milliseconds. Thirty alternating pairs and five warmups per lane for all five graphs. The SDK nearest-rank summary is used, and paired excess is computed before percentiles.

| Graph | Native median | Flarex median | Added median | Added P95 | 5 / 10 ms gate |
| --- | ---: | ---: | ---: | ---: | --- |
| mixed-product | 15.14 | 162.26 | 146.43 | 399.58 | Fail |
| payload-create | 2.01 | 57.21 | 55.11 | 69.54 | Fail |
| medusa-workflow | 25.61 | 242.39 | 215.46 | 235.95 | Fail |
| mixed-payload | 18.71 | 151.03 | 132.85 | 174.13 | Fail |
| mixed-workflow | 39.81 | 301.90 | 259.84 | 292.21 | Fail |

All 150 pairs complete and verify committed business results. All graphs pass source/settings stability, cleanup, sampling and complete-request gates, but fail both latency gates. These numbers establish no complete latency improvement. No fresh quiet cohort was collected for the frozen runtime baseline, so the older connected-generation quiet results are historical context rather than a controlled before/after latency comparison. CPU and latency are separate cohorts and must not be subtracted to invent an exact wait budget.

The native lane uses the [complete native business reference](./README.md), including independently committed native framework calls and Application PostgreSQL JSON surrogates. Flarex's atomic OCC, authorization, history, durable outcome and publication obligations remain inside the measured excess. This does not make the entire excess avoidable. A new database-count/server-CPU cohort was not collected here; the older 122 standalone / 50 mixed workflow exchange counts remain historical observations, not a new SQL-count result.

## Attribution and next correction

Fresh baseline root-only profiles reproduce substantial execution CPU. Their active samples contain approximately 34-36% Effect machinery and 9-20% Drizzle machinery, alongside protocol/encoding and private value work. These overlapping sampled categories are investigation guides, not exclusive millisecond allocations. This candidate has not been reprofiled, so those shares are not current residual attribution.

The strongest remaining source witness is the outcome-value pipeline: captureJsonOutcomeValue detaches an issued tree, normalizeJson validates strings/keys and reconstructs it through per-node Result generators, command/borrowed workflow boundaries repeat that pipeline, and final canonicalization captures it again. The next coherent correction should normalize during descriptor-safe ingress and retain authentic immutable value evidence across trusted consumers. Every ordered budget charge, escaping detachment, native mutable copy, seal-before-result order, canonical durable bytes/hashes and full foreign stored-outcome verification must remain.

Ordinary scope-clock/index readiness also rebuilds fixed projections and joins. Retaining owner-local SQL/projection mechanics is a second candidate; exact residual CPU benefit remains unmeasured. Keep fresh invocation parameters, locks, required-build checks, observed-clock refresh and corrupt-state refusal. Existing schema/generation and scope observation owners already exist; duplicate authority or accepting caches are not a remedy.

## Validation and limits

- Persistence strict typecheck and all five Medusa strict configurations pass. Core/diff lint and Effect runtime boundary guard pass; staged checks are required for the actual commit index.
- Shared materialization, logical working-set reads and finite metadata dependency suites pass **21 cases on PGlite and 21 on ordinary-role PostgreSQL**. The final PostgreSQL Product-tag suite passes all **25 cases**, including the deterministic concurrent-publication witness. Corrected Medusa Promise/workflow PGlite suites pass 30 tests with three expected PostgreSQL-only skips.
- Diagnostic/SQL compiler witnesses pass 24 tests; native value, omission, workflow detachment and the unchanged decoder witnesses retain their focused passing receipts. Both final project reviewers report no findings. Independent capture comparisons cover 4,000 systems cases plus 25,000 deterministic and 11,232 adversarial TypeScript-review cases.
- Earlier overlapping consumer runs contain SQL/test timeouts. A contaminated target rerun allowed timed-out work to affect later assertions. The final serial full PostgreSQL suite passes; the timeout's precise cause remains unconfirmed and is not classified as a corrected runtime defect.
- No production load, hosted Cloudflare behavior, arbitrary framework coverage or native-relative acceptance is established. Setup, per-sample verification and resource cleanup remain visible in raw evidence.

## Retained raw evidence

The compressed JSON below preserves every SDK sample, source/settings inventory, calibration and acceptance verdict. The implementation commit records reproducible numbers, not only selected medians.

| Graph | Source | Lane | Report |
| --- | --- | --- | --- |
| mixed-product | baseline | root-counters | [bf9db87c-fdf4-48ac-a2e5-85e250ea4301](reports/cpu-execution/baseline/mixed-product/root-counters-bf9db87c-fdf4-48ac-a2e5-85e250ea4301.json.gz) |
| payload-create | baseline | root-counters | [25a95f1d-846c-4aa7-b6ac-d64ef0d505bf](reports/cpu-execution/baseline/payload-create/root-counters-25a95f1d-846c-4aa7-b6ac-d64ef0d505bf.json.gz) |
| medusa-workflow | baseline | root-counters | [e7d6472e-6408-490e-ae9e-cf32a3505a17](reports/cpu-execution/baseline/medusa-workflow/root-counters-e7d6472e-6408-490e-ae9e-cf32a3505a17.json.gz) |
| mixed-payload | baseline | root-counters | [63a85a65-f58e-4ff2-847e-513b839471f8](reports/cpu-execution/baseline/mixed-payload/root-counters-63a85a65-f58e-4ff2-847e-513b839471f8.json.gz) |
| mixed-workflow | baseline | root-counters | [21c44f02-c27d-486e-8bf8-31b373ed0e64](reports/cpu-execution/baseline/mixed-workflow/root-counters-21c44f02-c27d-486e-8bf8-31b373ed0e64.json.gz) |
| mixed-product | candidate | root-counters | [ebd3bad9-7dab-4994-b01c-cdcff720245e](reports/cpu-execution/candidate/mixed-product/root-counters-ebd3bad9-7dab-4994-b01c-cdcff720245e.json.gz) |
| payload-create | candidate | root-counters | [88a1d2a6-a00b-4386-aca7-afaf5c696980](reports/cpu-execution/candidate/payload-create/root-counters-88a1d2a6-a00b-4386-aca7-afaf5c696980.json.gz) |
| medusa-workflow | candidate | root-counters | [98c82cec-fc66-43ff-9d36-45993a674254](reports/cpu-execution/candidate/medusa-workflow/root-counters-98c82cec-fc66-43ff-9d36-45993a674254.json.gz) |
| mixed-payload | candidate | root-counters | [2ecb221b-64e8-4342-81d8-7c32be915701](reports/cpu-execution/candidate/mixed-payload/root-counters-2ecb221b-64e8-4342-81d8-7c32be915701.json.gz) |
| mixed-workflow | candidate | root-counters | [ebe7cf54-55bb-4c8f-b98a-be11b39d0036](reports/cpu-execution/candidate/mixed-workflow/root-counters-ebe7cf54-55bb-4c8f-b98a-be11b39d0036.json.gz) |
| mixed-product | candidate | quiet | [1c3802fb-3d99-4c9d-8f48-211e17c3b6b0](reports/cpu-execution/candidate/mixed-product/quiet-1c3802fb-3d99-4c9d-8f48-211e17c3b6b0.json.gz) |
| payload-create | candidate | quiet | [816f333f-9a6a-473d-8db1-af7bbc723a62](reports/cpu-execution/candidate/payload-create/quiet-816f333f-9a6a-473d-8db1-af7bbc723a62.json.gz) |
| medusa-workflow | candidate | quiet | [a1afdc88-f4cb-4d4f-9bc9-78e47edb2c1b](reports/cpu-execution/candidate/medusa-workflow/quiet-a1afdc88-f4cb-4d4f-9bc9-78e47edb2c1b.json.gz) |
| mixed-payload | candidate | quiet | [c13c3a6f-99ed-4cc1-8a14-91f10f55fbab](reports/cpu-execution/candidate/mixed-payload/quiet-c13c3a6f-99ed-4cc1-8a14-91f10f55fbab.json.gz) |
| mixed-workflow | candidate | quiet | [2a68c2be-a044-41d3-ac5b-99b74ba59420](reports/cpu-execution/candidate/mixed-workflow/quiet-2a68c2be-a044-41d3-ac5b-99b74ba59420.json.gz) |
