# Postgres Executor

## Status And Scope

Status: active replacement domain with an implemented compatibility baseline
and a partially implemented `flarexdb_v1` foundation.

This roadmap owns the durable direction for:

- the framework-neutral trusted executor in `@flarex/executor`;
- authoritative Postgres persistence in `@flarex/persistence-postgres`;
- the private Cloudflare executor Worker and its request-scoped Hyperdrive
  adapter;
- the stable internal Fetch boundary used to prepare, start, service, finish,
  abort, and maintain execution sessions; and
- the compatibility role of the HTTP and Nitro adapters while the hosted Worker
  reaches parity.

This roadmap does not own:

- execution-artifact analysis or sandbox implementation;
- public SDK and code-generation behavior;
- live-sync, WebSocket, or freshness-cache architecture;
- the detailed journal and commit-compiler protocol;
- Payload feature parity or Medusa repository/workflow semantics; or
- turn-by-turn implementation history.

Those concerns remain in their linked domain roadmaps and accepted design
notes. Git owns the historical checkpoint record previously accumulated here.

## Current Sources Of Truth

Use these sources in order:

1. [`../design-notes/flarex-db-accepted-design.md`](../design-notes/flarex-db-accepted-design.md)
   owns the accepted Postgres authority, hosted topology, trust boundaries,
   storage-generation migration, snapshot, and commit rules.
2. [`../design-notes/flarex-commerce-cms-v1-schema-cutline.md`](../design-notes/flarex-commerce-cms-v1-schema-cutline.md)
   owns the minimum v1 inventory and explicit deferrals, not verbatim physical
   DDL.
3. [`flarexdb-foundation/README.md`](./flarexdb-foundation/README.md) owns the
   active low-level slice order and current completion status.
4. The focused foundation plans own executable detail:
   [`01-schema-and-migrations.md`](./flarexdb-foundation/01-schema-and-migrations.md),
   [`02-occ-and-transactions.md`](./flarexdb-foundation/02-occ-and-transactions.md),
   and [`03-commit-compiler.md`](./flarexdb-foundation/03-commit-compiler.md).
5. [`../design-notes/flarex-internal-db-schema.md`](../design-notes/flarex-internal-db-schema.md)
   is a long-form physical-policy inventory and risk register. Its unresolved
   sketches are not accepted merely because they are documented.
6. Current code and decisive tests prove what is implemented:
   - [`packages/executor/src/index.ts`](../packages/executor/src/index.ts)
   - [`packages/persistence-postgres/src/schema.ts`](../packages/persistence-postgres/src/schema.ts)
   - [`packages/persistence-postgres/src/index.ts`](../packages/persistence-postgres/src/index.ts)
   - [`packages/persistence-postgres/src/postgresClient.ts`](../packages/persistence-postgres/src/postgresClient.ts)
   - [`apps/executor/src/worker.ts`](../apps/executor/src/worker.ts)
   - [`apps/executor/src/requestLifecycle.ts`](../apps/executor/src/requestLifecycle.ts)
   - [`packages/executor/test`](../packages/executor/test)
   - [`packages/persistence-postgres/test`](../packages/persistence-postgres/test)
   - [`apps/executor/test`](../apps/executor/test)

Adjacent domain authorities are:

- [`21-cloudflare-freshness-cache.md`](./21-cloudflare-freshness-cache.md) for
  sync, delivery, and non-authoritative cache state;
- [`35-commit-compiler-and-session-intent.md`](./35-commit-compiler-and-session-intent.md)
  for logical session intent and trusted lowering;
- [`13-convex-first-system-porting.md`](./13-convex-first-system-porting.md) for
  cross-system Convex compatibility; and
- [`16-package-boundaries.md`](./16-package-boundaries.md) for repository-wide
  package placement.

## Current Architecture

### Two storage generations coexist

The repository intentionally contains two generations:

| Generation | Current truth |
| --- | --- |
| `legacy_v1` | The working executor path. `createFlarexExecutor` currently installs only `createLegacyV1AppDataEngine`, backed by the existing `documents`, `indexes`, invoke-session, commit, outbox, freshness, subscription, and delivery tables. It remains the compatibility oracle. |
| `flarexdb_v1` | The accepted replacement. Scope authority, the scope clock, stable schema catalogs, immutable schema artifacts, physical index definitions, fenced index-build reads, and preparation primitives exist, but replacement app-row storage, exact-snapshot OCC, the commit compiler, and production routing are not yet complete. |

The existence of replacement catalog tables does not mean the replacement data
path is active. The executor must not route a request into `flarexdb_v1` until
the declared generation, hosted, OCC, and migration gates pass.

### Hosted topology

The accepted production topology is:

```text
public backend Worker
  -> artifact-runtime Worker
  -> generated Dynamic Worker shell around untrusted developer modules
  -> private FLAREX_EXECUTOR service binding
  -> trusted executor Worker
  -> request-scoped pg.Client
  -> cache-disabled Hyperdrive
  -> authoritative Postgres
```

The earlier plan to make Nitro/Vercel the primary production executor is
superseded. `@flarex/executor-nitro` remains a compatibility adapter; it is not
the target authority or the place for transaction logic.

The private Worker:

- requires an internal bearer capability before allocating a database client;
- requires the cache-disabled Hyperdrive binding;
- creates and connects one client per request;
- composes the same framework-neutral executor and persistence core used by
  local and compatibility hosts; and
- attempts `client.end()` in `finally`, without allowing a cleanup failure to
  replace the primary request failure.

No client or pool belongs in Worker module scope. Node control-plane tools may
continue using a pool for migrations and bounded operator work; PGlite remains
the in-process development and fast-test adapter.

### Execution and transaction boundary

The stable first transport remains the internal `/invoke/*` Fetch protocol:

```text
prepare
  -> start a trusted session anchor
  -> execute developer code outside a database transaction
  -> service restricted syscalls and record dependencies/intent
  -> finish through trusted OCC and commit logic
  -> or abort/expire the session
```

Untrusted developer code never receives SQL, Drizzle, Hyperdrive, a Postgres
client, a persistence object, a physical locator, or a transaction handle. A
service-binding request is an internal capability call, not a public executor
URL and not transaction authority by itself.

Postgres/PGlite transaction adapters own `BEGIN`, `COMMIT`, and rollback. The
executor must never hold a database transaction open while waiting for
untrusted developer code or a remote execution artifact.

### Replacement control foundation

The implemented `flarexdb_v1` control foundation currently includes:

- trusted scope metadata and shared/split physical placement records;
- a per-scope clock with epoch, storage generation, generation fence,
  `last_commit_seq`, and `last_outbox_seq`;
- stable deployment-scoped table and logical-index identities;
- immutable canonical schema-version artifacts;
- separate immutable physical index-definition identities and schema-version
  bindings;
- fenced per-scope physical index-build state reads; and
- authenticated, package-internal preparation/application tokens that keep
  canonicalization and Web Crypto outside the short SQL lock.

The normalized catalog is derived from one canonical manifest. Stable identity,
immutable definition, physical build, and mutable readiness are separate
concepts; none may silently become a competing schema authority.

## Invariants And Trust Boundaries

1. **Postgres is the only authoritative committed app-data store.** Cloudflare
   owns execution, bindings, sockets, coordination, and explicitly
   non-authoritative cache state.
2. **The trusted server derives scope.** User code and mutation journals cannot
   choose `scope_id`, physical placement, storage generation, table names,
   lock targets, index rows, change atoms, or system outbox rows.
3. **Exactly one storage generation is authoritative per scope.** The scope
   clock pins generation and fence; a fence change invalidates active attempts.
4. **Every authoritative write participates in one scope-local commit stream.**
   Successful commits allocate the next dense `commit_seq` atomically;
   rollback consumes no sequence.
5. **Snapshot identity is exact.** Replacement reads use
   `{ scopeId, epoch, commitSeq }`, not wall-clock time or an at-least-fresh
   cache value.
6. **Reads and missing results are dependencies.** Point reads, scans, and index
   ranges must record the dependency shape needed for OCC and subscriptions.
7. **Writes preserve history and tombstones.** Current rows are an
   optimization, not the only retained truth.
8. **Idempotency and outcome recovery are authoritative.** Mutation request
   identity, result, commit record, change atoms, and outbox publication must be
   committed atomically in the replacement path.
9. **Retry classes remain separate.** OCC reruns, safe SQL-plan retries, and
   uncertain-outcome lookup cannot be collapsed into one generic retry loop.
10. **Unsupported read-your-writes shapes fail closed.** Reading Postgres
    without applying the attempt journal cannot make an unsupported overlay
    correct.
11. **No transaction spans untrusted execution.** Only the final trusted
    validation/publication phase opens the short authoritative transaction.
12. **Host adapters remain thin.** Worker, Fetch, Nitro, PGlite, and Node
    adapters cannot own business semantics that diverge from the executor core.
13. **Compatibility is removed only through proof.** Backfill, invariant
    verification, shadow comparison, scoped cutover, and a retained rollback
    switch precede legacy retirement.
14. **Commerce authority stays separate.** Generic Flarex app-data writes do
    not create an automatic atomic `ctx.db + ctx.commerce` transaction; Medusa
    owns commerce-affecting workflows and transaction semantics.

## Decisions And Rationale

### Keep the executor core framework-neutral

OCC, session fencing, trusted catalog resolution, commit planning, and
publication must behave identically across the hosted Worker, PGlite tests,
real-Postgres tests, and compatibility adapters. Keeping these rules in
`@flarex/executor` and `@flarex/persistence-postgres` prevents a host framework
from becoming a second correctness implementation.

### Make the private Cloudflare Worker the hosted target

The Dynamic Worker already executes inside Cloudflare and needs only a private
service binding to reach trusted database capabilities. A dedicated executor
Worker removes the former Cloudflare-to-Node production bridge while
preserving the restricted syscall boundary. Cache-disabled Hyperdrive is
required because authoritative write visibility cannot depend on Hyperdrive's
query cache.

### Preserve the Fetch contract before considering Workers RPC

`/invoke/prepare`, `/invoke/start`, `/invoke/syscall`, `/invoke/finish`, and
`/invoke/abort` are already shared by the current hosts. Replacing Fetch with
Workers RPC may be evaluated later, but transport replacement is independent
of FlarexDB correctness and cannot delay the storage/OCC kernel.

### Use a strangler migration

The legacy executor proves useful behavior and supplies the compatibility
oracle. The replacement therefore grows additively behind a storage-generation
fence, rather than renaming legacy tables or declaring partially built control
metadata production-ready. This preserves rollback and makes equivalence
measurable.

### Use PGlite for speed and real Postgres for database semantics

PGlite is the default fast lane for deterministic package tests and local
development. Real Postgres remains mandatory for locks, isolation,
concurrency, migrations, outbox behavior, hosted request lifecycle, and query
plans. Passing one lane does not imply the other.

## Convex Compatibility And Flarex Divergences

Flarex follows these Convex sources and patterns:

- [`../../../crates/database/src/transaction.rs`](../../../crates/database/src/transaction.rs)
  for accumulating reads and writes before commit;
- [`../../../crates/database/src/committer.rs`](../../../crates/database/src/committer.rs)
  for backend-owned authoritative validation and publication;
- [`../../../crates/application/src/application_function_runner/mod.rs`](../../../crates/application/src/application_function_runner/mod.rs)
  for separating function execution from database authority;
- [`../../../crates/isolate/src/environment/udf/syscall.rs`](../../../crates/isolate/src/environment/udf/syscall.rs)
  for restricted database syscalls;
- [`../../../crates/postgres/src/sql.rs`](../../../crates/postgres/src/sql.rs) for
  generic document/index persistence patterns; and
- the bootstrap table/index models and index registry for stable logical
  identity, immutable definitions, and backend-managed index lifecycle.

The necessary Flarex divergences are narrow:

| Concern | Convex pattern | Flarex divergence |
| --- | --- | --- |
| Runtime placement | Backend and database authority are closely integrated. | Untrusted code runs in a Dynamic Worker and crosses a private service binding to a separate trusted executor Worker. |
| Database authority | Convex owns its integrated storage engine and commit path. | Flarex uses Postgres transactions, a scope clock, explicit storage generations, and Hyperdrive only as transport/pooling. |
| Host lifecycle | No Cloudflare request-scoped `pg.Client` boundary is needed. | Flarex creates and closes a Worker-safe client for each executor request. |
| Migration | Convex does not need to replace Flarex's DO prototype. | Flarex retains `legacy_v1`, adds `flarexdb_v1`, compares them, and cuts over by scope with rollback. |
| Public placement API | Normal Convex app tables do not require caller-authored shard placement. | Flarex removes prototype partition concepts from the target developer model while keeping internal scope authority. |
| Commerce | Convex app transactions own Convex documents. | Medusa remains a separate trusted relational transaction lane; Flarex provides commit/outbox participation rather than pretending both models are one transaction API. |

Cloudflare service bindings, Dynamic Worker packaging, Hyperdrive lifecycle,
and the split deployment topology have no direct Convex equivalent. Those
differences must remain adapter concerns, not reasons to weaken Convex-style
transaction semantics.

## Implemented Capabilities

### Compatibility executor

The current `legacy_v1` path implements:

- deployment/package/function resolution and authenticated execution metadata;
- invoke preparation, session start, restricted syscalls, finish, retry,
  abort, expiry, and maintenance;
- document point reads, table scans, index reads, inserts, replaces, patches,
  deletes, validators, staged-write overlays, and legacy OCC checks;
- commit/outbox persistence and existing live-query freshness, subscription,
  rerun, delivery, claim/ack, failure, and dead-letter primitives; and
- PGlite and real-Postgres persistence adapters plus HTTP and Nitro adapters.

These capabilities are compatibility evidence, not proof that their legacy
schema or wall-clock transaction model is the accepted replacement.

### Replacement foundation

The active foundation status is:

- complete: `S01` compatibility generation seam;
- complete: `S02-A` through `S02-C` trusted scope location, scope clock,
  shared/split provisioning, reconciliation, and readiness projection;
- complete but non-routing: resolve-only `S02-D1`;
- complete: stable table identities, immutable schema artifacts, strict app
  table definitions, stable logical indexes, ordered index codec v1, immutable
  physical definitions, schema bindings, and fenced build-state reads through
  `S03-D2d` plus the interleaved `S05-A` prerequisite;
- complete and first consumed by non-routing replacement rows: host-neutral
  Flarex Value Codec V1 through `S05-B`, including canonical evidence, ordered
  lowering, the SDK facade, and storage verification;
- complete but internal/non-routing: `S06` native scope/epoch projections,
  strict replacement Document ID V1, authoritative row revisions, and
  pointer-only current storage;
- complete but private/non-routing: `O02` resolves one ephemeral exact app-data
  snapshot plus generation/fence from trusted placement and one located
  data-plane scope-clock read; and
- not complete: remaining replacement session/OCC/commit/cutover work,
  per-scope build reconciliation/readiness, and production replacement routing.

### Hosted Worker proof

The host proof has established:

- the Worker-safe connected-client persistence seam;
- a private Worker with bearer capability enforcement and fail-closed binding
  checks;
- request-scoped connection cleanup;
- Wrangler bundle checks that exclude PGlite, filesystem migrations, and Node
  control-plane code;
- named local workerd service-binding execution against real Postgres; and
- a bounded H05 proof/receipt toolchain that can validate hosted data-plane,
  control-plane, trace, cleanup, and source evidence.

It has not established a live staging deployment through real Hyperdrive. The
credentialed/provisioning `H05-B` receipt remains incomplete.

## Known Gaps And Limitations

- `createFlarexExecutor` still registers only the legacy app-data engine.
- `S02-D2` production generation routing cannot begin until the live hosted
  `H05-B` proof passes.
- `S03-D2c` atomically applies and verifies the complete normalized catalog
  inside a caller-owned transaction. `S03-D2d` now exposes that attempt through
  `publishAppSchemaV1`, snapshots declarations once, retries only combined
  typed staleness with at most three fresh preparations, preserves the
  protocol's 10,000-table and 10,000-developer-index maxima while limiting the
  current serial path to 256 combined definition work items, rejects guaranteed
  oversized decoded input before cloning or catalog reads, enforces the exact
  16 MiB canonical-manifest ceiling after every fresh preparation, and closes
  the focused real-Postgres bounded-work/race/rollback matrix.
- Per-scope index-build reconciliation and readiness remain `S03-D3` and
  `S03-D4`; catalog existence is not activation readiness.
- Active-schema pointer migration (`S04`) remains deferred to Wave 4. The
  completed value codec is wired into internal S06 rows but not a route.
- Snapshot leases, semantic exact-snapshot reads and dependencies, OCC
  validators, commit/change feed, idempotency outcomes, leased outbox, and the
  bounded commit compiler are not implemented. S06's storage-level history
  lookup and current-pointer CAS do not claim those later semantics.
- The current broad persistence interface and legacy invoke-session tables are
  compatibility surfaces to narrow behind generation-specific ports.
- Existing freshness and live-query delivery behavior belongs to the legacy
  compatibility path. The accepted Postgres-authoritative sync replacement is
  tracked in roadmap 21.
- Nitro/Vercel remains available but has not been retired; retaining it does
  not make it the production target.
- Hosted provisioning and deployment are intentionally outside ordinary core
  foundation turns.

## Target Direction

The target is one trusted, Postgres-authoritative correctness kernel with
replaceable hosts and explicit adapter lanes:

```text
authenticated scope and immutable execution anchor
  -> pinned storage generation and exact snapshot
  -> restricted logical reads and writes
  -> explicit read dependencies plus supported staged-write overlay
  -> pure trusted lowering against the pinned catalog
  -> short scope-local Postgres OCC/constraint transaction
  -> atomic result, idempotency outcome, revisions/current rows,
     commit/change feed, derived sidecars, and outbox
  -> post-commit sync/freshness consumers
```

The migration order remains:

1. finish the immutable control catalog and authority primitives;
2. prove one exact-snapshot point-read and point-mutation vertical slice;
3. add derived index, uniqueness, and stable-edge sidecars;
4. backfill and shadow-compare one isolated scope;
5. pass hosted Worker/Hyperdrive and real-Postgres correctness gates;
6. cut over by scope while retaining rollback; and
7. retire legacy storage/OCC only after the separate sync/reconnect gates pass.

Payload may later use trusted app-row/catalog primitives through a
Payload-owned adapter. Medusa uses its own repositories and transaction
manager, participating only through defined scope commit/change/outbox
capabilities. Neither adapter may receive raw executor persistence.

## Next Correctness Gates

The immediate next candidate is `S07` in the focused schema plan: add the
session and retention-lease DDL needed before authoritative session anchors.
Completed `S06` remains internal and changes no `/invoke/*` behavior or
production replacement route. `S07` requires its own evidence-backed preflight
and approval; S06 completion is not implicit authorization.

Follow the interleaved foundation order rather than pulling build/readiness
work forward:

1. Wave 1 continues from completed private snapshot resolution and value codec
   into just-in-time row/session capabilities, point reads, and pure point
   planning.
2. Wave 2 closes one atomic result-bearing point mutation with idempotency,
   commit feed, and outbox through the real-Postgres `C07` gate.
3. Immediately after `C07`, apply the predeclared threshold to the conditional
   SessionDO logical-journal decision.
4. Wave 3 adds derived sidecars and only then runs `S03-D3` per-scope physical
   build reconciliation.
5. Wave 4 owns baseline import, shadow comparison, real backfill evidence,
   `S03-D4` readiness, and `S04` active-schema authority.
6. Complete `H05-B` before `S02-D2` activates the hosted replacement route,
   then retain scoped rollback until sync/cutover gates permit legacy retirement.

Each gate must update this roadmap only when it changes durable status,
architecture, gaps, or direction. Its commit and verification history remains
in Git and the task report.
