# Mixed Mutation Core

## Status And Scope

Status: the first Application and Product slice is implemented as a private,
isolated-scope execution profile. The [mixed mutation design](../../design-notes/flarexdb-mixed-mutation-execution.md)
owns architecture and open contract questions. This roadmap owns current status,
sequencing and finite delivery gates. Numbered slice preflights own their
specific scope, decisions, affected contracts and remaining gates. The implemented
[first Application and Product attempt](./01-application-product-attempt-preflight.md)
uses the real Worker, Product service and shared journal/commit owners. It is
not activated on a named durable environment and exposes no public authoring API.
The [Payload Local API attempt](./02-payload-local-api-attempt-preflight.md) is
the proposed next slice; it has no runtime implementation approval.

The other shared-storage session has reviewed, validated and committed its
active [exact-scope retained-history slice](../shared-logical-storage/56-same-deployment-scope-authority.md)
and confirmed a clean pause. The [shared-storage completion plan](../shared-logical-storage/03-completion-plan.md)
remains active with unfinished consumer migrations and retirement under its own
owner. The mixed core starts from the paused baseline after an audit; it takes
only a concrete storage blocker required by its first connected proof, with
ownership recorded in that preflight. Whole-goal storage completion is not a
prerequisite.

The goal is one private logical mutation attempt that can compose Application
operations, selected real Medusa services and finite workflows, and selected
Payload Local API operations under one authoritative outcome. It includes
snapshot-plus-pending evaluation, complete dependency/conflict evidence,
authenticated domain participation, journal/recovery, settlement and publication,
with profile-specific lifecycle rules. Public `ctx.commerce`/`ctx.cms`, generated
types, SDK/configuration, hosted activation, arbitrary Medusa/Payload support,
durable workflows containing waits/effects, and advanced schema evolution remain
separately gated.

## Working Method And Document Ownership

For this owner-authorized session, the root coordinates planning, discussion,
review and Git; explicitly assigned workers make disjoint edits and fixes,
serializing dependent changes and preserving unrelated work. Spawn every
subagent, including workers, explorers and both standing reviewers, with model
`gpt-6-sol` and `reasoning_effort: high`. Reviewers remain read-only.
The first numbered preflight grants the scoped runtime implementation work.

The design note owns architecture; this README owns domain status, package order
and remaining cross-package gates. Create `NN-topic-preflight.md` only when a
slice is ready for focused scope agreement. That numbered file owns the slice's
decisions, current status and remaining gates; update it in place as truth
changes. Do not create duplicate plan, status or checkpoint-log documents.

## Authorities And Baseline

- The [accepted database design](../../design-notes/flarex-db-accepted-design.md)
  governs current Postgres authority, execution profiles and trust boundaries.
  The [mixed mutation design](../../design-notes/flarexdb-mixed-mutation-execution.md)
  records the approved private admitted mixed profile for the first slice.
  Its remaining proposals need their own focused scope agreement.
- [Shared logical storage](../shared-logical-storage/README.md) owns logical
  data/index/relation storage, its unfinished cutovers and structural retirement.
  [Shared transaction core](../shared-transaction-core/README.md) owns existing
  settlement, publication and recovery foundations. [Package boundaries](../16-package-boundaries.md)
  determine placement.
- Current native attempt/journal and commit owners, logical working set,
  index/search/materialization owners, Payload adapter, Medusa repository and
  workflow runtime, and their decisive tests establish the implemented baseline.
  Their existence does not prove mixed snapshot, pending or retry semantics.
  The design note links these exact sources. Inspect the paused checkout and
  selected call graph before writing the first preflight; verify that owned
  test/runtime resources were stopped at handoff.

The existing private named Application/CMS/Currency command proves trusted
atomic composition for a fixed command. It does not admit arbitrary sandbox
interleaving or convert independently committing framework hosts into borrowed
attempt participants. Current framework commands remain supported for their
real callers until an approved slice migrates or deliberately retains them.

## Invariants And Replacement Rule

- Postgres alone settles data, retained result and event intents. The root
  attempt owns retry, cancellation, budgets, fencing and uncertain-outcome
  recovery. Child calls borrow it and cannot independently commit.
- Application, Payload and Medusa retain separate semantic authorities and
  execution profiles. Adapters translate; they cannot invent core guarantees
  or grant framework mutation rights from an Application grant.
- No SQL transaction spans sandbox/user execution, remote effects, resource
  waits or workflow suspension. Unsupported hooks, effects, locks, parallel
  constructs and query semantics fail admission.
- Snapshot reads include earlier pending changes and exact dependency evidence;
  participating writers preserve needed history and conflict facts. Index,
  search, relation, unique and locking correctness is proved with the package
  that admits each path, not deferred wholesale.
- Necessary internal breaking changes are accepted after scope agreement.
  Each numbered preflight inventories affected callers, durable data and formats,
  outstanding attempts, cutover, validation and removal. Migrate consumers and
  remove displaced mechanics in the same connected slice. Retain an old path
  only for a named supported caller or durable obligation with a removal gate;
  never silently delete or reinterpret durable evidence.

## Delivery Packages

These are connected outcomes, not a prescribed file count or a sequence of
helper-only commits. Before each package, create its numbered focused preflight
after inspecting the latest baseline. Record challenged alternatives, exact
operation/call graph, authority and trust, old/new contracts, affected consumers,
durable-data disposition, validation, cleanup and exit criteria. A material
change to those decisions returns to scope discussion. No runtime package starts
from this roadmap alone.

1. **[Application plus Product private atomic attempt](./01-application-product-attempt-preflight.md).** Agree the first real
   Product service method and field set from the paused baseline. Through the
   genuine sandbox/host boundary, compose Application write, admitted Product
   service call, pending Product read and dependent Application write. Connect
   attempt/snapshot/pending working set, authenticated journal evidence,
   complete point/predicate/constraint observations, OCC, short physical
   settlement, retained result, event intent and recovery under one root.
   Include late failure, authority refusal, cancellation, conflict/retry and
   lost-acknowledgement witnesses; concurrent standalone writers cannot escape
   conflict evidence. Select and prove the required index/search snapshot and
   lock behavior for that method. Refactor owner contracts and migrate affected
   native/framework callers together, removing displaced duplicate paths.
   Remaining storage work is imported only if this exact proof needs it.
2. **[Payload Local API lifecycle](./02-payload-local-api-attempt-preflight.md) (proposed).** Admit selected real Local API create, update and find-by-ID with
   access, validation, nested same-request calls and a database-only hook into
   the same attempt. Define hook location, permitted capabilities, first-failure
   order, rollback-only and retry behavior before admission. Prove pending
   cross-domain visibility and late Payload failure after Medusa work leaving
   no committed rows or event intent. Migrate adapter/request consumers and
   remove their displaced transaction, evidence or lifecycle mechanics while
   retaining independently supported standalone profiles.
3. **Finite Medusa workflow and connected three-consumer proof.** Select an
   admitted ordered workflow, its child frames, actual services, Links, events
   and transitive dependencies. Borrow the root attempt without independent
   child settlement or blind callback replay. Prove graph/pending reads and
   the index, text/JSON search, relation, uniqueness and resource-lock semantics
   the selected graph actually uses; refuse unsupported effects, waits,
   parallelism or locks. Run one combined Application/Payload/Medusa scenario
   with late failure, whole-attempt conflict retry, replay, cancellation and
   uncertain COMMIT. Migrate affected workflow/adapter consumers and remove
   displaced paths in this package.
4. **Evidence-driven cost and completion.** Only after representative real
   integration and correctness work, measure equivalent workloads on ordinary-role
   PostgreSQL, attributing SQL statements, sequential round trips, journal,
   validation, index/event maintenance, retries and lock waits. Agree numerical
   acceptance targets from that baseline. Optimize measured bottlenecks at
   their owning layer; rerun the same correctness and performance workloads.
   Finish with an audit of profile boundaries, durable formats, retained callers,
   exports, tests and documentation. This audit confirms cleanup already done
   per slice; it is not a delayed retirement package.

The first Product proof currently repeats checked-read, source-binding and
attempt-authority SQL across native service operations. That is a known query
cost, not a measured PostgreSQL latency or capacity result. Package 4 must
attribute statements and sequential round trips on a representative
ordinary-role PostgreSQL workload before setting targets or batching those
checks at their owning layer; the first package retains their correctness
checks.

The first preflight may revise package boundaries when a real call graph or
durable obligation requires it, but it must preserve a connected consumer proof
and state the changed scope for agreement.

## Validation And Completion Gates

Each significant code package needs focused owner and real-consumer tests,
type/build/lint/source guards, both `typescript-diff-reviewer` and
`code-quality-diff-reviewer`, and re-review after substantive fixes. Use PGlite
for fast behavioral coverage and ordinary-role PostgreSQL on distinct connections
for transaction, isolation, locking, index/search, migration and concurrency
claims; report their results separately. Include the applicable real Worker or
host boundary for private execution without claiming production deployment.

Completion requires the agreed private three-consumer scenario and its failure,
conflict, retry, event, cancellation and recovery witnesses; safe refusal of
unsupported behavior; explicit durable-data disposition; migrated consumers;
per-slice cleanup; and measured targets on the representative workload. A
passing bounded test does not prove arbitrary framework support, hosted capacity
or a developer API. Public authoring and deployment require later scope approval.
