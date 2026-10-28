# Concept 01: engine ownership and lifetime

Status: **Accepted design boundary**: one independent app has one logical owner,
shared by Medusa/Payload/Application, with portable core and Cloudflare adapters
first. DO-local commit coordination, out-of-order saves with ordered normal
publication, and uncertainty recovery are accepted in the
[commit record](./01-commit-coordination.md). The
[timestamped-snapshot contract](./02-timestamped-snapshots.md) is accepted; routing,
fencing, numerical lifetime budgets and cache representation remain open. Replication is
explicitly deferred. No implementation.

The [placement companion](./01-do-execution-and-replicas.md) holds the broader
cache/hosting sketch and deferred replica example; it does not reopen accepted
commit decisions. [REFACTOR.md](./REFACTOR.md) owns the accepted
existing-core migration direction; [OPEN-QUESTIONS.md](./OPEN-QUESTIONS.md) owns
the unresolved queue. This card continues to own the accepted portable boundary.

## Question

The scope is one independent app, not a cart, shop label or framework. Its DO
hosts commit coordination in the initial Cloudflare design. How does that owner
maintain a coherent published view, and how does a replacement safely take over?

Example: two requests update the same Product while a third revokes access.
They may reach different runtime instances. All must use compatible versions,
observe the required authorization boundary and participate in one commit order.
If the current owner disappears during COMMIT, its replacement must resolve the
durable outcome before reexecution or acknowledging another incompatible result.

## Convex mechanism to inspect

The pinned [source map](../REFERENCES.md#engine-mechanism-reference-map) covers:

- `Database::load`: bootstrap metadata/index state at a persisted timestamp.
- `SnapshotManager`: bounded versioned snapshots shared across commands.
- `Committer::commit_has_conflict`, `write_to_persistence`, `publish_commit`:
  check committed/pending conflicts, persist, then publish the visible state.
- Postgres `Lease::transact`: fence writes by actual ownership in the accepting
  transaction; reacquiring ownership requires resynchronizing in-memory state.

This is evidence for coordinated ownership. It is not proof that all Convex data
is in RAM, that it uses no SQL checks, or that a Worker/DO implementation has the
same latency. Ordinary cache contents do not independently grant commit authority.

## Accepted portable core and adapter boundary

Build the engine independently of Cloudflare services and inject infrastructure
implementations at host composition. Cloudflare is the initial host family when
implementation passes the [goal's slice gates](./GOAL.md). This carries forward the accepted
[runtime boundary](../../../design-notes/flarex-db-accepted-design.md#hosted-runtime-topology)
and [package ownership](../../../roadmaps/16-package-boundaries.md#current-architecture);
it does not replace their current production topology or activate this experiment.

### Responsibility and dependency direction

| Responsibility | Portable or semantic owner | Initial infrastructure boundary |
| --- | --- | --- |
| Framework behavior | Medusa services, repositories and workflows; Payload lifecycle and hooks; Application execution profile | Framework bridges call admitted engine capabilities; exact execution placement remains open |
| Engine reads and state | Definitions, query/index semantics, pending changes, read dependencies, cache validity and visibility rules | Host creates bounded engine instances; no Cloudflare types or bindings in these contracts |
| Execution | Trusted invocation, authority, cancellation and outcome rules | Cloudflare invocation, service-binding transport and isolated user-code hosting |
| Coordination | App ownership, ordering, fencing, takeover and recovery requirements | App DO hosts coordination; routing/fencing mechanisms remain open and platform-specific |
| Persistence | PostgreSQL schemas, SQL/Drizzle operations, transactions, durable history and settlement | Host-supplied connection lifecycle through cache-disabled Hyperdrive; direct PostgreSQL/local drivers keep their separate gates |
| Change delivery | Committed ordering, replay eligibility, invalidation and freshness rules | Injected delivery/wake transport; a message or publication prefix cannot establish a business commit |

Host composition depends on the portable owners and supplies implementations of
their narrow contracts. Engine contracts must not import `cloudflare:workers`,
DO classes/stubs, Worker environment bindings, Hyperdrive or platform storage
types. Cloudflare APIs remain in adapters. SQL and Drizzle remain in their
PostgreSQL owner rather than leaking into framework bridges or pure engine code.
Cloudflare adapters translate platform behavior; they cannot add alternate
settlement, repair shared-owner defects or silently weaken a guarantee.

Keep these as distinct modules with actual responsibilities, not one giant core
or universal runtime/options object. Injection does not require making every
helper, map or index operation a service. Reuse or adapt sound existing owners
under the [experiment's dependency audit](../AGENTS.md#scope); do not import old
execution plumbing merely to preserve its sequence. Exact interfaces, package
placement and implementation reuse remain later decisions.

### Storage, authority and lifetimes

PostgreSQL alone owns committed application data, history and durable outcomes.
Cache memory, DO SQLite, temporary journals and artifact storage are distinct
roles; do not erase their guarantees behind a generic key/value storage contract.
Injecting persistence access does not authorize substituting DO SQLite or memory
for PostgreSQL. The durable accepting path must enforce the applicable fencing,
validation and atomic publication rules even if a host routes to one named owner.

The [commit record](./01-commit-coordination.md#accepted-order-and-visibility-contract)
distinguishes DO-side logical validation from PostgreSQL's atomic enforcement and
durable commit. Accepted, saved and published are different states; no separate
Worker committer is required. A saved later operation is not automatically visible.

Distinguish host/executor lifetime, shop or partition state, invocation/command
state, and physical database transaction/connection lifetime. Construct shared
capabilities at the host composition root with Effect services, Layers and Scope
where appropriate; use explicit instances or scoped factories for dynamic shop,
request and transaction state. No global Layer may accidentally hold a particular
shop's mutable state or a borrowed transaction. The owner bounds caches and
background work and drains or cancels owned work before releasing its resources.

Framework and user execution receive restricted capabilities, never raw platform,
database, commit or finalizer access. Preserve Application OCC, Payload request
semantics and Medusa service/workflow transaction, retry and compensation rules.
Sharing infrastructure does not select a universal transaction API, replay
arbitrary hooks, or hold SQL transactions across user code, workflow waits or
remote effects.

### Placement, communication and concurrency

A module boundary is not automatically a network boundary. Keep same-owner local
calls direct; use explicit bounded batch operations where a chosen placement
requires RPC. Account for authorization, cache misses, dependent reads, commit
and recovery calls in complete traces. Do not hide a round trip behind every
index lookup or promise a fixed two-call workflow before proving its read shape
and framework obligations.

Injection supplies portability, not parallel CPU execution or shared memory.
Each host must state its execution model, state lifetime, isolation, delivery,
eviction and resource limits. A single JavaScript execution thread still shares
CPU among the framework and engine operations placed there. Multiple executors
do not automatically share mutable indexes or coherent caches. Future Node,
Rivet or other hosts need explicit scheduling/state arrangements and conformance;
none is selected or implemented by this decision.

## Choices still open

The canonical queue is [OPEN-QUESTIONS.md](./OPEN-QUESTIONS.md). Q01/Q02 record
accepted app/commit decisions and their remaining protocols. Timestamped reads
and [operation-lifetime policy](./02-operation-lifetime.md) are accepted. Use the
[replacement workflow](./REFACTOR.md#convex-guided-replacement-workflow) to select
the questions required by a bounded slice; resumable index backfill remains Q07.
All relevant writers and stale-owner takeover still need a concrete protocol.
Replication is deferred; other topics stay queued. The requirements below
constrain these answers, rather than creating another independent question list.

## Alternatives to compare

These are retained comparisons. The selected initial coordinator placement is
the app DO; the whole framework/cache host design is not yet proved. The
resident-service option is a future portability comparison, not an approved host
switch, and the old PostgreSQL coordination path is baseline evidence.

| Option | Potential benefit | Obligations and tradeoffs |
| --- | --- | --- |
| Keep Postgres coordination with request-scoped roots and bounded prepared reuse | Smallest hosting change; existing failure model | Fresh coordination visits remain; adding cache alone cannot eliminate them |
| A named Cloudflare Durable Object owner per independent app, with Postgres persistence | Selected initial coordinator placement; shared memory while active | Memory eviction/restart, cold reconstruction, routing locality, extra hop, async interleaving, upgrades and Postgres fencing need proof |
| A resident TypeScript service near Postgres with scoped owners | Longer-lived engine state and close storage placement | Changes hosting target; operating, partitioning, takeover and scaling that service become explicit responsibilities |

The independent-app boundary is accepted; its concrete identity mapping and
cross-app operation policy remain open. Avoid one global owner for all apps or
separate owners merely for Medusa/Payload. Do not promise cross-owner atomicity.

## Requirements for an answer

- Define owner identity, routing, epoch/fence and the meaning of ownership loss.
- Account for every relevant writer: Application, Payload, Medusa, permissions,
  schema activation, index builders, maintenance, retention and repair.
- Define what state is immutable, transaction-local, shared/versioned and durable.
  Cached body validity and permission to disclose that body are separate questions.
- Follow the [authorization split](./02-read-authorization.md): application
  permission reads participate in the snapshot; authentication and engine-grant
  revocation remain separate. Preserve named fresh-revocation obligations until
  replacement enforcement is explicitly accepted and proved.
- Retain Postgres as the durable authority. The owner cannot publish success before
  persistence or use memory to resolve an uncertain database commit.
- Define restart/bootstrap and catch-up after lost ownership, including a crash
  after persistence succeeds but before caches and the caller receive publication.
- Bound memory, history retention, simultaneous roots and queued work. Cold-start
  and eviction costs count; memory need not contain every table or index.
- Keep user/native callbacks outside SQL transactions. Define how cancellation,
  late callbacks and async interleaving interact with the owner lifetime.
- State what each injected capability guarantees and which owner enforces it.
  Unsupported host behavior must fail closed, not redefine core semantics.

## Evidence required before implementation selection

Sketch the complete warm read, cache miss, write and takeover traces, identifying
which steps are local, RPCs or Postgres operations. Name the removed round trips
and why their guarantees still hold. Include a concurrent revocation and a stale
owner trying to commit; cache hit rate cannot prove either case safe.

The future connected proof must include old/new instances contending during
single-owner takeover, loss during acceptance, recovery after committed-but-unacknowledged
work, cold bootstrap and cache eviction. Use ordinary-role Postgres for fencing
and persistence claims. Keep existing business assertions and report warm/cold
latency, CPU, memory, contention and remaining storage visits separately.

Before an adapter is admitted, check dependency boundaries and run the applicable
shared contract cases against that host: cancellation and cleanup, isolation,
eviction/restart, duplicate or missing delivery, ownership loss and uncertain
outcomes. Portable model tests do not establish platform behavior. PostgreSQL
claims retain both PGlite and ordinary-role real PostgreSQL proof; hosting claims
also require the actual host. No such new proof is claimed by this documentation.

## Decision

Accepted: one independent app owner, shared framework coordination, portable
owners and Cloudflare adapters, PostgreSQL authority, and the
[commit/recovery decisions](./01-commit-coordination.md), with
[timestamped reads](./02-timestamped-snapshots.md). This is design only.

Unresolved: numerical lifetime budgets, concrete identity/routing/fencing, cache/history
representation, native hosting/replay eligibility and resource limits. These
remain in the canonical queue. Replication is open and explicitly deferred;
single-owner recovery does not wait for a replica design. Related concepts
refine these contracts without baking Cloudflare mechanisms into the core.
