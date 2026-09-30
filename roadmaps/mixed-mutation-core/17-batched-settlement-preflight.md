# Batched authoritative settlement

Status: **audited focused planning preflight; runtime scope agreement pending.**
Reconciled against delivered [15](./15-admission-protection-preflight.md) and
[16](./16-batched-read-execution-preflight.md). The
[successor roadmap](./14-execution-redesign-roadmap.md) owns sequence and final
acceptance. This proposal changes internal capture/provenance and transaction
orchestration within the accepted architecture; it does not amend the accepted
design or authorize runtime, durable-format, schema, locking, host or activation
changes. The internal cutover requires scope agreement before implementation.

## Connected outcome and evidence

Freeze the complete issuer-owned finite contribution graph before SQL. Persist
its canonical seal and capture detached planning evidence in one checked seal
transaction; verify and plan outside SQL; consume the execution claim in the
existing separate finishing transaction; publish under independent fresh full
acceptance. Batch actual OCC, build, reference and materialization work through
existing persistence owners. Migrate Application, executor, genuine
Product/Payload/workflow and affected shared writers together, removing displaced
healthy reload and reconstruction paths. An unused helper or capture wrapper
does not deliver this slice.

Delivered 16 retains source-wide readiness, ordered snapshot/pending dependencies,
local tentative construction and bounded storage frontiers. Its
[measurements](../../packages/flarex-backend/benchmarks/mixed-mutation-core/bounded-read-execution/README.md)
are **643 / 670 / 1,034 / 354** driver dispatches and **29 / 30 / 43 / 6** explicit
transactions for Product, Product + Payload, mixed workflow and standalone.
Each mixed graph still has five seal/OCC and two publication transactions.
Final mixed latency targets remain unmet. Dispatch totals and overlapping phase
intervals do not isolate server work, lock hold or terminal latency.

The [accepted DB design](../../design-notes/flarex-db-accepted-design.md),
[mixed design](../../design-notes/flarexdb-mixed-mutation-execution.md#retry-recovery-and-settlement)
and [package boundaries](../16-package-boundaries.md) govern authority.
Checked-in Convex [transaction](../../../../crates/database/src/transaction.rs),
[read set](../../../../crates/database/src/reads.rs) and
[write set](../../../../crates/database/src/writes.rs) anchor accumulated snapshot
and pending semantics; native frameworks retain business and lifecycle ownership.

## Audited terminal graph and proposed cutover

| Stage | Current healthy measured path | Proposed path |
| --- | --- | --- |
| Seal | `sealFiniteRootEffect` stages projections, rereads through `captureSealRowsInTransaction`, materializes candidate and completes seal | Freeze ordered issued graph and prepare intrinsic canonical journal/result before SQL; derive normalized projections directly; one checked seal persists projections/body, promotes lease and captures detached body/session/authority plus candidate-schema planning head |
| Planning evidence | Fixture reload, stored-attempt repeatable read and stored-authority repeatable read | Confirmed seal output supplies exact detached healthy planning inputs; existing canonical/signed grant, arguments, schema, `verifyCommitInput` and planner run outside SQL |
| Finishing | Separate fresh checked claim-consumption transaction after verification | Retain exact fencing, first-failure and pre-finishing abort contract |
| Publication | Candidate-head preparation transaction, then actual publication | Prepare from captured head; retain independent fresh kernel/full acceptance and `readHeadForUpdate` recheck |
| Recovery | Repeatable-read stored evidence/authority and finishing reconstruction | Retain for real sealed-running/finishing obligations; captures never become cached live verdicts |

The five seal/OCC transactions are seal, fixture reload, `StoredAttemptEvidence`
repeatable read, `StoredCommitAuthority` repeatable read and finishing. Capture
removes the middle three on the healthy measured path. Publication removes its
head-preparation transaction, leaving actual publication. **Seven terminal
transactions become three**: seal, finishing, publication. The executor already
has `currentAttempt` normally; the fixture reload removal is not a universal
executor saving. Ordinary Application `prepareSeal`/`completeSeal` remains a
separate supported profile.

Freeze synchronously refuses in-flight work and late completion before SQL.
Issuer-owned completeness covers source/member identity, ordered observations,
final pending rows, lifecycle operations, result/events and usage. Preserve the
root claim-renewal gate and asynchronous runner closure. No late runner may
append to the frozen graph; neither a caller list nor stable digest authenticates
its completeness.

Seal keeps full fresh exact-kernel scope/placement/binding/source, generation,
revocation, session/lease/claim/fence, expiry, post-lock DB time, source-wide
readiness, physical proof and mandatory 23-table protected tail. Capture the
candidate-schema planning head through its existing preparation owner's internal
API. Body/session/authority/head are detached structural inputs, not live DB
capabilities. Release no capture/provenance capability before confirmed COMMIT.
Keep frozen seal canonical preparation, executor signed-grant/schema/input
verification, candidate validator compilation and control preparation outside SQL.
Publication retains locked database-row/evidence decoding and materialization/hash
checks that require its accepting transaction; moving them needs separate proof.

Retain separate finishing. A seal candidate has not authenticated signed grant,
schema and complete commit input. Entering finishing before verification can
strand invalid proof and remove pre-finishing abort. Verification failure before
finishing authoritatively aborts/discards; after finishing use retained recovery
and outcome authority. No SQL spans sandbox code, native callbacks, hooks,
workflow steps, waits or external effects.

Publication independently repeats full fresh acceptance and locks/rechecks the
candidate head. Keep strong scope-clock serialization, lock strength/order and
one clock allocation. Immutable preparation never transfers a live verdict across
transactions. The known publication-body proof limitation remains separately
owned; captured graph/digest does not repair it. Retain current checks and claim
no new tamper guarantee.

## Existing owners and mandatory batching

| Existing owner | Connected change and preserved obligation |
| --- | --- |
| [Journal](../../packages/persistence-postgres/src/sessionJournalStore.ts): `sealFiniteRootEffect`, `stageFiniteRootRows`, `captureSealRowsInTransaction`, `materializeSealCandidateEffect`, `completeSeal` | Replace healthy stage-then-reread reconstruction with frozen graph and confirmed capture; prove normalized projections and canonical body agree; staging already uses 128-row chunks |
| [Stored evidence](../../packages/persistence-postgres/src/storedAttemptEvidence.ts), authority loader, executor planning/verification/finishing/crash owners | Healthy capture reuse and outside-SQL verification/planning; retain exact repeatable-read recovery and signed-input authentication |
| [Commit transaction](../../packages/persistence-postgres/src/pointCommitTransaction.ts), [commit evidence](../../packages/persistence-postgres/src/logicalDocuments/commitEvidence.ts) | Batch original-snapshot participant points and ordinal range/page/unique rechecks, preserving full bounds/versions/`isDone`, negative membership and first-error order |
| [Materialization](../../packages/persistence-postgres/src/applicationDocumentMaterialization/materialization.ts), [candidate validation](../../packages/persistence-postgres/src/appSchemaCandidateValidation.ts) | Capture planning head and fresh final recheck; batch intrinsic build locks and validating-reset work across actual consumers; enabled definitions issue no reset SQL |
| [Rows](../../packages/persistence-postgres/src/appRows.ts), [index entries](../../packages/persistence-postgres/src/appIndexEntries.ts), [developer indexes](../../packages/persistence-postgres/src/appDeveloperIndexCommitV1.ts), [unique keys](../../packages/persistence-postgres/src/appUniqueKeys.ts) | Writes already batch. Reuse authenticated exact-transaction clock and issued index-head transition proof for redundant checks; preserve history/tombstones/coverage, release-before-claim and effects |
| Strong-reference validation and final admission | Batch original-source/target/reverse and target-slot/row/coverage checks; derive final affected set from finished facts including streamed Commerce `appendRows`, not adapter changes |
| [Search](../../packages/persistence-postgres/src/logicalDocuments/searchEntries.ts), publication/event persistence | Search already batches entries per definition, current-only supported semantics. Keep atomic commit/result/feed/fact/event insertion; `commitEvents/store` asynchronous delivery has no cutover |

Participant point correlation currently performs historical reads per first-touched
identity. Batch bounded identities while preserving original snapshot versus
pending correlation. Range/page/unique batches preserve every ordinal's dependency,
error and resource order. New membership in an empty predicate still conflicts;
independent writers retain complete history/conflict participation. Choose exact
bounded SQL after inspecting captured demands; a bundled call hiding unchanged
server statements supplies no batching proof.

Intrinsic build selection is per definition; developer selection is already bulk.
Batch locks preserving existing strength/order and exact returned membership.
A required coordinated build-ID order change returns to focused scope discussion
with all publisher, maintenance and activation owners before changing it. Keep
existing serialization; changing it requires a different coordinated-writer/
activation/migration preflight.
Reuse duplicated materialization/index-head planning through an issued exact-
transaction transition proof, never a skipped check. Clock observation expires
on transaction exit or relevant mutation. Reference fetch deduplication preserves
charges, order, existence/reverse/delete/cascade semantics and rollback. No new
planner, validator, registry, framework business engine or adapter finalizer.

## Stage cost and bounded formulas

The minimum wrapper-removal gate is source-derived, not a latency forecast:

| Graph | Driver dispatch ceiling | Terminal dispatch ceiling | Explicit transaction ceiling |
| --- | ---: | ---: | ---: |
| Product | **633** (643 − 10) | **228** (238 − 10) | **25** (29 − 4) |
| Product + Payload | **660** (670 − 10) | **236** (246 − 10) | **26** (30 − 4) |
| Mixed workflow | **1,024** (1,034 − 10) | **321** (331 − 10) | **39** (43 − 4) |
| Standalone workflow | **354** | Existing profile | **6** |

Current seal wrappers have 13 dispatches: five BEGIN, five COMMIT, two
repeatable-read SET and one read-committed SET. Two retained transactions require
six wrappers, saving seven. Publication wrappers fall six to three, saving three.
Moving candidate preparation queries into seal is phase movement, not extra
savings: all four scope/provision/clock/head queries may move, or trusted seal
may capture only head if proved. Retain combined terminal ceilings and attribute
moved queries explicitly. Nonterminal ceilings remain **405 / 424 / 703**
dispatches and **22 / 23 / 36** explicit transactions.

**Ten fewer wrapper dispatches alone do not complete this slice.** Actual owner
read/build/reference batching and removal must deliver fewer driver/server
statements with safe bounded exact queries through real consumers. Derive one
bounded implementation ledger from the actual frozen graph: original point,
range/page/unique/reference observations, per-owner rows, definition/constraint
counts and actual byte partitions. Net effects cannot reconstruct that ledger;
these counts remain an implementation gate, not invented per-graph promises or
a separate profiling turn. Driver counts exclude unmeasured function/trigger SQL.

| Preserved owner limits | Formula or bound |
| --- | --- |
| Row append | Greedy ordered chunks ≤32 rows, target 256 KiB; first oversized row alone ≤8 MiB. Nonempty `S_rows = 1 + sum_chunks(1 + I(create) + 2 I(update))` |
| Index append | `S_index = 1 + ceil0(I,32) + sum_chunks(2 + I(live) + I(tombstone))` |
| Unique/developer | Unique lookup chunks 32, release before claim; 128 transitions / 256 actions shared across constraints; developer actions ≤256 |
| Facts/events | Facts 500, events 64, up to 512 delivery rows. Known publication prefix `3 + ceil0(R,500) + ceil0(A,500) + I(F>0) + 2 ceil0(E,64)`; streamed header adds one; clock/journal/lease/session/reference work additional |
| References | Pages 32; source/target 2,016 per reference, reverse 2,016 globally; 4 MiB / 30 seconds; fetch dedup preserves accounting |
| Search/commit | Search ≤4,096 entries / 4 MiB aggregate, current-only. Commit ≤128 material rows, 4,096 points, 16,000 user writes, 16 MiB semantic / 64 MiB canonical journal |

`ceil0(n,k)` is zero for zero, otherwise `ceil(n/k)`; `I` is a nonempty category
indicator. Actual greedy chunks govern formulas; `ceil(totalBytes/256 KiB)` is
invalid. Apply 32-ordinal/256-KiB grouping where the owner supports it, retaining
output limits and full row/table ordinal bounds. Preserve capture, decode,
observation, charge and install order; oversize refusal never becomes absence.
Final reference affected set derives finished facts within the 16,000 bound.

The unchanged effects ledger is:

| Effect | Product | Product + Payload | Mixed workflow | Standalone |
| --- | ---: | ---: | ---: | ---: |
| Logical rows / final index entries / events | 1 / 1 / 1 | 2 / 3 / 1 | 7 / 36 / 7 | 5 / 33 / 6 |
| Material revisions / index revisions | 2 / 5 | 3 / 7 | 9 / 42 | 6 / 35 |
| New pointers / advances | 1 / 1 | 2 / 1 | 7 / 2 | 5 / 1 |
| Live index / tombstones | 3 / 2 | 5 / 2 | 39 / 3 | 34 / 1 |
| Unique claims / search inserts | 1 / 1 | 2 / 1 | 10 / 3 | 8 / 2 |
| Event intents / delivery rows | 1 / 1 | 1 / 1 | 7 / 7 | 6 / 6 |
| Receipts / points / write events | 5 / 11 / 3 | 9 / 12 / 6 | 9 / 15 / 12 | Unavailable |

Extend the measured 51-source inventory to actual capture, executor verification/
planning, stored evidence, candidate, index/unique, commit evidence/contribution,
search/FK/reference/point projection, event/protocol and early-conflict recovery
owners. Preserve the old 120-sample baseline and every outlier; compare matched
quiet traced/untraced full sample plans. Attribute preparation/seal/publication,
CPU/decode/hash, driver await, server/wait/lock/connection cost where observed;
mark unavailable attribution. Phase sums overlap and driver await includes
transport/server/waits. No planning benchmark is required.

Final mixed p50 goals remain **100 / 200 / 500 ms**, p95 **200 / 400 / 1,000 ms**;
standalone median below 400 ms with comparable regression strictly below 10%.
Functional delivery, structural acceptance and whole-successor latency acceptance
remain separate.

## Internal breaks, cutover and cleanup

Break internal seal/capture, prepared materialization and issued writer-transition/
callback APIs as required. Migrate `ApplicationMutationSystem`/private system V1,
durable Application task mutation authority, executor initial/OCC/finishing/crash,
genuine mixed fixture, Application participant, CMS contribution/publication,
Commerce logical participant/publication and cross-domain materialization/
publication consumers. Retain Task lifecycle and standalone/durable profile
semantics. Exact signature/export/caller census is an implementation gate.

Remove redundant healthy reload/loaders, stage/reread orchestration and displaced
single-item paths after their actual consumers move. Retain repeatable-read
recovery readers and durable projections for real obligations, not a legacy
facade. No compatibility wrapper, dual reader, fallback or second authority.

Keep durable journal/protocol/schema, normalized tables, result/event bytes,
identities and retained formats unchanged. No migration/reset/delete or named
activation. A necessary durable-format/schema/identity change requires revised
scope and explicit disposition first. Drain live finite owners or exact fenced
abort; never transfer process-local maps/pending state. Retain sealed-running
plus live claim `finishOnly`, finishing/sealed reconstruction with no durable
execution claim, committed resolution and `relation_conflicted` replacement readers.

## Failure, validation and exit

- Seal COMMIT loss abandons local root and resolves exact durable sealed state;
  no capture release, child reopening or native callback replay. Finishing loss
  uses current durable state proof; publication uncertainty resolves retained
  outcome. Confirmed abort bounded retry remains distinct from unknown COMMIT.
- Early relation conflict retains separate durable aggregate transition and
  replacement. Add its targeted lost-COMMIT witness; unrelated recovery cannot
  close the existing gap.
- PGlite and ordinary-role Postgres prove complete capture/projection/body
  correlation, extra/missing/duplicate/corruption and first-failure order; caught
  failure, in-flight freeze/late runner and claim renewal; 33-item chunk crossing,
  oversize and invalid-later refusal; malformed proof abort before finishing.
- Prove exact negative/positive point/range/page/relation/unique OCC with standalone
  writers; pending/tombstones/history, null/predicate/delete constraints, streamed
  finished facts; one publication sequence with atomic history/index/constraints/
  events/result. Keep intermediate native results, operation evidence and charges.
- Distinct Postgres connections prove candidate changes between seal/publication,
  fresh generation/revocation/full readiness/protected tail/post-lock time,
  preserved lock strength and input ordering across actual consumers.
  Observe SQL closed during native callbacks and detached grant/schema/canonical/
  candidate preparation and control work; retain required publication CPU checks.
- Run genuine Product/scalar Payload/workflow success, late failure, rollback-only,
  whole-root retry, replay, cancellation and targeted seal/finishing/publication/
  early-conflict lost acknowledgement plus fresh-process recovery. No duplicate
  callbacks/events; retain ordinary Application, standalone and durable regressions.
- Apply typed Effect full Cause/interruption/drain guidance, affected types/builds/
  Worker/source/core+diff lint, both final project reviewers (`gpt-6.1-sol`, high),
  substantive-fix re-review, cleanup, staged lint and scoped commit after validation.

Exit requires scope agreement, healthy seven-to-three terminal path, minimum
structural ceilings plus meaningful actual owner batching/removal, complete
consumer migration, failure/recovery proofs and unchanged durable disposition.
Reconcile failed agreed stage budgets within the slice or discuss changed
contracts. Quantify remaining latency and evidence-derived owners across existing
core frontiers, protection, settlement and hosts. Terminal traced intervals and
untraced whole-request medians do not support a subtraction forecast. Conditional
[18](./18-host-lifecycle-preflight.md) requires attributable host evidence; an
unmet target does not assign the remaining gap to it. Scope-clock partitioning, reduced
attestation, new framework/query/search support, developer APIs, hosted activation,
async delivery, waits/effects/locks and advanced schema evolution remain gated.
