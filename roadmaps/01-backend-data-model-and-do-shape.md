# Backend Data Model And Durable Object Shape

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
validation path as the legacy direct replacement routes.

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
legacy reads and partition schema sync, but the execution start path now treats
the active push analysis as authoritative:

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
