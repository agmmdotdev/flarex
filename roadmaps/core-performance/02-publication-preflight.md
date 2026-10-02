# Publication: Component Attribution Preflight

Status: **attribution investigation and focused preflight authorized; proposed
measurement implementation and runtime/profile remedies inactive pending examination.**
This existing document owns preparation, handoff and locked publisher attribution.
The [component roadmap](./README.md), [reassessment](./orchestration-simplification-preflight.md)
and [target proposal](./orchestration-target-design.md) retain their separate gates.

## Outcome And Bounded Scope

Establish an exact original-demand and cost graph for publication preparation,
handoff and the existing atomic publisher, then select one evidenced owner
improvement and a grounded budget. The nearest connected proof is genuine sealed
Application plus Product, actual Payload Local API and admitted workflow plans
entering finishing and producing one authoritative committed outcome.

The completed accepting component leaves a substantial publication phase with
fresh proof and useful durable work. Phase size is not proof of waste or the cause
of the original mixed latency regression. Preserve that regression and its
nonreproducing targeted repeat; neither replacement nor filtering establishes a
cause or whole-goal acceptance.

Preserve OCC, schema/head/physical readiness, revision and tombstone history,
indexes/search/uniqueness, strong references, facts/events/outcomes and uncertain
decision recovery. Preserve seal → finishing → publication as this attribution
baseline. This does not make today's terminal graph immutable for a later
separately examined redesign; any such redesign needs its own connected proof,
recovery and lifetime decisions. No second
publisher/factory/authority, direct test writer, foreign callbacks in SQL,
transaction across native/remote execution, host/framework/API expansion,
schema/durable-format migration or data deletion is selected.

## Current Measured Boundary

The [connected ledger](../../packages/flarex-backend/benchmarks/core-performance/fresh-application-acceptance/README.md)
owns exact source/settings/sample provenance and the original regression. Its
[raw traced artifact](../../packages/flarex-backend/benchmarks/core-performance/fresh-application-acceptance/final-full-trace.json.gz)
is verified lossless gzip; the [manifest](../../packages/flarex-backend/benchmarks/core-performance/fresh-application-acceptance/manifest.json)
records original/compressed hashes. Current warm publication has twenty samples
per workload:

| Workload | SQL dispatches | Distinct fingerprints | Control / target dispatches | Explicit target transactions |
| --- | ---: | ---: | --- | ---: |
| Product | 103 | 87 | 17 / 86 | 1 |
| Product + Payload | 108 | 90 | 19 / 89 | 1 |
| Mixed workflow | 146 | 102 | 31 / 115 | 1 |

Fingerprint multiplicities are stable across each twenty-sample warm series.
The phase includes control and target work outside the explicit target transaction;
the mixed total is 31 control plus 115 target dispatches, with one explicit target
transaction, not 146 statements inside that transaction. Healthy terminal work retains separate seal,
finishing and publication transactions. Older 104/109/147 publication counts
belong to their historical profile, not this baseline. Traced smoke is structural
evidence, not a matched quiet publication distribution.

| Leading statement form | Product | Product + Payload | Mixed |
| --- | ---: | ---: | ---: |
| SELECT | 72 | 77 | 104 |
| WITH | 5 | 5 | 7 |
| INSERT | 12 | 12 | 16 |
| UPDATE | 6 | 6 | 9 |
| DELETE | 5 | 5 | 7 |
| BEGIN / SET / COMMIT | 1 / 1 / 1 | 1 / 1 / 1 | 1 / 1 / 1 |

WITH may contain useful locking or data work; these forms are not affected-row
counts. Selected SQL table-family membership illustrates demand shape:

| Mentioned family | Product / Product + Payload / Mixed |
| --- | --- |
| Scope clock | 14 / 15 / 18 |
| Control scope | 6 / 7 / 13 |
| Control index definitions | 3 / 4 / 10 |
| Application active head / readiness | 5 / 5 / 5; 3 / 3 / 3 |
| Application activation / revision schema | 2 / 2 / 2 each |
| Row revisions / current rows | 6 / 8 / 18; 5 / 6 / 10 |
| Unique keys | 6 / 7 / 10 |
| Index revision / current | 1 / 1 / 2; 2 / 2 / 3 |
| Search current / build state | 2 / 2 / 6; 3 / 3 / 7 |
| Commit row-change family | 2 / 3 / 6 |
| Event / delivery / wake families | 1 / 1 / 1 each |

Membership counts overlap joins and are non-additive: they are not locks, rows,
native demand or proof of duplicate authority. Only two phase dispatches have
single stack-source attribution; 101/106/144 remain unattributed. The named
publisher observer provides a separate partial partition of thirteen dispatches
across eleven names. Neither method establishes a complete owner ledger.

### Existing Timing And Demand Evidence

Traced sample-level median/P95 distributions are available:

| Workload | Publication inclusive ms | Explicit transaction interval ms | Phase SQL awaited sum ms |
| --- | --- | --- | --- |
| Product | 84.4483 / 88.5178 | 69.20185 / 71.8592 | 37.5403 / 39.9882 |
| Product + Payload | 90.73075 / 122.1615 | 73.9811 / 90.2896 | 40.11565 / 53.3697 |
| Mixed | 162.11255 / 212.8395 | 137.43095 / 170.9009 | 66.6519 / 84.2289 |

These are separate distributions. Do not sum/subtract percentiles or nested
inclusive intervals. Driver awaits include transport/scheduling; BEGIN-to-settlement
is not lock-hold time. Raw trace preserves grouped phase awaits and complete
invocation await union, not a publication-only union or individual publication
interval timestamps. Quiet publication, CPU, server execution/planning/function/
trigger, native comparison and exact lock acquisition/hold metrics are unavailable.

`settlementLedger` comes from confirmed issuer-owned seal capture after the
request timer, not net row changes. Stable warm demand counters are:

| Original captured demand | Product / Product + Payload / Mixed |
| --- | --- |
| Syscall receipts / read-document occurrences | 5 / 9 / 9; 1 / 1 / 1 |
| Point dependencies and projected point rows | 11 / 12 / 15 each |
| Admitted range / page / unique observations | 10 / 11 / 26; 0 / 0 / 0; 4 / 5 / 15 |
| Range / page entry occurrences | 10 / 10 / 10; 0 / 0 / 0 |
| Index-definition occurrences (distinct) | 219 (73) / 227 (75) / 269 (117) |
| Constraint-definition occurrences (distinct) | 72 (24) / 76 (25) / 87 (36) |
| Receipt / point projection chunks, bound 128 | 1 / 1 for each workload |

Application indexed-query/range/relation syscall counters are zero here; that
does not erase admitted framework ranges. Definition occurrences are not distinct
definitions or measured compilation invocations. First warm samples capture
canonical journal bytes 12,106/19,316/34,020 and material write/event evidence
bytes 2,183/4,646/9,409. These are representative original seal partitions, not
exact publication allocations or universal constants.

The thirteen observed publisher dispatches include two `lockScopeClock` and two
`readDatabaseTime`, then one each of active-schema validation, outcome recheck,
session/lease/journal locking, row-head/prior-document loading, commit-change
write and binding-head read. First warm observed parameters are 42/48/84 and
scalar parameter bytes 822/922/1,486. Unobserved owner parameters and non-scalar
wire encoding remain unavailable. Original publication document/history/index/
search/unique/fact/event/outcome row cardinalities and strong-reference demand
are not captured. Capture them before selecting a cost budget; net committed
row/index/event deltas cannot reconstruct them.

## Existing Owner Graph And Proof Profile

| Stage and existing owner | Contract and attribution question |
| --- | --- |
| `pointCommitTransaction.ts:1571` preparation | Genuine command authority and retained-outcome correlation |
| `pointCommitTransaction.ts:1742`, `:1832`, `:1891` | Bounded journal decode/hash; table/participant/event projection; canonical documents; definition merge; canonical result correlation |
| Executor `finishingOperations.ts:680`, `:772`, `:486`; `pointCommitRuntimeModel.ts:424`, `:532` | Genuine finishing consumes claim; publication requires finishing; defensive handoff copies; uncertain recovery rebuilds exact command without framework rerun |
| `pointCommitTransaction.ts:4854`; `transactionSessionActivation.ts:2656` | READ COMMITTED runner, decision provenance and physical transaction ownership |
| `pointCommitTransaction.ts:4909` locked kernel | Clock KEY SHARE, replay, Application ownership/schema, clock UPDATE, replay, build locks, session/lease/journal and post-lock database time |
| `pointCommitTransaction.ts:5197`, `:5299`, `:5330` | Exact point/pending/source/operation/range/unique proofs under genuine command and original observations |
| `pointCommitTransaction.ts:5153`; `applicationDocumentMaterialization/materialization.ts` | Lower rows/history/index/search/relation/unique work with original documents and complete definitions |
| `pointCommitTransaction.ts:6805`; shared `commitPublication/publication.ts:310` | Facts/events/outcome/terminal settlement; final strong-reference/binding gate and clock correlation |

Current publication does **not** open or flush a global protected metadata guard.
Admitted validation uses `withSharedLogicalSourceBindingChecks`, with full live
source/canonical proof before lowering. Shared publication retains its final
strong-reference gate after the completed fact prefix. This is distinct from
protected finite entry and standalone Application direct precheck/tail. Those
profiles imply no publication epoch certificate or prepared-live verdict.
Protected immutable publication reuse and a tail would be a separate explicit
proof/lifetime decision requiring examination.

## Proposed Connected Attribution Capability

Extend the genuine real-COMMIT paired-observer seam in
`persistence-postgres/test/pointCommitTransaction.postgres.test.ts:2522` to actual
mixed finishing plans. It already measures CE0 with alternating observed/quiet
pairs, row counts 1/8/32/128, fresh scopes and one enabled intrinsic index; journal
creation/sealing and index installation are outside its publication timer.
That bounded CE0 plan does not establish mixed demand. Reuse its actual publisher
and authentication lineage; introduce no expected-row authority or direct writer.

The proposed extension must:

1. Produce genuine Application/Product, Product+Payload and admitted workflow
   work, seal it, verify it and enter finishing under original liveness. Charge
   complete construction/admission/native/seal/finishing work and report setup
   separately, without hiding moved preparation or recovery cost.
2. Capture original publication inputs before lowering: documents/tombstones,
   historical/current rows, tables, definitions, index/search/unique operations,
   references, facts/events/deliveries/wakes, outcomes and bytes/chunks. Keep
   occurrence/distinct counts and original demand/net committed effects separate.
3. Map every dispatch/fingerprint to preparation, handoff, locked proof, lowering
   or settlement owner, with parameters/scalar bytes and unavailable encodings.
   Reconcile all control/target and outside/inside-transaction work, driver
   dispatches, server statements and work within functions/triggers.
4. Measure quiet and observed complete publication, preparation, handoff, locked
   kernel, lowering and settlement at actual owner boundaries. Preserve sample
   interval overlap/containment; derive distributions from samples, never from
   summed/subtracted medians/P95. Report paired observer overhead with alternating
   order and retain every sample/outlier. Name server/lock costs only after their
   attribution; missing instrumentation remains unavailable.
5. Vary bytes, tables, definitions, dependencies and row/history demand independently
   through genuine plans/native behavior. Match settings, pool/concurrency,
   temperature, source inventory and retry/contention accounting. Preserve
   protected and ordinary/PGlite profile distinctions.

Measurement implementation is proposed and inactive. First establish exact
attribution and a quiet baseline; then select an existing preparation/handoff or
lowering owner and grounded dispatch/transaction/byte/latency budget. No removable
SELECT count, single-digit target, latency floor or overhead ceiling is selected.

## Challenged Alternatives And Candidate Owners

| Candidate | Evidence and required challenge |
| --- | --- |
| Per-table intrinsic preparation | `materialization.ts:221/:257` reaches `appIndexDefinitions.ts:1145`; mixed trace has eleven repeated scope lookups and nine definition-shaped reads. Attribute genuine touched-table/control demand and lineage before composing or reusing it. |
| Immutable command/journal/result handoff | Preparation, finishing, defensive copies and recovery may repeat detached work. Measure bytes/hash/copy inputs and lifetimes. A replacement requires authentic same-owner lineage, bounds and fresh-process reauthentication/recovery; no forgeable certificate or cached live verdict. |
| Contiguous-table historical participant row batches | `pointCommitTransaction.ts:5250` establishes fresh participant evidence and correlation: it is a participant-proof batching seam. Measure row/table/history proof demand and refusal/lock order before regrouping. |
| Generic batching layer | Not justified: rows `appRows.ts:1266/:1464`, indexes `appIndexEntries.ts:769/:1031`, unique `appUniqueKeys.ts:1550`/`materialization.ts:2042`, `logicalDocuments/commitEvidence.ts:33`, build/frontier `materialization.ts:708/:2138/:2160`, bounded facts/events in shared `publication.ts:110/:175/:228`, and source-proof sharing at `sourceAdmission.ts:76/:183` already exist. Extend the evidenced owner. |
| Protected immutable publication reuse | No global guard exists in this profile. A new precheck/tail changes proof eligibility/lifetime and needs a separate decision. |
| Parallel/eager reads or terminal fusion | Could change first refusal, locking, recovery and durable decisions. No cheaper proof, prefix success, fallback publisher, second settlement or native callback under SQL. |

## Callers, Breaking Changes And Cleanup

No schema, codec, identity, durable-format, public API migration or deletion is
selected. Candidate internal breaks are welcome when an approved owner correction
requires them; inventory and migrate actual consumers together.

| Path | Disposition and future removal gate |
| --- | --- |
| Native Application command producer/planner and publisher | **Retain** complete authority/correlation and ordinary publication; **replace** redundant prep/handoff only after attribution and connected cutover. |
| Mixed finishing/execution and fresh-process recovery | **Retain** claim consumption, exact command reconstruction, retained outcome and no framework rerun; migrate handoff producers/consumers before retiring displaced preparation. |
| Shared materialization: standalone Commerce/CMS/cross-domain commands | **Retain** their distinct readiness/settlement obligations; include them if that shared owner changes. No new host profile. |
| CE0 paired observer and confirmed seal demand capture | **Extend** after examination for genuine mixed attribution; retire temporary diagnostics when equivalent decisive coverage exists. |
| Row/index/unique/fact/event/source-proof batching and caches | **Retain** proven responsibilities; replace only the evidenced displaced owner, with no wrapper or parallel engine. |

Temporary retention requires a named unmigrated consumer and retirement gate.
Migrate producers/planners/publishers/recovery and remove displaced validators,
copies, exports, tests/fixture authority and stale documentation in the coherent
approved slice. Preserve named durable data and outcomes.

## Validation And Completion Gates

Use genuine Application, Product, actual Payload Local API and workflow consumer
regressions plus focused PGlite and ordinary-role PostgreSQL. Preserve point/
tombstone/range conflicts, positive/negative reads, pending correlation, late
revocation/head/readiness changes, issuer/scope/fence/claim/deadline refusal,
uniqueness and strong-reference/delete conflicts, trigger tamper, bounds and
lock contention. Check write/history/index/fact/event/outcome atomicity after
partial work; preserve rollback-only, cancellation, typed failures, defects/
interruption, full Cause cleanup composition and current retry policy.

Forwarded COMMIT with lost response must resolve through authoritative retained
outcome and fresh-process recovery without speculative success or repeated
framework callbacks/events. A handoff change must prove first publication,
replay, known rollback and uncertainty under the same authentic lineage.

Affected types/source guards, lint, both reviews and substantive-fix reruns apply
at implementation. Clean resources and displaced paths before a scoped commit.
Real component distributions and original demand must meet the grounded selected
budget, not merely lower SQL. Full E2E performance is required at declared group
milestones or cross-component/lifecycle changes, not after every owner iteration.
Bounded connected correctness remains required each iteration. Whole latency
goals and original mixed regression cause remain open.
