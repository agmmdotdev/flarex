# Core Execution Redesign And Validation

## Status And Scope

The active goal covers Flarex DB core redesign. New Medusa integration and
framework capability expansion are subsequent work. Future framework semantics
constrain core contracts; existing consumers affected by a core break must still
be migrated and regression-tested within that slice.

The owner grants standing approval to proceed slice by slice. Record each
focused design/preflight, necessary breaks, affected consumers and cleanup before
implementation, then implement, validate, run both required reviews and commit.
Do not wait for a separate approval response for each slice. Surface materially
different decisions explicitly and correct the actual owner; this authorization
does not permit silent durable-data deletion or unrelated integration expansion.

Status: owner-requested design and implementation-gate plan, with bounded CE0
attribution/references, CE1 intrinsic membership preparation and bounded row/index
and unique application implemented; complete-request reference acceptance and remaining
execution changes are open. Documentation
approval does not activate new storage, remove locks or broaden any framework
capability. This is a workstream within the existing shared transaction core,
not another runtime or metadata authority.

The [remaining implementation plan](./62-core-completion-plan.md) groups the
remaining gates into connected work packages. It governs the medium-sized goal
cadence and completion inventory; the existing CE evidence below remains valid.
Do not reopen completed proofs or expand reference coverage without a concrete
replacement-contract or acceptance question.

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
head reads already batch dependencies, and prepared row writes now batch at the
shared row owner. Index and unique application also use bounded sets. Activated
ordered indexes and unique constraints now use shared build protection without
per-commit progress updates. Remaining concerns include broad commit exclusion,
execution evidence across the request, and the cost of validating continuous
maintenance. These are source-derived risks, not measured regressions.

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
to finish the entire core before exercising a framework. CE1 and CE2 use scoped
CE0 evidence for coherent independent slices; complete-request CE0 acceptance
remains a separate gate. CE3 uses their actual findings. CE4 is
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

The [first workload handoff](./11-ce0-first-workload.md) names the selected
executing path, implemented publication observation, correctness witnesses and
remaining coverage gaps. It is not complete CE0 acceptance or a measured win.
The [native lifecycle and row-store reference](./12-ce0-native-lifecycle-and-reference.md)
separates native journal cost from publication and admits only a bounded
first-revision storage comparison. Full publication/reference equivalence remains open.
[Native invocation attribution](./32-ce0-native-invocation-attribution.md) extends
measurement through real admission, cryptographic grants, execution host, journal
and finalization with independently observed control/target pools. The
[source-execution extension](./35-ce0-native-workerd-attribution.md) now executes
the registered body in local Workerd through the existing test capability bridge.
Deployed transport/scheduling, broader workloads and equivalent complete-request
references remain open. Its calibrated
phase observations guide owner selection without treating pool elapsed times as
additive or client intervals as server lock-hold measurements.
The [bounded authority capture](./33-ce4-bounded-authority-capture.md) replaces
separate clock/session/lease/journal metadata reads with one bounded header in
the existing repeatable-read loader. Size-before-payload admission and complete
authentication remain intact; this does not remove durable journal evidence.
The [shared prior-document state](./34-ce3-shared-prior-document-state.md)
consolidates predecessor reads and canonical decoding across index, unique and
relation planning in native/CMS materialization. Publication exclusion and exact
dependency validation remain; coordinated parallel materialization is still open.
The [scope-clock lock contract](./36-ce3-scope-clock-lock-contract.md) provides
PostgreSQL witnesses for separating snapshot-reader protection from ordinary
sequence advancement on the existing row, while retaining strong transition
exclusion and stale-snapshot refusal. The [CMS snapshot cutover](./38-ce3-cms-snapshot-publication.md)
applies this contract at the physical/session, admission and publication owners.
Standalone CMS reads overlap ordinary CMS publication with coherent document
and incoming-relation snapshots. [Native publication](./39-ce3-native-publication-snapshots.md)
also overlaps these readers. [Native attempt protection](./40-ce3-native-attempt-snapshots.md)
extends overlap through active selection, session activation, journal work and
finishing. Attempt replacement, recovery and terminalization use ordinary-write
protection; actual scope transitions retain their strong locks.
[Commerce snapshots and publication](./61-ce3-commerce-publication-snapshots.md)
extend these profiles to existing commerce reads and ordinary standalone/atomic
writes. Fresh binding-head protection rejects revoked membership after snapshot
formation. Bootstrap retains strong protection; standalone
CMS still refuses commerce-bearing bindings outside its admitted composite gate.
The CMS/native/commerce admission and execution cutovers below supersede the
earlier writer exclusion; sequence-consuming materialization remains serialized.
The [active readiness lock correction](./37-ce3-active-readiness-locks.md) replaces
exclusive stored-active validation locks with shared protection at the existing
fold owner. Same-scope CMS reads can admit concurrently; lifecycle updates remain
excluded until those reads finish. The snapshot cutover preserves these checks
while removing ordinary CMS publication exclusion.
The [publication persistence preflight](./13-ce0-publication-persistence-reference.md)
extends the matched comparison at the existing shared publication owner, without
duplicating native authentication or transaction recovery in a benchmark engine.
The [matched bounded row reference](./41-ce0-batched-row-reference.md) replaces
its scalar SQL baseline with independent batching and exact returned-set checks.
Row/byte boundary, late-batch rollback and real contention witnesses constrain
that comparison; it remains a row-store boundary, not a complete request.

Continue CE0 with complete request attribution and an equivalent PostgreSQL
reference. Select each execution correction against its declared baseline and
correctness contract without calling the wider CE0 gate complete. The initial publication slice
provides repeated core samples and a deterministic scope-clock contention witness. It
changes observability/test support, not the authoritative lock or storage
protocol. Discover actual package/lane commands and reuse existing observation
hooks; count SQL that bypasses those hooks through the physical execution
boundary without logging tenant data. Keep overhead bounded and report the
instrumented versus normal measurement boundary.

The owner-approved [intrinsic membership preparation slice](./14-ce1-intrinsic-membership-preparation.md)
refines this broad sequencing for an owner-local CE1 correction: use the existing
bounded membership reader once for the admitted transition set, with direct
before/after and connected correctness proofs. Complete-request CE0 acceptance
remains open; it is not required to duplicate unchanged authority/recovery code
in a benchmark before removing these repeated reads. Other execution changes
retain their focused evidence and preflight gates.

The [bounded row application slice](./15-ce1-row-batch-application.md) replaces
prepared scalar row writes in the shared native/CMS materializer. It checks exact
returned identities, predecessor creation times and conditional current-pointer
updates while retaining the existing transaction and locks. The
[statement reuse refinement](./42-ce1-row-statement-reuse.md) compiles repeated
revision/pointer insert shapes once per append and supplies fresh batch bindings;
it retains unnamed driver execution and the existing transaction lifetime. The
[index application slice](./16-ce1-index-batch-application.md) extends bounded
execution to membership/parent checks and index revisions/current pointers.
The [unique ownership slice](./17-ce1-unique-batch-application.md) replaces scalar
unique writes with bounded validation and release/claim phases. Native unique
admission remains capped at 32 transitions. The
[CE2 continuous-maintenance preflight](./18-ce2-continuous-index-maintenance.md)
selects activation-bound coverage and identifies exact writer composition as
its prerequisite. [Exact developer selection](./19-ce2-exact-developer-index-selection.md)
now rejects incomplete touched sets from the issued catalog port.
[Required composition](./20-ce2-required-ordered-index-composition.md) verifies
issued native/CMS ports against their control database. [Legacy-writer exclusion](./21-ce2-legacy-writer-exclusion.md)
now refuses material, attempted and unauthenticated legacy writes under active
Application heads. [Required intrinsic build state](./22-ce2-required-intrinsic-build-state.md)
also prevents selected creation-time definitions from silently skipping missing
build metadata. The [activation maintenance cutover](./23-ce2-activation-maintenance-cutover.md)
now binds ordered-index coverage to the coherent active head and its verified
schema/physical requirements. Native/CMS serving writes no longer update enabled
ordered-build progress; readers, activation and builders share the replacement
proof. Existing uncertified active heads require fresh validated activation.
Bounded candidate history and the scope clock remain authoritative.
[Exact unique selection](./24-ce2-exact-unique-constraint-selection.md) binds
fresh touched definitions to the existing closed unique set, with one retained
immutable closure per issued port. [Unique maintenance](./26-ce2-unique-maintenance-cutover.md)
now extends activation-bound coverage to unique workspaces; native/CMS serving
writes preserve their certified build tuples. Matched complete-request measurements
and wider lifecycle concurrency remain CE2 work. Broader CE0 references and connected CE1 acceptance
also remain open.

[Split-catalog activation](./25-ce2-split-catalog-activation.md) now borrows its
existing catalog transaction for outgoing requirements. This closes the core
transaction-reuse gap without changing adapter behavior. Ordered and unique
maintenance retain the scope clock. The next CE2 acceptance work is matched
measurement and wider lifecycle concurrency, with actual native/CMS publication.

[Active CMS request measurement](./27-ce2-active-request-measurement.md) now
exercises admission through settlement and durable replay with certified ordered
and unique builds. Its growing-catalog witness exposed and removed the CMS core's
whole-table uniqueness scan: indexed claim lookup plus the bounded pending
overlay preserves eager conflict semantics without tying selective writes to
total stored rows. Request limits and final claim/publication authority remain.
Repeated catalog/readiness preparation is still a full-request and replay cost;
native attribution, matched references and wider concurrency remain open.

The [complete-request comparison contract](./47-ce0-complete-request-contract.md)
maps the missing authority, materialization and recovery obligations beyond the
existing row/publication references. Its empty-operation baseline distinguishes
a standalone read from a successful zero-row mutation and mutation replay from
a repeated read. Neither composing the existing references nor timing these
real core requests establishes an independent complete-request comparator.

The [zero-row request reference](./48-ce0-empty-mutation-reference.md) now
independently assembles request evidence and explicit publication SQL, with
cross-host replay, rollback and actual PostgreSQL settlement witnesses. Admission,
empty-delta validation, lifetime and recovery owners are shared and disclosed.
This bounded first profile is not timed; nonempty and remaining differential
acceptance still gate the complete-request comparison.

[Reference authority and absence](./49-ce0-reference-authority-and-absence.md)
adds cross-scope, stale-preparation and absent-outcome witnesses. It exposed an
accepting-catalog gap: ordered definitions and their normalized bindings now
receive fresh integrity validation beside the existing unique closure. The
bounded correction reuses the registered catalog reader and canonical decoder;
it adds correctness work and requires refreshed request baselines before timing
claims. The [first-insert reference](./50-ce0-first-insert-reference.md) now adds
independent row/index/claim persistence at one/eight/thirty-two rows with exact
stored evidence, cross replay and late-write rollback. The
[nonempty settlement matrix](./51-ce0-nonempty-settlement.md) adds eight-row
uncertainty and cancellation, duplicate/disjoint/unique contention and progress
in another scope during a held publication. Those measurements predate the
[CMS concurrency cutover](./64-cms-concurrent-command-settlement.md).
The [first-insert executor](./52-ce0-first-insert-execution.md) independently owns
pending inserts, collision/eager uniqueness decisions and accounting order. Schema
validation, bounded readers, lifetime, admission and build/candidate authority
remain common components. The [standalone read reference](./53-ce0-standalone-read-reference.md)
adds independent empty and bounded point readback, unchanged publication state,
scoped absence/corruption and real snapshot overlap. The
[cumulative request budget witnesses](./54-ce0-cumulative-request-budget.md)
compare valid-document accumulation, distinct/cached read boundaries, refusal
without publication and corrected explicit requests after confirmed rollback.
The [explicit title-list extension](./55-ce0-pending-unique-equivalence.md) adds
early/late pending unique conflicts, committed conflicts after pending work,
first-failure ordering and request identity without a second mutation owner.
The [request authority matrix](./56-ce0-request-authority-matrix.md) compares
stale-preparation refusal across zero/eight-row fresh/replayed mutations and
standalone reads, preserving active-binding absence versus corruption errors.
The [paired scalar measurement](./57-ce0-paired-request-measurement.md) supplies
the first admitted complete-request comparison for these bounded operations.
The current balanced profile misses the one-row mutation relative-latency target;
reference empty read/empty mutation and core one-row mutation miss observer
calibration, so those instrumented timings are not accepted as neutral. Common
authority/readiness cost and additional nonempty core SQL are traced in the
[request SQL attribution](./58-ce0-request-sql-attribution.md). The remaining
nonempty difference belongs to generic dependency, authority, parent, membership
and ownership checks plus bounded index writes.
[Combined membership application](./59-ce1-combined-membership-application.md)
removes duplicated batch entry and combines writes within existing chunk limits;
it establishes fewer SQL calls, not a general latency improvement. Removing
validation is not an admitted shortcut.
[Membership read preparation](./60-ce1-membership-read-preparation.md) separates
definition preparation from range handling and checks the immutable scope
identity once per nonempty read operation. Every issued definition, key, row and
stored membership still passes its existing validation. This removes repeated
scope reads for mixed definitions without changing epoch/readiness ownership,
32-position chunks or the open scalar latency interpretation.
Protected readiness-root work, broader reference acceptance and capacity remain
open.

[Bounded current-row capture](./45-ce1-bounded-current-capture.md) combines the
current reader's size probe and document fetch in one statement snapshot. Its
identity and byte verdict gates body transfer, while scope-clock validation,
canonical decoding and corruption refusal remain with the existing owner.
This removes one statement per capture; it does not change writer exclusion or
establish a capacity improvement. The aggregate plan remains necessary for
set-wide budgets but adds unnecessary work to exact point selection.
The [point plan refinement](./46-ce1-point-capture-plan.md) uses the current-row
primary key to check a single selected row without aggregate CTE work, retaining
SQL-side body withholding and the shared capture validation/decoding owner.
Its measured local point-heavy request lane improves without changing SQL counts;
batch/scan, large-catalog and capacity acceptance remain distinct open work.

[Catalog restoration reuse](./28-ce0-catalog-restoration.md) removes the schema
resolver's duplicate artifact read within one resolution and omits relation/edge
lookups for empty ID sets. Fresh preparation and accepting integrity checks
remain independent; the normalized relation-set query still detects unexpected
rows even for an empty root. This does not implement cross-request preparation
retention or the broader readiness/audit contract.

[Active request concurrency](./29-ce3-active-request-concurrency.md) proves that
another active CMS scope can settle through the shared physical families while a
publication remains uncommitted. [Unlocked planning](./31-ce3-unlocked-planning.md)
removes the earlier same-scope wait in binding and document preparation: planning
captures authenticated definitions and candidate inputs without claiming live
readiness. The accepting transaction checks current unique builds, candidate
receipts, head/fence and lifecycle before issuing authority. The subsequent
[CMS concurrency cutover](./64-cms-concurrent-command-settlement.md) also permits
independent same-scope command execution. Duplicates wait on request exclusion;
sequence-consuming materialization and publication retain the shared lock.
[Native final admission](./65-native-admission-before-publication.md) validates
schema, ownership and relation selection under lifecycle protection while other
ordinary publication may complete. Its final build/session locks, exact OCC and
materialization still serialize. [Commerce/composite admission](./66-commerce-admission-before-execution.md)
also precedes publication exclusion; direct-SQL callbacks and finalizers require
explicit protected entry and share its fresh clock. Protected readiness and
final connected acceptance remain open.

[CMS preparation lifetime](./67-host-owned-cms-preparation.md) binds immutable
Application preparation to the private CMS and existing composite host. Every
request and recovery attempt still resolves current placement and validates
live catalog, readiness and binding evidence before execution or replay. This
does not replace integrity verification with a readiness-root cache.
[Prepared payload retention](./68-prepared-metadata-payloads.md) now discards
verified publication/function byte copies from Application bundles and includes
installation evidence in its payload budget. Aggregate host lifetime and memory
admission remain open.

The [concurrent CMS load baseline](./43-ce0-concurrent-cms-load.md) extends these
barriers to finite complete-request bursts on one and four scopes sharing a
pool. It separates bounded client queueing from host execution, records SQL and
sampled pool pressure, and verifies successful publications and explicit replay.
The [colocated admission correction](./44-ce3-colocated-admission-catalog.md)
reuses the held transaction for catalog checks when registered database identity
matches, preserving separate catalog placement and integrity validation. It
removes the observed nested pool demand and lets both twelve-slot grid cases
complete without refusals. The separate overload witness still exposes
scope-clock lock or statement deadline refusals before command execution, so
zero-refusal behavior is not established across runs.
Those refusals must leave no durable effects and support an explicit untimed
retry after rollback. This preserves a measured CE3 limitation; it neither raises
timeouts nor establishes sustained capacity or complete-reference equivalence.

The [publication deadline witness](./30-ce3-publication-deadline.md) now proves
that the existing PostgreSQL physical owner ends a stalled active CMS publication
before COMMIT, releases its transaction and preserves complete rollback. An
explicit retry can publish once and subsequent duplicate calls replay. Keep this
single deadline/settlement owner; the witness does not bound preparation before
the main session or shorten same-scope commit exclusion.

Candidate admission is already implemented and does not need its producer/identity
scope reopened for measurements. CE1 begins actual shared storage execution
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

The [commit-compiler roadmap](../flarexdb-foundation/03-commit-compiler.md)
retires C04A-VAL-001 as a current blocker after validating the original cases,
full ordered PGlite lane and focused ordinary-role PostgreSQL counterparts.
Runtime bigint/wire-string separation and fail-closed current-authority
classification remain enforced. This reconciliation does not establish the
historical failure's cause, complete native request attribution or close CE0's
equivalent-reference and capacity gates. Recheck affected witnesses when their
owning contracts change instead of carrying historical failures forward as
current status.

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
