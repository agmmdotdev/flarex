# Product, Authority, And Package Boundary

## Product Contract

The Flarex Query Sync Engine is an independently testable server-side framework
that turns an authoritative ordered change source plus trusted query evaluation
into current query-result publications.

It serves applications with different data models through model adapters. The
engine does not inspect Flarex rows, tables, relations, Postgres WAL records, or
application code. A trusted adapter canonicalizes each model's queries,
committed facts, dependency keys, results, and authority evidence.

The first consumer is Flarex, but neither Cloudflare nor FlarexDB is embedded in
the portable package. The Cloudflare composition is a host adapter, and the
Postgres commit feed is one change-source adapter.

## Deliberate Non-Goals

The engine does not initially provide:

- arbitrary row replication or an Electric Shape equivalent;
- client-authored/offline writes;
- conflict resolution, CRDTs, or peer-to-peer synchronization;
- a general durable event bus or lossless application event history;
- arbitrary tenant-supplied code running inside the engine;
- a database, query planner, or SQL incremental-view engine;
- WebSocket, SSE, HTTP, Durable Streams, or client reconnection protocols; or
- public Flarex SDK syntax.

The initial delivery contract is **latest authoritative query state**. The
engine may coalesce obsolete rerun work, but it must never skip the latest dirty
frontier or publish a stale generation. A future lossless-event profile would
be a different contract and must not be implied by this package.

## Vocabulary

| Term | Meaning |
| --- | --- |
| tenant | Control-plane customer or billing owner. It is not a data-plane key that an untrusted caller may choose. |
| application | A deployed product/model owner. One tenant may own several applications. |
| sync namespace | The concrete isolated ordering and state authority processed by one engine instance. The host authenticates and binds it. |
| sync model | A trusted, statically admitted version of query, change, dependency, result, and authority semantics. |
| source epoch | A replacement boundary for one namespace's ordered change history. |
| source sequence | An exact, monotonic, precision-safe position inside one source epoch. |
| canonical query identity | Complete bounded model-owned query and authorization evidence used for sharing and collision checks. |
| canonical query key | Deterministic lookup key for a complete canonical identity; never identity or authorization authority by itself. |
| dependency key | Bounded canonical model-owned invalidation key. The engine compares keys; it does not interpret their contents. |
| generation | Fenced candidate evaluation for one canonical query. Active and provisional generations may coexist. |
| dirty frontier | Highest admitted source sequence requiring the active query to be refreshed. |
| publication | Idempotently identified current-result transition sent to an external delivery log after durable state acceptance. |
| delivery offset | Transport-owned position used by a client to resume a stream. It is not the source sequence. |

Use plain unversioned names for these current domain concepts. Add a suffix only
when a concrete wire, persisted, or codec contract must coexist or be decoded
exactly.

## Namespace Authority And Isolation

An operation must not accept a free-form tenant, application, deployment, or
scope ID and treat that value as authority.

The host authenticates the caller, resolves one sync namespace, selects one
admitted sync model, and constructs a namespace-bound engine instance with
namespace-bound capabilities. Normal engine operations then omit caller-chosen
scope authority.

The host must prove one of these physical boundaries:

- one durable state instance per namespace; or
- a shared store whose every key, unique constraint, transaction predicate,
  quota, and read result is namespace-bound and revalidated.

Canonical queries may be shared only when namespace, source epoch, sync model,
and the complete canonical query identity all match. That identity must include
the model-owned effective authorization/access evidence. Equal query text or an
equal digest is insufficient.

Clients never submit trusted dependency keys, source positions, result hashes,
model code, namespace capabilities, or the authorization/access component of a
canonical identity.

## Two API Planes

### Trusted system plane

The application or database side supplies:

- a replayable `ChangeSource` for one bound namespace;
- an optional wake that means only "new work may exist";
- a trusted model adapter that converts admitted committed facts into bounded
  canonical dependency keys;
- a `QueryEvaluator` that returns one coherent snapshot, result, result digest,
  dependency set, and authority witness; and
- a durable state and publication composition.

A direct producer notification is never sufficient recovery authority. The
application may commit data and crash before notifying the engine. The source
must therefore be replayable from a transactionally correlated feed/outbox.
Best-effort pushes are not admitted under the authoritative query-state
contract; any future degraded profile needs a different explicit product name
and preflight. Flarex uses its existing transactionally correlated commit feed.

### Consumer plane

The consumer side is host-mediated:

1. the gateway authenticates the user and binds the namespace;
2. a Flarex/model adapter canonicalizes the requested server query together
   with its effective authorization/access evidence into one complete identity;
3. the engine begins or attaches to the matching canonical query lifecycle;
4. the gateway returns only an authorized delivery target/capability; and
5. the client consumes that target through the delivery protocol.

The generic engine does not accept browser connections and does not expose a
network endpoint. The Flarex SDK may later wrap `@durable-streams/client`, but
that transport is not an engine dependency.

This is a deliberate reuse boundary, not a missing half of the framework. The
framework owns the trusted registration/publication contract needed by any host
and can be developed independently with an in-memory delivery adapter. It does
not create another portable reconnect/client engine when the selected upstream
protocol already supplies one. If a later non-Durable-Streams host proves a
stable client-state abstraction that upstream cannot provide, that is a new
package preflight backed by the second real owner.

## Package Boundary

`QSYNC01-A/B` created and extended one private package. Its current boundary is:

```text
packages/query-sync/
  package.json
  src/
    kernel/
      CanonicalValue.ts
      Errors.ts
      Model.ts
      Policy.ts
      index.ts
    change/
      Admission.ts
      Errors.ts
      Model.ts
      index.ts
    state/
      Errors.ts
      Port.ts
      Receipts.ts
      index.ts
    testing/
      ReferenceModel.ts
      conformance/
      index.ts
  test/
```

The package name is `@flarex/query-sync`. The permanent product name does not
need `core` or a version suffix. The package has no root public SDK export. Its
current explicit subpaths are `./internal/kernel`, `./internal/change`,
`./internal/state`, `./testing/conformance`, and
`./testing/reference-model`. The completed C3/C4 slices add the separately
reviewed private `./internal/orchestration` subpath; there is still no package
root or public SDK export.

The package owns:

- runtime-neutral model and transition semantics;
- pure canonical-value capture and boundedness rules;
- typed domain failures;
- later narrow Effect service contracts for shared asynchronous capabilities;
- semantic durable-state operations; and
- deterministic reference/conformance behavior.

Existing owners retain:

| Owner | Retained responsibility |
| --- | --- |
| `flarex-protocol` | Flarex-specific versioned scope/query/dependency/publication frames and codecs |
| `@flarex/persistence-postgres` | commit facts, epochs, retained floors, snapshots, Postgres source and outbox adapters |
| `flarex-backend` | Durable Object construction, object-local SQLite, service bindings, auth gateway, alarms/wakes, runtime bridges, publication composition |
| `flarex` | developer/client API and eventual Durable Streams client wrapper |
| upstream Durable Streams | stream append/read protocol, opaque delivery offsets, SSE/long-poll delivery, producer retry deduplication |

Do not create `query-sync-contracts`, `query-sync-testing`,
`query-sync-cloudflare`, `query-sync-postgres`, or `query-sync-client` packages
until a concrete independent owner justifies each split. Adapters remain with
their existing platform/domain owner initially.

## Model Admission

The portable engine should consume a statically trusted `SyncModel` selected by
an admitted model ID. The model adapter owns:

- canonical query construction;
- committed-fact decoding and invalidation projection;
- dependency canonicalization and comparison;
- result encoding/digest construction;
- authority-witness validation; and
- compatibility between a query generation and a source epoch/model version.

The authority witness is an opaque, bounded model-owned digest over mutable
result-authorizing state that is not already immutable in the complete query
identity, such as an active schema/head or policy revision. It is captured with
the evaluation and re-derived for the exact refreshed-through source cursor.
The engine compares those two canonical witnesses during atomic completion; a
mismatch requires resnapshot. Every authority change capable of changing a
result must either change the complete query identity, epoch/model ID, or
advance the replayable source cursor and therefore change the witness. An
out-of-band mutable authority that can change without one of those fences is
not an admissible model adapter.

Do not execute dynamically uploaded tenant plugins inside the engine. A model
implementation is trusted platform code, even when it interprets opaque
application-specific canonical values.

Avoid making the entire engine generic over every application's TypeScript row
types. Durable and wire boundaries need bounded canonical values plus a model
identity; the trusted model adapter owns typed decoding on either side.

## Host-Facing API Shape

The names below describe responsibilities, not frozen TypeScript exports:

```text
QuerySyncEngineFactory.open(namespaceCapability, adapters)
  -> NamespaceQuerySync

NamespaceQuerySync.catchUp(sourceHint?)
NamespaceQuerySync.beginQuery(trustedQuery)
NamespaceQuerySync.completeEvaluation(evidence)
NamespaceQuerySync.runDirtyWork(budget)
NamespaceQuerySync.releaseQuery(lease)
NamespaceQuerySync.recover(budget)
```

The factory may eventually be an application-scoped Effect service. The
returned namespace coordinator is a scoped/plain multi-instance value, because
many namespaces and Durable Objects coexist. It must not be a singleton Context
tag.

## Extraction Standard

The framework is independently developable when:

- its package has no platform/database/application imports;
- an immutable reference model executes all semantic transitions;
- synthetic models with unrelated data shapes pass the same contract;
- host adapters implement semantic operations instead of exposing driver CRUD;
- Cloudflare and a later second durable host pass the same conformance suite;
  and
- Flarex can replace an adapter without changing engine semantics.

An in-memory reference model proves determinism, not durable runtime
portability. Do not claim production runtime agnosticism until a second real
durable host/store passes the contract.
