# Cloudflare Convex Runtime Vision

This directory describes a Cloudflare-native application platform that preserves
the strongest parts of Convex's developer experience while adapting transaction
semantics to Cloudflare's distributed runtime.

The target is not a new client API. The target is a backend that existing
Convex-style generated code and clients can talk to with minimal or no changes:

- `defineSchema`, `defineTable`, validators, and generated server/client files
- `query`, `mutation`, `action`, `httpAction`, and internal variants
- HTTP endpoints such as `/query`, `/mutation`, `/action`, `/query_batch`
- WebSocket sync endpoints such as `/sync` and `/{client_version}/sync`
- sync protocol behavior: query set updates, transitions, mutation responses,
  action responses, auth changes, reconnect behavior
- atomic deterministic mutations inside one declared data partition
- durable cross-partition workflow mutations
- live reactive queries
- side-effect separation

The backend internals are different because Cloudflare is different:

```txt
Existing Convex client APIs
  -> Cloudflare Worker gateway
  -> WebSocket/session Durable Objects
  -> Cloudflare Application API implementation
  -> Dynamic Worker user-code runtime
  -> trusted ctx syscall coordinator
  -> partition Durable Objects with SQLite
  -> projections and cross-partition Cloudflare Workflows
```

## Current Primary Direction

The current primary design is the partitioned Durable Object model:

- authoritative data is colocated into explicit transaction partitions
- one partition Durable Object provides atomic SQLite transactions
- `mutation` is always atomic and restricted to one partition
- `workflowMutation` allows cross-partition work through one automatically
  generated Cloudflare Workflow
- workflow operations are grouped into one atomic step per affected partition
- `defineProjection` maintains reactive derived read models across partitions
- projections are readable by queries but forbidden in authoritative mutations
- generated types catch common cross-partition mistakes before runtime

The earlier Postgres/global-OCC design remains documented as an alternative for
full Convex transaction compatibility. It is not the current primary
Cloudflare-native implementation direction.

## Domain Documents

- [Compatibility Goals](./docs/01-compatibility-goals.md)
- [HTTP And Sync Protocol](./docs/02-http-and-sync-protocol.md)
- [Dynamic Worker Runtime](./docs/03-dynamic-worker-runtime.md)
- [Transaction And OCC Engine](./docs/04-transaction-and-occ-engine.md)
- [Postgres Storage Model](./docs/05-postgres-storage-model.md)
- [Subscriptions And Sync Engine](./docs/06-subscriptions-and-sync-engine.md)
- [Actions, Scheduling, Auth, And Storage](./docs/07-actions-scheduling-auth-storage.md)
- [Implementation Roadmap](./docs/08-implementation-roadmap.md)
- [Partitioned Data Model](./docs/09-partitioned-data-model.md)
- [Developer API And Type Safety](./docs/10-developer-api-and-type-safety.md)
- [Projections And Consistency](./docs/11-projections-and-consistency.md)
- [Cross-Partition Workflow Mutations](./docs/12-cross-partition-workflow-mutations.md)
- [Application Examples](./docs/13-application-examples.md)

## Non Goals

- Do not use one Durable Object per document as the default source of truth.
- Do not silently turn `mutation` into a non-atomic workflow.
- Do not expose Postgres connections to user code.
- Do not expose projections as authoritative mutation data.
- Do not fork the npm client or generated TypeScript APIs until a real
  incompatibility forces it.

## Current Design Principle

Preserve the public contract first. Rebuild the internals behind the same
contract:

```txt
same client DX
same sync protocol shape
same query/mutation/action model
atomic mutations inside one partition
explicit durable workflows across partitions
```
