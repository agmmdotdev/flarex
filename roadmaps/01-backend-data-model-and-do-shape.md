# Backend Data Model And Durable Object Shape

## Current Decision

The backend server lives in `apps/backend` and is the first standalone
Cloudflare server target.

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

Created `apps/backend` with:

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
- No real user-function execution path is connected yet.
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
