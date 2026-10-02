# Publication Source And Participant Proof Capture

Status: **proposed / inactive; examination requested. Runtime composition is not
approved.** This is the next connected owner proposal after
[publication attribution](./02-publication-preflight.md). It changes no runtime,
measurement harness, schema, public API or durable format by itself.

## Outcome And Scope

Compose fresh publication source evidence through the existing Application,
readiness, task and logical-storage owners, authenticate the captured values with
their existing canonical authenticators, and consume participant history through
one bounded composite `(tableId, rowId)` frontier. Deliver the connected proof
through the genuine Application + Product, Product + actual Payload Local API,
and admitted mixed-workflow finishing plans and the sole point publisher.

The selected cost hypothesis is repeated acquisition/construction inside one
full-live proof, not repeated source authorization. Retain complete canonical
authentication, actual heads and activation rows, all fresh physical/lifecycle/
coverage/catalog checks, snapshot and OCC semantics, source grants and events,
one authoritative publication and existing rollback/recovery behavior. No
native or remote callback runs inside SQL.

No protected epoch, guard, cached authorization result, reuse certificate,
fallback, parallel transaction, new publisher or lifetime is proposed. Host
construction, framework expansion, source-demand narrowing, terminal fusion,
schema/format migration and durable deletion remain outside this slice. The
accepted full-live publication profile is the starting contract; the preceding
standalone protected acceptance slice does not apply here.

## Evidence And Baseline Disposition

The committed [publication ledger](../../packages/flarex-backend/benchmarks/core-performance/publication-attribution/ledger.md)
and its packaged raw/owner artifacts retain the historical 36-attempt matrix:
three profiles, one warmup pair and five retained alternating boundary-only /
detailed pairs per profile. Boundary-only includes minimal phase observation;
it is not an uninstrumented control. Detailed timing includes charged diagnostics
and real variation. Intersecting owner intervals overlap; do not add their
percentiles or subtract them to assign CPU cost.

The final inline OCC/lowering/clock-advance phase corrections are **unmeasured**.
The historical distribution belongs to its measured source, not automatically
to the current production bytes. A matched final-source baseline is required
before implementation and a matched final-source candidate before performance
acceptance. The finite measurement decision below remains subject to this
preflight's approval.

| Historical boundary-only median / observed P95, ms | Product | Product + Payload | Workflow |
| --- | --- | --- | --- |
| Participant proof | 32.371 / 33.965 | 33.384 / 37.838 | 56.653 / 61.952 |
| Genuine publisher | 78.592 / 88.219 | 82.170 / 99.155 | 150.634 / 159.627 |
| Lowering, separate owner | 19.738 / 23.002 | 21.506 / 27.914 | 57.230 / 63.406 |

Five retained samples make observed P95 the maximum. These figures select a
component and comparison question, not an invented latency floor or percentage
improvement promise. Workflow's 42 actual index revisions already use 32 + 10
chunks; lowering remains a separate potential component, not part of this remedy.

## Exact Current Participant Graph

Retained detailed pair 1 reconciles the region without subtracting phase sums:

| Target-pool dispatches | Product | Product + Payload | Workflow |
| --- | ---: | ---: | ---: |
| Stored journal points | 1 | 1 | 1 |
| Historical first-before revisions | 1 | 2 | 8 |
| Shared full-live source proof | 21 | 21 | 21 |
| Dependency evidence | 2 | 4 | 10 |
| **Participant proof** | **25** | **28** | **40** |

Thus the nonhistorical remainder is 24 / 26 / 32 dispatches. The source graph
runs once under the existing exact source-sharing key, not once per contribution.
Dependency evidence already uses one range batch and one unique batch for each
nonempty range/unique frontier: 1 / 2 / 5 such contributions in these plans.
Total admitted source contributions are 3 / 7 / 9 across 3 / 7 / 7 participant
operations; zero-dependency contributions still undergo authentication. Admitted
ranges are not individual SQL calls. Later contributions retain their own
authentication and dependency/event refusals.

The following Product fingerprints are query-shape identifiers from pair 1,
not statement names or authority. Payload/Workflow have the same primitive
owners with some different demand-sized shapes. All 21 are target acquisitions;
there is no control-pool dispatch inside this observed source region.

| Fresh primitive | Product fingerprint prefix / parameters | Current owner |
| --- | --- | --- |
| Framework head | `463f2eaa3998` / 3 | `frameworkSchema/binding/repository.ts:312` `readBindingHeadRecord` |
| Framework activation, candidate, lanes | `4dd1e551a349` / 5 | `repository.ts:363` `readBindingSelectedEvidence` |
| Application head | `2ba209045b4f` / 2 | `applicationActiveHeadRead.ts:463` `readCoherentApplicationActiveHeadInTransaction` |
| Actual Application activation | `10f5420f43a2` / 3 | same coherent-head owner |
| Revision | `8277d9659ad7` / 3 | `applicationReadiness.ts:1254` `reserveBundle` |
| Candidate, analysis, publication | `7d540322aeaa` / 3 | `reserveBundle` |
| Canonical functions | `6e7348197962` / 3 | `reserveBundle` → `authenticateStoredBundle` |
| Task authority clock | `a8db4e2e94db` / 2 | `applicationTaskBindings.ts:77` `captureApplicationTaskCatalogRowsInTransaction` |
| Task catalog | `ba4d96a2880a` / 4 | same task capture owner |
| Task definitions | `28667d5d3671` / 15 | same task capture owner |
| Application physical builds and clock | `1640ee045925` / 2 | `applicationReadiness.ts:2389` `loadPhysicalBuildRows` |
| Revision-schema binding | `8f8deefac9b8` / 3 | `applicationActiveHeadRead.ts:348` `readApplicationSchemaForHeadForShareInTransactionEffect` through coverage owner |
| Physical lifecycle | `ab446de573c3` / 3 | `physicalDefinitionLifecycle.ts:659` `validatePhysicalDefinitionLifecycleReadinessInTransactionEffect` |
| Readiness parent | `c4320ce831a6` / 3 | `applicationReadiness.ts:1696` `loadStoredColdEvidence` |
| Cold children | `e378ec7e4e2d` / 2 | same cold owner |
| Same readiness parent again | `c4320ce831a6` / 3 | `applicationReadiness.ts:1808` `loadStoredReadinessAuthority` |
| Logical index builds | `e06d6a7b793e` / 80 | `logicalStorageReadiness.ts:127` `inspectIndexes` → `indexBuildStates.ts:233` |
| Table frontiers | `ade5e210d13b` / 31 | `inspectIndexes` → `indexBuildStates.ts:735` |
| Unique build eligibility | `89b738e91961` / 28 | `logicalStorageReadiness.ts:206` `inspect` → `acceptPreparedAppUniqueConstraintSet` |
| Search build states | `dcd43c88ed22` / 17 | `logicalSearchBuild.ts:88` `inspectDefinitions` |
| Physical search catalog | `46a8191727cc` / 4 | same search owner, after ordered state verdict |

Disjoint group arithmetic is 2 framework + 2 Application head/activation +
6 canonical **including task clock/catalog/definitions** + 3 physical +
3 cold/readiness + 4 logical eligibility + 1 physical search catalog = 21.
The final catalog query is a physical search-index proof, not a protected
metadata epoch attestation.

| Pair 1 input accounting | Product | Product + Payload | Workflow |
| --- | ---: | ---: | ---: |
| Participant parameters / scalar parameter bytes | 315 / 3,813 | 339 / 4,318 | 637 / 7,812 |
| Source parameters / scalar parameter bytes | 219 / 1,959 | 217 / 1,956 | 289 / 2,209 |
| Source SQL UTF-8 bytes | 20,056 | 20,026 | 22,415 |
| Unknown parameter encodings in participant region | 0 | 0 | 0 |

These are observed transmitted-input counts, not canonical result-body sizes,
native demand or CPU attribution. Per-sample bytes vary; retain every sample's
accounting rather than promoting pair 1 to a universal byte ceiling.

## One Accepting Composition Through Existing Owners

`pointCommitTransaction.ts:5075` enters participant proof after the current
scope/build/session/lease/journal-root locks. `validateAdmittedParticipantOperations`
at `:5346` first validates journal-point correlation, then bridges once into
`withSharedLogicalSourceBindingChecks` and the ordered participant validator
at `:5365`. Extend this graph, rather than adding a second proof service.

Proposed capture/consumption cuts:

1. **Framework selection: retain two statements.** Lock/authenticate the head,
   then select its activation/candidate/lanes in a new READ COMMITTED statement
   after any lock wait. `readBindingSelectedEvidence` documents this requirement.
   A single joined head/body statement can combine a newly locked head with
   evidence from its older statement snapshot; it is rejected.
2. **Application selection: retain real head and activation proof.** Use the
   existing checked-head callback from `applicationActivation.ts:1223`. An
   issued readiness basis does not authenticate an actual activation row.
   Preserve its issuer, exact transaction/clock identity and release on every Exit.
3. **Canonical bundle/tasks: compose bounded raw acquisitions.** Retain the
   revision acquisition; consider one bounded candidate/analysis/publication/
   function capture and one bounded task-parent/child capture. Reuse
   `authenticateStoredBundle` (`applicationReadiness.ts:1322`) and
   `authenticateCapturedApplicationTaskCatalogRows`
   (`applicationTaskBindings.ts:133`). The already owned exact publication clock
   may replace the task clock lookup only through its existing clock observation
   owner, with the same authority checks; a supplied plain clock is insufficient.
4. **Application physical proof: retain its fresh owner and cuts.** Build rows
   and their clock must share the current MVCC statement. Revision-schema and
   lifecycle checks remain live, including every missing/draining/stale refusal
   and bounded refresh. Do not merge these with later logical locks speculatively.
5. **Cold/readiness: capture once, authenticate twice where required.** Use one
   exact locked readiness parent for cold and readiness authentication and
   bounded cold children. Reuse `authenticateStoredColdEvidence` (`:1741`) and
   `authenticateStoredReadinessAuthority` (`:1840`). Removing the second parent
   acquisition requires proof that it is the same captured, locked row and that
   no selected work can update it before consumption.
6. **Logical eligibility: consider one bounded fresh state frontier.** Extend
   the existing build/frontier/unique/search owners to capture their exact
   selected sets, then consume index → frontier → unique → search state →
   physical catalog verdicts in their original order. Keep state locks, optional
   catalog probes, implicit lifecycle semantics, coverage authority and refresh
   obligations. Earlier acquisition is not earlier authorization.
7. **Consume contributions in the current order.** Binding digest, genuine
   token/source/method/head, definition correlation, document validation,
   dependency evidence, source events, operation-bundle digest and workflow
   events remain in their current ordered loop. Do not authenticate all sources
   first or batch dependencies across these semantic cuts.

`captureApplicationReadinessInTransaction` (`applicationReadiness.ts:467`) is
evidence for bounded acquisition and existing authenticators. **Do not reuse its
whole request/retained construction profile:** it performs control preparation,
different capture/refusal handling and optional protected brackets. Extend its
underlying capture/authentication mechanics at the accepting owner instead.
Captured data stays internal and callback-owned; it is not a public admission
certificate. No raw transaction, authority, mutable canonical buffer or captured
manifest is given to user/framework business code.

The conditional source construction is 2 framework + 2 Application +
3 canonical/task + 3 physical + 1 cold/readiness + 1 logical/catalog = **12**.
This requires actual typed bounded rowset construction and demonstrated parent/
child lock and snapshot equivalence. Joining child families multiplicatively is
not acceptable. Existing byte/count limits must bound transfer before bodies
cross the driver boundary. If a lock wait requires a separate child snapshot,
or a selected set requires multiple chunks, keep those statements and revise
the forecast before implementation; do not add a fallback path to meet 12.

## Writer Exclusion And Checks That Stay Fresh

The publisher upgrades the scope clock to NO KEY UPDATE
(`pointCommitTransaction.ts:5023`, `lockPointCommitClock`), then locks intrinsic/developer builds,
session, lease and journal root before this region. That clock conflicts with
the named clock-first metadata writers:

| Authoritative write family | Existing exclusion owner |
| --- | --- |
| Analysis/candidate/revision registration | `applicationAnalysisRegistration.ts:789` `requireExactAuthority`, clock FOR UPDATE before candidate/analysis writes |
| Publication and canonical functions | `applicationPublication.ts:518` `requireExactAuthority`, clock FOR UPDATE before revision/candidate/publication/function work |
| Task catalog and definitions | `applicationTaskBindings.ts:398` `requireExactAuthority`, clock FOR UPDATE before parent/child writes |
| Application activation/head | `applicationActivation.ts:1564,1616` clock-first activation owners |
| Framework activation/head | `frameworkSchema/binding/host.ts:242` `lockScope`, used by activation owners |
| Physical lifecycle transitions | `physicalDefinitionLifecycle.ts:981,1108` clock-first transition owners |
| Published index reconciliation | `indexBuildReconciliation.ts:812` `reconcileInTransaction` |
| Unique build transitions | `appUniqueConstraintSetBuildV1.ts:1911,1978,2014,2428,2543` clock-first owners |
| Empty search advancement | `logicalSearchBuild.ts:186` `advanceEmpty`, clock FOR UPDATE |

The accepted design requires every authoritative writer, including maintenance
and admin tools, to participate in this lane or its formal equivalent. Verify
each touched build/maintenance writer during implementation; this list is not a
claim that all PostgreSQL state is immutable under the clock. Catalog DDL,
privileged out-of-contract DML and corruption are not blessed by it. Preserve
live physical catalog checks and complete authentication of every selected body.
Readiness/build coverage is mutable and cannot be borrowed merely because two
checks use one transaction. Existing bounded clock-progress refresh stays owned
by the original readiness owner; persistent misses continue to refuse.

Keep the existing source-sharing key (`sourceAdmission.ts:181`): exact selection,
Application identity, control/authority/unique owners, deployment/scope,
authority, clock, schema and manifest. Its `withSharedLogicalSourceBindingChecks`
lifetime (`:76`) restores/deletes state on every Exit. Do not broaden eligibility,
reuse across requests/transactions or authorize an uncaptured source. Scope/build/
session/lease/root lock order, liveness/deadline checks and final reference gate
remain unchanged. No positive observation escapes its owning callback.

## Historical Composite Frontier And Ordered Consumption

`validateParticipantPointCorrelation` (`pointCommitTransaction.ts:5244`) verifies
stored journal points and the sealed receipt/work accounting first. It derives
first-before entries in original operation/source/effect order, then currently
cuts contiguous per-table batches of at most 32. At `:5310` it consumes the
`appRows.ts:719` settlement reader. Replace that settlement input with ordered
composite identities under one scope and snapshot, not sorted table groups.

Extend the existing `consumeSnapshotRows` owner (`appRows.ts:580`): partition
latest revisions and correlate results by **table and row**, preserving original
ordinal. Same row IDs in different tables are legitimate; duplicate composite
identities and foreign/unrequested results must still refuse. Missing and
tombstone bases remain observable. Keep 32 identities and the 262,144-byte
settlement window, the first oversized body behavior, withheld later bodies and
the no-progress defect. Consumption, canonical decoding and byte accounting
remain ordered; an earlier consumer refusal must precede decoding a later
corrupt body. Do not transfer every selected body before applying the window.

This changes only capture acquisition where approved: SQL selection and bounded
structural identity/envelope correlation can occur earlier for later tables in
the same frontier. A later malformed intent may be retained as a preparation
Result after the valid prefix; it must not defeat an earlier prefix's semantic
refusal. Journal-point verification, per-ordinal point/intent correlation,
missing/live/tombstone commitment, exact before-image canonical comparison and
final-overlay canonical comparison keep their current order. Withhold later
canonical decoding. No eager capture decision extends to contribution
authentication, dependencies or events.

Migrate both settlement reference consumers
(`commitPublication/strongReferenceValidation.ts:230,358`) using genuine selected
composite demands, preserving their original source/target order and final gate.
The private native evaluator reader
`consumeBoundedAppRowsAtSnapshotInTransactionEffect` (`appRows.ts:703`) stays:
its real consumer `logicalDocuments/workingSet.ts:346` implements Application
and logical participant snapshot hydration with request lifetime/document bounds
and dependency recording. Single-point and bounded current-row readers also
remain. Share the existing lower query mechanics without making settlement's
window semantics a universal evaluator contract.

## Material Approval Decisions Before Runtime Work

1. **Acquisition versus semantic refusal:** accept or reject eager acquisition
   within each named bounded frontier. A later SQL failure or interruption can
   precede an earlier canonical domain refusal even when domain verdicts are
   consumed in original order. Example: corrupt candidate/function bytes plus
   a missing/denied task table; current code can refuse the bytes before querying
   that table, while a composed statement fails acquisition first. The same issue
   applies to cold/physical state and composite historical capture. PostgreSQL
   failures may abort the transaction, so catching and continuing/re-querying is
   not a valid way to restore the old order. Structural envelope, foreign or
   duplicate composite-identity refusals from the enlarged historical capture
   may also precede an earlier per-row canonical refusal. Retain ordinal-addressable
   preparation failures behind the valid prefix; an uncorrelatable result is a
   capture refusal, not permission to decode later bodies. Approve these exact
   cuts explicitly. Defects stay defects; interruption stays interruption, with
   original cleanup and settlement ownership.
2. **Exact capture cuts and locks:** prove parent/child and post-wait snapshots
   at every proposed fusion. Preserve current explicit lock order or obtain a
   separately examined amendment if it must change. Failure to prove a fusion
   removes it from the proposal; 12 is not an override of correctness.
3. **Internal caller cutover:** approve the accepting-only composition and
   composite settlement input replacement, including reference consumers and
   removal of displaced internals. This introduces no durable/public contract.

Before implementation, amend these exact locations in
`design-notes/flarex-db-accepted-design.md`, then record the selected cuts and
consumer inventory here:

- **Commit Compiler Trust Boundary:** immediately after the current capability
  graph containing the O06 kernel and O07-B CommitExecutor descriptions, add the
  selected accepting-only full-live source/participant capture paragraph. Name
  fresh canonical authentication, publisher clock/session/lease/root ownership,
  separate framework post-wait selection, actual Application activation, fresh
  physical/catalog proof, bounded composite history and callback-local consumption.
  State the exact approved acquisition versus domain/structural/interruption
  precedence and unchanged contribution/dependency/event order. The existing
  O06/O07-B authority and forced-rollback/durable-publication descriptions remain.
- **Shared Commit Authority And Execution Profiles:** after the private mixed
  Application/Product/Payload profile paragraphs, add the selected publication
  composition's profile limit: one existing full-live publisher, including
  finish-only recovery, with no protected reuse or new execution/public authority.
  Standalone framework and native evaluator profiles remain distinct.
- **Required Correctness Gates:** add compound early canonical refusal / later
  capture SQL or structural failure and interruption, post-head-wait snapshot,
  and composite-history ordinal/byte-window witnesses. Retain the existing lost
  response, conflict, deadlock, identity and framework gates.

No accepted-design amendment is made by this proposed document. Existing
READ COMMITTED, uncertain-outcome and framework ownership invariants remain
accepted; do not silently legitimize a different lifetime.

## Alternatives Challenged

| Alternative | Disposition |
| --- | --- |
| Historical hydration alone | Reject as the component remedy: only 0 / 1 / 7 fitting dispatches saved, Product unchanged; cannot explain or close the largest region |
| Cross-request canonical reuse / protected tail | Not selected; changes proof/profile/lifetime and requires a different preflight |
| Reuse complete request/retained readiness construction | Reject; wrong control preparation, protection and lifetime obligations |
| Authenticate all contributions, then batch dependencies | Reject; changes source/domain/dependency/event refusal order and can preauthorize later contributions |
| One joined head/body query | Reject for framework selection; loses the required post-lock-wait statement snapshot |
| Parallel SQL or a universal capture service | Reject; new transaction scheduling/authority and unnecessary abstraction |
| Retain sequential cuts, only remove same locked-row duplicate | Alternative before approval, but a smaller proposal must be re-budgeted and cannot claim the 12-source graph |
| Optimize lowering concurrently | Defer; already useful bounded writes, separate evidence/owner and budget |

## Finite Measurement And Acceptance Gates

After examination approves the runtime slice and acquisition decision, root owns
one matched final-source baseline and one final-source candidate matrix using
the existing genuine plans: three profiles × (one warmup pair + five retained
alternating boundary-only/detailed pairs) = **36 attempts per matrix**. Freeze
exact executing sources/settings before each. Preserve all failures; no adaptive
sample filtering, retries, repeated measurements to obtain a passing sample, or
capacity increase is selected. Charge compilation, capture, transfer, hashing,
pure authentication, cleanup and enabled observation. Keep setup/seed/finishing/
artifact costs separately visible and do not add their percentiles.

Keep the existing interval definition: `runAttempt` starts after
`prepareAttempt` graph seeding. Its genuine native/admission, seal, finishing and
publisher flow remains inside that attempt; initial fixture setup, seeding,
evidence/trace finalization, source hashing and artifact writing remain outside
its distribution and separately charged. Compare the same plans and boundaries
in both final-source matrices, not a broader request or an uninstrumented control
against the historically observed component.

Original business and proof demand must match: current pair 1 plans have
2 / 3 / 9 live rows and touched tables, 11 / 12 / 15 point dependencies,
2 / 9 / 2, 3 / 10 / 3 and 9 / 41 / 16 intrinsic/developer/unique definitions;
10 / 11 / 26 ranges and 4 / 5 / 15 unique reads. Retain journal/result bytes,
function/task/cold counts and bytes, all physical/catalog selections, every
contribution, event and output. Do not make a smaller proof appear faster.

Structural acceptance requires demonstrated elimination of the duplicate
readiness-parent acquisition, bounded capture construction without Cartesian
body multiplication, original ordered validation, and no new repeated body
encoding/decoding introduced by rowset projection. Complete canonical
authentication still scales with actual required canonical input under this
full-live profile; flat total immutable-input scaling is not promised.

Conditional fitting dispatch arithmetic is source 21 → 12 and participant
25 / 28 / 40 → **16 / 18 / 24**, retaining dependency 2 / 4 / 10 and one history
frontier. These are hypotheses to test after exact query construction, not
proven removable-cost budgets. Extra owner-required chunks, clock refreshes,
range continuations and byte windows must be attributed rather than hidden.
Keep one target transaction. Preserve all writes/facts/events/outcomes and
terminal counts. Record all parameter counts, scalar bytes, unknown encodings,
SQL bytes and transferred-body limits. Any increase from final-source baseline
must correspond to documented authentic demand or bounded envelope/ordinal
construction; unexplained amplification or new unknown encoding blocks acceptance.

Performance acceptance requires participant-proof median improvement in all
three matched profiles and P95 no greater than the corresponding final-source
baseline. Publisher median/P95 must not regress. Report comparison with the
historical figures separately; meeting historical figures alone cannot accept
an unmeasured final-source change. Evaluate detailed-versus-boundary paired
differences separately from the business component. A query reduction without
the measured component result does not complete this slice.

Focused structural axes use original owners: mixed tables/repeated row IDs;
32 / 33 identity cuts; empty/missing/tombstone and first oversized/crossing byte
windows; multiple function/task/cold entries near their existing limits; logical
definition/search/unique set and continuation boundaries. Do not infer causal
scaling from the three workload medians. No unbounded axis sweep is selected.

### Correctness, Cleanup And Connected Gates

Run focused PGlite and ordinary-role PostgreSQL owner tests for lock waits,
missing/corrupt clock/head/activation, malformed early and late canonical bodies,
task/cold cardinality and byte bounds, draining/stale/missing physical state,
catalog mismatch, coverage clock progress and persistent miss. Include compound
early domain-corruption / later SQL-failure and interruption witnesses for each
approved eager frontier, with exact selected provenance and full Cause checks.

Historical witnesses cover composite repeated row IDs, foreign/duplicate result
identities, absent/live/tombstone bases, before/overlay mismatch, invalid later
intent after an earlier refusing batch, first corrupt body before budget refusal,
earlier semantic refusal before later corrupt body, withheld bodies, 32 / 33,
262,144-byte crossings and no-progress defects. Reference/delete tests must
retain source/target semantic order and final publication refusal.

Connected regressions use actual Application/Product reads and writes, Payload
Local API/hooks and mixed workflow finishing/publication, including later-source
token/head/method refusal, dependency conflict and event failure. Preserve
OCC/unique constraints, provisional prefix rollback, deadline and cancellation
drain, rollback-only Cause, confirmed pre-decision rollback, lost COMMIT ACK,
authoritative outcome replay and fresh-process finish-only recovery without
rerunning native business. Existing observer-transparent 33-row COMMIT/replay/
prefix rollback and throwing-observer held/lost ACK/interruption/replay remain
required. They do not prove every arbitrary native/server observer combination.

Migrate current point correlation and both strong-reference settlement callers,
their test scenarios and exact private exports in one coherent cutover; remove
the displaced single-table settlement shape and duplicate readiness-parent load
from the selected path. Retain native evaluator hydration for its named consumer,
with separate semantics and regression coverage. No compatibility wrapper,
temporary alias or duplicate algorithm is selected. No durable rows or tables
are deleted. Update only durable owner truth after final-source validation,
both required reviews, cleanup and one root-owned scoped commit.

## Server Evidence Gap

The two healthy Product windows are partial server evidence only. The final
six-attempt server lane had healthy business outcomes but refused bounded raw
and log artifacts; complete counters, final log offsets/admission windows,
planning/execution, lock/CPU/wire and complete native reconciliation remain
unavailable. The prior deallocation failure and final cap refusal stay preserved.
No server rerun, reset, reconstruction or cap increase is selected. Client owner
timing and conditional dispatch arithmetic cannot supply the missing server
evidence or establish the cause of the earlier mixed latency regression.
