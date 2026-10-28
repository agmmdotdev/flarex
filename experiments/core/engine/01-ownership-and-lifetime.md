# Concept 01: engine ownership and lifetime

Status: portable core with injected capabilities and Cloudflare adapters first
is **Accepted** design direction. Ownership topology, partition key, routing,
cache placement and lease protocol remain **Open**. This card authorizes no
engine or adapter implementation.

Current candidate: [DO-local execution and OCC replicas](./01-do-execution-and-replicas.md),
recorded as **Proposed** for further discussion. That companion owns the concrete
placement, cart example and tradeoffs. [REFACTOR.md](./REFACTOR.md) owns the accepted
existing-core migration direction; [OPEN-QUESTIONS.md](./OPEN-QUESTIONS.md) owns
the unresolved queue. This card continues to own the accepted portable boundary.

## Question

Who maintains coherent engine state between commands, over which data scope,
and how does another instance safely take over? Where should that owner run?

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
implementation is separately approved. This carries forward the accepted
[runtime boundary](../../../design-notes/flarex-db-accepted-design.md#hosted-runtime-topology)
and [package ownership](../../../roadmaps/16-package-boundaries.md#current-architecture);
it does not replace their current production topology or activate this experiment.

### Responsibility and dependency direction

| Responsibility | Portable or semantic owner | Initial infrastructure boundary |
| --- | --- | --- |
| Framework behavior | Medusa services, repositories and workflows; Payload lifecycle and hooks; Application execution profile | Framework bridges call admitted engine capabilities; exact execution placement remains open |
| Engine reads and state | Definitions, query/index semantics, pending changes, read dependencies, cache validity and visibility rules | Host creates bounded engine instances; no Cloudflare types or bindings in these contracts |
| Execution | Trusted invocation, authority, cancellation and outcome rules | Cloudflare invocation, service-binding transport and isolated user-code hosting |
| Coordination | Ownership, ordering, fencing, takeover and recovery requirements | Cloudflare routing, owner addressing and wake mechanisms; DO role and scope remain open |
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

The canonical queue is [OPEN-QUESTIONS.md](./OPEN-QUESTIONS.md). Q01 scope/routing
and Q02 validation/order/recovery are active together under this concept. Their
answer must account for all relevant writers and stale-owner takeover before
later cache, framework and hosting choices can be finalized. Other questions
stay queued. The requirements and counterexamples below constrain this concept's
answer; they are not a second list of independently tracked open work.

## Alternatives to compare

These remain alternatives for comparison. DO-local execution is now the current
discussion candidate, not an accepted topology. The initial adapter family is
Cloudflare; the resident-service option is a future portability comparison, not
an approved host switch.

| Option | Potential benefit | Obligations and tradeoffs |
| --- | --- | --- |
| Keep Postgres coordination with request-scoped roots and bounded prepared reuse | Smallest hosting change; existing failure model | Fresh coordination visits remain; adding cache alone cannot eliminate them |
| A named Cloudflare Durable Object owner per chosen scope/partition, with Postgres persistence | Routes related requests to an explicit owner; shared memory while active | Memory eviction/restart, cold reconstruction, routing locality, extra hop, async interleaving, upgrades and Postgres fencing need proof |
| A resident TypeScript service near Postgres with scoped owners | Longer-lived engine state and close storage placement | Changes hosting target; operating, partitioning, takeover and scaling that service become explicit responsibilities |

The scope/partition decision is independent of selecting the host. Avoid one
global owner for all tenants by accident. Do not promise cross-owner atomicity:
state the same-owner/same-placement atomic boundary and disposition of commands
that span it. Framework identity alone must not create separate commit owners.

## Requirements for an answer

- Define owner identity, routing, epoch/fence and the meaning of ownership loss.
- Account for every relevant writer: Application, Payload, Medusa, permissions,
  schema activation, index builders, maintenance, retention and repair.
- Define what state is immutable, transaction-local, shared/versioned and durable.
  Cached body validity and permission to disclose that body are separate questions.
- Preserve the existing fresh revocation contract until a replacement is explicitly
  accepted and proved. Authorization is not automatically snapshot-only.
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

The future connected proof must include two instances/owners contending for
ownership, loss during acceptance, recovery after committed-but-unacknowledged
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

Accepted: portable framework/engine owners, narrow injected infrastructure
capabilities and Cloudflare adapters first, with PostgreSQL durable authority.
This acceptance records boundaries only and authorizes no implementation.

Unresolved: ownership scope/lifetime, concrete Cloudflare topology and the other
open choices above. The [current DO proposal](./01-do-execution-and-replicas.md)
records the direction to examine without implementing or accepting its protocols.
Related concepts 02, 04, 05, 06 and 08 must refine authority,
cache validity, recovery and scheduling without baking platform services into
the core or treating the earlier scaling sketches as accepted protocols.
