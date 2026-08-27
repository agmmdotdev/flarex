# Runtime-Agnostic Query Sync Engine

## Status

Accepted architecture direction. Implementation is owned and gated by
[`roadmaps/query-sync-engine/`](../roadmaps/query-sync-engine/README.md).

This record replaces the assumption that portable query-sync semantics should
continue growing directly inside the Cloudflare-specific `DeploymentSyncDO`
store. It does not replace the concrete Flarex Postgres/Cloudflare topology;
that topology becomes the first adapter composition.

## Decision

Flarex will develop one small private `@flarex/query-sync` package as an
independently testable query-result synchronization engine.

The engine owns ordered source admission, namespace/model isolation, canonical
query and dependency state, active/provisional generations, dirty frontiers,
rerun and activation decisions, result-hash suppression, semantic durable-state
contracts, and publication-outbox semantics.

It does not own application data, Postgres commits, query execution,
Cloudflare lifecycle, network transport, client sessions, public SDKs, row
replication, offline writes, CRDTs, or a general event bus.

Flarex remains one consumer through adapters:

```text
Flarex Postgres commit feed
  -> Flarex fact/query model adapter
  -> @flarex/query-sync
  -> per-scope Cloudflare coordinator and SQLite state adapter
  -> accepted authenticated delivery adapter
       upstream Durable Streams is the current spike candidate
  -> Flarex client SDK adapter
```

## Electric Decision

The full Electric Sync engine is not the default Convex-style query path
because it is a separately deployed Postgres row/Shape synchronization service,
not a Cloudflare-native engine for arbitrary trusted Flarex server-query
results.

The open Durable Streams protocol, Cloudflare server, and client are accepted
for a production-inert feasibility spike as a replaceable outbound delivery
adapter. They may own stream persistence, resume offsets, SSE/long-poll, and
producer retry deduplication. They do not become source, query, generation,
authorization, or transactional authority.

The Cloudflare server implementation is currently young and lacks bounded
prefix retention. Its authenticated cache behavior, SSE duration cost,
payload ceilings, rotation/reset, producer uncertainty, and multitenant auth
must pass the explicit roadmap spike. Adoption must not require a private fork.

Electric Sync may later be offered as an explicit row-replication profile for
applications that intentionally choose that product contract.

## Package Cut

Start with one private package and one reference-model testing subpath. Do not
preemptively create separate contracts, engine, testing, Postgres, Cloudflare,
or client packages. Platform adapters remain with their existing owners until
a second legitimate owner proves a package split.

The portable package may depend on Effect and exact dependency-leaf utilities.
It must not import Flarex protocol, Postgres, Cloudflare, Electric, HTTP,
WebSocket, React, or application-specific types.

Pure policies use plain TypeScript and Effect v4 `Result`. Shared asynchronous
capabilities may later use narrow Effect services. Per-namespace and
per-Durable-Object instances remain scoped/plain multi-instance values, never
module-global Context services. Runtime bridges remain at real host callbacks.

## Authority And Recovery

The host authenticates and binds one namespace capability. Clients do not
author namespace authority, dependency keys, source positions, model code,
result hashes, or access fingerprints.

An authoritative producer integrates through a replayable transactionally
correlated change source. Pushes and wakes are latency hints, not recovery
authority.

External stream append cannot be atomic with engine state. Exact generation
installation records a durable publication outbox entry; a publisher retries
the identical producer identity and immutable persisted payload. Upstream
Durable Streams duplicate acknowledgement proves sequence admission, not
payload equality, so the adapter must serialize unresolved appends per stream
or establish exact correlated read-back before completion. Transport offsets
never replace the engine source sequence.

## Adoption Rule

The current production-inert backend policy, store, protocol, and Durable
Object are migration evidence. Do not run old and new engines, registries,
tables, or delivery paths in parallel. Completed cursor/actor work remains
valid evidence, while `SYNC01-GP`'s direct backend implementation authorization
is superseded and held until portable contracts, conformance, and a fresh
Cloudflare adapter preflight are accepted.

No public API, schema, route, production caller, compatibility fallback, or
relation implementation is authorized by this design record.

## Rejected Alternatives

- **Continue the backend-local engine and extract later:** rejected because the
  next slice would materially enlarge Cloudflare/Postgres coupling.
- **Adopt full Electric Sync invisibly:** rejected because row replication and
  trusted server-query-result synchronization have different authority and
  deployment models.
- **Build a universal sync framework:** rejected as an unbounded product claim;
  this engine is intentionally query-result sync.
- **Create many packages immediately:** rejected until real independent owners
  establish those boundaries.
- **Fork Durable Streams to close gaps:** rejected; keep delivery replaceable
  and stop the spike if upstream cannot satisfy required guarantees.
- **Expose a public mark-dirty/data-injection endpoint:** rejected because an
  untrusted push cannot prove transactional commit, ordering, or recovery.
