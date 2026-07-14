# Cloudflare Convex Runtime Direction

Status: accepted `flarexdb_v1` target. The repository also contains two
unshipped prototype architectures that are replacement inputs and regression
evidence, not future design authority.

Flarex preserves Convex's developer mental model and portable core behavior
while adapting runtime placement to Cloudflare. The target is not a generic
CRUD API and not a new partition-oriented developer model. Developers write
ordinary TypeScript modules and use Convex-style generated APIs; Flarex owns the
managed execution artifact, trusted transaction boundary, and deployment
topology.

## Accepted Runtime And Data Topology

```text
existing Flarex / Convex-style client APIs
  -> public Cloudflare backend Worker
  -> Flarex-managed Dynamic Worker user-code runtime
  -> restricted logical syscall boundary
  -> private trusted executor Worker
  -> cache-disabled Hyperdrive connection transport
  -> authoritative Postgres / FlarexDB
       exact snapshots, OCC, revision history, outcomes, commit/change feed
  -> deterministic Cloudflare coordination
       DeploymentSyncDO, ConnectionDO, delivery workers, optional caches
```

Postgres is the only authoritative committed app-data store. Cloudflare owns
sandboxed execution, service bindings, WebSockets, and explicitly
non-authoritative coordination or cache state. Durable Object SQLite may keep
rebuildable cursors, query/dependency indexes, connection state, and bounded
continuations; it does not own the only copy of committed app data.

The trusted executor pins execution to a
`SnapshotToken { scopeId, epoch, commitSeq }`, records explicit read
dependencies, stages logical writes, validates OCC in a short database
transaction, publishes versioned rows and tombstones, preserves idempotent
outcomes, and emits ordered commit/change information. Untrusted user code
never receives SQL, Postgres, Hyperdrive, Drizzle, or raw Durable Object
bindings.

## Design Lineage

| Iteration | Role now | Shipped state |
| --- | --- | --- |
| `PartitionDO` with Durable Object SQLite | First app-data prototype; retain only useful intended semantics and regression tests while replacing its physical/runtime authority. | Not shipped. |
| Initial Postgres `legacy_v1` | Second prototype; useful evidence for syscalls, persistence, host adapters, and failure cases, but its wall-clock transaction model and broad schema are not the target. | Not shipped. |
| Postgres-authoritative `flarexdb_v1` | Accepted first intended shippable storage generation and runtime direction. | Partially implemented; not active. |

No implemented Cloudflare D1 app-data path was found. Historical roadmap labels
such as `D1` are gate identifiers, not evidence of a third authoritative store.

Because neither prototype was shipped, the default is a clean internal
replacement: build the target behind a trusted generation fence, port the
still-intended semantics and tests, activate clean scopes, switch internal
callers, and remove prototype routes, bindings, tables, and pre-release
migration-history layers. Backfill, dual reads/writes, comparison, canaries, or
runtime rollback are introduced only when concrete shipped-state evidence proves
an obligation.

## Developer Compatibility Direction

Flarex inspects Convex first for schema and validators, function registration,
generated APIs, query/mutation/action behavior, explicit read dependencies,
OCC, sync and subscriptions, scheduling, analysis, deployment, local dev,
codegen, and testing. It ports portable behavior closely and records each
necessary Cloudflare or Postgres divergence. Cloudflare placement differences
must not weaken the Convex transaction mental model or leak internal partition
concepts into ordinary application code.

## Sources Of Truth

Use these records in order:

1. [Accepted FlarexDB design](./design-notes/flarex-db-accepted-design.md) for
   architecture, trust boundaries, and replacement rules.
2. [Commerce/CMS v1 schema cutline](./design-notes/flarex-commerce-cms-v1-schema-cutline.md)
   for the minimal logical inventory and explicit deferrals.
3. [FlarexDB foundation roadmap](./roadmaps/flarexdb-foundation/README.md) for
   active implementation order and proof gates.
4. [Postgres executor roadmap](./roadmaps/20-postgres-executor.md) and
   [sync/freshness roadmap](./roadmaps/21-cloudflare-freshness-cache.md) for
   durable domain direction.
5. Current code, schemas, and tests for exact implemented behavior and
   regression evidence.

The files under [docs/](./docs/) describe the first prototype-era architecture.
They are retained for provenance and must not be treated as active target design
or implementation order.
