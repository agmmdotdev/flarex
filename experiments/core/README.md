# Experimental Flarex core

Start with the [shared engine design discussion](./engine/README.md). The owner
has requested a fresh Convex-based design discussion, one concept at a time,
with decisions recorded before their implementation. The first open concept is
[engine ownership and lifetime](./engine/01-ownership-and-lifetime.md).

## Current state

| Area | Status |
| --- | --- |
| Active Flarex core and Medusa integration | Continue separately; outside this experiment's mutation scope |
| Initial experimental candidate | Bounded Application, Payload CRUD, Product scalar and explicitly atomic mixed flows implemented and measured with Drizzle; performance promotion remains closed |
| Shared engine direction | Investigation and documentation approved; host, cache design, ownership protocol and implementation slices remain open |

The existing candidate already keeps pending writes, observations and some
prepared state in memory. It does not implement Convex's complete shared
snapshot, metadata, index/cache and conflict-history machinery. Revisit those
owners and their database interactions without assuming that a TypeScript port
or an in-memory cache automatically provides Convex's performance.

This folder remains outside `packages/*` and `apps/*` workspace membership.
It is a separate experiment, not an accepted replacement or production package.

## Current discussion

1. [AGENTS.md](./AGENTS.md): scope, isolation and iteration rules.
2. [Engine discussion](./engine/README.md): direction, continuing obligations and modular responsibilities.
3. [Decision register](./engine/DECISIONS.md): accepted discussion process and open concepts.
4. [Concept 01](./engine/01-ownership-and-lifetime.md): ownership, lifetime and possible hosts.
5. [REFERENCES.md](./REFERENCES.md): pinned Convex mechanisms, platform constraints and Flarex evidence.

Discuss one concept, inspect its source and failure cases, record the owner's
decision, then update affected notes. Keep proposed, accepted, implemented and
measured status distinct. Later concepts can reopen earlier decisions; queued
topics and alternative hosts are not implicitly accepted.

## Existing implementation and evidence

Retain these documents as the initial candidate's contracts and comparison
baseline. Its pending implementation stages do not select the next engine slice.

| Document | Purpose |
| --- | --- |
| [DESIGN.md](./DESIGN.md), [MODULES.md](./MODULES.md), [IMPLEMENTATION.md](./IMPLEMENTATION.md) | Initial candidate lifecycle, module boundaries and construction sequence; behavioral obligations remain binding until explicitly revised |
| [VALIDATION.md](./VALIDATION.md) | Correctness, native comparison, concurrency and promotion gates |
| [APPLICATION.md](./APPLICATION.md) | Bounded standalone Application contract and remaining gaps |
| [PAYLOAD-CREATE.md](./PAYLOAD-CREATE.md), [PAYLOAD-CRUD.md](./PAYLOAD-CRUD.md) | Native Payload create/CRUD and atomic preference cleanup |
| [MEDUSA-PRODUCT.md](./MEDUSA-PRODUCT.md), [EQUALITY.md](./EQUALITY.md) | Native Product scalar flows and bounded indexed text-equality operations |
| [MIXED.md](./MIXED.md) | Actual Application, Product and Payload entry points under one accepting owner |
| [RESULTS.md](./RESULTS.md) | Initial connected measurements and batch/contention assessment |
| [READ-OBSERVATIONS.md](./READ-OBSERVATIONS.md), [OBSERVATION-COSTS.md](./OBSERVATION-COSTS.md), [COMBINED-OBSERVATIONS.md](./COMBINED-OBSERVATIONS.md) | Subsequent observation and preparation experiments |
| [BATCHED-NEW-IDS.md](./BATCHED-NEW-IDS.md) | Latest new-ID batching measurement and remaining limits |

The latest batching slice reduces 64-row insert exchanges **276→21** and
transactions **67→3**, with median latency **96.796→29.434 ms**. Mixed exchanges
fall **53→50**; Payload/Product counts remain **77/33**. Complete-request latency
has no overall win, same-scope tails regress and performance promotion stays
closed. These saved measurements do not establish shared-engine performance or
a matched comparison against Convex. Wider Application support, populated
Product relations and the active-core comparison remain unproved.

## Objective and boundaries

Improve complete Application, Payload, Medusa and mixed operations by changing
ownership and execution granularity. Preserve useful native services, workflows
and sound translation code. Existing integration behavior establishes requirements;
existing adapter interfaces and database coordination sequences need not survive.
Use the [reuse rules](./MODULES.md#framework-reuse-and-integration-replacement).

Modularity must make query execution, metadata policy, pending state, persistence
and commit coordination replaceable through small explicit contracts. It must
not add a transaction, database visit or independent finalizer per module.
TypeScript and Drizzle remain requirements. New engine mechanisms need explicit
decisions, connected correctness evidence and complete-request measurements.

Experimental database work uses explicitly owned disposable resources. Current
runtime packages, active Medusa work, existing schemas and named durable data
remain outside this lane. No production routing, data deletion or migration is
authorized. A successful experiment needs a separate connected cutover decision,
consumer migration and removal of displaced internals; coexistence here is for
evaluation, not a permanent fallback engine.

The [accepted design](../../design-notes/flarex-db-accepted-design.md) retains
production authority, execution-profile and host obligations. The
[performance roadmap](../../roadmaps/core-performance/README.md) links this lane.
The new discussion may propose changes, but does not silently override either.
