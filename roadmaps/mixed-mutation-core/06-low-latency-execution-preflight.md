# Low latency mixed execution: approved preflight

Status: **the first connected package is complete.** It keeps fresh selected
dependency verification, makes the physical-search proof cheaper, and removes
redundant internal admission transactions before checked reads. Later packages
depend on the retained traced and untraced results. This document does not amend the
[accepted database design](../../design-notes/flarex-db-accepted-design.md),
relax the [connected execution integrity decision](../shared-transaction-core/70-connected-execution-acceptance.md),
or extend the completed [core query cost correction](./05-core-query-cost-preflight.md).
No broader integrity, durable protocol or host change follows from this
preflight without its own evidence and required accepted-design revision.

## Outcome, boundary and reason to act

Target a reusable low latency private mixed attempt across Application, admitted
Payload Local API, Medusa modules and finite native workflows. The present
Product, `posts` and Product/Pricing/Link/Tag graph are connected witnesses,
not identifiers or branches in the core design. Postgres remains the committed
data, journal outcome and publication authority. Only the trusted outer root
settles; no SQL connection or transaction may span a Worker invocation, native
service or workflow callback, Payload hook, remote effect or pause. Framework
semantics remain with their adapters. Public authoring, additional framework
operations, hosted activation, advanced schema evolution, higher deadlines and
shared ceilings are outside this proposal.

The [retained optimized full series](../../packages/flarex-backend/benchmarks/mixed-mutation-core/optimized/manifest.json)
completed **104/104** ordinary-role PostgreSQL samples with the same four
workloads, 3 warmups, 20 measured warm requests and 3 cold requests each.
Every selected cold workflow succeeded under the existing deadline. The original
[partial run](../../packages/flarex-backend/benchmarks/mixed-mutation-core/exclusions.json)
still records its failed cold request; the correction neither deletes that
evidence nor explains its delayed COMMIT. The full corrected series is a
successful bounded correctness and cost proof, but its warm request spans are
well above the proposed product latency goal:

| Selected workload | Warm request median / descriptive p95 | Driver dispatch median | Driver SQL-await median | BEGIN-to-settlement interval count median |
| --- | ---: | ---: | ---: | ---: |
| Application + Product | 3.020 / 3.298 s | 4,358 | 1.623 s | 109 |
| Application + Product + Payload | 4.420 / 7.884 s | 6,352 | 2.403 s | 151 |
| Application + Product + Payload + finite workflow | 10.108 / 10.750 s | 11,442 | 5.982 s | 259 |
| Independently settling standalone workflow | 0.362 / 0.992 s | 480 | 0.171 s | 6 |

The [first connected package artifact](../../packages/flarex-backend/benchmarks/mixed-mutation-core/admission-cost/README.md)
retains two new full **104/104 successful** series. With the same traced
observer, the warm request-span medians changed from the table above to
**2.337 / 3.210 / 6.755 / 0.332 s** respectively. Candidate traced outer
wall medians were **2.341 / 3.216 / 6.767 / 0.333 s**; a subsequent untraced
candidate series measured the same outer boundary at **2.231 / 3.095 /
6.761 / 0.345 s**. The latter series has no SQL or phase observations and
there is no untraced historical optimized baseline. Sequential observer-mode
differences are descriptive, with cache and system drift possible; they do not
isolate a precise tracing cost. Product and mixed warm candidate traced
dispatch/transaction medians are **3,842 / 97** and **10,410 / 235**.
The proposed mixed warm latency budgets below remain unmet.

The standalone graph lacks the mixed root's Application, Payload, journal and
OCC obligations; it is neither parity nor a native ORM baseline. These are
driver dispatches and awaited intervals, not network round trips or PostgreSQL
server time. Physical `pg_catalog` proof still costs a median **90 dispatches /
0.597 s** on Product and **248 / 3.143 s** on the mixed workflow. Batched table
frontier costs are **270 / 0.106 s** and **744 / 0.321 s** respectively;
historical row SELECT/CTE costs are only **24 / 0.008 s** and **51 / 0.021 s**.
Product's fresh Worker construction median is **84.6 ms** and the mixed
workflow's is **89.9 ms**, already inside the request interval. The remaining
cost cannot be promised away by another table batch or a cached checksum.
The benchmark has no server execution, precise lock wait/hold or hosted
transport timings; collect those only to resolve a named implementation or
acceptance decision.

The optimized mixed workflow's approximately 10.1 s median includes about 6.0 s of
summed driver SQL await, but the remainder is not proven native ORM, CPU or
Worker work: nested phases, observer cost and overlapping waits prevent that
subtraction. The first package ran matching candidate traced and untraced
requests with identical business assertions, request start/end and host
temperature, after a prior optimized traced series. The candidate-only
calibration cannot infer an untraced before/after speedup. Retain both modes
when later candidates need observer calibration; do not silently remove
instrumentation only for one side of a comparison. Profile CPU, hashing and allocation only for a named dominant
phase; use PostgreSQL `EXPLAIN` and bounded lock sampling only where query
execution versus checkout, scheduling or lock wait changes a decision. Keep
this a focused calibration, not a new benchmark platform.

### Proposed budgets, not accepted targets

For the **exact current private fixtures**, propose warm, successful,
ordinary-role PostgreSQL request-span p50 at or below **100 ms** for the
existing Application + Product graph, **200 ms** for that Product graph plus
the selected Payload `posts` create/update/find lifecycle, and **500 ms** for
the existing Application + Product + Payload + finite native workflow graph.
Propose descriptive p95 ceilings of **200 / 400 / 1,000 ms** respectively over
at least 20 measured warm requests. A future smaller Product fixture could be
an additional measurement, never a substitute for these three graphs.
For the independently settling standalone workflow, propose a regression
ceiling of **400 ms p50 / 1,100 ms descriptive p95** on its existing graph;
it has fewer obligations and is not a mixed parity target.
These are candidate product decisions, not an estimate that the architecture
can already attain them. The 100 ms goal leaves roughly 15 ms beyond the
current median fresh Worker construction alone, before any required admission,
native operation, journal or settlement. A host lifecycle choice and measured
lower bound are prerequisites to accepting it. Keep the independently settling
standalone workflow as context, with no mixed parity target inferred from it.

Measure fresh Worker, pre-readied single-use Worker, cold scope/module, larger
graph, conflict/retry and concurrent-scope distributions separately. Never
relabel prewarming as a free request cost: report replenishment CPU, memory,
capacity, eviction, queue wait and rejection, and preserve the
one-invocation-per-Worker guard. A proposed warm host series must still measure
the full request from admission through publication; it cannot meet a budget
by subtracting startup from the unchanged fresh-Worker interval. Keep that
fresh series as the comparison. The existing 3 cold samples per workload show
success, not a stable p95.
Before implementing a package, agree separate cold, retry, throughput and
contention budgets and whether the tentative warm numbers survive the proven
minimum number of authority and durability round trips. Count total work per
successful root, including retries, alongside visible request latency. Agree
which explicit traced or calibrated untraced mode judges the budgets, and
retain the original traced series for comparison.

## Integrity decision that blocks a cheap warm admission

The accepted [Prepared Execution Integrity](../../design-notes/flarex-db-accepted-design.md#prepared-execution-integrity)
decision and [connected acceptance](../shared-transaction-core/70-connected-execution-acceptance.md#integrity-decision)
require immediate verification of selected metadata dependencies in the
accepting transaction, including replay and recovery. Immutable bounded host
preparation may be reused but is **not** an admission verdict. Live scope,
placement, binding, generation, revocation and readiness remain checked. An
unchanged readiness root cannot currently replace selected reads and hashes:
ordinary history protection does not cover every Application catalog,
publication and build writer, and privileged repair can disable guards.
Existing unchanged-root/digest tamper witnesses synchronously refuse altered
publication/schema/catalog, binding and installation evidence. The lower cost
proposal therefore needs an **explicit amendment of that accepted integrity
boundary before code**, not an internal optimization justified by performance.

The proposed **default for discussion** is an ordinary runtime and approved
writer/maintenance boundary in which covered changes use controlled owners,
and privileged repair quarantines affected scope/source admission until a
fresh proof and explicit resume. Unannounced table-owner or superuser bypass
would be outside that proposed synchronous detection boundary. This **weakens
the current privileged unchanged-digest tamper guarantee** and is therefore
not selected without owner approval and an accepted-design amendment. Under
that proposed contract, an ordinary bypass is blocked, planned repair bumps or
invalidates the appropriate evidence before resumption, and unannounced
privileged alteration is a separate integrity incident rather than a claimed
immediate refusal. If the owner retains synchronous refusal for that last case,
the selected physical reads/hashes remain and the candidate latency budgets
must be reassessed honestly.

Investigate a protected, transactionally invalidated *structural* preparation
generation scoped to actual metadata ownership, together with a separate
cheap live readiness/coverage verdict **only if** every admitted writer can
maintain it atomically. This is a candidate use of existing heads, epochs and
fences where sufficient, not a default new registry or a global multi-shop
counter for ordinary business writes. Rare shared physical GIN/DDL changes may
need a placement- or schema-wide epoch at the existing owner, invalidating
all affected readers without an unbounded per-scope blind spot. Immutable
structural metadata and physical identities differ from
mutable data-dependent index/unique/search coverage, backfill progress,
retention and snapshot freshness. A generation bumped on every business write
would invalidate every warm request or create a hot row; frozen coverage would
be stale. At minimum, the proof must:

- enumerate every covered writer, lifecycle state and selected dependency:
  Application analysis/catalog registration and publication, relation
  publication and readiness, activation, task bindings, index/unique/search
  build and reconciliation, ordinary runtime publication's coverage progress,
  physical definition lifecycle, framework
  installation/plan/admission/attempt/receipt state, placement and revocation,
  maintenance, restore, and control-versus-target database transitions. This
  list is representative, **not yet complete**. Include namespace, collision
  and physical-name dependencies shared beyond one scope, and selected
  predicate/descendant membership: inserts, deletes and row entry/exit can
  change a selection without updating a previously selected row. Trace actual
  DML, DDL, privilege and repair paths before treating a generation as sufficient;
- enforce, rather than assume, that ordinary runtime roles cannot perform
  *uncontrolled* covered writes. A candidate is separate runtime and metadata
  writer roles, REVOKE of direct covered DML from runtime, and controlled
  writer functions or complete DML triggers; this is **unproved** until the
  full privilege/writer inventory and installation gate audit grants, triggers
  and repair re-enablement. Runtime publication still needs its required
  progress writes through the controlled owner. Dedicated trusted writers
  must invalidate the correct scope/source/schema structural generation in
  the same transaction as a structural change, while every data-dependent
  coverage publication maintains the live verdict with its own atomicity,
  retention and snapshot proof. Key invalidation to the actual selected
  owner/predicate set and placement, not just a per-scope identifier.
  Acceptance must hold its live head/fence lock through each short checked SQL
  operation and check again at final settlement, never across a native callback;
  writer invalidation and revocation must linearize with both rather than race
  between an old check and a newly committed write. Assess existing owners
  before introducing any new registry or metadata service;
- distinguish immutable prepared bytes from immediate live head, generation,
  placement, binding, revocation and readiness checks. Decide the selected
  physical evidence that remains synchronous and the exact authenticated
  projection whose cost can move to protected preparation;
- state a privileged-repair/DDL threat boundary. A superuser or table owner
  able to disable triggers or alter data outside the controlled writer path can
  bypass an ordinary-role generation. Disposition the existing synchronous
  tamper tests one by one: ordinary bypass blocked, approved repair
  invalidated/quarantined, unannounced privileged bypass either still checked
  synchronously or explicitly moved to a separate detection boundary. An
  asynchronous audit cannot silently replace the accepted guarantee;
- cover control and target database placement separately. Their current
  observations are not one atomic cross-database snapshot. A single shared
  generation cannot assert cross-database atomicity. Define the immutable
  publication, target activation/pinning, routing and revocation sequence,
  refusal on disagreement and recovery before claiming a warm admission.

Until this writer/threat/placement contract is agreed and proved, **retain the
existing selected-dependency verification**. A cache hit, unchanged digest or
successful replay test alone does not meet the gate.

## Current owners and primary-source differences

| Current owner or source | Contract relevant to this proposal |
| --- | --- |
| [Framework installation runtime](../../packages/persistence-postgres/src/frameworkSchema/installation/runtime.ts), [selected evidence](../../packages/persistence-postgres/src/frameworkSchema/installation/runtimeEvidence.ts) and [history guards](../../packages/persistence-postgres/drizzle/0100_framework_metadata_protection.sql) | Prepared graph/evidence is bounded and hashed; ordinary history guards do not protect against privileged bypass or establish complete writer invalidation. |
| [Participant admission](../../packages/persistence-postgres/src/logicalDocuments/participantAdmission.ts), [source admission](../../packages/persistence-postgres/src/logicalDocuments/sourceAdmission.ts), [document admission](../../packages/persistence-postgres/src/logicalDocuments/documentAdmission.ts) and [working set](../../packages/persistence-postgres/src/logicalDocuments/workingSet.ts) | Every checked read verifies source authority; a transaction-local candidate/readiness projection already exists. The proposed target is duplicate empty checked transactions before real I/O, while state-only observable paths retain live admission. |
| [Product borrow](../../packages/persistence-postgres/src/commerceTransaction/borrowedLogicalAttempt.ts), [workflow borrow](../../packages/persistence-postgres/src/commerceTransaction/borrowedWorkflowAttempt.ts) and [Payload borrow](../../packages/persistence-postgres/src/cmsTransaction/borrowedLogicalAttempt.ts) | Each currently composes `requireAdmission` as an empty `checkedRead` and also supplies a checked `readTransaction`; the exact native call and hook boundary must be preserved. |
| [Attempt activation](../../packages/persistence-postgres/src/transactionSessionActivation.ts) and [journal store](../../packages/persistence-postgres/src/sessionJournalStore.ts) | Scope/session/claim fencing, the committed invoking marker before native code, ordered receipts, poison, acceptance and lost-ack reconciliation are durable boundaries, not optional in-memory bookkeeping. |
| [Worker core](../../packages/flarex-backend/src/artifactRuntime/PointMutationExactRuntimeWorkerCore.ts) and [artifact runtime entrypoint](../../apps/artifact-runtime/src/pointMutationExactRuntimeEntrypoint.ts) | The Worker is created/readied for the request and the module has a one-invocation guard; immutable preparation is a different lifetime from reusing a live Worker. |
| Primary references: [Convex database](../../../../crates/database/src/database.rs) and [read dependencies](../../../../crates/database/src/reads.rs), [pinned Payload transaction initialization](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/utilities/initTransaction.ts), [pinned Medusa workflow export](../../third_party/medusa/upstream/packages/core/workflows-sdk/src/helper/workflow-export.ts) | Convex retries a whole closure with a fresh transaction and records missing reads; Payload nests under an existing request transaction ID; Medusa supplies workflow transaction/event-group context. Flarex additionally needs durable child acknowledgements across short transactions and cannot claim the same transaction lifetime or semantics from these references alone. |

## Candidate execution shape and challenged alternatives

The second axis is the number of small SQL operations and transactions produced
by the current call graph, not just the catalog proof. Trace the minimum needed
authority and durable-ack stages for each selected workload. The cost target is
bounded work proportional to actual reads, writes, selected sources and events,
not metadata definitions multiplied by helper calls. Do not assign a magic
constant transaction count before proving which stages can safely merge.

1. Keep process-local capability identity, closed/revoked handle checks and
   bounded input validation at the trusted host boundary. A local check is
   useful inside an explicitly admitted operation, never as a cached live
   verdict across operations or transactions. Today the borrowed Product,
   Payload and workflow owners install both `requireAdmission = checkedRead`
   of an empty effect and `readTransaction = checkedRead`; the working set
   commonly calls the empty guard immediately before the real checked read.
   Investigate removing that duplicate *only* where the actual I/O retains
   the fresh source-head, clock, fence and lease check in the same bounded
   short transaction. State-only observable operations such as pending reads,
   plan/set-null, event emission and close still require fresh admission even
   when no row SQL follows. A head flip between a local guard and historical
   read must fail at the read; revocation or expiry after one operation must
   fail on the next. Preserve first refusal order, source rights,
   pending-publication refresh and rollback-only behavior. The existing
   source-admission owner already reuses a candidate/readiness projection by
   `FlarexMetadataTransaction`; this is not a request for a second transaction
   cache or another auth owner.
2. Reuse the bounded evaluator, pending overlay, exact dependency observations
   and selected framework binding within **one** live root attempt, keyed by
   exact attempt/fence/journal position. Serialize root operations and verify
   the persisted journal position through the owning CAS/fence at each durable
   boundary. Another host advancing that position invalidates even a
   same-fence in-memory view. The durable journal and authoritative retained
   state reconstruct it after process loss; RAM state never becomes
   replay, commit or publication authority. Eviction, cancellation, expiry,
   whole-root OCC retry, changed source and late failure invalidate it. Native
   callbacks, Payload hooks and workflow children execute outside any SQL
   transaction while borrowing the same root; each newly accepted database
   operation still checks the relevant live authority. Convex's primary
   database path retries a whole closure with a fresh transaction and records
   missing as well as successful read dependencies; the mixed borrowed-call
   profile must preserve those observable obligations while using its own
   no-transaction-across-callback boundary.
3. Assess journal, invocation-marker, receipt and final settlement I/O as a
   connected durable protocol. Coalesce evidence or writes only across a
   defined acknowledgement boundary whose durable bytes, ordering, exact
   syscall sequence, fence and recovery owner are preserved. An acknowledged
   native or Payload result must never exist solely in RAM. No buffer may
   defer required evidence until a later callback or final commit. Preserve
   one outer settlement, OCC, event ordering, uncertain-COMMIT reconciliation
   and exact retry/replay behavior. The current committed invoking marker is
   written before native execution; preflight receipt/sequence, poisoned
   failure, accepted receipt and exact lost-ack resolution must survive any
   batching. Do not fuse operations across an acknowledged result without a
   specifically proved durable protocol.
4. Evaluate host lifecycle independently. First reuse immutable loader,
   definition and prepared-host construction at their existing owner. Only if
   that is insufficient and the host supports it, assess pre-readied
   *single-use* Workers as a separately approved option; do not install a new
   generic pool by default. Each Worker still receives one invocation and is
   disposed or quarantined. Measure refill, queue and cold paths; keep
   fresh-Worker results in a separate series.
   Do not hide startup in setup while describing that series as fresh-request
   end-to-end latency or claim Cloudflare hosted performance. Reusing the same
   Worker instance for a second call is
   forbidden by the current one-invocation guard and risks stale global clock,
   random, journal or stub state; immutable module/definition/host preparation
   may be reusable without reusing that Worker.

Reject a cross-transaction readiness cache without enforced invalidation, a
universal transaction/journal API that erases Application versus framework
profiles, adapter-side direct SQL, a second publication owner, a long SQL
transaction over framework code, in-memory-only acknowledged journal batches,
deadline increases, weaker tamper tests, and entity-specific fast paths. The
existing bounded batching is retained as long as it satisfies its exact source
and freshness contract; historical row calls are not the next optimization
priority at their measured cost.

## Connected delivery proposal and stop gates

### Approved first connected package

The two shared search GIN indexes receive an exact fresh physical check in
`logicalSearchBuild.ts` for every accepting transaction. A measured OID-anchored
query shape retains the existing index/table/column/operator-class, validity,
readiness and current-schema predicates while avoiding the expensive multi-join
planner path. On isolated PostgreSQL 18 the 20-query median was approximately
0.85 ms against 5.0 ms for the old shape; these are isolated query measurements,
not an end-to-end request result. Keep the selected metadata and installation
hashes, scope/placement/revocation checks, mutable search coverage and row
frontiers fresh. Preserve immediate unchanged-root tamper refusal. No schema,
role, certificate, repair or accepted integrity-boundary change is needed.

The same connected package removes redundant empty admission transactions at
the working-set/participant owner only where the actual storage I/O performs its
own fresh checked admission. State-only operations retain a live check; no SQL
transaction crosses a native callback. Validate PGlite and ordinary-role
PostgreSQL refusal/serving cases, malformed and replaced GIN definitions,
current-schema identity, real Worker Product/Payload/workflow behavior, and
per-operation transaction intervals. The retained candidate traced and
untraced series above complete the four-workload comparison. This package is
a query and transaction-ownership change, not a claim that the full latency
target is met.

The next measured direction became the completed [selected Application evidence
package](./07-selected-evidence-admission-preflight.md). It bounded target
revision/candidate/analysis/publication reads within each short checked
transaction while preserving the distinct revision lock, selected hashes and
fresh task clock. The prior candidate mixed warm series had 10,410 dispatches
and 235 transaction intervals; the [selected-evidence record](../../packages/flarex-backend/benchmarks/mixed-mutation-core/selected-evidence/README.md)
has 9,958 and 235 in its traced smoke. Successful joined row fetches retain
ordered domain refusals. A joined SQL statement execution failure retains the
typed resource-failure classification and can preempt a corrupt-row refusal;
the dual-fault tests pin this explicit boundary. Control-database observations
remain separate from target-database acceptance. The full untraced request
comparison shows no overall endpoint gain and still misses the proposed warm
latency budgets. A further package requires a measured dominant owner, not an
inferred cross-transaction cache or endpoint promise.

The following later connected packages remain conditional on measured owner
costs. They are not helper-only turns. Each needs an exact call
graph, owner review, contract/data inventory and measurable exit gate before
runtime edits.

1. **Enforced metadata preparation, only if still needed.** Audit selected dependencies and
   all writer/repair/DDL/placement paths; agree the privileged threat boundary
   and amend the accepted design. Enforce ordinary-role writer routing and
   same-transaction invalidation at the existing metadata owners; connect the
   prepared read and small live check to Application plus an independently
   compiled framework source. Preserve or deliberately revise every
   unchanged-digest tamper witness. Stop if a complete writer proof or
   cross-database placement protocol cannot be established; physical checks
   remain in force. The first package retains the fresh physical query and all
   selected hashes; a protected-root design needs its own measured reason.
2. **Per-attempt execution across real consumers.** Combine checked storage I/O
   with admission beyond the five redundant read guards removed in the first
   package. Reuse bounded pending/dependency state
   under exact attempt/fence/journal position and durable restore rules; migrate
   the selected Application, Payload Local API, Product and finite workflow
   callers together. Prove native callback and hook boundaries, conflict,
   expiry, cancellation and retry with no leaked transaction or authority.
   Establish per-operation lower bounds and demonstrate cost scales with
   actual reads/writes and selected sources, including neutral extra modules
   and tables; stop if an apparently fast path omits fresh admission.
3. **Durable settlement and host lifecycle.** Where the remaining trace shows
   unavoidable journal/publication dispatch cost, redesign the exact durable
   acknowledgement and settlement sequence at its owner, migrate all affected
   private consumers and remove displaced code. Reuse existing immutable host
   preparation first; assess pre-readied single-use Workers only after a
   supported-host and measured-benefit decision, with pool capacity and
   replenishment accounting if selected. Re-run the four original workloads plus the
   proposed warm/cold/retry/concurrency variants on ordinary-role PostgreSQL.
   If the agreed latency budget remains infeasible under the proven durable
   lower bound, report the bound and return to product scope discussion rather
   than weakening correctness or claiming a partial target.

Every package must include its affected consumer migration, obsolete helper,
export, test and documentation cleanup, focused PGlite and ordinary-role
PostgreSQL owner/consumer tests, real Worker or native host proof, type/build/
lint/source guards and both project diff reviewers. Add only decision-focused
instrumentation for CPU, hash work, checkout/lock wait, transaction interval,
inner journal/OCC phases or query plan where the missing distinction affects
the chosen contract. Keep original and optimized raw benchmark records intact;
new runs use new paths, identical fixture graph and separately labelled host
temperature.

| Required witness | Decisive acceptance question |
| --- | --- |
| Ordinary-role direct DML/DDL refusal; controlled writer insert/update/delete and selected-predicate entry/exit; install/restore/repair | Are grants, triggers or writer routines complete, and does repair quarantine and revalidate before admission resumes? |
| Structural activation, index/unique/search build and backfill, publication coverage, retention and shared physical change | Do structural and mutable readiness facts invalidate every affected source at the right transaction/placement frontier without a hot global business-write lock? |
| Changed source or scope head, placement, revocation and concurrent writer racing checked I/O and final settlement | Does the live check linearize at each short operation and settlement, preserving lock order and avoiding deadlock, with no SQL lock across native code? |
| State-only pending read/event/close and historical missing-row read after a prior local guard | Is fresh admission retained before observable effects, with the original first refusal and exact negative dependencies? |
| Same-fence second host advancing journal position; cross-scope or cross-source reuse; eviction/crash/restart | Is in-memory state discarded and the exact persisted root, source and position restored without authority leakage? |
| Native child accepted before lost acknowledgement, later failure, whole-root OCC retry and lost final COMMIT response | Are callback counts, durable receipt order, poison, retained result and uncertain-outcome recovery unchanged? |
| Neutral independent definitions/tables/modules, a larger graph and concurrent scopes | Does cost follow actual reads/writes and selected sources rather than Product names, catalog definition count or helper-call count? |
| Fresh and candidate warm host under matched traced/untraced requests | Is one invocation per Worker and isolation preserved, with observer, preparation, pool refill, CPU/memory and queue costs visible? |

## Contracts, cutover and approval questions

Necessary internal breaks are allowed within an approved focused implementation
scope; compatibility wrappers, dual writes or a fallback engine are not a
substitute for migrating consumers. The disposition for the first package and
conditional later work is:

| Contract or data | Proposed disposition and required proof |
| --- | --- |
| Accepted immediate selected-dependency integrity | **Retain** until an explicit design amendment, complete writer/privilege/repair proof and revised tamper boundary are approved. |
| Immutable preparation plus live scope, source and placement admission | **Extend** only with an enforceable protected generation, exact selected scope and revocation checks; never treat prepared bytes as authority. |
| Short checked read and working-set helper transactions | **Replace** redundant internal transactions after caller migration, preserving immediate I/O admission, visibility and rollback-only rules. |
| Exact attempt, journal marker/receipt/seal, retained result and publisher | **Retain or replace coherently** only after an acknowledgement-by-acknowledgement inventory and replay/recovery proof. No old format stays solely because it exists. |
| Framework adapters, native lifecycles and separate standalone profiles | **Retain** their business semantics; **extend** only narrow borrowed capabilities. Remove duplicate framework settlement paths only for named migrated callers. |
| Host Worker construction and reuse | **Extend** with a separately measured pre-readied single-use mode only if lifecycle, isolation and resource proofs pass. |

Inventory actual persisted metadata generations, journal/protocol bytes,
source digests, indexes, identities and any active or outstanding attempts in
each affected environment before choosing DDL or format changes. An isolated
scope may be reset only under its explicit test policy. A named environment
requires a drain, migration or fenced refusal plan with exact recovery and
rollback semantics; no silent data deletion or reinterpretation. Record the
named retained consumer and removal gate for any temporary old path. Publication
and recovery must not accept one protocol while normal execution emits another
without an approved cutover.

Owner decisions required **before a later material contract change**:

1. Which concrete writer, DDL and privileged-repair contract can enforce every
   selected dependency, and which synchronous tamper refusals may, if any, move
   to a different explicitly accepted detection boundary? How are control and
   target database observations pinned without a false cross-database root?
2. Are the proposed Product, Payload and finite-workflow p50/p95 goals the
   product acceptance target under a named warm host lifecycle? What cold,
   retry, contention, graph-size and resource budgets must accompany them?
3. Which exact journal acknowledgement and outstanding-attempt formats may
   change, and what is the named-data cutover and removal gate?
4. Does the traced lower bound justify each connected package, and which
   unavailable measurement is essential to that choice?

The accepted integrity decision remains in force. The first package preserves
it and needs no additional permission for its ordinary implementation, tests,
review fixes and cleanup. Return to the owner for a materially different
authority, trust, durable protocol/data or host lifecycle decision.
