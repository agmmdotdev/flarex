# Portable core refactor discussion

Status: refactoring the existing core with reusable Medusa/Payload integrations,
necessary breaking changes, portable owners and Cloudflare adapters first is
**accepted design direction**. One independent app owner, DO-local commit
coordination, out-of-order saves with ordered normal publication and uncertainty
recovery are accepted. Timestamped snapshots now govern all read paths, including
PostgreSQL misses. Demand caching, write invalidation, validated fills and bounded
cache/history retention are the accepted direction. Atomic-operation boundaries,
inherited deadlines and expiry/retry policy are accepted. Numerical budgets,
cache representation and fencing remain open;
replication is explicitly deferred. The [goal contract](./GOAL.md) authorizes
bounded implementation after the required source challenge. Implementation,
measurement and production activation remain separate claims.

Read the [refactor direction](./REFACTOR.md) for what we keep, replace and remove.
The [supported-profile baseline](./baseline/README.md) fixes the existing
consumer families and source/status boundaries for the goal.
The [decision register](./DECISIONS.md) tracks accepted/proposed status; the
[open-question queue](./OPEN-QUESTIONS.md) is the single unresolved-question owner.
Read [01: ownership](./01-ownership-and-lifetime.md) and its
[accepted commit decisions](./01-commit-coordination.md), then
[02: timestamped snapshots](./02-timestamped-snapshots.md), including
[cache and retention evidence](./02-timestamped-snapshots.md#pinned-cache-and-retention-evidence).
The [operation-lifetime record](./02-operation-lifetime.md) owns atomic grouping,
deadline sharing and expiry/retry rules. The
[read-authorization record](./02-read-authorization.md) separates tracked snapshot
permissions from authentication and engine-grant revocation. The
[read-after-write record](./02-read-after-write.md) owns latest ordinary reads,
recovery admission and reactive-client timestamp synchronization. The
[index-readiness record](./02-index-readiness.md) owns ordinary-index lifecycle,
deployment gating and query admission. Follow the accepted
[replacement workflow](./REFACTOR.md#convex-guided-replacement-workflow) and the
[starting milestone](./REFACTOR.md#recommended-starting-slice). Its bounded
[operation-local query cache](./slices/01-snapshot-reads.md) is implemented; the
[timestamped cache-transfer slice](./slices/02-timestamped-cache-transfer.md)
implements the active Convex handoff/write-log mechanism for supported
Application app-row query data. The wider portable
snapshot/DO composition remains open.
Resumable backfill remains open in Q07. [Pinned references](../REFERENCES.md#engine-mechanism-reference-map)
anchor each concept and later implementation in actual Convex owners.

## Current topology proposal

The [DO execution and replica proposal](./01-do-execution-and-replicas.md) is the
placement companion to concept 01. It applies the new execution/state direction to
the existing core, retaining useful experimental owners, pending-state semantics,
precise observations, native behavior and singular settlement while redesigning
their lifetime, hosting and storage interactions.
The initial app DO hosts commit coordination; broader trusted framework hosting
and versioned local cache mechanisms still need proof. Logical validation and
ordering run inside the DO; PostgreSQL performs durable commits and transactional
enforcement. Multiple DOs for one app would be execution replicas; that topic is
open and explicitly deferred, not an automatic scale-out setting.

The proposal records the cart conflict/retry example, the SQLite/PostgreSQL
authority split and framework replay limits. The commit and snapshot records own
the accepted parts; the companion's remaining mechanisms and replica sketch are
not accepted protocols. The question queue owns unresolved dependencies; the
goal supplies implementation authorization within settled, challenged boundaries.

## Accepted core and runtime boundary

Keep framework and engine behavior independent of Cloudflare services. Host
composition supplies execution, coordination transport, persistence access and
other required infrastructure through narrow contracts owned by the component
that needs them. Shared owners define correctness; adapters implement platform
mechanisms without changing those guarantees. This is not one universal runtime
interface or a requirement to create a new package for every capability.

Cloudflare is the first host family to wire under the goal's implementation
gates. Cloudflare bindings and types stay in host adapters; PostgreSQL remains
the durable authority. One independent app is the selected ownership boundary,
with its coordinator in the app DO. This does not prove every native framework
branch can run there or select replicated executor caches. The wider placement
sketch remains subject to native hosting and cache correctness evidence.
The [boundary record](./01-ownership-and-lifetime.md#accepted-portable-core-and-adapter-boundary)
defines responsibilities, lifetimes and the decisions still required. A later
host must satisfy the same contracts and pass its own conformance gates.

## Why reopen the design

The existing integrations already have native repository/Local API injection
seams. Reuse that investment while changing the core-facing contracts that
preserve unnecessary work. The experiment is a proving area, not a requirement
to build another full framework stack before migrating existing consumers.

The existing experiment implements bounded Application, Payload, Product and
mixed operations with pending state, dependencies and one final publication.
It reduces database visits but largely retains request-scoped execution with
Postgres coordination. It does not implement Convex's shared versioned metadata,
data/index caches and in-memory conflict history under a coordinated engine owner.

Both active Flarex and the experiment already keep some pending and prepared
state in memory. The hypothesis is to avoid additional storage interactions by
owning reusable, coherent state across commands. Merely adding maps, replacing
Rust with TypeScript or reducing statement counts does not establish a speedup.
The [existing measurements](../RESULTS.md) remain the baseline; there is no matched
Convex performance result and no shared-engine measurement yet.

## How we work through this

1. Discuss one concept in plain language, using a small concrete execution example.
2. Inspect the pinned Convex owner, its guarantees and failure paths; inspect
   executing native sources for framework-specific behavior. Do this again for
   each later implementation slice rather than relying only on an initial survey.
3. Explain alternatives, failure cases, cost and effects on earlier decisions.
4. Record the owner's explicit decision, or keep the concept open. Recommendations
   and tentative sketches are not decisions.
5. Update the register, canonical question queue and affected notes together.
   Mark replaced decisions superseded and remove conflicting planning guidance;
   retain baseline evidence. Do not duplicate unresolved lists across notes.
6. Select a connected implementation slice only after its required decisions are
   accepted. Implementation and measured acceptance are separate statuses.

This sequence is not a ban on discussing future dependencies: flag them early,
but do not silently settle them. A later concept can reopen an earlier decision.
Use small direct contracts; modules must not each add a database round trip,
independent lifetime or finalizer. Existing code is reusable where its owner fits.

## Continuing requirements

- Postgres alone decides durable committed application data, history and outcomes.
  Shared engine memory is reconstructible; it cannot acknowledge an unpersisted
  business commit. Use Drizzle schemas and query construction for new SQL work.
- Keep the portable Application contract and exact snapshot/dependency behavior.
  Preserve separate native framework visibility, lifecycle and retry obligations.
- Native Payload/Medusa behavior is requirements evidence and reusable code.
  New bridges may change core-facing contracts; do not preserve old bottlenecks
  through wrappers or automatically replay arbitrary native hooks.
- Preserve tenant confinement, fresh authorization/revocation obligations,
  fencing, cancellation, rollback-only failures and uncertain-outcome recovery.
  Any replacement enforcement protocol needs every relevant writer accounted for.
- Keep native/application callbacks and remote effects outside physical SQL
  transactions. Only the trusted outer owner publishes an atomic command.
- Keep current Medusa integration work and active runtime packages untouched.
  This is the current documentation boundary, not a permanent prohibition on
  refactoring them. Later connected scopes migrate existing consumers and remove
  displaced mechanisms. No data reset or deployment follows from these notes.
- The accepted production target remains the private Worker and cache-disabled
  Hyperdrive. Investigating another host is allowed; changing that target needs
  an explicit architecture decision. Ordinary Worker memory is not a shared owner.

## Responsibilities to discuss

Use [OPEN-QUESTIONS.md](./OPEN-QUESTIONS.md) for responsibility-specific questions,
source references and required counterexamples. Choose the dependencies of one
connected replacement at a time; queued topics do not impose a global sequence
or silently select APIs, data structures or runtime placement.

The first implementation should eventually prove a complete small path, including
cold bootstrap, reads, writes, conflicts, persistence, publication and recovery.
It must not consist only of fast in-memory map operations. Reuse the actual
Application and framework workloads and [validation gates](../VALIDATION.md),
adding warm/cold caches, eviction, owner replacement and memory-pressure witnesses.
The [recommended starting slice](./REFACTOR.md#recommended-starting-slice) scopes
that proof around existing point/range reads. Settle its required guarantees;
unrelated questions need not be finished first. Implementation proceeds under
the [goal contract](./GOAL.md) after the required pre-slice challenge.

## What follows from copying the design

Use Convex as the primary reference for the complete engine mechanisms, and make
every necessary product/platform divergence explicit. Record the exact source
revision, files and symbols for each adapted mechanism. This document records
design only.

TypeScript remains the requested implementation direction. Library selection,
ordered persistent structures, timestamp representation, async scheduling and
memory accounting remain open; a JavaScript Map is not a substitute for all Rust
ordered/copy-on-write structures. Do not claim equivalent performance in advance.
RAM caching is possible in TypeScript and DO instance state. Choose suitable
existing libraries, TypeScript structures or SQLite indexes; do not invent a
replacement solely because the reference implementation uses Rust.
