# Engine decision register

Status: portable core and injected Cloudflare adapters first are accepted design
boundaries. Ownership and lifetime remain the active discussion; detailed engine
choices remain open. DO-local execution and OCC replicas are the current
proposal for that discussion. This register records current decisions, not
execution receipts or a chronological work log.

## Status vocabulary

- **Open:** the owner has not selected an answer.
- **Proposed:** a concrete recommendation is available; not accepted.
- **Accepted:** the owner explicitly selected the recorded contract.
- **Superseded:** a named later decision replaced it.

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

This authorizes documentation only. It does not select a DO topology, framework
execution placement, replicated cache, lease protocol, replacement schema,
source translation or changed authorization semantics. No engine or adapter
implementation, production activation or performance acceptance follows.

## Current proposed direction

The owner requested that the [DO execution and replica candidate](./01-do-execution-and-replicas.md)
be recorded as an unfinished design for continued discussion. It proposes one
execution DO per chosen scope with trusted framework/core processing, RAM working
state and SQLite cached rows/indexes, backed by authoritative PostgreSQL. If CPU
becomes the measured limit, multiple execution DOs could use coherent snapshots
and complete OCC at the shared accepting path. Conflict refresh must discard and
rerun only an eligible attempt; arbitrary framework replay is not accepted.

Ordinary Worker execution plus a separate cache DO remains a comparison option,
not an accepted topology. The current candidate uses complete OCC to reject a
stale replica's mutation proposal instead of requiring a latest-data check before
every local read. Cache validity, read-only freshness, authorization, ordering
against already accepted pending writes, framework eligibility and recovery
remain substantive unresolved contracts.

Retain the initial experimental core's behavioral contracts, useful ownership
and implementation evidence. Redesign internal lifetimes, representations and
bridges as required rather than copying its execution sequence or discarding its
native behavior. No code replacement follows from recording this proposal.

## Concepts

| ID | Concept | Design status | Implementation / evidence |
| --- | --- | --- | --- |
| 01 | [Engine ownership and lifetime](./01-ownership-and-lifetime.md), with [DO execution candidate](./01-do-execution-and-replicas.md) | Portable boundary accepted; DO-local execution and OCC replicas proposed; active | No new engine implementation |
| 02 | Snapshot, metadata, readiness and authorization lifetimes | Open; queued | Existing fresh gates remain binding |
| 03 | Values, IDs, timestamps and ordered-key semantics | Open; queued | Existing contracts are evidence, not automatically retained internals |
| 04 | Read/index execution and coherent caches | Open; queued | Command-local observations exist; shared-engine cache unproved |
| 05 | Pending state, dependencies and execution profiles | Open; queued | Existing Application/framework witnesses retained |
| 06 | Commit ordering, Drizzle persistence and outcome recovery | Open; queued | Existing atomic publication is the baseline |
| 07 | Schema/index lifecycle, retention and memory limits | Open; queued | No replacement maintenance/GC protocol selected |
| 08 | Runtime scheduling, isolation and framework bridges | Cloudflare adapter direction accepted; placement proposal recorded under 01; scheduling open | No new adapter implementation; native semantics remain required |
| 09 | Reactivity and invalidation consumers | Open; queued | No connected shared-engine reactivity claim |
| 10 | First connected proof, performance gates and cutover | Open; queued | Existing complete-request measurements retained |

The order is a discussion guide, not a strict dependency chain. Ownership cannot
be accepted without a credible recovery and writer model; later concepts detail
that model. Open only the next concept when the current outcome is recorded or
the owner explicitly chooses to defer it. Create its focused note at that point;
do not fill this folder with speculative implementations or duplicate roadmaps.

The accepted boundary applies across queued concepts. Recording the current
proposal does not accept replica/cache protocols or replace the separate
Application, Payload and Medusa execution profiles. The relevant
[open choices](./01-ownership-and-lifetime.md#choices-still-open) must be resolved
before selecting a connected implementation slice.

## Decision record shape

Each focused note must contain:

1. The question, current status and one concrete scenario.
2. Pinned Convex source symbols and what they actually establish.
3. Current Flarex obligations, invalidating writers and any proposed divergence.
4. Alternatives and tradeoffs, including latency, CPU, memory and failure behavior.
5. The owner's decision and rationale, or an explicit unresolved outcome.
6. Effects on related notes, consumers, schemas and compatibility obligations.
7. Required counterexamples, correctness tests and performance measurements.
8. Implementation eligibility and cleanup/replacement gates.

For source reuse, also record revision/license/provenance disposition. For each
check to remove, name its replacement enforcement and relevant writer; do not
equate a cached value with fresh authority. Keep source code, tests and Git as
implementation/validation evidence rather than recording invented completion.
