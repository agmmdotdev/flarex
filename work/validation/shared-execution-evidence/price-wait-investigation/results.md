# Historical pricing-query wait investigation

The 172.1902 ms pricing wait remains a one-request outlier with an unresolved
cause. A focused reconstruction excludes pool acquisition, overlapping observed
application queries and substantial recorded observer work. A new full-observer
campaign did not reproduce it. No runtime fix or performance improvement is
claimed, and this investigation does not authorize the proposed OCC replacement.

## Original witness

The retained binding-reuse database report is
`../binding-reuse/database/2026-10-12T03-50-38-688Z-00857611-13a2-42d7-96e8-a6fe2afd7b4e/mixed-workflow/6fa11a26-4dac-4d8a-87ff-5bf2a0eb4e5f.json`.
Its diagnostic sample `:flarex:2`, driver event `database:476`, is capture 30:
PricingRepository.find relation population, table 6/index 94, backend PID 3148.
The caller chain is PricingRepository.find -> MedusaRead.execute -> relation
population -> LogicalDocuments.relationalFind -> FiniteStorageCapture.run ->
PostgresPhysicalSession.implicitCommand. Medusa owns population; shared logical
storage owns committed membership and physical execution.

| Reconstructed fact | Original value |
| --- | ---: |
| Query submission through Promise response handling | 172.1902 ms |
| Immediately preceding checkout | 0.0420 ms |
| Other same-fingerprint queries on that connection | 25 |
| Their wait minimum / median / maximum | 1.4326 / 1.7803 / 2.2222 ms |
| Other observed query intervals overlapping this wait | 0 |
| Recorded observer overlap | 0.0250 ms |
| SQL / parameter count / scalar parameter bytes | 16,301 bytes / 97 / 3,936 |
| Returned driver rows / decoded JSON bytes | 1 / 323 |

The previous capture finished at request-relative 222.3342 ms; this query began
at 228.0564 ms and ended at 400.2466 ms. The next capture began at 403.1137 ms
and took 1.8658 ms. They share the same SQL fingerprint and physical connection.
This is strong evidence against a consistently expensive pricing query shape;
different parameters and transient execution conditions remain possible.

The exact original observer implementation starts its timer immediately before
calling pg and ends it in the returned Promise handler. SQL fingerprinting,
input sizing and source-stack capture precede the timer; result sizing follows
the timer. Those directly recorded costs do not explain this interval. GC or
unrecorded scheduling triggered by instrumentation could still occur inside it.
There is no original GC profile, response-message timing or corresponding
PostgreSQL duration/wait record. The original driver record is not server CPU,
exclusive server execution or added client CPU.

Prior demand and server-plan evidence identifies an empty committed range with
one control/header result, followed by working-set interpretation of pending
writes. The empty witness is necessary for exact dependency validation. Neither
an empty answer nor the transient stall establishes permission to skip it.

## New focused campaign

The earlier 100-workflow light-observer campaign did not reproduce the spike:
pricing median 1.4711 ms, P95 1.7246 ms and maximum 1.8825 ms, as retained in
`../slow-capture-diagnostic/results-and-proposal.md`. That campaign did not
recreate the original full database/Effect observer mode.

This investigation therefore ran that full SDK database mode with three warmups,
one SDK calibration and six diagnostic complete mixed workflows. Additional
test-only instrumentation retained numeric pg submission/queue state,
rowDescription/dataRow/readyForQuery callbacks, post-parser socket callbacks,
GC observations, a 1 ms event-loop monitor and a separate nominal 5 ms activity
sampler. PostgreSQL duration logging omitted statement text and parameters.
No business demand, runtime source, SQL or acceptance limit was changed by this
investigation. This is an instrumented diagnostic, not quiet acceptance.

| Fresh diagnostic | Result |
| --- | ---: |
| Pricing wait minimum / median / maximum | 1.4324 / 1.8156 / 2.0234 ms |
| Complete pricing capture minimum / median / maximum | 2.2584 / 2.8814 / 3.1597 ms |
| Synchronous pg submission minimum / median / maximum | 0.0759 / 0.1078 / 0.1443 ms |
| All 228 captured query waits, maximum | 4.9433 ms |
| Queued queries / active query at each pricing submission | 0 / false |
| Pricing statements already prepared on actual session | 6 of 6 |
| GC intervals overlapping pricing waits | 0 |
| readyForQuery callback to observed Promise resolution | 0.0055-0.0105 ms |
| Pricing driver results | One row, 323 decoded JSON bytes each |

Every diagnostic retained all 38 captures, 60 exchanges and 41 checkouts. All
business samples succeeded. SDK source stability, ordinary-role durable settings
stability and cleanup gates passed. Fresh pricing wait samples contained no
observed blocker or Lock wait; most pricing windows were shorter than a sampler
period. Sampled absence cannot exclude short waits. Socket data callbacks run
after pg's existing parser, so their timestamps are not kernel arrival times.

Duration logs were retained, but wall-clock matching did not establish a complete
same-query correspondence. Several nearby backend log timestamps fall outside
the nominal 1 ms matching window. `breakdown.json` labels any in-window duration
as a candidate; missing candidates do not mean zero server cost. No subtraction
of these candidates from client waits is valid. This limitation does not affect
the monotonic client submission/message/Promise intervals above.

## Disposition and reproduction

No repeatable pricing owner defect or remedial change is established. The next
occurrence needs a correlated server execution/lock witness and client GC/event
loop/response witness for that same request. Choose the correction only after
those witnesses distinguish server time, transport/response handling and client
scheduling. The separate OCC planning proposal concerns final current-index
validation; it does not explain this earlier pricing capture.

`diagnostic.test.ts`, `vitest.config.ts`, `sampler.cjs`, `analyze.cjs`,
`breakdown.json` and the raw SDK/ledger reports are retained locally in this
directory. The completed run ID is `8d2ccb0a-caf5-4e25-9ef6-c6dbdacba973`.
Use `pnpm exec vitest run --config
work/validation/shared-execution-evidence/price-wait-investigation/vitest.config.ts`
with an ordinary fixture endpoint in `FLAREX_POSTGRES_DATABASE_URL`, its separate
provisioning endpoint in `FLAREX_POSTGRES_PROVISIONING_DATABASE_URL`, output in
`FLAREX_EVIDENCE_OUTPUT` and `BOUNDED_MODE=price-wait`. Then run `node
work/validation/shared-execution-evidence/price-wait-investigation/analyze.cjs`.
The test-only harness uses installed pg 8.22 queue accessors; their deprecation
warnings are retained. All diagnostics and raw artifacts remain ignored; this
report is the scoped documentation deliverable.

The first initialization used an administrator runtime endpoint and was refused
by the unchanged SDK environment gate before any business sample. Its failed
report and `initial-settings-refusal.log` remain retained; no runtime failure or
slow sample was excluded. The corrected campaign used ordinary control and
target runtime roles with fsync, full_page_writes and synchronous_commit on.
Owned PostgreSQL was stopped afterward. Concurrent unrelated worktree edits,
including OCC implementation paths, were left untouched. PGlite, a runtime
cutover and complete native-relative acceptance were not rerun for this
read-only diagnosis.
