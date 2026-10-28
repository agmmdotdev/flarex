# Flarex core refactor and experiments

Start with the [portable core refactor discussion](./engine/README.md) and
[accepted migration direction](./engine/REFACTOR.md). Refactor the existing core,
reuse the Medusa/Payload integration investment, allow necessary internal breaks
and inspect Convex for each relevant mechanism. This folder is the design/proof
area. Work one concept at a time from the [open-question queue](./engine/OPEN-QUESTIONS.md);
ownership and commit coordination are active. Current work is documentation only.

## Current state

| Area | Status |
| --- | --- |
| Existing core and Medusa/Payload integrations | Starting point and eventual refactor destination; current behavior remains until a selected connected replacement |
| Initial experimental candidate | Bounded Application, Payload CRUD, Product scalar and explicitly atomic mixed flows implemented and measured with Drizzle; performance promotion remains closed |
| Shared engine direction | Existing-core refactor, integration reuse, necessary breaking changes and portable Cloudflare adapters first accepted; DO topology/cache/replica protocols remain proposed and open |

The existing candidate already keeps pending writes, observations and some
prepared state in memory. It does not implement Convex's complete shared
snapshot, metadata, index/cache and conflict-history machinery. Revisit those
owners and their database interactions without assuming that a TypeScript port
or an in-memory cache automatically provides Convex's performance.

The [current DO proposal](./engine/01-do-execution-and-replicas.md) uses the useful
ownership, pending-state and dependency ideas from this experiment while reusing
existing native integrations. Their internal APIs, SQL segmentation, schemas and
lifetimes are redesignable; the [keep/adapt/replace map](./engine/REFACTOR.md#keep-adapt-replace-and-add)
separates real obligations from replaceable implementation. No code changes follow
from this documentation, and a permanent second framework/engine stack is not the plan.

This folder remains outside `packages/*` and `apps/*` workspace membership.
It is a proof area, not a production package or permanent alternative engine.

## Current discussion

1. [AGENTS.md](./AGENTS.md): scope, isolation and iteration rules.
2. [Engine discussion](./engine/README.md): direction, continuing obligations and modular responsibilities.
3. [Refactor direction](./engine/REFACTOR.md): keep/adapt/replace, breaking changes, integration seams and cleanup.
4. [Decision register](./engine/DECISIONS.md): accepted/proposed status and the one active concept.
5. [Open questions](./engine/OPEN-QUESTIONS.md): canonical queue, primary references and required decision evidence.
6. [Concept 01](./engine/01-ownership-and-lifetime.md): portable core/adapters, ownership and lifetime.
7. [DO execution and replica proposal](./engine/01-do-execution-and-replicas.md): local SQLite caches, OCC cart example and tradeoffs; discussion only.
8. [REFERENCES.md](./REFERENCES.md): pinned Convex mechanisms, platform constraints and Flarex evidence.

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

Saved results remain in their evidence documents rather than being copied into
the new direction as performance claims. The initial candidate missed complete
performance acceptance; fewer exchanges did not establish a complete-request
win. No shared-engine or matched Convex performance result is established.

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

Any later experimental database work uses explicitly owned disposable resources.
This documentation task leaves runtime packages, ongoing integration, schemas and
data untouched. Future selected replacements target their actual existing owners
and include connected consumer migration, verification and retirement. Keeping
an old layout is optional; resetting actual data requires an explicit disposition.
No production routing, data deletion or implementation is authorized now.

The [accepted design](../../design-notes/flarex-db-accepted-design.md) retains
production authority, execution-profile and host obligations. The
[performance roadmap](../../roadmaps/core-performance/README.md) links this lane.
The new discussion may propose changes, but does not silently override either.
