# Engine decision register

Status: existing-core refactoring, integration reuse, necessary breaking changes,
portable owners and Cloudflare adapters first are accepted design directions.
One independent app has one owner shared by Medusa/Payload/Application. DO-local
commit coordination, bounded out-of-order saves, ordered normal publication and
uncertainty recovery are accepted design decisions. Timestamped snapshots are
accepted; concept 02 is active, with snapshot lifetime next. Remaining ownership,
fencing and recovery protocols stay open. Replication is explicitly deferred. This
register records decisions, not execution receipts; [OPEN-QUESTIONS.md](./OPEN-QUESTIONS.md)
owns the unresolved queue and its references.

## Status vocabulary

- **Open:** the owner has not selected an answer.
- **Proposed:** a concrete recommendation is available; not accepted.
- **Accepted:** the owner explicitly selected the recorded contract.
- **Superseded:** a named later decision replaced it.
- **Deferred:** still open; intentionally excluded from the current discussion
  and implementation selection until the owner reopens it.

Track **implemented** and **measured** separately from those design statuses.
An accepted design can remain unimplemented; a prototype can remain unaccepted;
passing correctness does not establish performance acceptance.

## Accepted discussion direction

The owner requested a fresh, modular engine-design discussion using Convex as
the primary reference, proceeding one concept at a time and updating the notes
after each decision. TypeScript and Drizzle remain requirements. Preserve the
existing experimental code, contracts and measurements as evidence while the
active Medusa integration continues separately. Follow the
[continuing requirements](./README.md#continuing-requirements).

The owner also accepted a portable core with injected infrastructure capabilities
and Cloudflare adapters as the initial host implementation direction. The
[boundary record](./01-ownership-and-lifetime.md#accepted-portable-core-and-adapter-boundary)
owns the responsibility split, lifetime rules and remaining choices. Framework
behavior stays in its framework owner; engine correctness stays in shared core
and persistence owners; host composition supplies platform mechanisms.

This authorizes documentation only. The accepted choices below do not finalize
all framework hosting, cache retention, fencing, schema or recovery mechanisms.
No engine implementation, source translation, production activation or measured
performance acceptance follows.

## Accepted refactor and development rules

The owner selected [refactoring the existing core](./REFACTOR.md), retaining
useful Medusa/Payload implementations and experimental-core design properties.
The experiment is the proof area; existing packages and their consumers are the
destination. Rebuilding a permanent parallel framework/engine stack is superseded
as a planning assumption, not recorded as a previously implemented replacement.

Necessary early-development internal API/type/schema/codec/identity and bridge
breaks are accepted. Keeping current PostgreSQL tables is optional, not a frozen
constraint. Preserve native behavior and correctness guarantees while replacing
costly mechanisms. Name affected data and its disposition, migrate callers and
remove displaced code/tests/exports/planning; no compatibility wrapper or fallback
exists merely to preserve unshipped internals. Current approval edits docs only.

Use the [pinned Convex mechanism and divergence rules](../REFERENCES.md#source-and-divergence-rules)
before each concept and implementation slice, recording invariants, relevant
tests, concurrency/recovery and the reason/evidence for each difference. Native
framework source owns behavior without a Convex equivalent. TypeScript RAM caches
are permitted; evaluate libraries, local structures and SQLite indexes by their
semantics and cost. Source reference does not itself authorize source copying.

Proceed one active concept at a time. Modular owners must not each introduce a
new transaction, admission pass or RPC. Record required behavior, owner/contract,
breaks, complete-operation cost and failure witnesses before a connected slice.
Once implementation is selected, finish its migrated consumers and cleanup within
the authorized scope; a small helper change is not the completion criterion.

## Accepted app, commit and read decisions

The [commit-coordination record](./01-commit-coordination.md) and
[timestamped-snapshot record](./02-timestamped-snapshots.md) own these decisions:

| Decision | Status / boundary |
| --- | --- |
| One independent app, one logical owner; Medusa/Payload/Application share its data and coordination | Accepted; a shop is only an example, not the partition key; domain permissions/profiles remain distinct |
| Coordinator and logical conflict validation inside the app DO; PostgreSQL performs durable commits and transactional enforcement | Accepted initial Cloudflare placement; no separate Worker committer required |
| Ordered acceptance, bounded overlapping saves that may complete out of order, ordered normal publication and acknowledgement | Accepted target; existing clock/publication plumbing must be redesigned where incompatible |
| Uncertain persistence stops acceptance/publication, fences old work, reconciles all in-flight outcomes, rebuilds state, then resumes | Accepted contract; exact fencing, terminality and reconstruction mechanisms remain open |
| Each operation reads committed data at one safe published timestamp across RAM, SQLite and PostgreSQL fallback | Accepted; explicit document/index/deletion history, valid-at-timestamp cache results or misses, no silent latest-row fallback; lifetime and representation remain open |
| Convex revision `84fbb0e70b4e857913673871cb847ad11a55f3d5`, source-first inspection and justified divergences | Accepted development rule; source reuse/license disposition remains separate |
| Execution replicas, their synchronization and scaling topology | Open and explicitly deferred; not a prerequisite for the first single-owner design |

The [placement companion](./01-do-execution-and-replicas.md) retains the wider
cache/hosting sketch and deferred replica example. Snapshot lifetime, cache
completeness, authorization, native replay eligibility, pipeline bounds and durable
recovery representation remain substantive unresolved contracts. No arbitrary
framework replay, raw latest-row disclosure or automatic cross-app atomicity is selected.

Use the [refactor record](./REFACTOR.md) for keep/adapt/replace choices and the
source-grounded integration seams. The initial candidate remains evidence;
neither it nor old active-core interfaces constrain the successor's internal
execution sequence. No code replacement follows from recording this proposal.

## Concepts

| ID | Concept | Design status | Implementation / evidence |
| --- | --- | --- | --- |
| 01 | [Engine ownership and lifetime](./01-ownership-and-lifetime.md), with [commit coordination](./01-commit-coordination.md) | App boundary, coordinator placement, save/publication order and recovery accepted; residual protocols open; replication deferred | No new engine implementation |
| 02 | [Timestamped snapshots](./02-timestamped-snapshots.md), metadata, readiness and authorization lifetimes | Fixed-timestamp read contract accepted; active focus is snapshot lifetime; other details open | Existing fresh gates remain binding; no new snapshot implementation |
| 03 | Values, IDs, timestamps and ordered-key semantics | Open; queued | Existing contracts are evidence, not automatically retained internals |
| 04 | Read/index execution and coherent caches | Open; queued | Command-local observations exist; shared-engine cache unproved |
| 05 | Pending state, dependencies and execution profiles | Open; queued | Existing Application/framework witnesses retained |
| 06 | Commit ordering, Drizzle persistence and outcome recovery | Ordering/recovery principles accepted under 01; detailed mechanism queued | Existing atomic publication is the baseline, not the new pipeline |
| 07 | Schema/index lifecycle, retention and memory limits | Open; queued | No replacement maintenance/GC protocol selected |
| 08 | Runtime scheduling, isolation and framework bridges | Cloudflare app coordinator placement accepted; detailed hosting/scheduling queued; replication deferred | No new adapter implementation; native semantics remain required |
| 09 | Reactivity and invalidation consumers | Open; queued | No connected shared-engine reactivity claim |
| 10 | First connected proof, performance gates and cutover | Open; queued | Existing complete-request measurements retained |

The order is a discussion guide, not a strict dependency chain. Q01/Q02 record
the accepted portions and remaining protocol work. The published-read-view
decision is now recorded under concept 02; the next focused question is
[snapshot lifetime](./OPEN-QUESTIONS.md#next-question-snapshot-lifetime).
This does not close the remaining ownership/fencing work or open every cache
topic at once. Open only the next concept when the current outcome is recorded
or the owner explicitly chooses to defer it. Create its focused note at that point;
do not fill this folder with speculative implementations or duplicate roadmaps.

The accepted boundary applies across queued concepts. Recording the current
proposal does not accept replica/cache protocols or replace the separate
Application, Payload and Medusa execution profiles. The relevant
[open questions](./OPEN-QUESTIONS.md) must be resolved
before selecting a connected implementation slice.

## Decision record shape

Each focused note must contain:

1. The question, current status and one concrete scenario.
2. Pinned Convex source symbols and what they actually establish.
3. Current Flarex obligations, invalidating writers and any proposed divergence.
4. Alternatives and tradeoffs, including latency, CPU, memory and failure behavior.
5. The owner's decision and rationale, or an explicit unresolved outcome.
6. Effects on related notes, consumers, schemas and compatibility obligations.
7. Required counterexamples, full-operation correctness/cost measurements and
   references to remaining questions in the canonical queue.
8. Implementation eligibility and cleanup/replacement gates.

For source reuse, also record revision/license/provenance disposition. For each
check to remove, name its replacement enforcement and relevant writer; do not
equate a cached value with fresh authority. Keep source code, tests and Git as
implementation/validation evidence rather than recording invented completion.
