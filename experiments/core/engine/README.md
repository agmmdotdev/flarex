# Portable core refactor discussion

Status: refactoring the existing core with reusable Medusa/Payload integrations,
necessary breaking changes, portable owners and Cloudflare adapters first is
**accepted design direction**. DO-local execution with SQLite caches and possible
OCC replicas remains **proposed**. Ownership, cache and coordination contracts
remain open. Current work is documentation only; no engine implementation, source
port, data change or production cutover is authorized by these notes.

Read the [refactor direction](./REFACTOR.md) for what we keep, replace and remove.
The [decision register](./DECISIONS.md) tracks accepted/proposed status; the
[open-question queue](./OPEN-QUESTIONS.md) is the single unresolved-question owner.
Start with [01: ownership and lifetime](./01-ownership-and-lifetime.md) and Q01/Q02
in that queue. [Pinned references](../REFERENCES.md#engine-mechanism-reference-map)
anchor each concept and later implementation in actual Convex owners.

## Current topology proposal

The [DO execution and replica proposal](./01-do-execution-and-replicas.md) is the
active companion to concept 01. It applies the new execution/state direction to
the existing core, retaining useful experimental owners, pending-state semantics,
precise observations, native behavior and singular settlement while redesigning
their lifetime, hosting and storage interactions.
It proposes keeping trusted framework/engine processing next to local cached
rows and indexes, initially in one DO per chosen scope. Multiple DOs for a busy
scope would be separate execution replicas, with complete OCC and explicit
snapshot/recovery rules; they are not an automatic scale-out setting.

The proposal records the cart conflict/retry example, the SQLite/PostgreSQL
authority split and framework replay limits. It remains a discussion candidate,
not an accepted topology or an implementation plan. The question queue owns next
steps, starting with scope ownership and the authoritative accepting path.

## Accepted core and runtime boundary

Keep framework and engine behavior independent of Cloudflare services. Host
composition supplies execution, coordination transport, persistence access and
other required infrastructure through narrow contracts owned by the component
that needs them. Shared owners define correctness; adapters implement platform
mechanisms without changing those guarantees. This is not one universal runtime
interface or a requirement to create a new package for every capability.

Cloudflare is the first host family to wire when implementation is separately
approved. Cloudflare bindings and types stay in host adapters; PostgreSQL remains
the durable authority. Selecting Cloudflare does not select one DO per shop,
place all Medusa/Payload logic inside a DO, or accept replicated executor caches.
Those placements are now a concrete proposal in the companion note, still open.
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
source references and required counterexamples. Only ownership and its commit
coordination dependency are active; queued topics do not select module APIs,
data structures, runtime placement or an implementation schedule.

The first implementation should eventually prove a complete small path, including
cold bootstrap, reads, writes, conflicts, persistence, publication and recovery.
It must not consist only of fast in-memory map operations. Reuse the actual
Application and framework workloads and [validation gates](../VALIDATION.md),
adding warm/cold caches, eviction, owner replacement and memory-pressure witnesses.
Exact slice scope is deferred until its necessary decisions are accepted.

## What follows from copying the design

Use Convex as the primary reference for the complete engine mechanisms, and make
every necessary product/platform divergence explicit. Source adaptation is a
separate decision: identify the exact revision, applicable license, intended use
and provenance before translating code. The currently inspected backend is FSL;
changing language does not establish permission. This document copies no code.

TypeScript remains the requested implementation direction. Library selection,
ordered persistent structures, timestamp representation, async scheduling and
memory accounting remain open; a JavaScript Map is not a substitute for all Rust
ordered/copy-on-write structures. Do not claim equivalent performance in advance.
RAM caching is possible in TypeScript and DO instance state. Choose suitable
existing libraries, TypeScript structures or SQLite indexes; do not invent a
replacement solely because the reference implementation uses Rust.
