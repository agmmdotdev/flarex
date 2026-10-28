# Single-owner core refactor goal

Status: **Active implementation goal; bounded Application cache/read replacement
implemented, wider snapshot/DO milestone open**.
The owner has requested the complete single-owner refactor, delivered through
bounded connected milestones. This authorization supersedes earlier statements
that this work is documentation-only. It does not decide unresolved guarantees,
approve unspecified durable-data deletion or establish implemented support.

The [accepted architecture](../../../design-notes/flarex-db-accepted-design.md#portable-core-refactor-direction),
[replacement workflow](./REFACTOR.md#convex-guided-replacement-workflow),
[decision register](./DECISIONS.md) and [question queue](./OPEN-QUESTIONS.md)
remain the owning records for architecture, status and unresolved decisions.

## Finish line

Complete the existing core's supported Application, Medusa and Payload paths
through portable TypeScript owners with injected Cloudflare Worker/DO adapters
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
| Snapshot reads and cache/index adapters | Replace a real existing point/range read with a portable snapshot owner, timestamp-preserving PostgreSQL misses and injected local storage; prove actual DO composition and cache coherence before enabling reuse. |
| Pending state, dependencies and acceptance | Preserve profile-correct read-your-writes, exact dependencies, native visibility and outer settlement while replacing the affected attempt/validation machinery. |
| Persistence, publication and recovery | Implement the accepted save/publication order, fencing, durable outcome reconciliation and cache/bootstrap recovery through the correct owners. |
| Required index lifecycle and integration migration | Prove the lifecycle/build/readiness paths required by the recorded inventory and migrate remaining Application, Medusa and Payload consumers without rewriting native business algorithms. |
| Retirement and complete-flow acceptance | Remove displaced paths, run the full relevant workload/host/scale comparisons and close every required correctness, performance, review and cleanup gate. |

The [starting-slice record](./REFACTOR.md#recommended-starting-slice) is the first
candidate. Its mechanism choices remain subject to the required source challenge;
authorization to implement the goal is not acceptance of every proposed detail.

The [bounded operation-local replacement](./slices/01-snapshot-reads.md) is
implemented. The next selected [cache-transfer slice](./slices/02-timestamped-cache-transfer.md)
has completed its independent source challenge and records the handoff and
PostgreSQL-refresh adaptations; runtime is unstarted. Neither closes the wider
snapshot/DO milestone or the complete goal.

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

Use the recorded [performance gates](../VALIDATION.md#acceptance), the
[performance owner](../../../roadmaps/core-performance/README.md#acceptance-is-complete-request-cost)
and profile-specific contracts. Declare admitted workload sizes, concurrency and
throughput/tail targets before judging capacity; do not invent missing targets,
weaken existing ones or infer capacity from helper speed or fewer SQL calls.

Replication remains explicitly deferred. Arbitrary new framework coverage,
complete Convex feature parity and production rollout are outside this goal.
Single-owner correctness, required hosting proof and migration of the recorded
supported scope remain inside it.
