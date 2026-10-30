# Single-owner core refactor goal

Status: **Active implementation goal; bounded Application cache/read replacement,
local query DO composition, shared pending indexes, operation admission and
exact original finite preparation implemented; wider core milestones open**.
The owner has requested the complete single-owner refactor, delivered through
bounded connected milestones. This authorization supersedes earlier statements
that this work is documentation-only. It does not decide unresolved guarantees,
approve unspecified durable-data deletion or establish implemented support.

The [accepted architecture](../../../design-notes/flarex-db-accepted-design.md#portable-core-refactor-direction),
[replacement workflow](./REFACTOR.md#convex-guided-replacement-workflow),
[decision register](./DECISIONS.md) and [question queue](./OPEN-QUESTIONS.md)
remain the owning records for architecture, status and unresolved decisions.

## Finish line

Translate pinned Convex core logic and its physical persistence schema into
TypeScript/Drizzle through the [connected translation plan](./REFACTOR.md#core-and-physical-schema-translation-plan).
Depart only for a demonstrated DO/runtime or required native-behavior constraint,
with the reason, replacement and proof in its divergence record. Existing private
interfaces, physical layouts, optimizations or product-policy choices do not
supply an automatic exception; unresolved observable guarantees retain their
scoped decision gate. The current core in `packages/` and `apps/` is the
destination; the older `experiments/core/src` candidate is retained baseline
material, not a runtime dependency or a permanent second engine.

Complete the existing core's supported Application, Medusa and Payload paths
through that engine with portable owners and injected Cloudflare Worker/DO adapters
and PostgreSQL as the sole durable authority. One independent app has one logical
owner shared by these profiles. Reuse native business behavior and sound core
logic, migrate consumers and remove the displaced machinery.

At the start, record the actual supported consumer/workload inventory, exact
executing source identities, affected data and applicable acceptance gates.
The [bounded supported-profile baseline](./baseline/README.md) now records
the executing consumer families, source identities and explicit support gaps.
Complete transitive closure and fresh runtime proofs remain slice gates.
Existing public or durable obligations
need evidence; an old fixture or helper alone does not create one. Unrelated
work in progress belongs to its current owner until a coordinated handoff.
Changes to the goal inventory must be explicit rather than silently expanding
coverage while the refactor proceeds.

The goal is complete only when:

- Transaction finalization, snapshot/metadata ownership, pending/committed conflict
  checks, index maintenance/hydration and physical persistence follow the pinned
  mechanisms or have a demonstrated DO/native divergence. Connected conformance
  traces and schema/data cutover prove the translation; a new facade over the
  displaced SQL-command engine does not complete it.
- Supported reads, indexed ranges, misses, absence and pending-state results
  obey their selected snapshot, ordering, authorization and dependency contracts.
- Relevant writers preserve integrity and accepted conflict/retry rules. Bounded
  accepted saves may finish out of order; normal publication and acknowledgement
  remain ordered. Uncertain outcomes are reconciled before unsafe reexecution.
- Shared caches have proven eligibility, coverage, concurrent-fill validation,
  publication invalidation, bounds and restart reconstruction. PostgreSQL remains
  authoritative after DO eviction, replacement or crash.
- Existing supported native services, Local API behavior, hooks, errors,
  workflow visibility, compensation and effects survive the migration. Native
  commands retain their explicit profiles; they do not silently become replayable
  Application OCC mutations or one universal transaction API.
- Core correctness is independent of Cloudflare bindings. Adapters supply host,
  local storage, transport and persistence mechanisms through responsible owners.
- Every in-scope consumer uses the replacement path, and displaced code, exports,
  dependencies, fixtures and obsolete planning guidance are removed. Retained
  paths need a named obligation and removal gate.
- Required owner/consumer regressions, reviews and database/host proofs pass,
  applicable complete-request performance gates pass, scoped changes are committed,
  and documentation describes implemented evidence accurately.

An incomplete proof, unmet performance gate, unresolved required guarantee or
exhausted time/token budget does not make the goal complete.

## Milestones

These describe connected outcomes; source findings may change their dependency
order. Each milestone includes native consumer checks where its boundary reaches
those consumers.

| Milestone | Required outcome |
| --- | --- |
| Establish the baseline and challenge the first slice | Record supported consumers and compare current owners, the accepted direction and pinned Convex mechanisms; select the exact point/range path, writer connections and cleanup boundary. |
| Translate the core/persistence contract and physical schema | Map transaction finalization, versioned document/index logs, same-timestamp ordinary-index hydration, private metadata, fenced batches, outcomes and retention to current owners; resolve necessary DO/native adaptations and named-data disposition before connected cutover. |
| Snapshot reads and cache/index adapters | Replace a real existing point/range read with a portable snapshot owner, timestamp-preserving PostgreSQL misses and injected local storage; prove actual DO composition and cache coherence before enabling reuse. |
| Pending state, dependencies and acceptance | Preserve profile-correct read-your-writes, exact dependencies, native visibility and outer settlement while replacing the affected attempt/validation machinery. |
| Persistence, publication and recovery | Implement the accepted save/publication order, fencing, durable outcome reconciliation and cache/bootstrap recovery through the correct owners. |
| Required index lifecycle and integration migration | Prove the lifecycle/build/readiness paths required by the recorded inventory and migrate remaining Application, Medusa and Payload consumers without rewriting native business algorithms. |
| Retirement and complete-flow acceptance | Remove displaced paths, run the full relevant workload/host/scale comparisons and close every required correctness, performance, review and cleanup gate. |

The [starting-slice record](./REFACTOR.md#recommended-starting-slice) is the first
candidate. Its mechanism choices remain subject to the required source challenge;
authorization to implement the goal is not acceptance of every proposed detail.

The [bounded operation-local replacement](./slices/01-snapshot-reads.md) is
implemented. The [timestamped cache-transfer slice](./slices/02-timestamped-cache-transfer.md)
now connects exclusive query-cache handoff and guarded PostgreSQL refresh to
the existing Application query path. Neither closes the wider
snapshot/DO milestone or the complete goal. The bounded
[actual-DO query composition](./slices/03-application-query-do-host.md) now executes
the genuine query path with default local workerd and ordinary PostgreSQL.
The [mutation pending-state replacement](./slices/04-mutation-pending-state.md)
records independent source challenge and peer convergence. Its first
[range-evidence prerequisite](./slices/04a-range-completion-evidence.md) is
implemented for newly executed operations. The bounded
[incremental shared-root index replacement](./slices/04b-incremental-pending-indexes.md)
now connects accepted Application/native writes to ordered current positions and
written-ID suppression, preserving profile-specific interpretation and failure
order. The real Standard cutover and stored-profile disposition remain open;
these replacements do not repair older journal readsets or complete that milestone.
The [Standard cutover contract](./slices/04c-standard-mutation-cutover.md) records
the connected preparation, ordered admission, stored-request and recovery
requirements. Its genuine current nested-failure prerequisite is implemented;
the connected [operation-admission replacement](./slices/04c1-application-operation-admission.md)
is implemented. The ordinary Standard cutover is in progress; complete acceptance
remains open.
The [exact-original preparation prerequisite](./slices/04c2-exact-selection-preparation.md)
is implemented for existing finite Product/Payload consumers, including full
callable-catalog coverage and explicit installation reconciliation. Ordinary
Standard finite activation and recovery remain open.
The [ordinary Standard replacement](./slices/04c3-standard-finite-execution.md)
has completed independent challenge and peer exchange. Its connected runtime
implementation is in progress; the affected historical-data path requires the
[stored-attempt disposition](./05-stored-attempt-disposition.md).

The bounded [joint Application/Payload/Currency relation writer](./slices/04c3e-cross-domain-relation-maintenance.md)
uses one current preparation generation and the existing combined publisher.
It preserves native execution and maintains Application edges, adjacency and
facts. Like standalone source CMS, it corrects future writes without certifying
historical sidecar coverage or closing maintained-serving readiness.

## Mandatory challenge before each slice

Before implementation, independent sub-agents inspect and challenge:

1. The current core's executing owners, callers, tests and actual costs: identify
   semantic obligations, reusable logic and replaceable choreography.
2. The pinned Convex owner, relevant callers and tests: establish the actual
   mechanism, invariants, concurrency order and failure/recovery behavior.
3. The proposed replacement against both: test assumptions with concrete
   counterexamples, identify retained bottlenecks, missing writer participation,
   unnecessary abstractions and changes to supported behavior.

Use Convex revision `84fbb0e70b4e857913673871cb847ad11a55f3d5`, the
[source map](../REFERENCES.md#convex-source-identity) and the actual source files;
do not substitute remembered behavior. Agents first form independent findings,
then exchange evidence and challenge each other's conclusions. The coordinator
records convergence, unresolved disagreements, current owner -> pinned mechanism
-> keep/adapt/replace -> correctness cases -> removed code, and the bounded
implementation contract before dispatching affected code work.

The coordinator resolves ordinary source/implementation questions with evidence.
An unresolved change to guarantees requires a recorded owner decision before the
affected path proceeds. Independent authorized work continues. Accepted choices
and routine TypeScript adaptation do not require repeated approval.

## Coordinated implementation

Use implementation sub-agents with explicit responsibility/file ownership,
consumer contracts and expected validation. Tell each worker that others share
the codebase; do not revert or overwrite their changes. Coordinate cross-owner
changes directly, sequence overlapping edits and integrate through the existing
semantic owner. Agents must not invent competing settlement, cache authority or
framework behavior to work around missing contracts.

Copy or translate the pinned Convex mechanism as closely as the host and native
contracts permit. Each necessary mechanism difference needs a dedicated
[divergence record](./divergences/README.md) before affected implementation,
including why it is necessary and how the replacement works. A record does not
itself accept a new guarantee change.

Significant code changes still require both root-mandated read-only project
reviewers after implementation: `typescript-diff-reviewer` and
`code-quality-diff-reviewer`, using the model/effort specified in
[AGENTS.md](../../../AGENTS.md). Pre-slice challenge does not replace these reviews.
Fix findings, rerun affected validation and reviews as required, and create
scoped commits without including unrelated work.

## Validation and exclusions

Apply [VALIDATION.md](../VALIDATION.md), including complete native business
graphs and separate Application evidence. Database semantics require PGlite and
focused ordinary-role real PostgreSQL lanes. DO storage, lifecycle, interleaving
and restart claims require the actual Cloudflare host; Node or local mock
conformance is insufficient. Keep quiet performance runs separate from competing
load and stop only resources owned by this work.

The owner's current compiler selection is installed Oxc
`tsrs@0.20.1-ts7.1.0-beta --fast` for scoped checks. Do not run native `tsc`/`tsgo`
or scripts that invoke them. A suspected checker false positive pauses the
affected path for a direct report with the exact command, diagnostic, source
identity and uncertainty; do not suppress it or change valid code merely to
silence it. Native comparison needs separate authorization. Compiler benchmarks
remain stopped. This selects validation tooling, not weaker runtime guarantees.

Use the recorded [performance gates](../VALIDATION.md#acceptance), the
[performance owner](../../../roadmaps/core-performance/README.md#acceptance-is-complete-request-cost)
and profile-specific contracts. Declare admitted workload sizes, concurrency and
throughput/tail targets before judging capacity; do not invent missing targets,
weaken existing ones or infer capacity from helper speed or fewer SQL calls.

Replication remains explicitly deferred. Arbitrary new framework coverage,
complete Convex feature parity and production rollout are outside this goal.
Single-owner correctness, required hosting proof and migration of the recorded
supported scope remain inside it.
