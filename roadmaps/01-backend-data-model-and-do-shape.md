# Backend Data Model And Durable Object Shape

## Accept Staged FlarexDB Data Model

Previous completed checkpoint: `01c11ab` Clarify SessionDO cache read bridge.

What changed:

- Accepted typed app row JSON plus derived index, stable edge-occurrence, and
  unique-key sidecars as the target app/CMS storage shape.
- Kept Payload lifecycle as reserved logical collections for the first adapter
  slices and Medusa commerce as real relational tables behind Medusa adapters.
- Separated stable catalog identities from immutable versioned definitions and
  added storage-generation backfill/dual-read/cutover/rollback requirements.
- Kept the current document/index schema as an implemented compatibility
  baseline instead of describing the proposal as already implemented.

Why it changed:

The previous schema examples could collide repeated/localized relation edges,
mutate catalog identity across schema versions, and implied dedicated Payload
tables and DML-only Medusa generation before their adapter contracts were
proven.

Convex references:

- `crates/database/src/committer.rs`
  - revisions and derived write metadata share one authoritative commit.
- `crates/database/src/reads.rs`
  - typed row/range dependencies are part of correctness.

How Flarex differs:

- Hosted shared app storage uses stable logical table IDs over fixed physical
  row/sidecar tables, while Medusa requires relational adapter-owned tables.
- Durable Objects coordinate sessions and sync but do not own committed rows.

Known limitations:

- The proposed storage generation, tagged Flarex value codec, retention/GC,
  Payload parity, and Medusa parity are unimplemented.

Verification:

```sh
git diff --check
```

## Partition Route Request Effects

Previous completed checkpoint: `e752f33` Type registry create request boundary.

What changed:

- PartitionDO schema-cache, commit, subscription registration, subscription
  target, and connection unregister request bodies now expose only the
  Effect-returning route request decoders.
- Removed Promise/throwing compatibility wrappers that converted typed
  partition route failures before the Durable Object adapter edge.
- Public Worker partition schema-cache request decoding now exposes only the
  Effect-returning decoder for the forwarding boundary.

Why it changed:

PartitionDO route request validation already lived behind typed Effect
decoders. This checkpoint removes obsolete wrapper surfaces without changing
the Durable Object's storage, OCC, subscription, or transaction logic.

Convex references:

- No Convex source files were inspected for this slice. This is a Flarex
  PartitionDO route-boundary cleanup around existing decoders.

How Flarex differs:

- Flarex hosts colocated partition state in Cloudflare Durable Objects and
  forwards some public partition routes through the Worker. This checkpoint
  keeps that DO/Worker shape while narrowing request decoding to typed Effect
  paths.

Known limitations:

- PartitionDO SQL/OCC behavior, idempotency replay, subscription invalidation,
  transaction response shapes, DeploymentDO, RegistryDO, executor-http,
  protocol package parser compatibility, and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/partitionRouteBoundary.test.ts test/publicPartitionSchemaCacheRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/partitionRouteBoundary.test.ts test/publicPartitionSchemaCacheRouteBoundary.test.ts test/transaction.test.ts test/sync.test.ts -t "schema-cache|commit|subscription|connection unregister|PartitionDO" --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Registry Create Request Effects

Previous completed checkpoint: `9f81903` Type public invoke request boundary.

What changed:

- Removed the throwing `parseRegistryCreateDeploymentPayload(...)`
  compatibility wrapper from `registry/Requests.ts`.
- Removed the Promise-returning `registryApiRequestForRoute(...)` route
  compatibility runner.
- Removed the Promise-returning `readRegistryCreateDeploymentRouteRequest(...)`
  compatibility wrapper.
- Kept RegistryDO production routing on `decodeRegistryApiRequestForRoute(...)`
  and `decodeRegistryCreateDeploymentRouteRequest(...)`.

Why it changed:

RegistryDO already routes through Effect request decoders before forwarding to
the generated Registry HttpApi web handler. The removed wrappers were legacy
compatibility surfaces that converted typed route/payload failures too early.

Convex references:

- No Convex source files were inspected for this slice. This is a Flarex
  RegistryDO route/source boundary cleanup around existing decoders.

How Flarex differs:

- Flarex hosts registry create/list through a Cloudflare Durable Object and a
  generated Effect HttpApi web handler. This checkpoint preserves that host
  shape while narrowing request decoding to typed Effect paths.

Known limitations:

- RegistryService, RegistryStore, RegistryDO generated web handler behavior,
  DeploymentDO, PartitionDO SQL/OCC, executor-http, protocol package parser
  compatibility, and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/registryRequests.test.ts test/registryHttpApiRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/registryRequests.test.ts test/registryHttpApiRouteBoundary.test.ts test/registryHttpApiHandlers.test.ts test/registryService.test.ts test/registryDO.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Registry Adapter Response Effects

Previous completed checkpoint: `a72b6f2` Remove deployment HttpError adapter
bridge.

What changed:

- Removed the legacy `registry/HttpBoundary.ts` adapter module.
- Removed `registryFailureToHttpError(...)`.
- Removed the matching `registryHttpBoundary.test.ts` compatibility test.
- Kept generated Registry HttpApi handler storage/protocol failures on typed
  response mappers.

Why it changed:

RegistryDO already hosts generated Registry HttpApi handlers that map
`RegistrySqlError` and registry protocol response failures to the declared
`RegistryStorageErrorResponse`. The removed helper kept an older `HttpError`
adapter in parallel with the typed generated-handler path.

Convex references:

- No Convex source files were inspected for this slice. This is a Flarex
  RegistryDO adapter cleanup around existing generated HttpApi handlers.

How Flarex differs:

- Flarex hosts the deployment registry in a Cloudflare Durable Object with a
  generated Effect HttpApi web handler. This checkpoint preserves that host
  shape and removes only obsolete `HttpError` compatibility mapping.

Known limitations:

- RegistryService, RegistryStore, RegistryDO routing, generated Registry
  HttpApi web handler behavior, DeploymentDO, PartitionDO SQL/OCC,
  executor-http, and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/registryHttpApiHandlers.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/registryHttpApiHandlers.test.ts test/registryHttpApiRouteBoundary.test.ts test/registryService.test.ts test/registryDO.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Partition Route Decoder Ownership

Previous completed checkpoint: `36dce15` Own scheduler route decoders.

What changed:

- Internal PartitionDO schema-cache, commit, subscription registration,
  subscription target, and connection unregister routes now expose decode-named
  route payload boundaries.
- The public Worker partition schema-cache route now also exposes a
  decode-named route payload wrapper that injects the route partition key.
- Partition request decoders call `decode*RoutePayload(...)` functions directly
  after the shared JSON body Effect boundary succeeds.
- Parse-named Effect helpers remain as compatibility wrappers, but newly
  migrated partition request paths prefer the decode-named route payload
  functions.

Why it changed:

Partition route payload validation already lived in `partition/Requests.ts`,
but the request decoders still flowed through parse-named compatibility
helpers. This checkpoint makes route payload ownership explicit across the
PartitionDO route family and the public schema-cache adapter while keeping
PartitionDO's correctness-sensitive transaction logic untouched.

Convex source files inspected:

- None for this checkpoint. This is Cloudflare-specific route adapter wiring
  around Flarex shard-local PartitionDO requests.

How Flarex differs from Convex:

- Flarex sends shard-local schema-cache, commit, and subscription maintenance
  payloads through Cloudflare Worker/Durable Object fetch routes before they
  enter the authoritative PartitionDO. This checkpoint tightens that HTTP/JSON
  boundary without changing the shard ownership model.

Known limitations:

- PartitionDO SQL/OCC, idempotency replay, schema-cache persistence,
  subscription invalidation, public Worker partition routing, executor-http,
  protocol schemas, and `ValidatorJson` are unchanged.
- These route payload functions still delegate to the existing manual payload
  decoders; the payload shapes are not moved into the protocol package yet.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/partitionRouteBoundary.test.ts packages/flarex-backend/test/publicPartitionSchemaCacheRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/partitionRouteBoundary.test.ts packages/flarex-backend/test/publicPartitionSchemaCacheRouteBoundary.test.ts packages/flarex-backend/test/transaction.test.ts packages/flarex-backend/test/partitionDO.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Partition Route Payload Validation Boundary

Previous completed checkpoint: `f77949c` Share scheduler maintenance payload
validation.

What changed:

- Partition route request payload validation now lives in the shared
  `partition/Requests.ts` source boundary.
- Schema-cache, public schema-cache wrapping, commit, subscription
  registration, subscription target, and connection unregister request shapes
  now emit `PartitionRoutePayloadError` from named Effect decoders at the
  payload source.
- Internal PartitionDO routes and public Worker schema-cache routes continue to
  share the same request validation path, while malformed JSON remains
  `RequestJsonError`.
- Partition route adapters still map typed payload failures to the same HTTP
  400 response shape at the adapter edge.

Why it changed:

Partition route validation had already moved to typed Effect decoders, but the
payload validation and route error tag still lived in `partition/RouteBoundary`.
This checkpoint moves the payload ownership to the Partition request source
boundary while keeping route files responsible for JSON reads and HTTP
conversion.

Preserved behavior:

- PartitionDO SQL/OCC, idempotency, schema-cache persistence, document writes,
  index reads, and subscription invalidation are unchanged.
- Public Worker schema-cache routing still keeps the route `partitionKey`
  authoritative over any body field.
- `ValidatorJson`, protocol schemas, deployment routes, invoke routes,
  scheduler routes, execution routes, delivery routes, and executor-http routes
  are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/partitionRouteBoundary.test.ts packages/flarex-backend/test/publicPartitionSchemaCacheRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/partitionRouteBoundary.test.ts packages/flarex-backend/test/publicPartitionSchemaCacheRouteBoundary.test.ts packages/flarex-backend/test/transaction.test.ts packages/flarex-backend/test/partitionDO.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Partition Route Effect Boundary

Previous completed checkpoint: `083fae0` Route public execution through Effect.

What changed:

- `partition/RouteBoundary.ts` now exposes Effect-returning decoders for
  schema-cache, commit, subscription registration, subscription target, and
  connection unregister request bodies.
- Partition route-body validation now originates as
  `PartitionRouteValidationError`; malformed JSON remains the shared
  `RequestJsonError`.
- Existing throwing parsers and Promise `read*` wrappers remain as compatibility
  adapters, but they now delegate through the typed validation implementation
  and `partitionRouteErrorToHttpError(...)`.
- The public schema-cache boundary now has an Effect decoder that keeps the
  route `partitionKey` authoritative over any body field.
- Public Worker partition `commit` and `schema-cache` forwarding now run through
  `Effect.fn` helpers and convert typed failures at the Worker adapter edge.

Why it changed:

Partition request parsing was one of the remaining hand-written `readJson` plus
`HttpError` validation clusters. Moving it to typed Effect decoders advances the
larger migration without changing the correctness-sensitive PartitionDO
transaction, OCC, schema-cache, or subscription logic.

Preserved behavior:

- PartitionDO still owns SQL initialization, commit conflict detection,
  idempotency keys, schema-cache persistence, document/index reads, and
  subscription invalidation.
- Public Worker partition route behavior still forwards canonical JSON to the
  internal Durable Object routes and keeps the route partition key authoritative
  for schema-cache updates.
- `ValidatorJson`, protocol schemas, deployment routes, invoke routes,
  scheduler routes, execution routes, delivery routes, and executor-http routes
  are unchanged in this checkpoint.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/partitionRouteBoundary.test.ts packages/flarex-backend/test/publicPartitionSchemaCacheRouteBoundary.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/partitionRouteBoundary.test.ts packages/flarex-backend/test/publicPartitionSchemaCacheRouteBoundary.test.ts packages/flarex-backend/test/transaction.test.ts packages/flarex-backend/test/partitionDO.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## RegistryDO Effect Host Shape

Previous completed checkpoint: `14930c4` Extract deployment HttpApi route boundary.

What changed:

- `RegistryDO` remains the Cloudflare Durable Object host and still owns table
  initialization plus fallback handling for non-GET `/health` and unknown
  routes.
- Registry persistence and behavior moved behind per-instance Effect services:
  `RegistryStore`, `RegistryService`, `RegistryClock`, and `RegistryIds`.
- `RegistryDO` composes the registry layer from its own `ctx.storage.sql`, then
  owns a generated Registry HttpApi web handler for `GET /health`,
  `GET /deployments`, and `POST /deployments`.
- A small route-boundary helper pre-parses create-deployment bodies with the
  existing `readJson` and protocol parser before forwarding canonical JSON to
  the generated handler, preserving the public invalid-body messages.

Why it changed:

This keeps the DO lifecycle and object-local SQLite state explicit while
proving that a Durable Object can route a complete small API through Effect
HttpApi without giving up compatibility fallbacks or per-instance state.

Convex references inspected:

- No new Convex source files were needed. RegistryDO is deployment metadata
  coordination, not the authoritative document/OCC data path.

Cloudflare difference:

- Unlike Convex backend components, Cloudflare Durable Object state is attached
  to each object instance. The SQL-backed Effect layer must therefore be built
  from the object instance, not as a global package singleton.

Known limitations:

- RegistryDO still owns outer fetch fallback behavior. Typed DO clients and
  Alchemy Durable Object resources are deferred.
- DeploymentDO, PartitionDO, ExecutionDO, DeliveryDO, SchedulerDO, and
  ConnectionDO still use their existing hand-written shapes.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/registryHttpApiRouteBoundary.test.ts packages/flarex-backend/test/registryHttpApiHandlers.test.ts packages/flarex-backend/test/registryDO.test.ts
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
git diff --check
```

## Authority Pivot

Previous completed checkpoint: `e80e176` Plan Postgres executor package
boundaries.

The forward authoritative data model is now Postgres-backed generic
multitenant document/index persistence, not Durable Object shard storage. The
existing `PartitionDO` implementation remains a useful prototype and temporary
bridge, but new data-model work should target:

- `design-notes/postgres-multitenant-persistence-schema.md`
- `design-notes/postgres-authoritative-sync.md`
- `roadmaps/20-postgres-executor.md`

Durable Objects should remain in the architecture for deployment coordination,
WebSocket sessions, schedulers, and future freshness/cache mirrors. They should
not remain the long-term authoritative document database.

Verification:

```sh
git diff --check
```

## Postgres Multitenant Persistence Schema Direction

Previous completed checkpoint: `4538f4a` Document Postgres authoritative sync
cache design.

What changed:

- Added `design-notes/postgres-multitenant-persistence-schema.md`.
- Recorded the storage-shape decision for the Postgres-authoritative Flarex
  track:
  - keep public `defineSchema` / `defineTable` APIs Convex-style,
  - do not create one physical SQL table per developer table,
  - store app data in generic multitenant `documents` and `index_entries`
    tables,
  - scope every authoritative physical row by deployment/project identity,
  - keep table names, table IDs, index IDs, document history, current-document
    optimization, commits, and outbox as backend metadata/state.

Why it changed:

- The user clarified that "same schema as Convex" means the same internal
  multitenant persistence model, not SQL DDL per developer table.
- This is the correct fit for Convex-style generated APIs, dynamic schema push,
  logical document IDs, OCC, and live-query invalidation.

Convex references:

- `crates/clusters/src/lib.rs`
  - `DbDriverTag::PostgresMultitenant` resolves schema/search path and sets
    `multitenant: true`.
- `crates/db_connection/src/lib.rs`
  - `PostgresOptions` carries `schema`, `instance_name`, and `multitenant`.
- `crates/postgres/src/sql.rs`
  - `documents` and `indexes` are generic physical persistence tables with
    optional `instance_name` tenancy columns and filters.
- `crates/value/src/table_mapping.rs`
  - logical table names are separated from internal table numbers/tablets.

Cloudflare / Flarex difference:

- Existing Flarex implementation remains Durable Object authoritative. The new
  note defines the intended physical Postgres schema for the
  Postgres-authoritative track.
- Convex uses `instance_name`; Flarex should use platform terminology such as
  `deployment_id`, while preserving the same tenant-discriminator invariant.
- Flarex's trusted executor near Postgres must own authoritative commits; user
  code running in Cloudflare Dynamic Workers must not receive a raw database
  connection.

Known limitations / follow-up:

- No Postgres DDL or executor implementation exists yet.
- We still need to decide whether the first implementation includes
  `current_documents` as a table or derives current state from history.
- Range freshness, outbox delivery, and Cloudflare cache repair remain covered
  by `design-notes/postgres-authoritative-sync.md`.
- The older DO shard placement model should become optional cache/routing
  policy if Postgres authority becomes the default.

Verification:

```sh
git diff --check
```

## Source-Package Schema Analysis Update

Local deployment analysis now evaluates the separately bundled immutable schema
module and normalizes it into the existing backend `DeploymentSchema` contract:
tables, document validators, placement, indexes, stable table IDs, and stable
index IDs.

Final codegen and the generated Worker consume this analyzed schema as static
data. They no longer re-evaluate the developer schema for runtime metadata.

This remains a prototype schema model. Backend push state must later own schema
version progression, schema diff validation, index lifecycle, and activation.
Projections are not yet part of authoritative storage schema analysis.

## Candidate Push State Update

`DeploymentDO` now owns candidate push state in addition to active schema and
function metadata.

It stores source package metadata, analyzed schema, analyzed functions, state,
failure errors, and timestamps. `finish` activates a candidate by applying its
schema/functions in one Durable Object storage transaction through the same
validation path that used to back the now-removed legacy direct replacement
routes.

This is the first step toward a Convex-style deployment activation boundary.
The current prototype still stores source package contents inline and does not
yet persist an active execution-artifact pointer, push race token, schema diff,
or index backfill status.

Convex references:

- `crates/application/src/lib.rs` schema evaluation path
- `npm-packages/convex/src/cli/lib/deployApi/componentDefinition.ts`
- `npm-packages/convex/src/cli/codegen_templates/dataModel.ts`

Verification:

```sh
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

## Current Decision

The backend server runtime lives in `packages/flarex-backend`. `apps/backend`
is the thin Wrangler deployable wrapper for that runtime.

Durable Object shape:

```txt
RegistryDO       global deployment registry
DeploymentDO     authoritative deployment metadata and schema
PartitionDO      authoritative shard database
ConnectionDO     realtime connection endpoint, currently a stub
SchedulerDO      scheduled function endpoint, currently a stub
```

DO names are deterministic and tenant-scoped:

```txt
registry:v1
deployment:{deploymentId}
partition:{deploymentId}:{partitionKey}
connection:{deploymentId}:{sessionId}
scheduler:{deploymentId}
```

`PartitionDO` is the shard. A user-owned app can map one user to one
`PartitionDO` instance.

## Implemented So Far

Created the backend runtime, now located in `packages/flarex-backend`, with:

- `wrangler.jsonc`
- `src/worker.ts`
- `src/registryDO.ts`
- `src/deploymentDO.ts`
- `src/partitionDO.ts`
- `src/connectionDO.ts`
- `src/schedulerDO.ts`
- shared helpers in `src/http.ts`, `src/routing.ts`, `src/types.ts`
- Miniflare-backed Worker/DO integration test harness in
  `test/partitionFlow.test.ts`
- backend invoke routes:
  - `POST /deployments/:deploymentId/invoke`
  - `POST /invoke` with `deploymentId` in the body or
    `x-flarex-deployment` header

`PartitionDO` currently owns:

- `meta`
- `tables`
- `indexes`
- `documents`
- `current_documents`
- `index_entries`
- `current_index_entries`
- `write_log`
- `idempotency_keys`

`DeploymentDO` now owns:

- `tables`
- `indexes`
- `functions`

The next deployment-model change is versioned push state. Directly replacing
the current schema and functions is not sufficient for Convex-style
`start_push` analysis and atomic `finish_push` activation. `DeploymentDO`
should eventually own:

- active push/execution-artifact pointer,
- candidate push state,
- authoritative analyzed modules and functions per candidate,
- candidate schema and schema-change state,
- push race/superseded detection,
- atomic activation after schema validation.

Large source packages and source maps should live outside Durable Object SQLite;
`DeploymentDO` should store references, hashes, authoritative metadata, and
state transitions.

Detailed design: `roadmaps/17-deployment-analysis-and-push.md`.

## Convex References

- `crates/postgres/src/sql.rs`
  Convex stores versioned `documents` and `indexes`, with optional
  `instance_name` in multitenant Postgres mode.
- `crates/postgres/src/lib.rs`
  Convex persistence writes documents and indexes through a lease-protected
  Postgres transaction.
- `crates/value/src/table_mapping.rs`
  Convex separates table names, table numbers, and tablets.
- `crates/value/src/document_id.rs`
  Convex separates developer IDs from resolved document IDs.

## Cloudflare Difference

Convex uses shared persistence with an `instance_name` column in multitenant
mode. Flarex uses the Durable Object name as the tenancy and shard boundary.
Rows inside a `PartitionDO` SQLite database do not need a `deployment_id`
column because the object name already provides isolation.

This means Flarex should not copy Convex's Postgres schema row-for-row. It
should copy the semantics: versioned documents, current snapshot optimization,
write log, indexes, and table metadata.

## Known Limitations

- `DeploymentDO` schema metadata is not yet automatically pushed to
  `PartitionDO` schema caches.
- `ConnectionDO` and `SchedulerDO` are topology stubs.
- A first generated Worker execution path is connected through backend
  execution sessions and syscalls. Cloudflare Dynamic Worker deployment is not
  connected yet.
- No retention or compaction exists for document history or write logs.

## Last Update

Added backend invoke routes while keeping the Worker route thin. The route
parses deployment, partition, function path, args, kind, and idempotency key,
then delegates to `executeInvoke`. The deployed registry is still empty until
the Dynamic Worker bridge or function registry is connected.

Added deployment-owned function metadata:

- `PUT /deployments/:deploymentId/functions`
- `GET /deployments/:deploymentId/functions`
- internal `GET /function?path=...`

Each function metadata row stores:

- path
- kind
- visibility
- args validator JSON
- returns validator JSON

`executeInvoke` now loads this metadata and uses it as the function contract.
The in-memory handler registry remains only the execution source for the
current prototype.

Return validators are enforced before mutation commit, matching Convex's
ordering where a validated UDF outcome is produced before commit. This means a
mutation that writes documents and returns a value that fails the declared
validator does not persist those writes.

`v.id("table")` validation now uses deployment table mappings. For the
authoritative backend, Flarex IDs are currently encoded as:

```txt
{tableId}:{documentId}
```

The backend resolves `tableId` through `DeploymentSchema.tables` during
argument, document, return, and direct commit validation.

Convex reference remains the same topology boundary:
`crates/application/src/api.rs` keeps HTTP/API entrypoints thin, while database
components such as `crates/database/src/committer.rs` validate and commit the
transaction.

Additional Convex references:

- `crates/model/src/modules/module_versions.rs`
  - `AnalyzedFunction` stores function type, visibility, args, and returns
    validator strings.
- `crates/model/src/modules/mod.rs`
  - `ModuleModel::get_analyzed_function_by_id` resolves deployed function
    metadata before execution validation.
- `crates/udf/src/validation.rs`
  - `ValidatedPathAndArgs` uses analyzed metadata for kind and argument checks.
  - `ValidatedUdfOutcome::new` applies `ReturnsValidator` before the mutation
    commit path consumes the outcome.
- `crates/common/src/schemas/validator.rs`
  - `Validator::Id` decodes `DeveloperDocumentId` and checks that the ID's table
    matches the validator table.

Verified with:

```sh
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend test
```

## Canonical ID Codec Update

Added a canonical Flarex document ID codec with this format:

```txt
{tableId}:{documentId}
```

The authoritative backend now uses codec helpers instead of ad hoc string
splitting in:

- `SingleShardTransaction.insert`
- `PartitionDO.applyDocumentWrite`
- `PartitionDO` direct commit validation
- `/invoke` document lookup, write validation, and `v.id("table")`
  validation

This keeps the storage model aligned with the table metadata already owned by
`DeploymentSchema.tables`.

Convex reference:

- `crates/common/src/schemas/validator.rs`
  - `Validator::Id` decodes the developer document ID and resolves the table
    before accepting a value for `v.id("table")`.

Cloudflare difference:

- Flarex currently uses a small TypeScript codec in both the backend and SDK
  packages. This duplication exists because `@flarex/backend` is still kept as
  an isolated Cloudflare backend package. The likely future shape is a
  runtime-neutral `flarex-core` package shared by the backend, SDK, generator,
  and Dynamic Worker bridge.

Verified with:

```sh
corepack pnpm typecheck
corepack pnpm test
```

## Execution Session Data Path

Added `ExecutionDO` as a backend-owned transaction session coordinator. It
keeps the authoritative data path inside backend Durable Objects:

```txt
generated Worker user handler
  -> service binding to backend /executions/:sessionId/syscall
  -> ExecutionDO
  -> SingleShardTransaction
  -> PartitionDO
```

Document writes remain staged until `/finish`, and only `PartitionDO.commit`
persists them. This preserves the intended Convex-like rule that user code
does not receive a raw database connection or Durable Object storage handle.

Known limitation: session state is currently in `ExecutionDO` memory. A future
executor must add retry semantics for eviction, restart, and `OCC_CONFLICT`.

## Architecture Terminology Cleanup

Previous completed checkpoint: `da42b4a` Add analysis import phase prelude.

Normalized storage wording to `source package`. Large uploaded `flarex/`
source packages and source maps should live outside Durable Object SQLite; the
developer's whole app is not part of deployment metadata.

Verification:

```sh
git diff --check
```

## Active Deployment Pointer Update

Previous completed checkpoint: `6db912b` Preserve analyzed function source
positions.

`DeploymentDO` now records the first active deployment pointer in its `meta`
table:

```txt
active_push_id
active_activated_at
```

`finish_push` sets those values only after applying the candidate schema and
function metadata. `GET /deployments/:deploymentId/deployment` reads the active
push row and returns active source package, analysis, codegen analysis, schema
version, and activation timestamp.

Convex reference:

- `crates/application/src/deploy_config.rs`
  - deployment activation is a distinct finish step after candidate analysis.
- `crates/model/src/modules/mod.rs`
  - active module metadata is durable deployment state used for function
    resolution.

Cloudflare difference: Flarex currently uses the activated push row as the
source package reference and stores source package JSON inline in Durable
Object SQLite. Large source package storage and the active Dynamic Worker
artifact pointer remain future work.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## ExecutionDO Create-Root Session Shape

Previous completed checkpoint: `2e6dc68` Consume preallocated root ids.

`ExecutionDO` now stores create-root scope in the active session indirectly
through its `SingleShardTransaction`. The session still records the resolved
scope, active schema, active function metadata, deployment id, and path, but
the authoritative create-root enforcement lives in the transaction object so
all syscalls share the same preallocated root state.

DO shape after this step:

```txt
ExecutionDO session
  deploymentId
  active schema/functions metadata
  resolved FunctionExecutionScope
  SingleShardTransaction
    partitionKey
    optional createRoot(rootTableId, preallocatedRootId, consumed)
```

Convex reference:

- `crates/application/src/application_function_runner/mod.rs`
  - active deployment analysis is the runtime input to function execution.
- `crates/database/src/transaction.rs`
  - transaction-local mutation state owns generated ids and staged writes.

Cloudflare difference: this session is per execution Durable Object instance,
not an in-process Rust isolate transaction. That makes explicit session
lifetime and HTTP syscall validation part of the backend data model.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test -- --runInBand
```

## Create-Root Transaction Context

Previous completed checkpoint: `1a8a8ff` Plan create-root id preallocation.

`SingleShardTransaction` now carries optional create-root state:

```ts
{
  rootTableId: number,
  preallocatedRootId: string,
  consumed: boolean,
}
```

This state is not persisted as a separate table. It is request-local execution
context that controls which document id can be used for the first root insert.
The durable data model remains the normal document history/current rows/index
rows written by `PartitionDO` commit.

Convex references:

- `crates/database/src/transaction.rs`
  - transaction-local state accumulates writes before commit.
- `crates/database/src/committer.rs`
  - commit applies validated writes to durable tables.

Cloudflare difference:

- The preallocated id is a Durable Object routing concern, so Flarex keeps it
  in transaction context until the root document write is staged.

Remaining limitations:

- No durable marker records that a transaction was create-root after commit;
  the created document is the durable result.
- Active deployment/client layers still cannot expose create-root until
  generated code and execution sessions carry the new request shape.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Create-Root Metadata Shape Update

Previous completed checkpoint: `601256a` Classify create-root partition
analysis.

Backend deployment/function metadata now accepts the create-root partition
shape:

```ts
{
  type: "partitionCreateRoot",
  table: string,
  partitionField: "_id",
}
```

`DeploymentDO` validates this shape during push/start metadata normalization,
and backend invoke planning turns it into a future `PartitionDO` object name by
preallocating the root id.

Convex references:

- `crates/model/src/modules/module_versions.rs`
  - function metadata is modeled as backend-owned deployment state.
- `crates/model/src/source_packages/mod.rs`
  - source/deployment state is stored durably before execution.

Cloudflare difference:

- Flarex stores routing intent in deployment metadata because Durable Objects
  need a concrete object name before execution. Convex does not expose this
  distinction in function metadata.

Remaining limitations:

- This is a metadata/runtime planning shape only.
- No active deployment can safely expose create-root functions to clients until
  the execution session consumes `preallocatedRootId`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Shared Artifact Ref Computation Update

Previous completed checkpoint: `363d7e0` Add local execution artifact runtime
invoke.

`DeploymentDO` now computes `active_execution_artifact_ref` through the shared
`flarex/artifacts` helper instead of an inline helper in the Durable Object.
This keeps active deployment metadata aligned with the local artifact store and
future hosted artifact storage.

Convex reference:

- `crates/model/src/source_packages/mod.rs`
  - package identity is shared between deployment metadata and execution.

Cloudflare difference: the backend still stores only the active ref and source
package JSON inline. Durable hosted storage remains future work.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Active Execution Artifact Reference Update

Previous completed checkpoint: `4a6e66f` Resolve execution sessions from active
deployment.

`DeploymentDO` now stores the first active execution artifact reference with
the active deployment pointer:

```txt
active_push_id
active_activated_at
active_execution_artifact_ref
```

The reference is content-addressed from the normalized source package manifest
and returned by `GET /deployments/:deploymentId/deployment` as:

```ts
executionArtifactRef: {
  runtime: "dynamic-worker";
  artifactId: string;
  sourcePackageHash: string;
  executionModule: string;
}
```

This gives the backend data model the missing pointer between active analyzed
deployment metadata and the future Flarex-managed Dynamic Worker runtime.

Convex reference:

- `crates/model/src/source_packages/mod.rs`
  - source packages are stored as durable metadata and addressed by
    `SourcePackageId`.
- `crates/model/src/modules/types.rs`
  - module metadata links analyzed modules to source package identity and
    module hash.

Cloudflare difference: Flarex has not built the artifact storage service yet,
so the reference is a deterministic manifest-derived pointer rather than a
database document ID for an uploaded package. R2-backed package storage and
hosted Dynamic Worker loading remain follow-up work.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Active Deployment Invoke Resolution Update

Previous completed checkpoint: `b08269e` Record active deployment pointer on
finish.

The backend data model now has its first runtime consumer of
`active_push_id`. Execution sessions resolve schema and function metadata from
the active push's analyzed deployment payload instead of trusting the mutable
`functions` table alone.

`DeploymentDO` still materializes the active schema/functions into tables for
partition schema sync, but the execution start path now treats the active push
analysis as authoritative:

```txt
active_push_id -> pushes.analysis -> schema/functions -> ExecutionDO.start
```

Convex reference:

- `crates/application/src/application_function_runner/mod.rs`
  - function execution receives validated metadata derived from stored module
    analysis.
- `crates/model/src/modules/mod.rs`
  - analyzed module metadata is durable deployment state used for later
    function resolution.

Cloudflare difference: Flarex still stores active source package and analysis
inline in Durable Object SQLite. Convex has richer module/config models and a
separate isolate runner. Future Flarex storage should move large source
packages and execution artifact references out of this row.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Direct Metadata Route Removal

Previous completed checkpoint: `63637f9` Harden create-root sync docs and
tests.

The backend data model no longer exposes direct public schema/function
replacement routes. `DeploymentDO` still stores normalized tables, indexes, and
functions after `finish_push`, but the only public activation path is analyzed
push state.

Current authority chain:

```txt
source package
  -> analyzed push
  -> finish_push
  -> active_push_id
  -> active deployment analysis
  -> invoke/sync/execution session
```

Convex reference:

- `crates/application/src/deploy_config.rs`
  - push/finish owns deployment activation.
- `crates/model/src/modules/mod.rs`
  - module/function metadata belongs to deployment state.

Cloudflare difference: Flarex still has materialized SQLite tables inside the
DeploymentDO because partitions need compact schema sync. Those tables are no
longer publicly writable metadata authority.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run --maxWorkers=1
```
