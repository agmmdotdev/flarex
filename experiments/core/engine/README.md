# Shared engine design discussion

Status: portable core with injected infrastructure capabilities and Cloudflare
adapters first is **accepted design direction**. Ownership topology, cache and
coordination protocols remain open. No new shared engine, adapter implementation,
source port or production cutover is authorized or implemented by this decision.

Start with [01: ownership and lifetime](./01-ownership-and-lifetime.md).
The [decision register](./DECISIONS.md) tracks that single active concept and the
remaining questions. [Pinned references](../REFERENCES.md#engine-mechanism-reference-map)
anchor the discussion in actual Convex code and documented platform behavior.

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
The [boundary record](./01-ownership-and-lifetime.md#accepted-portable-core-and-adapter-boundary)
defines responsibilities, lifetimes and the decisions still required. A later
host must satisfy the same contracts and pass its own conformance gates.

## Why reopen the design

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
2. Inspect the pinned Convex owner and the relevant current Flarex requirement.
3. Explain alternatives, failure cases, cost and effects on earlier decisions.
4. Record the owner's explicit decision, or keep the concept open. Recommendations
   and tentative sketches are not decisions.
5. Update the register and all affected notes together. Mark replaced decisions
   superseded and remove conflicting planning guidance; retain baseline evidence.
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
  No deployment, data reset, migration or production routing follows from this note.
- The accepted production target remains the private Worker and cache-disabled
  Hyperdrive. Investigating another host is allowed; changing that target needs
  an explicit architecture decision. Ordinary Worker memory is not a shared owner.

## Responsibilities to discuss

These are a coverage map, not accepted module APIs or a port checklist. The
portable core/adapter separation above constrains each responsibility without
selecting its algorithm, placement or exported interface.

| Responsibility | Question we must resolve |
| --- | --- |
| Engine ownership | What scope/partition is coordinated, by whom, and how does takeover work? |
| Versioned snapshots and metadata | Which versions are retained, and how do authority and readiness relate to them? |
| Values and ordered keys | Which encoding, comparison and identity semantics must TypeScript preserve? |
| Reads, indexes and caches | What can memory answer, how are misses fetched, and how is validity established? |
| Pending state and read dependencies | How do points, absence, ranges and native observations contribute to conflicts? |
| Commit and persistence | How are conflicts ordered, writes persisted, outcomes resolved and state published? |
| Schema/index lifecycle and retention | How do build, activation, cleanup and history expiry participate safely? |
| Runtime and integration | How do bounded resources, concurrency, cancellation and framework lifetimes compose? |
| Reactivity | How do committed changes feed exact invalidation without a second source of truth? |

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
