# Orchestration simplification: architectural reassessment

Status: **active research and design gate; bounded native retrieval ledger available,
focused request-owned construction and Application acceptance implemented with
bounded connected correctness;
broader runtime choices and ceilings pending.** The
checked-read slice delivers structural transport composition, with latency acceptance open.
Before publication or another minor performance iteration, compare the whole
orchestration with native demand and select a coherent replacement graph. This
direction does not itself amend an accepted authority or transaction contract.

The [proposed finite target](./orchestration-target-design.md) records a candidate
graph, the readiness-scope and terminal-durability decisions, data disposition
and connected delivery groups. The [paired native retrieval measurement
preflight](./native-retrieval-measurement-preflight.md) has a genuine pinned
MikroORM versus protected standalone Flarex scalar/collection control, with full
DTO and missing-error parity. The [artifact ledger](../../packages/medusa-adapter/benchmarks/core-performance/native-retrieval/README.md#read-construction-comparison)
owns timings, complete work and measurement limits. The approved focused
[read-admission construction](./read-admission-construction-preflight.md) slice
selects request-owned standalone Application capture and generalizes the existing
immutable preparation owner with full readiness, fresh acceptance and current
protection. Its approved standalone physical amendment moves that live proof solely
to fresh business acceptance, changing diagnostic timing/classification/precedence
before business work while retaining full serving proof. Executable Application,
retained finite and relation profiles keep their physical-refusal contracts.
Shared request/retained capture acquires clock before head with original lock
strengths, matching activation. Missing/corrupt clock now precedes missing head;
well-formed foreign authority remains checked after the head. The focused preflight
owns the correction and diagnostic inventory. Demand narrowing,
cross-request reuse, cheaper attestation and
terminal/recovery changes remain deferred. The broader proposals authorize no
runtime cutover or private retrieval admission extension.

The [accepted DB design](../../design-notes/flarex-db-accepted-design.md),
[mixed mutation design](../../design-notes/flarexdb-mixed-mutation-execution.md),
[package boundaries](../16-package-boundaries.md), and repository Medusa/Payload
integration skills govern this work. Private interfaces may break when required
by the selected design. Preserve supported behavior and inventoried durable data.

## Outcome and acceptance question

Explain and remove avoidable platform amplification in real native Product
retrieval, then the existing Product update plus Application graph, Product plus
Payload graph, and finite mixed workflow. High counts are acceptable only for
actual native/business demand or demonstrated necessary correctness obligations.
Avoidable platform amplification is a redesign failure; accepting the current
baseline or passing a small dispatch ceiling does not close this reassessment.

Investigate proof boundaries, lifetime aggregation, internal read transactions,
whole-source checks, native batching/joins, journal merge, and seal/finish/publish
choreography together. RPC coalescing may improve transport; count the retained
server work before claiming architectural simplification.

Developer APIs, hosted activation, new Product create admission, arbitrary
hooks/workflows, advanced schema migration and named durable-environment
activation remain deferred. Product create is a future connected proof.

## Required invariants versus replaceable mechanisms

| Required invariant | Current mechanism to challenge |
| --- | --- |
| Postgres alone owns one atomic outcome, isolated by scope/placement; only the trusted outer owner settles | Private coordinator layers, owner handoffs and number of accepting transactions |
| One logical snapshot plus earlier pending edits/inserts/tombstones across domains | Working-set/context construction, any repeated pending hydration and separate row/range/relation loops; attribute their actual costs before selecting replacement |
| Complete point absence/revision, membership/order/page, relation/constraint dependencies; final OCC, uniqueness and reference enforcement | Intermediate journal frames, repeated dependency merge/encoding and materialization passes |
| Authentication of principal, schema/binding/source/method, original claim, attempt fence, revocation and deadlines at selected accepting cuts | Rebuilding the full present admission template for every low-level storage demand |
| Correct freshness/invalidation under the ordinary-role writer contract; privileged protected edits require quiescence | Source-wide traversal frequency, compilation and exact-transaction proof representation |
| Native Medusa result/error/visibility/relation/event and Payload access/validation/hook/nesting behavior | DAL translation that decomposes native queries into checked microtransactions, context construction and request plumbing |
| Atomic data/result/outcome/event intents; durable fencing and uncertain-COMMIT recovery | Separate aggregate seal, finishing and publication handoffs or duplicate verification |
| Bounded resources, rollback-only, full Cause/interruption and actual cancellation settlement | Budget wiring, helper layers, captures, retry and cleanup choreography |

Do not hold a SQL transaction across untrusted callbacks, remote effects or
workflow pauses. Short SQL lifetimes remain the accepted contract until an
explicit amendment is selected. A trusted captured storage evaluator can group
its own bounded dependent reads; labelling a framework service trusted does not
justify putting its callbacks or hooks inside SQL.

Slices [11](../mixed-mutation-core/11-attempt-admission-preflight.md),
[16](../mixed-mutation-core/16-batched-read-execution-preflight.md) and
[19](../mixed-mutation-core/19-aggregate-entry-preflight.md) already permit
tentative finite local work, aggregate entry and captured storage frontiers.
Slice 16 currently requires fresh full authority and source-wide readiness at
each actual frontier. Reassess those accepting cuts and lifetimes; the present
template does not prove every present frontier must survive. Moving discovery
of persisted revocation/readiness/claim/deadline loss requires an explicit
timing/authority decision and witnesses. Do not silently cache live verdicts.

## Current source and owner evidence

| Responsibility | Concrete source/owner |
| --- | --- |
| Pinned Medusa | `third_party/medusa/SOURCE.json`: fork commit `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, package baseline 2.13.4; historical upstream release identity remains separate |
| Executing Product | Workspace `@medusajs/product` in `packages/medusa-product/`, `src/services/product-module-service.ts`; adapter `product-module.ts` constructs it with the selected repository; `product-commands/reads.ts` directly invokes `service.retrieveProduct` |
| Native comparison sources | Pinned `third_party/medusa/upstream/packages/modules/product/src/services/product-module-service.ts`, `packages/core/utils/src/modules-sdk/medusa-internal-service.ts`, native MikroORM repository `packages/core/utils/src/dal/mikro-orm/mikro-orm-repository.ts`, and distinct fork `packages/database/drizzle/src/repository.ts` |
| Medusa DAL and relations | `packages/medusa-adapter/src/query/read.ts`, `commerce-relations.ts`, `commerce-relation-filter.ts`, `product-repository.ts`, `product-read-profile.ts`, `product-attempt.ts` |
| Executing Payload | Installed `packages/payload-adapter/node_modules/payload/package.json`: 3.88.0, matching adapter peer; `dist/collections/operations/{local/,}create.js`, `update.js`, `findByID.js`. Release identities live in `roadmaps/flarexdb-framework-integration/preflight/payload-release-capability-map.json`; tarball-to-Git equivalence is not claimed |
| Payload lifecycle | `packages/payload-adapter/src/{operations,adapter,composition,collectionRuntime,mixedConformance}.ts`: actual Local API, same mutable nested request and request-owned loader |
| Borrowed lifetime | Persistence `commerceTransaction/{borrowedLogicalAttempt,borrowedWorkflowAttempt}.ts`, `cmsTransaction/borrowedLogicalAttempt.ts`, `logicalDocuments/{participantAdmission,relationalAdmission,documentAdmission}.ts` |
| Source/freshness evidence | Persistence `logicalDocuments/sourceAdmission.ts`, `logicalStorageReadiness.ts`, `preparedMetadataEpoch.ts`, application/data binding owners |
| Snapshot/pending execution | Persistence `logicalDocuments/{workingSet,rootEvaluator,query,relationalQuery,indexReads}.ts`, `appRows.ts`, `appIndexEntries.ts`; existing working-set captured frontiers |
| Attempt/journal | Persistence `transactionSessionActivation.ts`, `transactionSessionAttemptKernel.ts`, `exactRunningAttemptTail.ts`, `sessionJournalFiniteEntry.ts`, `sessionJournalStore.ts`, `logicalDocuments/{journalEvidence,journalContribution}.ts`; executor `pointMutationJournal.ts` |
| Terminal/recovery | Executor `storedAttemptAuthentication/{exactPointMutationExecutionOperations,finishingOperations,pointCommitPersistenceOperations}.ts`; persistence `pointCommitTransaction.ts`, materialization and `commitEvents/store.ts` |
| Connected evidence | Backend `test/support/mixedMutationProductFixture.ts`, `checkedReadPerformanceScenario.ts`, `mixedMutationProduct*.workerd.test.ts`, `mixedMutationPayload*.workerd.test.ts`, `mixedMutationWorkflow*.workerd.test.ts`, `mixedMutationCommitRecovery.postgres.test.ts`; existing benchmark artifact owners |

Native `retrieveProduct` expands `variants.images` to `variants` and `images`,
calls internal retrieve with normalized config, optionally builds variant/image
associations, then serializes. Internal retrieve builds the query, calls the
repository's `find`, and retains missing-ID/NOT_FOUND behavior. MikroORM load
strategies and the fork Drizzle seam are distinct. Establish the executable
native repository/bootstrap supporting the chosen comparison; do not infer
query counts or populated-relation support from the service name.

Medusa `executeRead` currently resolves relation filters before root selection,
populates relations, then projects results; count placement depends on its plan.
`workingSet.ts` already owns `withStorageFrontier` for captured mechanics. Reuse
that owner before proposing another planner, universal CRUD layer or interpreter.

## First decisive proof: real Product.retrieve

Current checked-read component probes call genuinely borrowed
`context.table("product").find` for ID/handle hits and misses. They prove that
component, not full retrieval normalization, serialization or populated relations.
The private mixed `product-attempt.ts` retrieve decoder admits an ID only;
broader find config needs a private admission decision, even though standalone
Product supports selected populated reads.

1. Freeze the same seed, scalar fields, requested populated relations, visibility,
   actual native method/config, complete result and native error behavior. Begin
   with currently supported retrieval; use existing standalone relation fixtures
   to establish the populated graph. Inventory any private admission extension.
2. Execute the same pinned native Product service using its real native repository
   and Flarex. Preserve native assertions, seed and configuration. Identify
   promotion/seam differences, ORM bootstrap, connection and execution settings.
   A mocked repository or hand-written SQL is not the native control.
3. Attribute each service/repository/population demand to queries, rows, bytes and
   dependent phases. Observe native joins/select-in batches and locate precisely
   where Flarex retains or decomposes them and why.
4. Keep point hit/miss and handle probes as accompanying diagnostics. Add requested
   relation growth and repeated retrieval after pending updates, preserving exact
   absence/range/relation evidence. These diagnostics do not establish retrieval
   parity by themselves.
5. Compare quiet latency and complete work under identical declared settings.
   Report setup and whole-request cost alongside operation samples. Preserve
   failures/retries/outliers; do not claim exact native parity or production scale.

## Connected graphs and distinct profiles

Next prove the existing native Product update, subsequent retrieve/listByHandle
and Application insert/patch graph: snapshot plus pending reads, uniqueness and
references, native events, original claim and whole-attempt OCC retry. Include
concurrent changes between early reads and final acceptance.

Then use existing Product plus Payload: actual Local API create/update/findByID,
access and validation, supported create `afterChange` nested update/read on the
same request, and caught validation failure preserving rollback-only. The adapter
invokes Payload itself; `payload.db.*` alone cannot prove this lifecycle. Preserve
request/dataloader ownership, hook/result/error order and tentative pending state.

The existing finite mixed workflow is the integration gate for fanout, child
results, cross-domain pending interleaving, events, rollback, conflict retry and
recovery. Waits, independent remote effects and unadmitted compensation remain
outside this atomic finite profile.

| Profile | Obligation when selecting a replacement |
| --- | --- |
| Private finite mixed root | May replace internal proof/journal/working-set choreography after selecting accepting cuts, replay restrictions and resource bounds |
| Ordinary Application and durable operations | Preserve dependencies, replay/journal/liveness; migrate actual shared callers or name the genuinely distinct retained owner |
| Standalone Medusa/Payload | Preserve supported native request/transaction behavior, constraints/events and outer-only settlement; attribute actual native demand separately |
| Sealed and uncertain-outcome recovery | Preserve authoritative durable evidence and outcome correlation; process-local pending/evaluator/proof state cannot become recovery authority |

## Alternative target graphs: proposals only

| Proposal | Owner cut and unresolved proof |
| --- | --- |
| Native normalization → bounded captured retrieval evaluator → native serialization | Group dependent root/relation/index hydration within short SQL lifetimes at existing working-set/DAL owners. Prove trusted capture, bounds, native error/order and complete temporal join/negative/range evidence. The service callback itself remains outside SQL |
| Full root/source entry → tentative native demand execution → aggregate operation/root acceptance → settlement | Reassess repeated proof and lifetime cuts. Specify exactly where revocation/readiness/fence/claim/deadline loss refuses and which intermediate results are tentative. This may require an explicit timing amendment; no cached live verdict is selected |
| One owned root pending/dependency evaluator → borrowed adapters → one journal contribution | Avoid repeated copy/hydration/merge while retaining one authority, bounded memory, complete conflicts and ordered native activity. Ordinary durable/replay profiles may need a distinct persistent representation |
| Stable structural source identity → owned demand selection → fresh required progress at accepting cuts | Investigate separating immutable identity/shape from live physical/build progress and selecting exact demand plus pending/constraint closure. Source-wide validation is the current contract, not evidence that every selected definition is necessary for scalar retrieval. Narrowing it requires semantic and freshness proof, not a cached live verdict |
| Frozen canonical result/evidence → fresh final validation and transition/publication | Challenge seal/finish/publish duplicate work only after proving necessary durable transitions, uncertain-COMMIT and recovery. No service/hook rerun at commit or second settlement owner |
| RPC/server-function composition with unchanged graph | Transport alternative. Count internal statements, locks, functions and triggers; unchanged read/proof amplification can leave the architecture problem unresolved |

Prefer small direct owner composition over a universal framework transaction
API, parallel journal/validator engine, adapter bypass or speculative prefetch.
Show representative native adapter construction/callers before and after,
including populated relation and nested-hook cases; fewer imports are not proof.

## Demand accounting and small-overhead selection

| Category | Required ledger |
| --- | --- |
| Native/business demand | Actual service/DAL queries, selected rows/fields/populated edges, batches/joins, mutations, native hook/validation/event calls and dependent phases |
| Flarex data work | History and missing/tombstone/range evidence, pending reconciliation, row/index/search/reverse maintenance, constraints/OCC and durable result/event writes |
| Orchestration overhead | Authentication/readiness/binding/proof, lifetime/claim work, journal capture/merge/encoding, setup/bootstrap and terminal choreography not charged above |
| All SQL/server work | Every checking/accepting transaction and autocommit, round trip, row/page/byte bound, internal server-function statement and trigger invocation |
| Latency/recovery | Quiet whole-request and phase distributions, setup, measured CPU/encoding, driver/lock waits, retries and uncertain outcomes per successful result |
| Scaling | Vary records, populated edges, native calls and workflow steps independently; distinguish necessary demand growth from platform multiplication |

After native attribution, propose a small justified additive orchestration
budget per selected semantic acceptance cut. It should follow the necessary
source/proof set and dependent phases rather than multiply full admission by
every row or DAL call. Legitimate history/index/constraint work may scale with
records/mutations; explain it separately. Small dispatch counts cannot conceal
unbounded server loops or overfetch.

Numerical ceilings are **not selected**. Publish the proposed bound, unavoidable
obligations and owner-attributed residual for each graph once native evidence
exists. Acceptance requires all-server-work, checking-transaction, round-trip,
latency and scaling gates. Existing whole-request latency goals remain. Report
unavailable server instrumentation as unavailable, never zero.

## Native attribution and remaining runtime decision gate

The selected native scalar and collection cases each issue one autocommit query.
The displaced protected standalone baseline retains six transactions and extensive
proof construction before its native method. Owner tracing places its first five
transactions in binding selection and ordinary Application activation/readiness
construction and acceptance; the final transaction obtains the fresh business
snapshot, revalidates binding/Application and protection, accepts logical source
readiness, then probes/hydrates the selected data. Candidate/analysis/publication
and readiness projections are reconstructed repeatedly. The artifact ledger owns
the exact dispatch/row/byte and quiet/trace/server observations. Those independent
measurement modes do not provide additive CPU/latency causation.

The current private finite path uses `prepareFiniteActiveApplication` and the
generalized `captureApplicationReadinessInTransaction` with issuer-owned preparation
under the host lifetime and fresh accepting transactions. It does not repeat
the standalone first-five-transaction sequence on every finite retrieval. The
standalone ledger therefore selects the next owner group; it does not replace
the finite checked-read baseline or justify importing standalone costs into it.
The implemented focused slice removes repeated standalone healthy construction
through request-owned capture and detached preparation; native Product data demand
remains unchanged. Matched final-source quiet/trace/server evidence reports bounded improvement.
Fresh binding/Application acceptance is the largest remaining region by dispatches
and JSON bytes, with `validateStoredIssuedReadiness` repeating canonical evidence
after preparation. Full logical-source readiness is the largest metadata-row region.
The approved [fresh Application acceptance preflight](./fresh-application-acceptance-preflight.md)
selects Application-only pre-business snapshot attestation and direct final tail,
explicit tentative-local refusal timing and finite same-entry immutable-observation
composition. Earlier candidates remove repeated captured bodies but miss the
combined latency gate. The approved bounded named identity owner now passes the
controlled initial-readiness/pre-attestation/tail median and P95 gate while
preserving every protection predicate and refusal contract. Complete native
requests, cold connection/protocol evidence, covered-write validation and bounded
connected correctness are established. The full mixed milestone retains an
original quiet regression and nonreproducing targeted repeat; cause is unestablished.
Whole goals remain open. Exact source attribution
of publication at existing `pointCommitTransaction` is a next hypothesis, requiring
its own preflight before activation. Counts, distributions and limits remain in
the artifact ledgers.

- The native MikroORM control, deterministic native seed/config and complete
  scalar/collection DTO plus missing-error parity are established for the bounded
  measured cases. Method bodies match; constructors and request lifetimes differ.
  Broader populated relations, variant-image demands and all Product behavior
  remain unproved.
- Private ID-only retrieve admission has not widened. Specify scalar/relation
  config, affected grants/callbacks and source proofs before changing it.
- Client query/row/JSON-byte and separate server-statistics ledgers exist for those
  cases. Function/trigger coverage is not proven absent by missing nested rows.
  Scaling, full setup SQL/CPU and complete mixed-profile attribution remain open.
- The retained earlier scalar Product trace selects 73 ordered-build rows and
  repeats physical/live metadata checks. Attribute each to actual query, pending,
  constraint or authentication requirements; do not mark it necessary merely
  because current source-wide admission performs it. Stable identity/progress
  separation and demand-bound validation are hypotheses requiring this evidence.
- The completed checked-read pair measures miss counts 20 → 17 and the exact
  baseline eight-table frontier union after correcting initial unique overfetch.
  Its structural transport composition is delivered. Miss medians are higher; no causal latency gain
  or architectural acceptance is established, and the initial outlier's cause
  remains unknown.
- The approved focused [read-admission slice](./read-admission-construction-preflight.md)
  reuses the existing immutable preparation owner with request-owned standalone
  capture, the actual retained finite lifetime and fresh authoritative acceptance.
  The selected construction is implemented under the approved focused contract;
  whole-goal performance acceptance remains open. Connected validation, reviews
  and cleanup remain mandatory slice gates.
  It retains full readiness and current protection. Demand narrowing, cross-request
  reuse, cheaper attestation and terminal recovery semantics remain deferred;
  broader runtime changes, timing amendments and numeric ceilings require selection.

## Breaks, data disposition, cutover and removal

The implementation preflight must inventory root, borrowed-context, admission,
working-set, source/readiness, journal/protocol and finishing/publication breaks.
Classify paths retain/extend/replace/delete and migrate actual Application,
Medusa and Payload consumers together. Retain distinct ordinary/durable/recovery
paths only for demonstrated profile contracts, with owners and explicit
removal/reassessment gates. Do not keep private wrappers or dual engines to avoid
caller migration.

Inventory running attempts/claims, sealed journals, retained outcomes and event
intents before changing formats/transitions. Select migration, quiescent cutover
or explicitly authorized disposable-scope reset; no silent durable deletion or
process-local recovery substitute. Retain old readers only until their named data
obligations migrate. Remove displaced helpers, hooks, schemas, exports, copied
semantics and test assembly in the same delivery, retaining behavioral coverage.

Research completion requires the native-demand ledger, selected target graph,
explicit invariant/timing decisions, data disposition and justified small-overhead
proposal. Runtime completion also requires native consumer cutover, PGlite and
ordinary-role PostgreSQL, full mixed integration measurement for this
cross-component/lifecycle change, proportionate concurrency/failure/recovery
proofs, both project reviews and cleanup. Root owns orchestration and Git;
workers edit disjoint owners and reviewers remain read-only. This document
authorizes no broader evidence-pending runtime cutover. The focused read-admission
contract is selected by its linked approved preflight.
