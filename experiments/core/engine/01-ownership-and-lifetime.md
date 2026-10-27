# Concept 01: engine ownership and lifetime

Status: **Open**. No host, partition key, routing scheme or lease protocol chosen.
This is the first discussion card, not authorization to implement an engine host.

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

## Alternatives to compare

These are candidates, not ranked recommendations.

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

## Decision

Unresolved. Discuss ownership scope and lifetime first, then compare feasible
hosts against that contract. No option above has been selected. Related concepts
02 and 06 must refine authority and recovery without silently changing this choice.
