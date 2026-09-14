# Core Execution Redesign And Validation

## Status And Scope

Status: owner-requested design and implementation-gate plan; execution changes,
reference benchmarks and measured improvements remain pending. Documentation
approval does not activate new storage, remove locks or broaden any framework
capability. This is a workstream within the existing shared transaction core,
not another runtime or metadata authority.

The [core execution design](../../design-notes/flarexdb-core-execution-redesign.md)
owns the recommended contracts and fair-comparison rules. The
[shared logical storage roadmap](../shared-logical-storage/README.md) owns
cross-consumer placement and cutover. Native
[OCC](../flarexdb-foundation/02-occ-and-transactions.md),
[commit compilation](../flarexdb-foundation/03-commit-compiler.md),
[storage representation](./07-transactional-storage-redesign.md) and
[runtime scalability](./09-runtime-scalability-redesign.md) retain their
responsibilities. Query and framework behavior remain in the
[query/constraint acceptance contract](../shared-logical-storage/02-query-and-constraint-acceptance.md).

## Current Architecture And Findings

Native execution collects snapshot dependencies and a logical journal before
its final trusted transaction. CMS shares Application materialization through
its participant; current commerce retains physical module rows and uses the
shared publisher. Generic three-framework storage execution is still a target.
Do not benchmark legacy serving while reporting a private target kernel, or
charge native syscall journaling to a framework path that does not use it.

The pure point OCC comparison is not evidence of a large CPU bottleneck. Current
head reads already batch dependencies. Remaining concerns include sequential
row/index/unique application, exclusive index-build-state access and coverage
updates during normal commits, broad commit exclusion, and execution evidence
across the request. These are source-derived risks, not measured regressions.

[Materialization](../../packages/persistence-postgres/src/applicationDocumentMaterialization/materialization.ts)
and the [point commit owner](../../packages/persistence-postgres/src/pointCommitTransaction.ts)
are the initial investigation boundaries. The existing
[publisher](../../packages/persistence-postgres/src/commitPublication/publication.ts)
already batches some fact families. The
[physical owner](../../packages/persistence-postgres/src/physicalSession/postgres.ts)
and [request recovery](../../packages/persistence-postgres/src/relationalTransaction/requestRecovery.ts)
retain cancellation and authoritative decision handling. Do not replace these
owners with benchmark-local production logic.

## Retained Invariants

Keep exact present/missing/range/relation dependencies, read-your-writes, row and
membership history, scope/generation fencing, semantic write ownership, bounded
resources and one physical settlement. Membership stability must not hide a
changed returned document. A logical plan, callback return, written prefix or
commit sequence allocation alone is not a successful commit.

Keep native OCC rerun, confirmed rollback retry and uncertain-COMMIT recovery
separate. No transaction spans untrusted code, external effects or workflow
suspension. Dense commit order and result-bearing idempotency remain intact.
Shared generic storage does not grant arbitrary cross-framework writes or change
native Module Links into strong references. Preserve the existing accepted
breaking-change policy without silently resetting named durable data.

## Gate Sequence

These gates name outcomes and evidence, not mandatory new packages or a demand
to finish the entire core before exercising a framework. CE1 and CE2 may proceed
as coherent independent slices after CE0; CE3 uses their actual findings. CE4 is
conditional on measured native evidence cost. Each slice migrates its real
consumers and removes what it displaces before reporting completion.

| Gate | Coherent outcome | Decisive completion evidence | GLS relationship |
| --- | --- | --- | --- |
| CE0: path inventory and baseline | Name actual entry points, trace complete request phases and shared lock resources, define numerical targets and a matched PostgreSQL reference. | Equivalence checklist, pinned source/configuration, correctness/refusal baseline and per-phase SQL/bytes/lock data; open failures have current dispositions. No tuning justified solely by helper count. | Part of GLS1; core measurements can begin on supported current paths without expanding generated commerce storage. |
| CE1: prepared bounded materialization | Extend existing compiler/materializer with bounded batches and safe reusable pure preparation. | Exact affected sets, unique swaps, conditional membership, pending new/old index reads, complete rollback/publication, unchanged-key preservation and measured batch scaling through actual native/CMS consumers; shared Medusa consumer as its storage lands. | Supplies GLS2/GLS3; does not turn candidate-only metadata into serving authority. |
| CE2: enabled-index lifecycle proof | Replace unnecessary exclusive per-commit coverage work only after specifying the readable-index invariant. | Reader/writer/build/activation/compaction contracts agree; enabled-index ordinary writes avoid the targeted metadata write; concurrent lifecycle and stale-fence failures remain safe; same-index disjoint work is measured. | Design in GLS1, exercised with GLS2/GLS3, readiness consolidation in GLS4. |
| CE3: critical section and cross-owner concurrency | Shrink serial commit work first; change lock order or concurrent application only through a coordinated sequence/fence protocol. | Commit-sequence use is explicit; distinct-connection tests separate independent overlap from genuine conflicts; no residual index/claim/lifecycle lock invalidates the claim; mixed native/CMS/commerce and control-plane races, duplicate requests and uncertain COMMIT pass. | Invariant design is early; GLS5 completes applicable protocol cutover and capacity, not the first correctness analysis. |
| CE4: measured evidence reduction | Select journal/phase coalescing only when CE0 attributes meaningful cost; retain the existing evidence owner. | Pre-coalescing limits, repeated/no-op writes, exact syscall replay, independently authenticated seals, crash/takeover and outcome recovery; removed child/event evidence has no surviving reader. No automatic DO/facet relocation. | Native-path optimization; not a mandatory tax or prerequisite for every framework. |
| CE5: connected acceptance and retirement | Run paired core/reference and real framework workloads; reconcile owners and remove displaced runtime paths. | Targets met or limitations explicitly recorded, representative Pricing/Payload/relationship proofs retained, required reviews complete, no benchmark import/fallback in production, no duplicated authority or unowned cleanup state. | Feeds GLS5/GLS6; hosted activation remains separate. |

## First Implementation Handoff

The next recommended executable slice is CE0: instrument current supported core
entry points and establish the benchmark equivalence and failure baseline. It
changes observability/test support, not the authoritative lock or storage
protocol. Discover actual package/lane commands and reuse existing observation
hooks; count SQL that bypasses those hooks through the physical execution
boundary without logging tenant data. Keep overhead bounded and report the
instrumented versus normal measurement boundary.

Complete this alongside the existing candidate-admission work rather than
reopening its producer/identity scope. CE1 begins actual shared storage execution
with a supported native and CMS mutation and follows the Medusa consumer as
GLS2/GLS3 admits it. Do not optimize a growing set of generated commerce schemas
as a second destination just to obtain a benchmark result.

## Proposed Breaking Changes To Inventory

| Candidate change | Affected contracts and mandatory cutover analysis |
| --- | --- |
| Batch materialization | Scalar row/index/unique transition APIs, result-set evidence, hook/observation frequency and direct callers. Migrate consumers; retain meaningful failure assertions rather than obsolete per-row statement counts. |
| Enabled-index coverage | Build/readiness fields, snapshot eligibility, validators, active reads, builders, fences and compaction. Do not remove a field because only the current writer was searched. Preserve historical-reader and out-of-band integrity policy explicitly. |
| Commit protection/order | Clock, business/invariant locks, request/session/claim/lease owners, schema activation and maintenance. Record every old/new ordering edge, implicit constraint lock and actual scope cutover. |
| Journal coalescing | Open and sealed formats, receipts, cumulative accounting, stored-attempt verification, rerun/takeover and retained recovery readers. No second format or compatibility wrapper without a named obligation. |
| Telemetry/reference harness | Internal observation schemas, benchmark-only configuration and raw sample provenance. No production bypass switch, semantic test stub or runtime dependency on the reference. |

The implementation preflight reports exact symbols, formats, physical schema
changes, named environments and consumer dispositions. This document recommends
those corrections but does not invent final field names or authorize an unnamed
data reset. Already approved in-scope fixes require no repeated permission;
a materially different authority or behavior change needs its own decision.

## Core And PostgreSQL Comparison Contract

Both implementations use PostgreSQL. The reference is a small test-only
implementation of the same selected operation and guarantees. It is neither a
replacement database nor a supported alternative Flarex engine. The
[design's equivalence checklist](../../design-notes/flarexdb-core-execution-redesign.md#equivalence-checklist)
is required before timing either one.

The initial comparison should hold physical layout and required work constant
where possible to attribute orchestration overhead. A separately labeled
relational-layout experiment may evaluate generic-storage costs; it must retain
equivalent observable constraints, snapshot decisions and publication/replay.
Differences in representation are not all wrapper overhead. A bare SQL UPDATE,
rollback-only timing or a reference without earlier-read validation is a partial
microbenchmark, not a fair end-to-end comparator or theoretical lower bound.

For each comparison record expected results, rejection/conflict/recovery cases,
common versus candidate-specific code, source revision, database/driver versions,
durability settings, data shape, pool/transport, warm-up/trial policy and workload
arrival pattern. Test correctness first. Missing capabilities limit the claim;
do not weaken Flarex assertions to make the reference appear equivalent.

## Decisive Core Workloads

| Workload | Required interpretation |
| --- | --- |
| Read, no-row mutation and duplicate request | Distinguish no publication from the admitted successful-mutation outcome, and replay from new execution. |
| One and many rows with several indexes | Separate input/API batching, actual materialization batching, index membership work and publication facts. |
| Non-key update, key move and wide-row narrow projection | Preserve old/new membership and returned-row OCC while measuring avoidable writes and decoding. |
| Two independent rows sharing an enabled index | Identify index-state lock/coverage contention after accounting for the scope clock; serialized success alone is not overlap proof. |
| Same-row OCC, absence, empty/limited ranges and relation reads | Confirm dependency precision, phantom handling and qualified history, including membership changes and returned-body changes. |
| Unique swap/restore and target-delete/reference-insert | Preserve selected constraint policies, pending visibility, correct outcomes and complete rollback under real races. |
| Index activation/retirement, schema fence and history floor races | Prove lifecycle safety rather than testing only enabled steady state. |
| Lost COMMIT acknowledgement, late cancellation and acquisition timeout | Reconcile authoritative outcomes and safe connection ownership without blindly replaying business work. |
| Journal replay, sealing and process loss | Verify exact identities, cumulative bounds and independent reconstruction before selecting evidence reduction. |
| Mixed framework traffic, hot scopes and background work | Attribute tenant fairness, maintained history/WAL and eventual placement limits; do not claim unlimited capacity. |

Use deterministic barriers and separate real PostgreSQL connections for races.
Fast PGlite tests remain valuable for semantics but cannot establish lock or
transport behavior. Record latency distributions, error/retry rates, offered
and completed work, SQL/rows/bytes, CPU/memory, lock wait/hold, WAL and retained
storage. Keep real COMMIT timings separate from EXPLAIN/rollback diagnostics.
Keep current core, reference and framework overhead visible without subtracting
unpaired percentiles or hiding queue time.

## Evidence Reconciliation And Completion

The commit-compiler roadmap records C04A-VAL-001 as an open issue. CE0 must check
its current reproduction and disposition at the actual evaluated revision.
Do not assume it still fails, silently declare it fixed, or omit it from a broad
correctness claim. Other independently supported cases may be measured with
that limitation explicitly scoped; affected acceptance remains blocked until
its owner resolves or properly reclassifies it.

Update the existing living status owners when verified truth changes. The
storage redesign already describes implemented canonical row bodies, stable
unique ownership and membership-transition history; do not relabel those as new
unimplemented features or claim their isolated experiment proves the whole core.

Before runtime completion, require affected typechecks, source/protocol tests,
PGlite and ordinary-role PostgreSQL witnesses, lint and both project reviews as
applicable. No runtime verification is implied by this documentation change.
Reconcile actual source and status rather than weakening tests to match a plan.
Every temporary old path has a named consumer and removal gate. The benchmark
reference remains deliberately test-only; it is not an old production path to
preserve indefinitely through dispatch or fallback.
