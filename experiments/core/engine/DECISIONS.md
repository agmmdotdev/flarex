# Engine decision register

Status: existing-core refactoring, integration reuse, necessary breaking changes,
portable owners and Cloudflare adapters first are accepted design directions.
One independent app has one owner shared by Medusa/Payload/Application. DO-local
commit coordination, bounded out-of-order saves, ordered normal publication and
uncertainty recovery are accepted design decisions. Timestamped snapshots are
accepted, with demand caching, write invalidation, validated fills and bounded
retention as the selected direction. Operation boundaries, inherited deadlines
and expiry/retry policy are accepted; numerical limits remain open. Snapshot
permission dependencies and identity-aware result reuse are accepted, with separate
engine-grant revocation. Latest-published read admission, recovery gating and
reactive-client timestamp synchronization are accepted. Ordinary-index lifecycle,
deployment readiness gates and snapshot-based index admission are accepted.
Concept 07 now focuses on resumable index backfill. Remaining concept-02 protocols,
ownership, fencing and recovery details stay open.
Replication is explicitly deferred. This register records decisions, not execution
receipts; [OPEN-QUESTIONS.md](./OPEN-QUESTIONS.md)
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
semantics and cost.

Proceed one active concept at a time. Modular owners must not each introduce a
new transaction, admission pass or RPC. Record required behavior, owner/contract,
breaks, complete-operation cost and failure witnesses before a connected slice.
Once implementation is selected, finish its migrated consumers and cleanup within
the authorized scope; a small helper change is not the completion criterion.

## Accepted app, commit and read decisions

The [commit-coordination record](./01-commit-coordination.md),
[timestamped-snapshot record](./02-timestamped-snapshots.md),
[operation-lifetime record](./02-operation-lifetime.md),
[read-authorization record](./02-read-authorization.md),
[read-after-write record](./02-read-after-write.md) and
[index-readiness record](./02-index-readiness.md) own these decisions:

| Decision | Status / boundary |
| --- | --- |
| One independent app, one logical owner; Medusa/Payload/Application share its data and coordination | Accepted; a shop is only an example, not the partition key; domain permissions/profiles remain distinct |
| Coordinator and logical conflict validation inside the app DO; PostgreSQL performs durable commits and transactional enforcement | Accepted initial Cloudflare placement; no separate Worker committer required |
| Ordered acceptance, bounded overlapping saves that may complete out of order, ordered normal publication and acknowledgement | Accepted target; existing clock/publication plumbing must be redesigned where incompatible |
| Uncertain persistence stops acceptance/publication, fences old work, reconciles all in-flight outcomes, rebuilds state, then resumes | Accepted contract; exact fencing, terminality and reconstruction mechanisms remain open |
| Each operation reads committed data at one safe published timestamp across RAM, SQLite and PostgreSQL fallback | Accepted; explicit document/index/deletion history, valid-at-timestamp cache results or misses, no silent latest-row fallback; numerical limits and representation remain open |
| One bounded atomic operation owns a snapshot and deadline; participating nested work shares both, pending state and one outer settlement | Accepted; map Application queries/attempts and actual Payload/Medusa transaction groups without holding snapshots across remote effects or workflow suspension |
| Expiry before acceptance closes the operation; eligible pure queries/Application attempts may restart, native framework commands initially fail explicitly; accepted or uncertain writes require outcome recovery | Accepted policy; numerical budgets, native conformance, error mapping and cancellation/acceptance interlocks remain open |
| Populate data/index caches on demand, invalidate relevant ranges at publication, validate concurrent fills, and bound cache size and history separately | Accepted direction following pinned Convex mechanisms; numerical defaults, local structures and cleanup protocol are not selected |
| Application permission records are tracked snapshot reads; result reuse accounts for relevant identity and all dependencies | Accepted Convex-style direction; ordinary permission updates do not universally cancel older running queries; native access/hook semantics and result-cache eligibility require proof |
| Authentication and engine-grant revocation remain separate from snapshot permission data | Accepted; preserve the grant's attempt-invalidating revocation contract; concrete enforcement/disclosure races remain open, with stronger checks requiring named obligations |
| New ordinary reads use the ready app owner's latest published snapshot; startup/recovery gates new reads with bounded waits or explicit failure | Accepted; cold caches miss to PostgreSQL at that same timestamp; no per-query timestamp-fetch request or mandatory minimum-timestamp token for the initial single-owner ordinary-read path; concrete ownership/readiness protocols remain open |
| Reactive clients retain commit/query timestamps, resolve successful mutation promises after applied query-state progress and check reconnect progress | Accepted direction following pinned Convex backend/client code; exact protocol and subscription implementation remain open; no native replay is enabled |
| Ordinary database indexes move through Backfilling, Backfilled and Enabled; required builds gate deployment and queries require enabled metadata at their snapshot | Accepted Convex-style lifecycle; staged builds require later enablement, no runtime waiting/partial reads/implicit scan fallback; local cache coverage is separate; backfill, activation and recovery details remain open |
| Convex revision `84fbb0e70b4e857913673871cb847ad11a55f3d5`, source-first inspection and justified divergences | Accepted development rule; adapted mechanisms retain exact source provenance |
| Execution replicas, their synchronization and scaling topology | Open and explicitly deferred; not a prerequisite for the first single-owner design |

The [placement companion](./01-do-execution-and-replicas.md) retains the wider
cache/hosting sketch and deferred replica example. Numerical lifetime limits, cache
completeness, grant enforcement, native result-cache/replay eligibility, pipeline bounds and durable
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
| 02 | [Timestamped snapshots](./02-timestamped-snapshots.md), [operation lifetime](./02-operation-lifetime.md), [read authorization](./02-read-authorization.md), [read-after-write freshness](./02-read-after-write.md) and [index readiness](./02-index-readiness.md) | Read/cache, operation boundary, expiry/retry, authorization, freshness and index-admission direction accepted; remaining budgets/protocols queued | Named grant/native obligations remain binding; no new snapshot implementation |
| 03 | Values, IDs, timestamps and ordered-key semantics | Open; queued | Existing contracts are evidence, not automatically retained internals |
| 04 | Read/index execution and coherent caches | Coherence/population principles accepted under 02; representation and execution details queued | Command-local observations exist; shared-engine cache unproved |
| 05 | Pending state, dependencies and execution profiles | Outer ownership and initial retry policy accepted under 02; detailed representation and native conformance queued | Existing Application/framework witnesses retained |
| 06 | Commit ordering, Drizzle persistence and outcome recovery | Ordering/recovery principles accepted under 01; detailed mechanism queued | Existing atomic publication is the baseline, not the new pipeline |
| 07 | Schema/index lifecycle, retention and memory limits | Index lifecycle/readiness and bounded cache/history direction accepted; resumable index backfill active; other maintenance/limit details queued | No replacement builder, maintenance or GC protocol selected |
| 08 | Runtime scheduling, isolation and framework bridges | Cloudflare app coordinator placement accepted; detailed hosting/scheduling queued; replication deferred | No new adapter implementation; native semantics remain required |
| 09 | Reactivity and invalidation consumers | Client timestamp synchronization direction accepted; delivery/protocol details queued | No connected shared-engine reactivity claim |
| 10 | First connected proof, performance gates and cutover | Open; queued | Existing complete-request measurements retained |

The order is a discussion guide, not a strict dependency chain. Q01/Q02 record
the accepted portions and remaining protocol work. Read views and operation
lifetime policy are recorded under concept 02; the next focused question is
[resumable index backfill](./OPEN-QUESTIONS.md#next-question-resumable-index-backfill).
This does not close the remaining ownership/fencing work or open every cache
topic at once. Open only the next concept when the current outcome is recorded
or the owner explicitly chooses to defer it. Create its focused note at that point;
do not fill this folder with speculative implementations or duplicate roadmaps.

The accepted boundary applies across queued concepts. Recording these policies
does not select replica topology or concrete cache layout, or replace the separate
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

For source reuse, also record the exact revision, files and symbols. For each
check to remove, name its replacement enforcement and relevant writer; do not
equate a cached value with fresh authority. Keep source code, tests and Git as
implementation/validation evidence rather than recording invented completion.
