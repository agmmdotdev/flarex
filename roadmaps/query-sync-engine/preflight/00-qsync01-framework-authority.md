# QSYNC01-P Framework Authority Preflight

## Status

**Status:** complete, docs only.

This preflight changes architecture and roadmap authority only. It creates no
package, export, schema, table, route, Durable Object, binding, stream, client,
compatibility path, or production behavior.

## Admitted Product

Admit one independently testable **query-result synchronization engine**. It
coordinates authoritative server-query results for many isolated application
namespaces and trusted model adapters.

Do not call it a universal data-sync framework. Row replication, offline
writes, CRDTs, conflict resolution, arbitrary event history, and tenant-loaded
plugins are outside the admitted product.

## Authority Cut

- `roadmaps/query-sync-engine/` owns runtime-neutral engine semantics,
  conformance, and package direction.
- Roadmap 21 owns the Flarex Postgres/Cloudflare adapter composition, per-scope
  Durable Object, recovery scheduling, delivery adapter, and deferred caches.
- Postgres persistence retains commit/feed/snapshot/outbox authority.
- `flarex-protocol` retains concrete versioned Flarex contracts.
- Cloudflare and upstream Durable Streams remain replaceable adapters.
- The native relation roadmap remains a downstream consumer and cannot repair
  or copy engine logic.

Completed backend cursor/policy/actor work remains implementation evidence.
`SYNC01-GP` is superseded only as authorization to grow portable semantics and
query state directly in `flarex-backend`; `SYNC01-G` is not started and is held.

## Package Decision

Admit one future private package named `@flarex/query-sync`, created only by an
explicitly approved implementation slice.

Start with one kernel plus a deliberate testing/reference-model subpath. Do not
create contracts, engine, testing, Postgres, Cloudflare, and client packages in
advance of real independent owners.

The package may depend on Effect and exact dependency-leaf utilities. It must
not import Flarex protocol, persistence, backend, Cloudflare, Electric/Durable
Streams, database, network, client, or application-specific types.

## Runtime Decision

- Pure canonical values and transition policies use plain TypeScript and
  Effect v4 `Result` for recoverable value-level failures.
- Shared asynchronous capabilities may later be narrow Effect services.
- Namespace and Durable Object instances are scoped/plain multi-instance
  values created by the host, never global Context services.
- Layers own dependency/resource construction, not query registration,
  catch-up, rerun, writes, or delivery.
- Effect runners remain at real host callbacks.

## Producer And Consumer Cut

- A trusted producer integrates through a replayable transactionally
  correlated change source. A direct wake/push is only a hint.
- The host authenticates and binds one namespace; clients cannot author
  namespace authority, facts, dependency keys, source positions, model code,
  result hashes, or access fingerprints.
- Query execution is a trusted adapter outside state transactions.
- Client network connections and resume offsets belong to the delivery
  adapter, not the engine.

## Electric And Cloudflare Decision

- Do not adopt full Electric Sync as the default trusted server-query path; it
  is a separate Postgres row/Shape synchronization service and is not the
  strict Cloudflare-native engine requested here.
- Admit upstream Durable Streams only for a production-inert Cloudflare
  delivery-log feasibility spike.
- The spike must pass pinned conformance, multitenant auth, cache behavior,
  retention/rotation, payload, producer uncertainty, real lifecycle/cost, and
  client apply/checkpoint gates.
- Do not fork upstream to force acceptance. If it fails, retain the portable
  engine and replace only the publication/delivery adapter.

## Transaction Decision

Query state and an external stream append cannot be one transaction. Exact
generation installation must durably record publication intent. Delivery
retries the identical producer tuple and immutable persisted payload. An
upstream duplicate-sequence acknowledgement does not prove payload equality;
the adapter needs sufficient exact-publication evidence, initially by allowing
at most one unresolved append per stream or by explicit correlated read-back.
Transport offsets never replace the source sequence.

The query-result publication outbox is not authority to modify Flarex commit
compilation, journals, idempotency outcomes, application rows, commit/change
feed, or the existing application transaction outbox.

## No-Dual-Engine Decision

There will be no dual registry, table set, writer, delivery comparison path,
fallback, or caller split for one namespace. Current unshipped code is
migration evidence. A later cutover adapts/moves/deletes it after target-only
proof and a current-consumer audit.

## First Medium Slice

The first proposed implementation is `QSYNC01-A`: one pure transition kernel
and immutable deterministic reference model. Its completed docs-only
implementation preflight is
[`01-qsync01-portable-transition-kernel.md`](./01-qsync01-portable-transition-kernel.md).

It includes namespace/model/sequence/canonical-value contracts, generation and
invalidation decisions, authoritative snapshot-to-current refresh evidence,
one atomic value-level completion/activation, aggregate byte/work ceilings,
bounded typed failures, two synthetic models, and deterministic/property tests.

It excludes every adapter, async service, store, database, host, query runner,
publication mechanism, client API, and current-engine modification.

## Exit

This docs-only preflight is complete because the product cut, authority order,
package direction, runtime/lifecycle policy, producer/consumer trust boundary,
Electric/Cloudflare decision, transaction rule, no-dual-engine adoption, and
first bounded slice are recorded and cross-linked.

Implementation remains stopped until explicit approval for `QSYNC01-A`.
