# Package Boundaries

## Public Partition Schema Cache Route Boundary

Previous completed checkpoint: `c930cf0` Decode public delivery wake bodies.

What changed:

- `packages/flarex-backend/src/partition/PublicSchemaCacheRouteBoundary.ts`
  now owns the public Worker partition schema-cache request-body boundary.
- `PUT /deployments/:deploymentId/partitions/:partitionKey/schema-cache`
  decodes through the shared `readJson` boundary before the Worker forwards to
  `PartitionDO`.
- The boundary appends the route partition key, keeps it authoritative over any
  request-body field, and reuses the existing partition schema-cache parser for
  object-envelope validation.
- Schema semantic validation, table/index persistence, schema-version metadata
  writes, transaction ownership, commit/OCC behavior, subscription routes,
  document/index reads, scheduler routes, delivery routes, executor-http routes,
  and `ValidatorJson` remain in their existing owners.

Boundary decision:

The public schema-cache route is a Worker transport boundary. This checkpoint
validates the public envelope and route partition key before forwarding, while
keeping schema validation, persistence, and transaction-facing state inside
`PartitionDO`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicPartitionSchemaCacheRouteBoundary.test.ts packages/flarex-backend/test/transaction.test.ts -t "public partition schema-cache route boundary|rejects malformed public partition schema-cache JSON|rejects non-object public partition schema-cache JSON"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Public Delivery Wake Route Boundary

Previous completed checkpoint: `c1c104d` Decode public live query delivery bodies.

What changed:

- `packages/flarex-backend/src/delivery/PublicWakeRouteBoundary.ts` now owns
  the public Worker `wake-delivery` request-body boundary.
- `POST /deployments/:deploymentId/sync/wake-delivery` decodes through the
  shared `readJson` boundary before the Worker forwards to `DeliveryDO`.
- The boundary appends the route deployment id, keeps it authoritative over
  any request-body `deploymentId`, and reuses the existing `DeliveryDO` wake
  parser for the optional drain controls.
- Authorization, `DeliveryDO` wake/drain behavior, claim/fanout/ack semantics,
  scheduler routes, live-query delivery fanout, partition routes,
  executor-http routes, and `ValidatorJson` remain in their existing owners.

Boundary decision:

The public wake callback is a Worker transport boundary, but delivery draining
is Durable Object behavior. This checkpoint validates the forwarded wake
request at the public edge without moving claim, fanout, acknowledgement, retry,
or pending-drain state logic out of `DeliveryDO`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicDeliveryWakeRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "public delivery wake route boundary|rejects malformed public DeliveryDO wake JSON|rejects invalid public DeliveryDO wake envelopes"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Public Live Query Delivery Route Boundary

Previous completed checkpoint: `ac853a0` Decode partition commit bodies.

What changed:

- `packages/flarex-backend/src/liveQueryDelivery/RouteBoundary.ts` now owns the
  public Worker live-query delivery request-body boundary.
- `POST /deployments/:deploymentId/sync/deliver-live-query` decodes through the
  shared `readJson` boundary before `deliverLiveQueryChangesToConnections(...)`
  groups deliveries and calls `ConnectionDO`.
- The boundary extracts only the existing delivery transport envelope and keeps
  the existing delivery parser messages.
- Authorization, deployment scoping, fanout, `ConnectionDO` delivery behavior,
  skip accounting, `DeliveryDO`, scheduler routes, partition routes,
  executor-http routes, and `ValidatorJson` remain in their existing owners.

Boundary decision:

The public Worker delivery callback is a transport boundary, but delivery
fanout remains backend runtime behavior. This checkpoint gives the route a
named decoder without moving connection fanout or Durable Object state logic.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicLiveQueryDeliveryRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "public live query delivery route boundary|rejects malformed public live query delivery JSON|rejects invalid public live query delivery envelopes"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Partition Commit Route Boundary

Previous completed checkpoint: `a9d1e67` Decode partition subscription bodies.

What changed:

- `packages/flarex-backend/src/partition/RouteBoundary.ts` now owns the
  `PartitionDO` commit request-body boundary.
- `POST /commit` decodes through the shared `readJson` boundary at both the
  public Worker partition forwarding edge and the Durable Object edge.
- The boundary extracts only the commit request envelope: required integer
  `beginTs`, optional integer `schemaVersion`, optional string `source`,
  optional string `idempotencyKey`, optional object `readSet` with
  document/table/index read arrays, and required `writes` array with integer
  `tableId`, optional non-empty `id`, and JSON `value`.
- Idempotency lookup, schema-version mismatch behavior, generated IDs for
  missing write IDs, write validation, table/placement/schema checks,
  transaction ownership, OCC conflict detection, write-log persistence,
  invalidation notification, document/index reads, schema-cache, subscription
  routes, and `ValidatorJson` remain in their existing owners.

Boundary decision:

Partition commit is the correctness-sensitive shard write path. This checkpoint
narrows the HTTP transport edge without moving commit execution, OCC conflict
detection, SQL writes, or invalidation behavior out of `PartitionDO`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/partitionRouteBoundary.test.ts packages/flarex-backend/test/transaction.test.ts -t "partition route boundary|rejects malformed partition commit JSON|rejects invalid public partition commit envelopes"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Partition Subscription Route Boundary

Previous completed checkpoint: `afe8390` Decode partition schema-cache bodies.

What changed:

- `packages/flarex-backend/src/partition/RouteBoundary.ts` now owns the
  `PartitionDO` subscription request-body boundaries.
- `POST /subscriptions/register`, `POST /subscriptions/unregister`, and
  `POST /subscriptions/unregister-connection` decode through the shared
  `readJson` boundary.
- The boundary extracts only the subscription request envelopes:
  registration requires non-empty `connectionName`, integer `queryId`, and
  object `readSet`; unregister requires non-empty `connectionName` and integer
  `queryId`; unregister-connection requires non-empty `connectionName`.
- Subscription SQL insert/delete ownership, invalidation scanning, commit/OCC
  behavior, schema-cache, document/index reads, ConnectionDO callers, Worker
  forwarding, and `ValidatorJson` remain unchanged.

Boundary decision:

Partition subscription routes cross an HTTP/JSON boundary before mutating
`sync_subscriptions`. Moving the request parsers into a backend route-boundary
helper narrows the transport edge while keeping subscription state ownership
and invalidation behavior inside `PartitionDO`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/partitionRouteBoundary.test.ts packages/flarex-backend/test/transaction.test.ts -t "partition route boundary|rejects malformed partition subscription registration JSON|rejects invalid partition subscription unregister-connection envelopes"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Partition Schema Cache Route Boundary

Previous completed checkpoint: `8de16fb` Decode scheduler cleanup bodies.

What changed:

- `packages/flarex-backend/src/partition/RouteBoundary.ts` now owns the
  `PartitionDO` schema-cache request-body boundary.
- `PUT /schema-cache` decodes through the shared `readJson` boundary and
  accepts JSON object envelopes, preserving both wrapped `{ partitionKey,
  schema }` bodies and legacy flat `{ partitionKey, version, tables, indexes }`
  bodies.
- The boundary extracts only the transport envelope and leaves schema semantic
  validation, partition-key checks, table/index persistence, transaction
  ownership, and schema-version metadata writes in `PartitionDO`.
- Commit/OCC behavior, subscription routes, document/index reads, Worker
  forwarding, and `ValidatorJson` remain unchanged.

Boundary decision:

Partition schema-cache crosses an HTTP/JSON boundary before it enters
PartitionDO's schema metadata update path. Decoding that envelope in a small
backend helper narrows the route edge without pulling correctness-sensitive
commit or SQL behavior out of the Durable Object.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/partitionRouteBoundary.test.ts packages/flarex-backend/test/transaction.test.ts -t "partition route boundary|rejects malformed partition schema-cache JSON"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Scheduler Connection Cleanup Route Boundary

Previous completed checkpoint: `6634f8f` Decode scheduler dead-letter bodies.

What changed:

- `packages/flarex-backend/src/scheduler/RouteBoundary.ts` now owns the
  live-query connection cleanup request-body boundary.
- `POST /cleanup/live-query-connections` decodes through the shared `readJson`
  boundary and accepts required non-empty `deploymentId`, `projectId` from
  request or configured environment fallback, and optional ISO `expiredAt`;
  extra fields remain ignored.
- The boundary extracts only the cleanup request envelope and leaves executor
  cleanup calls and response validation in `SchedulerDO`.
- Other SchedulerDO route execution and continuation behavior remains in place.

Boundary decision:

Scheduler connection cleanup crosses an HTTP/JSON boundary before it enters
executor maintenance. Decoding the request at the route edge makes the
transport contract explicit without moving SchedulerDO's cleanup workflow or
mixing executor-side cleanup behavior into the route parser.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/schedulerRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "scheduler route boundary|rejects malformed live query connection cleanup JSON|rejects invalid live query connection cleanup fields"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Scheduler Dead Letter Delivery Route Boundary

Previous completed checkpoint: `e75622d` Decode scheduler rerun bodies.

What changed:

- `packages/flarex-backend/src/scheduler/RouteBoundary.ts` now owns the
  live-query delivery dead-letter request-body boundary.
- `POST /dead-letter/live-query-deliveries` decodes through the shared
  `readJson` boundary and accepts optional non-empty `deploymentId`, optional
  ISO `olderThan`, optional positive integer `stuckAfterMs` only when
  `olderThan` is absent, optional positive integer `minAttempts`, `limit`, and
  `maxBatches`, optional passthrough `cursor`, optional non-empty `reason`, and
  optional ISO `deadLetteredAt`; extra fields remain ignored.
- The boundary extracts only the dead-letter request envelope and leaves
  executor dead-letter scans, force-reconnect fanout, pagination, and result
  aggregation in `SchedulerDO`.
- Other SchedulerDO routes remain on their existing parsers for later slices.

Boundary decision:

Scheduler dead-letter delivery crosses an HTTP/JSON boundary before it enters
executor maintenance and connection reconnect behavior. Decoding the request at
the route edge makes that transport contract explicit without moving
SchedulerDO's operational dead-letter workflow.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/schedulerRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "scheduler route boundary|rejects malformed live query dead-letter JSON"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Scheduler Live Query Rerun Route Boundary

Previous completed checkpoint: `4864cd5` Decode scheduler connection reconcile
bodies.

What changed:

- `packages/flarex-backend/src/scheduler/RouteBoundary.ts` now owns the
  live-query subscription rerun request-body boundary.
- `POST /rerun/live-query-subscriptions` decodes through the shared `readJson`
  boundary and accepts required non-empty `deploymentId`, optional non-empty
  `projectId`, and optional positive integer `limit`, `deliveryLimit`, and
  `maxBatches`; extra fields remain ignored.
- The boundary extracts only the rerun request envelope and leaves pending
  rerun construction, executor rerun calls, delivery wake fanout, in-flight
  coalescing, retry scheduling, and persistence in `SchedulerDO`.
- Other SchedulerDO routes remain on their existing parsers for later slices.

Boundary decision:

Scheduler live-query rerun crosses an HTTP/JSON boundary before it enters
durable rerun state and executor/delivery fanout behavior. Decoding the request
at the route edge makes that transport contract explicit without moving
SchedulerDO's rerun state machine or mixing it with executor-side subscription
evaluation.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/schedulerRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "scheduler route boundary|rejects malformed live query subscription rerun JSON"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Scheduler Connection Cleanup Reconcile Route Boundary

Previous completed checkpoint: `46d1782` Decode scheduler delivery reconcile
bodies.

What changed:

- `packages/flarex-backend/src/scheduler/RouteBoundary.ts` now owns the
  live-query connection cleanup reconcile request-body boundary.
- `POST /reconcile/live-query-connections` decodes through the shared
  `readJson` boundary and accepts optional ISO `expiredAt`, optional positive
  integer `limit`, and an optional cursor with ISO `oldestExpiredAt` and
  non-empty `deploymentId`; extra fields remain ignored.
- The boundary extracts only the cleanup reconcile request envelope and leaves
  durable cleanup continuation, fresh-request coalescing, retry scheduling, and
  persistence in `SchedulerDO`.
- Other SchedulerDO routes remain on their existing parsers for later slices.

Boundary decision:

Scheduler connection cleanup reconcile crosses an HTTP/JSON boundary before it
enters durable cleanup state and continuation behavior. Decoding the request at
the route edge makes that transport contract explicit without moving the
scheduler's cleanup state machine or mixing it with executor-side deployment
scan behavior.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/schedulerRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "scheduler route boundary|rejects malformed live query connection cleanup reconcile JSON|rejects malformed live query connection cleanup reconcile cursors"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Scheduler Delivery Reconcile Route Boundary

Previous completed checkpoint: `28a783e` Decode artifact runtime invoke bodies.

What changed:

- `packages/flarex-backend/src/scheduler/RouteBoundary.ts` now owns the
  live-query delivery reconcile request-body boundary.
- The boundary extracts only the delivery reconcile request envelope and leaves
  durable continuation state, keyed in-flight coalescing, wake fanout, retry
  scheduling, and persistence in `SchedulerDO`.
- Other SchedulerDO routes remain on their existing parsers for later slices.

Boundary decision:

Scheduler delivery reconcile crosses an HTTP/JSON boundary before it enters
stateful Durable Object scheduling behavior. Decoding the request at the route
edge makes that transport contract explicit without moving the scheduler's
durable state machine or mixing it with delivery drain execution.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/schedulerRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "scheduler route boundary|rejects malformed live query delivery reconcile JSON|rejects malformed live query delivery deployment scan cursors"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Artifact Runtime Invoke Route Boundary

Previous completed checkpoint: `c6bb370` Decode delivery wake bodies.

What changed:

- `packages/flarex-backend/src/artifactRuntime/RouteBoundary.ts` now owns the
  execution artifact runtime invoke request-body boundary.
- The boundary parses the existing backend `ExecutionArtifactInvokePayload`
  shape and preserves the runtime service's invalid-payload error envelope for
  both malformed JSON and invalid object shapes.
- `artifactRuntime.ts` still owns runtime authorization, artifact header
  checks, runtime-store source-package loading, materializer cache behavior,
  and invoke response/error conversion.

Boundary decision:

The artifact runtime service is a runtime adapter, not shared protocol. Its
body parser should be explicit and testable, but this slice should not move the
payload into `flarex-protocol` or alter materializer/cache ownership. A future
protocol slice can replace the local guard with an Effect Schema contract when
the artifact invocation DTO is stable enough to share.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/artifactRuntimeRouteBoundary.test.ts packages/flarex-backend/test/artifactRuntime.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Delivery Wake Route Boundary

Previous completed checkpoint: `2c7f8c6` Decode connection invalidation bodies.

What changed:

- `packages/flarex-backend/src/delivery/RouteBoundary.ts` now owns the
  `DeliveryDO` wake request-body boundary.
- The boundary extracts a required `deploymentId` and optional positive
  integer delivery limits, ignoring extra compatibility fields.
- `DeliveryDO` still owns route matching, drain coalescing, defaults,
  claim-owner creation, persisted continuation state, delivery fanout, acking,
  and structured delivery failure summaries.

Boundary decision:

`DeliveryDO /wake` is an internal route, but it crosses an HTTP/JSON boundary
from Worker and SchedulerDO callers into delivery drain state. The route should
decode the wake envelope before starting drain work, while claim/fanout/ack
failures should continue through the existing delivery failure summary path
rather than the decode error response path.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deliveryRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "delivery route boundary|rejects malformed DeliveryDO wake JSON|rejects invalid DeliveryDO wake envelopes"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Connection Invalidation Route Boundary

Previous completed checkpoint: `025481f` Decode connection delivery bodies.

What changed:

- `packages/flarex-backend/src/connection/RouteBoundary.ts` now owns the
  `ConnectionDO` invalidation request-body boundary.
- The boundary accepts the current invalidation envelope shape by extracting an
  integer `queryId` and ignoring extra compatibility fields such as
  `invalidatedTs`.
- `ConnectionDO` still owns route matching, active query state, rerun
  coalescing, subscription refills, and WebSocket transition emission.

Boundary decision:

`ConnectionDO /invalidate` is internal, but it crosses an HTTP/JSON boundary
from partition notification code into mutable connection state. The route
should decode the transport envelope before invoking rerun orchestration, while
runtime rerun failures should keep their existing behavior and not be folded
into the decode error response path.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/connectionRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "connection route boundary|rejects malformed invalidation JSON|rejects invalid invalidation envelopes"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Connection Live Query Delivery Route Boundary

Previous completed checkpoint: `94e9d0c` Decode public execution action bodies.

What changed:

- `packages/flarex-backend/src/connection/RouteBoundary.ts` now owns the
  `ConnectionDO` live-query delivery request-body boundary.
- The boundary delegates delivery-envelope validation to the existing
  `liveQueryDeliveryChangesFromBody(...)` parser and maps invalid delivery
  requests to the shared `HttpError(400, ...)` response path.
- `ConnectionDO` still owns route matching, live WebSocket state, delivery
  skip reasons, and transition emission.

Boundary decision:

`ConnectionDO /deliver/live-query` is an internal fanout endpoint, but it is
still a transport boundary. Body reads should be centralized in a route helper
before delivery arrays reach mutable connection state. The existing
live-query delivery parser remains the single shape checker for this slice
until a future protocol package contract replaces it.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/connectionRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "connection route boundary|rejects malformed live query delivery JSON"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Public Execution Action Route Boundary

Previous completed checkpoint: `f21421f` Document execution abort boundary.

What changed:

- `packages/flarex-backend/src/execution/ActionRouteBoundary.ts` now owns the
  public Worker's execution action forwarding body read.
- The helper delegates `syscall` and `finish` to the existing backend
  execution route-boundary parsers, keeping protocol parsing and backend JSON
  adaptation in one execution boundary package area.
- The helper keeps `abort` as well-formed JSON forwarding only, matching the
  bodyless Durable Object action decision.
- `worker.ts` still owns public route matching, session id routing, and
  Durable Object dispatch.

Boundary decision:

The public Worker should no longer use a generic JSON read for execution
actions that already have protocol-backed route-boundary parsers. It should
delegate to the execution boundary helper, while `ExecutionDO` remains the
owner of session and transaction behavior.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionActionRouteBoundary.test.ts packages/flarex-backend/test/executionDO.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Execution Abort Bodyless Boundary

Previous completed checkpoint: `7316794` Decode execution finish bodies.

What changed:

- Recorded execution abort as a bodyless Durable Object action rather than a
  protocol-owned request body.
- The public Worker still accepts the generated runtime's `{}` JSON envelope
  before forwarding to `ExecutionDO`; extra well-formed JSON is ignored by the
  bodyless action, and malformed JSON remains a Worker compatibility error.
- `flarex-protocol/execution` remains focused on execution bodies with domain
  data: start, syscall, and finish.

Boundary decision:

The backend route layer owns the public JSON forwarding compatibility for
abort. `ExecutionDO` owns the cancellation side effect and should not receive a
protocol DTO for a body it ignores. A future change can introduce an abort
request schema only if abort starts enforcing body fields such as reason,
actor, or idempotency metadata.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionDO.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Execution Finish Backend Route Boundary

Previous completed checkpoint: `e77e2eb` Add execution finish protocol body.

What changed:

- `packages/flarex-backend/src/execution/FinishRouteBoundary.ts` owns
  Durable Object finish JSON reading, protocol parsing,
  protocol-error-to-HTTP mapping, and protocol JSON to backend JSON adaptation.
- `ExecutionDO` still owns route matching, session state, return validation,
  transaction completion, and cleanup.
- `flarex-protocol/execution` remains transport-contract-only.

Boundary decision:

The protocol package validates the finish body shape. The backend route
boundary adapts that shape to mutable runtime types and compatibility errors.
`ExecutionDO.finish(...)` should continue to receive backend-native request
types and own return validation, commit behavior, and cleanup.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionFinishRouteBoundary.test.ts packages/flarex-backend/test/executionDO.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Execution Finish Protocol Package Boundary

Previous completed checkpoint: `652936f` Decode execution syscall bodies.

What changed:

- `flarex-protocol/execution` now owns the execution finish request schema and
  parser for the `{ value }` body currently accepted by `ExecutionDO.finish`.
- The schema validates the returned value as strict transport JSON without
  importing backend validator or transaction types.
- The protocol package remains transport-contract-only; backend Worker,
  Durable Object, transaction, return validation, and commit code are
  unchanged.

Boundary decision:

The protocol package should describe the finish body before backend code adapts
it to runtime validation and commit behavior. The backend should continue to
own return validator checks, query read-set response construction, mutation
commit behavior, and session cleanup.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
node ./node_modules/vitest/vitest.mjs run packages/flarex-protocol/test/execution.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Execution Syscall Backend Route Boundary

Previous completed checkpoint: `f766101` Add execution syscall protocol bodies.

What changed:

- `packages/flarex-backend/src/execution/SyscallRouteBoundary.ts` owns
  Durable Object syscall JSON reading, protocol parsing,
  protocol-error-to-HTTP mapping, and protocol JSON to backend JSON adaptation.
- `packages/flarex-backend/src/execution/JsonRouteBoundary.ts` centralizes
  the JSON adapter shared by execution start and syscall boundaries.
- `ExecutionDO` still owns route matching, session state, and transaction
  orchestration; `flarex-protocol/execution` remains transport-contract-only.

Boundary decision:

The protocol package validates the syscall body shape. The backend route
boundary adapts that shape to mutable runtime types and compatibility errors.
`ExecutionDO.syscall(...)` should continue to receive backend-native request
types and own session/transaction semantics.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionSyscallRouteBoundary.test.ts packages/flarex-backend/test/executionDO.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Execution Syscall Protocol Package Boundary

Previous completed checkpoint: `7f6ec53` Decode execution start bodies.

What changed:

- `flarex-protocol/execution` now owns the execution syscall request union and
  parser for the operation bodies currently accepted by `ExecutionDO.syscall`.
- The schema validates query selectors, optional paging/order fields, mutation
  JSON payloads, and JSON-record patch payloads without importing backend
  transaction types.
- The protocol package remains transport-contract-only; backend Worker,
  Durable Object, transaction, and PartitionDO code are unchanged.

Boundary decision:

The protocol package should describe syscall request bodies before the backend
adapts them into runtime transaction calls. The backend should continue to own
session lookup, transaction state, Durable Object lifecycle, and compatibility
HTTP errors when the parser is wired later.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
node ./node_modules/vitest/vitest.mjs run packages/flarex-protocol/test/execution.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Execution Start Backend Route Boundary

Previous completed checkpoint: `d8b82fc` Add execution start protocol body.

What changed:

- `packages/flarex-backend/src/execution/StartRouteBoundary.ts` owns backend
  JSON reading, protocol parsing, protocol-error-to-HTTP mapping, route
  deployment id injection, and protocol JSON to backend JSON adaptation for
  execution start requests.
- `worker.ts` still owns public route matching and session id allocation.
- `ExecutionDO` still owns session lifecycle and transaction orchestration.
- `flarex-protocol/execution` remains transport-contract-only.

Boundary decision:

The protocol package validates the shared start-body shape. The backend route
boundary adapts that shape to the backend runtime types and compatibility
rules. This keeps readonly protocol JSON from leaking into mutable backend
runtime APIs.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionStartRouteBoundary.test.ts packages/flarex-backend/test/executionDO.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Execution Start Protocol Package Boundary

Previous completed checkpoint: `67689e2` Decode public invoke bodies.

What changed:

- `flarex-protocol/execution` now owns the execution-session start request
  schema and parser.
- `flarex-protocol/json` exposes `JsonValue`, a shared strict JSON transport
  schema, so invoke and execution contracts validate the same JSON subset.
- The package export map exposes `./execution` for future backend boundary
  wiring.
- Backend Worker routing and `ExecutionDO` still own session behavior and HTTP
  compatibility.

Boundary decision:

The protocol package should describe execution-session transport bodies before
backend code adapts public Worker requests into Durable Object requests. The
backend package should continue to own malformed JSON handling, route-scoped
deployment id injection, and session lifecycle behavior.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
node ./node_modules/vitest/vitest.mjs run packages/flarex-protocol/test/execution.test.ts packages/flarex-protocol/test/invoke.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Public Invoke Worker Route Boundary

Previous completed checkpoint: `95cc914` Add public invoke protocol body.

What changed:

- `packages/flarex-backend/src/invoke/PublicInvokeRouteBoundary.ts` now owns
  Worker-edge public invoke JSON reading and protocol parser adaptation.
- `worker.ts` delegates both public invoke body reads to that helper while
  keeping deployment id resolution and invoke execution orchestration local.
- `flarex-protocol/invoke` remains the shared transport contract; backend code
  only adapts protocol failures into backend HTTP errors.

Boundary decision:

The protocol package owns the request shape. The backend package owns public
Worker compatibility: malformed JSON handling, `{ error }` envelopes, route
deployment resolution, and `args ?? null` runtime defaulting.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicInvokeRouteBoundary.test.ts packages/flarex-backend/test/invoke.test.ts packages/flarex-backend/test/artifactRuntimeRoute.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Public Invoke Protocol Package Boundary

Previous completed checkpoint: `be053f6` Decode public source push bodies.

What changed:

- `flarex-protocol/invoke` now owns the public invoke request body schema and
  parser.
- The package export map exposes `./invoke` for future backend and generated
  runtime consumers.
- Backend Worker routing still owns request reading, deployment lookup,
  artifact execution, session behavior, and response mapping.

Boundary decision:

The protocol package should describe the public transport body before backend
code adapts that body to runtime defaults such as `args ?? null`. Keeping this
slice protocol-only avoids coupling shared schema introduction to the live
Worker invoke path.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
node ./node_modules/vitest/vitest.mjs run packages/flarex-protocol/test/invoke.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Public Source-Only Push Protocol Boundary

Previous completed checkpoint: `65dd151` Decode public deployment push bodies.

What changed:

- `flarex-protocol/deployment` now owns the source-only `StartPushRequest`
  schema and parser.
- `packages/flarex-backend/src/deployment/PublicPushRouteBoundary.ts` adapts
  the protocol-decoded source package back into the backend's existing mutable
  `StartPushRequest` shape for analyzer code.
- `worker.ts` still owns the analyzer configuration branch, analyzer service
  call, artifact persistence, and Durable Object forwarding.

Boundary decision:

The protocol package should describe the public transport body, but it should
not force readonly schema-class DTOs through backend analyzer code that already
uses mutable local request types. The public boundary is the right place to
decode and adapt between those shapes.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts packages/flarex-backend/test/push.test.ts packages/flarex-protocol/test/deployment.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Public Deployment Push Protocol Boundary

Previous completed checkpoint: `e81a139` Route registry through HttpApi.

What changed:

- `packages/flarex-backend/src/deployment/PublicPushRouteBoundary.ts` owns
  public Worker body decoding for deployment push mutation forwarding.
- The helper uses `flarex-protocol/deployment` parsers for `start-analyzed`,
  `finish`, and `abandon` bodies, keeping the schema contract in the protocol
  package and the Worker forwarding policy in the backend package.
- `worker.ts` still owns public route matching, analyzer integration, artifact
  preflight, and Durable Object stub forwarding.
- DeploymentDO still owns its generated internal HttpApi handler and per-object
  runtime layer.

Boundary decision:

The public Worker should not cast request JSON to deployment body types before
forwarding. It should decode at the public edge with protocol parsers, then let
DeploymentDO repeat its internal compatibility parse as the object-local trust
boundary.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts packages/flarex-backend/test/push.test.ts packages/flarex-protocol/test/deployment.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Registry Durable Object HttpApi Host

Previous completed checkpoint: `14930c4` Extract deployment HttpApi route
boundary.

What changed:

- `flarex-protocol/registry` remains the shared schema-first contract for the
  RegistryDO route paths and request/response bodies.
- `packages/flarex-backend/src/registry/HttpApiWebHandler.ts` now composes that
  protocol contract with backend handlers and the object-local registry layer.
- `RegistryDO` owns the per-instance generated web handler and delegates current
  RegistryApi routes to it after a backend compatibility boundary accepts the
  route and normalizes create-deployment JSON.
- `RegistryDO` still owns Durable Object lifecycle concerns: SQL schema
  initialization, fallback route responses, and object-local layer construction.

Boundary decision:

The generated handler belongs in `flarex-backend`, not `flarex-protocol`,
because it needs backend services and object-local SQL state. The protocol
package stays transport-contract-only.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/registryHttpApiRouteBoundary.test.ts packages/flarex-backend/test/registryHttpApiHandlers.test.ts packages/flarex-backend/test/registryDO.test.ts packages/flarex-protocol/test/registry.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Route Bridge Boundary

Previous completed checkpoint: `31971a4` Inline deployment start push route
bridge.

What changed:

- Removed the remaining thin private deployment route bridge methods from
  `DeploymentDO`.
- The active deployment, push status, finish-push, and abandon-push route
  branches now call `runDeployment` directly.
- Kept `DeploymentService`, `deployment/Validation.ts`, `DeploymentPushStore`,
  and `flarex-protocol` unchanged.

Why it changed:

The meaningful package boundaries are now the HTTP route, the `runDeployment`
runtime bridge, and the deployment service/store modules. The removed methods
no longer represented separate ownership.

Convex references inspected:

- No new Convex source files were required. This remains a Flarex package
  boundary refinement.

Flarex differences:

- This is not a protocol, SDK, service, or store move. It only removes
  backend-local method hops.

Known limitations:

- Direct service calls in `DeploymentDO.fetch()` may be revisited after the
  deep protocol-decoding decision.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Start Push Route Bridge Boundary

Previous completed checkpoint: `c053c93` Extract deployment start push input
validation.

What changed:

- Removed the thin private `DeploymentDO.startPush` route bridge.
- The `POST /push/start-analyzed` branch now directly adapts the parsed body
  and calls `DeploymentDO.runDeployment`.
- Kept `DeploymentService` and `deployment/Validation.ts` ownership unchanged.
- Kept `flarex-protocol` unchanged.

Why it changed:

With start-push validation externalized, the extra method no longer owned a
meaningful package boundary. The fetch branch remains the HTTP boundary, and
`runDeployment` remains the runtime boundary.

Convex references inspected:

- No new Convex source files were required. This remains a Flarex package
  boundary refinement.

Flarex differences:

- This is not a protocol or SDK move. It only removes a backend-local method
  hop.

Known limitations:

- Other deployment branches still use private methods for the service bridge.
- A later slice can decide whether those should stay for readability.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Start Push Validation Boundary

Previous completed checkpoint: `5e74840` Move deployment metadata access into
store.

What changed:

- Moved analyzed start-push backend request normalization into
  `deployment/Validation.ts`.
- Reused the validation module for source package, diagnostics, analysis, and
  codegen normalization before calling `DeploymentService.startAnalyzedPush`.
- Kept `DeploymentDO` as the HTTP route and Effect runtime boundary.
- Kept `flarex-protocol` as the wrapper schema package; no shared protocol
  contract changed.

Why it changed:

Backend deployment validation now owns the pure request-to-service input
adapter. That keeps package boundaries narrow: protocol parses the wrapper,
backend validation normalizes service input, and the service/store layer owns
runtime orchestration.

Convex references inspected:

- No new Convex source files were required. This remains a Flarex package
  boundary refinement.

Flarex differences:

- This is not an SDK or protocol move. It is backend-local validation that
  preserves existing HTTP messages.

Known limitations:

- Deep `analysis` and `codegenAnalysis` payloads are still decoded by backend
  validation rather than by `flarex-protocol`.
- A later slice can decide whether that should change.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Store Metadata Boundary

Previous completed checkpoint: `2d6c9c4` Move deployment schema application
into store.

What changed:

- Moved active deployment metadata reads and writes into
  `DeploymentPushStore`.
- Removed metadata callbacks from the deployment layer constructor surface.
- Kept `DeploymentDO` as the owner of the SQL handle, route/runtime boundary,
  table creation, migrations, and initial `schema_version` bootstrap.
- Updated direct store tests to model the `meta` table in fake SQL.

Why it changed:

Deployment activation metadata is part of the store-owned activation/read
boundary. Keeping it in the store narrows the Durable Object surface to hosting
and schema lifecycle work.

Convex references inspected:

- No new Convex source files were required. This remains a Flarex package
  boundary refinement.

Flarex differences:

- This does not introduce a global repository abstraction. Metadata reads and
  writes still execute against the current Durable Object SQLite handle.

Known limitations:

- `DeploymentDO` still creates and migrates the deployment tables.
- A later slice can evaluate remaining request validation and protocol
  boundary placement.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Store Activation Write Boundary

Previous completed checkpoint: `e739957` Move deployment push reads into
store.

What changed:

- Moved schema table/index writes and function metadata writes into
  `DeploymentPushStore`.
- Removed schema/function application callbacks from the deployment layer
  constructor surface.
- Kept `DeploymentDO` as the owner of the SQL handle, route/runtime boundary,
  and deployment metadata callbacks.
- Updated direct store tests to prove store-owned activation application still
  preserves `HttpError` passthrough.

Why it changed:

The store should own the storage operations that activate a deployment push.
This reduces callback surface while keeping route behavior and service
orchestration unchanged.

Convex references inspected:

- No new Convex source files were required. This remains a Flarex package
  boundary refinement.

Flarex differences:

- This does not introduce a global repository abstraction. Activation writes
  still execute against the current Durable Object SQLite handle.

Known limitations:

- Metadata access remains callback-based for this slice.
- A later slice can evaluate whether metadata helpers should move into the
  store.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Store Push Read Boundary

Previous completed checkpoint: `ce58f78` Extract deployment push row
normalization.

What changed:

- Moved push-row SQL reads into `DeploymentPushStore`.
- Removed `readPush` from the deployment layer constructor surface.
- Kept `DeploymentDO` as the owner of the SQL handle and route/runtime
  boundary.
- Updated direct store tests to use fake SQL instead of a push-read callback.

Why it changed:

The store should own storage operations that produce deployment push state.
With row normalization already extracted, the store can read and normalize
push rows directly while preserving typed `DeploymentSqlError` mapping.

Convex references inspected:

- No new Convex source files were required. This remains a Flarex package
  boundary refinement.

Flarex differences:

- This is not a global repository abstraction. Reads still happen against the
  per-Durable Object SQLite handle.

Known limitations:

- Schema/function application and metadata access are still callback-based.
- A later slice can evaluate those callbacks separately.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Push Row Normalization Boundary

Previous completed checkpoint: `a5ff90c` Extract analyzed push adapter.

What changed:

- Added `DeploymentPushStatusRow` and `pushStatusFromRow` to
  `packages/flarex-backend/src/deployment/Validation.ts`.
- Moved generated codegen fallback construction into the validation module.
- Kept SQL row lookup in `DeploymentDO`.
- Added direct tests for the moved read-normalization helpers.

Why it changed:

The deployment validation module now owns backend request validation and
deployment metadata validation. Stored push row normalization is pure
conversion at the same boundary, while SQL access remains a Durable
Object/store concern.

Convex references inspected:

- No new Convex source files were required. This remains a Flarex package
  boundary refinement.

Flarex differences:

- The validation module is backend-local. It does not become a protocol or SDK
  contract.

Known limitations:

- `DeploymentPushStore` still depends on a `readPush` callback supplied by
  `DeploymentDO`.
- The next store-boundary slice can decide whether that callback should move
  behind the store directly.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Start Push Adapter Boundary

Previous completed checkpoint: `2e5f3dd` Extract deployment analysis
validators.

What changed:

- Moved the analyzed start-push protocol-to-backend adapter into
  `packages/flarex-backend/src/deployment/Validation.ts`.
- Kept `DeploymentDO.fetch()` responsible for HTTP routing and
  `parseAnalyzedStartPushRequest` protocol parsing.
- Added direct tests for adapter success/failure normalization.

Why it changed:

The adapter belongs with backend deployment validation because it normalizes
protocol wrapper output into the backend `AnalyzedStartPushRequest` shape. The
Durable Object should call the adapter, not own its field-level normalization.

Convex references inspected:

- No new Convex source files were required. This remains a Flarex package
  boundary refinement.

Flarex differences:

- The adapter is backend-local. Shared transport schemas still belong in
  `flarex-protocol`.

Known limitations:

- Deep protocol decoding remains a future decision.
- Row/status normalization still lives in `DeploymentDO`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Analysis Codegen Validation Boundary

Previous completed checkpoint: `eb0dcc2` Extract deployment schema
validators.

What changed:

- Moved analysis/codegen validation orchestration into
  `packages/flarex-backend/src/deployment/Validation.ts`.
- Removed temporary low-level codegen helper imports from `DeploymentDO`.
- Kept high-level validator entrypoints as the boundary between the Durable
  Object and backend deployment metadata validation.
- Extended direct unit tests for analysis/codegen behavior.

Why it changed:

After schema/function primitives moved, analysis/codegen validation could move
as a unit. This keeps `DeploymentDO` focused on orchestration and prevents
low-level parser helpers from becoming a de facto public module surface.

Convex references inspected:

- No new Convex source files were required. This remains a Flarex package
  boundary refinement.

Flarex differences:

- The validation module remains backend-local. Shared transport schemas still
  belong in `flarex-protocol`, and `ValidatorJson` remains the user
  document/function validator representation.

Known limitations:

- The protocol-to-backend adapter `analyzedStartPushRequest` still lives in
  `DeploymentDO`.
- Deep protocol decoding remains intentionally separate from this backend
  validation module.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Schema Function Validation Boundary

Previous completed checkpoint: `3a257f3` Extract deployment request
validators.

What changed:

- Expanded `packages/flarex-backend/src/deployment/Validation.ts` with
  schema/function validation primitives.
- Moved reusable validator helpers out of `DeploymentDO` while keeping the DO
  as the caller for route, SQL, and service boundaries.
- Exported only the helpers still needed by local analysis/codegen
  orchestration in `DeploymentDO`.
- Extended direct validator tests for schema/function behavior.

Why it changed:

Schema/function validation belongs beside the other deployment validation
helpers. Moving it narrows `DeploymentDO` toward orchestration while keeping
transport schemas in `flarex-protocol` and backend-specific validator logic in
`flarex-backend`.

Convex references inspected:

- No new Convex source files were required. This remains a Flarex package
  boundary refinement.

Flarex differences:

- The validation module is backend-local, not a public SDK or protocol
  surface. `ValidatorJson` validation remains the backend representation for
  user document/function validators.

Known limitations:

- Deep `validateAnalysis` and `validateCodegenAnalysis` orchestration remains
  in `DeploymentDO`.
- A later slice should reduce the number of helper exports once codegen
  validation moves as a unit.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Validation Module Boundary

Previous completed checkpoint: `64f1e75` Extract deployment error types.

What changed:

- Added `packages/flarex-backend/src/deployment/Validation.ts`.
- Moved source-package and diagnostics helpers behind that deployment module
  boundary.
- Kept `DeploymentDO` as the caller for start-push validation and service
  orchestration.
- Added direct unit tests for the extracted helpers.

Why it changed:

The deployment package now has service, store, runtime, layer, and error
modules. A validation module lets pure request/domain validation move out of
the Durable Object incrementally without pulling route or SQL ownership with
it.

Convex references inspected:

- No new Convex source files were required. This is a Flarex package boundary
  cleanup before deeper validator extraction.

Flarex differences:

- The validation module is not a public protocol package. Shared transport
  schemas still belong in `flarex-protocol`.

Known limitations:

- Deep schema/function/codegen validators remain in `DeploymentDO`.
- `safeValidator` still depends on backend `ValidatorJson` validation and has
  not moved.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Error Module Boundary

Previous completed checkpoint: `566ddfa` Extract deployment push read service.

What changed:

- Added `packages/flarex-backend/src/deployment/Errors.ts` for deployment
  service tagged errors.
- Kept service implementation in `DeploymentService` and HTTP mapping in
  `DeploymentDO`.
- Updated tests to assert the same typed error classes from the dedicated
  module.

Why it changed:

As deployment orchestration moves behind Effect services, typed domain errors
should be importable without pulling the service implementation itself into
every boundary or test.

Convex references inspected:

- No new Convex source files were required. This checkpoint only clarifies the
  current Flarex package boundary.

Flarex differences:

- Flarex still maps errors at the Durable Object HTTP boundary. The error
  module is not a public SDK contract.

Known limitations:

- Protocol/parser errors remain in `flarex-protocol/deployment`.
- Semantic validators are still local to `DeploymentDO`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Push Read Service Boundary

Previous completed checkpoint: `a93b051` Extract active deployment service
read.

What changed:

- Extended the deployment Effect service boundary to single-push status reads.
- Added `DeploymentService.getPush` over the existing `DeploymentPushStore`
  read port.
- Kept `DeploymentDO.fetch()` responsible for route matching, push ID
  decoding, and HTTP response conversion.
- Reused `DeploymentPushNotFoundError` for missing push status reads.

Why it changed:

After moving push writes and active deployment reads behind the service,
single-push reads were the remaining deployment push-state route branch still
calling `DeploymentDO.getPush` directly.

Convex references inspected:

- No new Convex source files were required. This remains a Flarex
  Cloudflare-specific service boundary over the current Durable Object state
  model.

Flarex differences:

- Flarex still stores and normalizes push rows inside the Durable Object. The
  Effect service does not introduce a global push repository.

Known limitations:

- The store still receives `readPush` for row-to-status normalization.
- Semantic validator extraction remains a future checkpoint.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Active Read Service Boundary

Previous completed checkpoint: `b8c25b9` Extract deployment abandon service.

What changed:

- Extended the deployment Effect service boundary to active deployment reads.
- Added `DeploymentActiveDeploymentNotFoundError` for the no-active-deployment
  case, preserving route-level 404 behavior without direct reads in
  `DeploymentDO.fetch`.
- Expanded the deployment store port with `getActiveDeployment` so active
  metadata assembly lives beside the push lifecycle operations.
- Passed a `getMeta` callback into the deployment store layer while keeping
  metadata ownership in the Durable Object instance.
- Kept corrupt active metadata errors as `HttpError` passthrough.

Why it changed:

Active deployment reads consume the metadata written by finish-push. Moving
that read behind the same service/store boundary keeps active deployment state
coherent without moving HTTP routing or Durable Object lifecycle ownership.

Convex references inspected:

- No new Convex source files were required. This remains a Flarex
  Cloudflare-specific boundary around the existing active deployment metadata
  model.

Flarex differences:

- Flarex still resolves active deployment state from Durable Object SQLite and
  metadata. The Effect service remains per DO instance and callback-based for
  this slice.

Known limitations:

- Single-push reads still go directly through `DeploymentDO.getPush`.
- The store still receives `readPush` for row-to-status normalization.
- Semantic validator extraction remains a future checkpoint.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Abandon Service Boundary

Previous completed checkpoint: `42cccd5` Extract deployment finish service.

What changed:

- Extended the deployment Effect service boundary to abandon-push.
- Added `DeploymentPushInvalidStateError` for terminal-state abandon attempts,
  keeping state-machine rejection explicit instead of throwing directly from
  the Durable Object route.
- Expanded the deployment store port with `abandonPush` so the SQL update and
  post-update push read live with the other deployment write operations.
- Preserved transaction-level `HttpError` passthrough so store guards for
  unknown or terminal pushes do not become storage failures.
- Kept the Durable Object boundary responsible for route parsing, request body
  decoding, and HTTP conversion of typed service errors.

Why it changed:

Abandon-push is a state-machine write path with stable behavior and narrow
inputs. Moving it behind the service completes the main push lifecycle write
surface before taking on active deployment reads or deeper validation moves.

Convex references inspected:

- No new Convex source files were required. This remains a Flarex
  Cloudflare-specific package boundary around the existing push state model.

Flarex differences:

- Flarex still stores deployment push state in Durable Object SQLite and
  composes the Effect service per DO instance. This slice does not introduce a
  global deployment service.

Known limitations:

- The store still receives `readPush` as a callback for row-to-status
  normalization.
- Active deployment reads and semantic validator extraction remain future
  checkpoints.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Finish Service Boundary

Previous completed checkpoint: `224f097` Extract deployment push-start
service.

What changed:

- Extended the deployment Effect service boundary from push-start into
  finish-push activation.
- Added an artifact runtime port next to the existing clock/id ports, keeping
  execution artifact lookup injectable and testable.
- Expanded the deployment store port with `getPush` and `finishPush` so the
  service can preflight unknown pushes and then delegate activation to the
  Durable Object-owned storage transaction.
- Kept the Durable Object boundary responsible for HTTP status mapping,
  route parsing, and the in-memory schema/function application callbacks used
  by activation.
- Kept activation validation `HttpError` failures separate from
  `DeploymentSqlError` so HTTP 400 validation behavior remains unchanged.

Why it changed:

Finish-push combines artifact lookup, state-machine checks, SQL updates,
schema/function application, and active deployment metadata. Moving that
orchestration behind a typed service boundary makes the deployment package
more coherent without moving Durable Object lifecycle ownership.

Convex references inspected:

- No new Convex source files were required. The boundary remains a Flarex
  Cloudflare implementation detail around the existing deploy-state model.

Flarex differences:

- Flarex still applies schemas and functions inside a Cloudflare Durable
  Object instance. The Effect service receives callbacks into that instance
  rather than owning global process state.

Known limitations:

- The store still uses callbacks such as `readPush`, `applySchema`,
  `applyFunctions`, and `setMeta` to preserve current Durable Object behavior.
  A broader deployment repository abstraction can wait until all write paths
  are behind the service.
- Abandon-push and active deployment reads have not crossed this boundary yet.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Service Push Start Boundary

Previous completed checkpoint: `bbdbec2` Add deployment analysis protocol
schemas.

What changed:

- Added `packages/flarex-backend/src/deployment/Runtime.ts`,
  `Store.ts`, `Service.ts`, and `Layer.ts` for the first deployment Effect
  service slice.
- `DeploymentDO` now hosts a per-instance `ManagedRuntime` for the deployment
  service, mirroring the existing Registry service pattern.
- The service owns push ID/time acquisition and delegates the push-start row
  transaction through a typed store port.
- `DeploymentDO` still owns HTTP routing, request parsing, semantic validators,
  and final error-to-response mapping.

Why it changed:

This creates a real service/package boundary for deployment push-start without
moving the entire Durable Object router or changing its behavior.

Convex references inspected:

- No new Convex source files were required. The boundary follows the repo's
  current Effect service pattern while keeping Flarex's Cloudflare Durable
  Object deployment state owner intact.

Flarex differences:

- Convex deploy services are not Durable Object instances. Flarex composes the
  service per Durable Object instance so SQLite storage and lifecycle stay
  tenant/deployment scoped.

Known limitations:

- The service currently covers only analyzed push-start persistence. Finish,
  abandon, active deployment, and metadata application remain in
  `DeploymentDO`.
- The store uses a `readPush` callback to preserve the existing row-to-status
  normalization before a broader deployment store extraction.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "coalesces concurrent fresh pending delivery reconciles"
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "does not coalesce concurrent pending delivery reconciles with different parameters"
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Analysis Protocol Boundary

Previous completed checkpoint: `bc2d552` Add deployment push-start protocol
schema.

What changed:

- `flarex-protocol/deployment` now exports deep deployment metadata schemas:
  `ValidatorJson`, placement/schema/function metadata, deployment analysis,
  codegen analysis, active deployment status, and finish-push response
  contracts.
- `PushStatus` response parsing now depends on those deep schemas for
  `analysis` and `codegenAnalysis`.
- Backend tests consume the new parser exports at JSON boundaries for push
  status, active deployment status, and activated finish responses.
- The protocol package has its own focused deployment schema tests.

Why it changed:

This keeps shared transport contracts in the protocol package and gives the
next service-extraction slice a typed response surface without moving
Durable Object write semantics yet.

Convex references inspected:

- No new Convex source files were required. The shape is Flarex's current
  backend analysis contract, which remains the Cloudflare-side analogue to
  backend-authoritative deployment metadata.

Flarex differences:

- Flarex is extracting these contracts from a Durable Object implementation.
  Convex already has mature deploy API/service boundaries, while Flarex is
  proving the protocol package incrementally.

Known limitations:

- Deep request decoding for `/push/start-analyzed` is intentionally deferred.
  `DeploymentDO` still owns semantic checks and exact validation messages.
- `ValidatorJson` is represented structurally for transport parsing only; user
  document/function validation still uses the existing validator runtime.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
git diff --check
```

## Deployment Push Start Protocol Boundary

Previous completed checkpoint: `6d026a9` Add deployment abandon protocol
schema.

What changed:

- Extended `flarex-protocol/deployment` with source package and analyzed
  push-start wrapper schemas:
  `PushSourceModule`, `PushSourcePackage`, `PushDiagnostic`, and
  `AnalyzedStartPushRequest`.
- DeploymentDO now decodes `POST /push/start-analyzed` bodies with
  `parseAnalyzedStartPushRequest`.
- DeploymentDO normalizes the protocol class output into its existing backend
  `AnalyzedStartPushRequest` shape before calling the unchanged `startPush`
  implementation, including explicit success/failure mutual-exclusion checks.
- Focused push lifecycle tests now parse successful analyzed push responses
  through `parsePushStatus` and cover invalid JSON, preserved source package
  validation, preserved diagnostics item validation, invalid diagnostics
  wrappers, and mixed success/failure wrappers.

Why it changed:

The abandon-push slice proved the deployment protocol subpath on a tiny route.
Push start is the next useful boundary because it validates input before any
push row is written while still allowing the deeper deployment analysis
validators to remain local.

Convex references inspected:

- No new Convex source files were required. This is still an incremental
  TypeScript protocol-boundary migration, not a redesign of deploy analysis or
  activation semantics.

Flarex differences:

- Convex deploy APIs have mature backend service contracts. Flarex is
  extracting those contracts gradually from a Cloudflare Durable Object router.

Known limitations:

- `sourcePackage`, diagnostics items, `analysis`, and `codegenAnalysis` remain
  deep-validated by DeploymentDO helpers. The protocol exports source package
  and diagnostic schemas for response parsing, but
  `parseAnalyzedStartPushRequest` only owns the push-start wrapper contract
  until those validators can be migrated without changing error semantics.
- Public source-only `/push/start` remains unchanged.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "skips stale failed live query deliveries after a newer result is active"
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
git diff --check
```

## Deployment Abandon Protocol Boundary

Previous completed checkpoint: `90f4383` Test registry Effect service.

What changed:

- Added `flarex-protocol/deployment` as the second protocol subpath.
- The new protocol module owns the narrow DeploymentDO abandon-push boundary:
  `AbandonPushRequest`, `PushStatus`, and
  `DeploymentProtocolValidationError`.
- `packages/flarex-backend/src/deploymentDO.ts` now decodes
  `POST /push/:id/abandon` request bodies through the protocol parser.
- `packages/flarex-backend/test/push.test.ts` parses successful abandon
  responses through `parsePushStatus`.

Why it changed:

Registry proved the protocol package pattern on a tiny object. DeploymentDO is
larger and correctness-sensitive, so the next package-boundary proof should be
the smallest stable route that exercises real deployment metadata behavior
without touching activation SQL.

Convex references inspected:

- No new Convex source files were required for this slice. It preserves the
  existing deployment push state machine and only changes the TypeScript
  transport contract for abandon-push.

Flarex differences:

- Convex deployment APIs are backend-owned service contracts. Flarex is
  introducing the same idea incrementally as Effect Schema modules because the
  current Cloudflare Durable Object router is hand-written.

Known limitations:

- `PushStatus` validates the stable push envelope and source package shape, but
  keeps deep `analysis` and `codegenAnalysis` payloads as unknown for this
  narrow boundary. Full deployment analysis/codegen schemas belong in a later
  push-start or active-deployment slice.
- DeploymentDO still uses a plain fetch router and backend-local validation for
  the larger push start/finish surfaces.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "pending delivery reconciles"
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
git diff --check
```

## Registry Effect Service Test Boundary

Previous completed checkpoint: `1a7112a` Refactor registry behind Effect
service.

What changed:

- Added focused `RegistryService` tests that run against controlled Effect test
  layers instead of Miniflare.
- The tests provide `RegistryStore`, `RegistryClock`, and `RegistryIds` with
  deterministic implementations.
- `RegistryService.listDeployments` is now an explicit service method backed
  by named `Effect.fn`, matching the reusable-function pattern already used by
  `createDeployment`.

Why it changed:

The Registry service extraction should be testable without constructing a
Cloudflare Durable Object. This checkpoint proves the service package boundary
before the same pattern is copied into larger backend modules.

Convex references inspected:

- No new Convex source files were required. This is an Effect service testing
  boundary around existing RegistryDO behavior, not a Convex semantic port.

Flarex differences:

- Convex does not expose this TypeScript service/layer boundary. Flarex needs
  it because backend behavior is being incrementally lifted out of Cloudflare
  `fetch()` hosts into reusable Effect runtime code.

Known limitations:

- The tests use plain Vitest plus `ManagedRuntime` and test layers. The repo
  does not yet add `@effect/vitest`; that can be revisited if more service
  tests need shared layer lifecycle helpers.
- RegistryDO remains the only backend module with this service-level test
  shape.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/registryService.test.ts packages/flarex-backend/test/registryDO.test.ts
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
git diff --check
```

## Registry Effect Service Boundary

Previous completed checkpoint: `9a66f62` Add registry protocol schema proof.

What changed:

- `flarex-backend` now depends on the workspace Effect v4 beta catalog entry
  directly because backend runtime code owns Effect services and Layers, not
  only protocol schemas.
- Added `packages/flarex-backend/src/registry/` as a narrow module folder for
  RegistryDO internals without moving the Durable Object host file yet.
- `registry/Store.ts` owns Durable Object SQLite access and emits typed
  `RegistrySqlError` failures at the SQL boundary.
- `registry/Runtime.ts` owns clock/id services so service logic does not hide
  direct `Date.now()` or `crypto.randomUUID()` calls.
- `registry/Service.ts` owns registry behavior behind `Context.Service`,
  `Layer`, and named `Effect.fn` service methods.
- `registry/Layer.ts` composes the per-DO runtime layer from the DO's own SQL
  storage instance.

Why it changed:

The previous checkpoint proved the protocol package boundary. This checkpoint
proves the next backend package boundary: existing DO hosts can remain small
Cloudflare adapters while reusable runtime behavior moves behind Effect
services and layers.

Convex references inspected:

- No new Convex source files were required for this package-boundary slice.
- The Convex-first constraint still applies to backend semantics; this
  checkpoint only changes local Flarex composition boundaries around an
  existing RegistryDO behavior proof.

Flarex differences:

- Convex does not need a TypeScript `ManagedRuntime` bridge at its Rust
  backend boundaries. Flarex does because Durable Object `fetch()` handlers are
  non-Effect Cloudflare entrypoints.
- The DO SQL storage layer is per Durable Object instance, not global. The
  layer factory therefore accepts `ctx.storage.sql` from the DO instance.

Known limitations:

- Only RegistryDO internals use the Effect service boundary. Worker routing,
  DeploymentDO, PartitionDO, executor-http, and freshness remain unchanged.
- The RegistryDO host still uses a plain hand-written fetch router. HttpApi is
  intentionally deferred until service extraction has a reviewed proof.
- Effect service unit tests are not added yet; current coverage remains the
  focused Miniflare route tests from the previous checkpoint.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/registryDO.test.ts
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
git diff --check
```

## Schema-First Protocol Package Boundary

Previous completed checkpoint: `27afbea` Add Effect migration reviewer.

What changed:

- Added `packages/flarex-protocol` as the first schema-first internal protocol
  package.
- The package currently owns only the narrow RegistryDO proof surface:
  `Json`, `CreateDeploymentRequest`, `DeploymentRecord`,
  `ListDeploymentsResponse`, and `ProtocolValidationError`.
- `flarex-backend` now depends on `flarex-protocol` and consumes
  `CreateDeploymentRequest` decoding for `RegistryDO` create-deployment
  requests.
- `flarex-backend/src/types.ts` re-exports `DeploymentRecord` from
  `flarex-protocol` while keeping the existing backend-local mutable `Json`
  alias in place to avoid a broad cross-package type churn in this first
  checkpoint.

Why it changed:

The Effect migration needs a proven contract boundary before moving DOs,
introducing HttpApi, or reorganizing modules. Starting with RegistryDO creates
a small package-boundary proof while leaving Worker routing and Durable Object
SQL behavior unchanged.

Convex references inspected:

- No new Convex source files were required for this package-boundary slice.
- The existing Convex-first direction still applies: public SDK compatibility
  remains in `packages/flarex`, while backend protocol contracts move behind a
  runtime-neutral internal package.

Flarex differences:

- This is an Effect Schema package boundary, not a Convex port. Convex's
  backend model is Rust-owned; Flarex needs TypeScript runtime schemas for
  Cloudflare Worker and DO boundaries.
- `ValidatorJson` remains separate from Effect Schema. The new package
  validates transport/service contracts, not user document or function
  validators.

Known limitations:

- Only RegistryDO contracts are present. Deployment, partition, execution,
  scheduler, sync, and executor contracts remain in their existing packages.
- The workspace uses the Effect v4 beta line (`effect@4.0.0-beta.90`) so the
  protocol package can follow the local `effect-smol` API style, including
  `Schema.TaggedErrorClass`.
- Built-output package publishing remains future work; packages still expose
  TypeScript source.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
```

## Packed Test SDK Reset Boundary

Previous completed checkpoint: `d94ef92` Cover packed test SDK Postgres
subscriptions.

What changed:

- Added `reset()` to the `flarex-test` public package surface.
- The packed fresh-consumer fixture now imports the installed tarball and proves
  reset clears state after live-query flows for both default and Postgres
  transports.
- The Postgres packed reset path uses a string `persistDir`, so the packed
  package graph proves persisted local state cleanup through the public helper.
- Unsafe reset deletion paths are rejected by the shared `flarex-dev` resolver
  before `flarex-test` calls recursive filesystem cleanup.
- `flarex-test` precomputes the resettable path at harness creation, so invalid
  public options fail before any runtime teardown.
- The public `reset`, `reload`, and `dispose` methods run through a serialized
  lifecycle queue.

Why it changed:

Package-boundary tests should prove test helpers app developers rely on from a
clean install. Reset is a public harness contract, so it must work through the
packed dependency graph, not only in workspace source tests.

Convex references inspected:

- `npm-packages/convex/package.json`
  - package exports are the consumer boundary.
- Convex test helper ergonomics recorded in the Test SDK roadmap.

Flarex differences:

- Flarex validates reset by recreating the local runtime because Cloudflare
  Durable Objects and the Postgres/PGlite executor state are part of the tested
  behavior.
- `flarex-test` reuses the `flarex-dev` persistence resolver, keeping package
  boundary behavior aligned with the dev runtime.
- The reset deletion policy is intentionally narrower than arbitrary dev
  runtime persistence paths because it performs destructive cleanup.
- The resolver option type is derived from `FlarexDevRuntimeOptions`, keeping
  the exported package boundary tied to the dev-runtime contract.
- The package still ships source-mode exports; built NodeNext artifact
  validation remains a future package-output checkpoint.

Known limitations:

- Identity/seed helper package boundaries remain future work.
- No published package artifact format is finalized yet.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- dev.test.ts
corepack pnpm --filter flarex-dev build
corepack pnpm --filter flarex-test typecheck
corepack pnpm --filter flarex-test build
corepack pnpm --dir apps/example exec vitest run flarex/invoke-e2e.test.ts --hookTimeout=60000 --testTimeout=60000
corepack pnpm --filter @flarex/example typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Packed Test SDK Postgres Subscription Boundary

Previous completed checkpoint: `9b0486f` Cover packed test SDK Postgres invoke
flow.

What changed:

- Extended the fresh packed-consumer Postgres script to use the installed
  `flarex-test` package's `client()` helper.
- Added a generated shared live-query assertion helper so the legacy and
  Postgres packed scripts validate the same subscription contract.
- The clean installed package graph now proves Postgres-backed live query
  subscription, sync mutation, delivery, and callback update behavior through
  public package exports and generated app files.

Why it changed:

Direct Postgres invoke coverage proved that the packed test SDK can reach the
trusted executor. The package boundary still needed to prove the app-facing
sync surface, because a consumer can successfully invoke mutations while still
failing to receive live-query updates from the installed package graph.

Convex references inspected:

- `npm-packages/convex/src/browser/sync/client.ts`
  - Convex's installed client package owns live-query subscription behavior.
- `npm-packages/convex/package.json`
  - installed package exports are the consumer boundary.

Flarex differences:

- Flarex validates this through the local Postgres/PGlite executor transport
  and Miniflare WebSocket bridge. Convex does not expose the transport split.
- Built NodeNext artifact validation remains separate from this source-mode
  packed consumer gate.

Known limitations:

- This proves local PGlite-backed Postgres delivery, not a deployed
  Nitro/Vercel executor plus Cloudflare Worker WebSocket deployment.
- Identity/reset helper package boundaries remain future work.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Packed Test SDK Postgres Transport Boundary

Previous completed checkpoint: `d133982` Cover packed test SDK live query
flow.

What changed:

- Added a second packed consumer `flarex-test` runtime script for the
  Postgres/PGlite transport.
- The fresh install now proves the installed package graph can resolve
  `flarex-test -> flarex-dev -> @flarex/executor -> @flarex/persistence-postgres`
  and execute generated app functions through that graph.
- The smoke uses only public package exports and generated app files from the
  temp consumer.

Why it changed:

The Postgres executor is the forward authoritative path. Package-boundary tests
should prove that path in a clean consumer install, not only through workspace
tests where source imports and dependency resolution are more forgiving.

Convex references inspected:

- `npm-packages/convex/package.json`
  - installed package exports are the consumer boundary.
- Convex's generated-reference test ergonomics remain the model for the
  `flarex-test` consumer surface.

Flarex differences:

- Convex does not expose a second transport selector to app tests. Flarex does
  while the legacy Durable Object prototype and Postgres executor coexist.
- The packed consumer validates source-mode package exports with linked
  external dependencies; final built-output package validation remains separate.

Known limitations:

- Packed Postgres live-query delivery is still not covered here.
- This does not prove Nitro/Vercel deployment behavior; it proves the installed
  local test SDK package boundary.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Packed Test SDK Subscription Boundary

Previous completed checkpoint: `a738186` Cover packed test SDK mutation flow.

What changed:

- Extended the packed consumer test SDK smoke to use the installed
  `flarex-test` package's `client()` helper.
- The temp consumer now exercises a live query subscription and a client-side
  mutation over the sync path, then verifies the subscription receives the
  updated query result with an order-insensitive exact message-set assertion.

Why it changed:

The test SDK package boundary should cover the app-facing sync surface as well
as direct invoke helpers. A package can import and run direct mutations but
still fail to expose a usable WebSocket-backed client from a clean consumer.

Convex references inspected:

- `npm-packages/convex/src/browser/sync/client.ts`
  - Convex's installed client package owns live query subscription behavior.
- `npm-packages/convex/package.json`
  - installed package exports are the consumer boundary.

Flarex differences:

- Flarex validates this through a source-mode packed consumer and the test
  SDK's Miniflare WebSocket bridge. Convex validates against its hosted sync
  service/runtime.

Known limitations:

- This proves legacy/local dev sync behavior from a packed consumer. The
  Postgres executor delivery path remains covered by example E2E, not by a
  packed `flarex-test` consumer yet.
- Built NodeNext artifact validation remains future work.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Packed Test SDK Mutation Boundary

Previous completed checkpoint: `5cb7dee` Run packed test SDK against
generated app.

What changed:

- Added a generated `messages.send` mutation to the packed fresh-consumer
  fixture.
- The packed consumer now invokes both generated query and mutation references
  through the installed `flarex-test` package.
- The mutation result and the follow-up query prove the write path persists
  data through the packed consumer runtime, including matching the returned id
  to the queried document `_id`.

Why it changed:

Package boundaries for test helpers should prove the app-facing behavior that
developers rely on. A read-only query smoke did not prove that the installed
test SDK can drive mutation sessions and observe committed writes through the
same generated app API.

Convex references inspected:

- `npm-packages/convex/package.json`
  - installed package exports are the consumer boundary.
- Convex test-helper ergonomics remain the model for invoking generated app
  functions through a compact test harness.

Flarex differences:

- Flarex validates this through a temp source-mode package consumer and local
  Miniflare/dev runtime. Convex publishes built artifacts and targets its own
  backend/test runtime.

Known limitations:

- This proves a single-partition write in the packed consumer. Subscription was
  added in the next checkpoint; identity, reset, and Postgres-transport
  consumer gates remain future work.
- Built NodeNext artifact validation remains future work.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Packed Test SDK Invocation Boundary

Previous completed checkpoint: `44878a0` Add packed consumer smokes for test
and Nitro packages.

What changed:

- Added a packed-consumer `flarexTest()` invocation script to
  `integration/fresh-consumer-pack.integration.test.ts`.
- The fresh consumer now generates `_generated/api`, imports it from the temp
  app, boots the installed packed `flarex-test` runtime, invokes
  `api.messages.list`, and disposes the harness.
- The invocation uses the installed SDK's `encodeFlarexId` helper so the packed
  package graph proves branded ID construction as well as function invocation.
- The packed script reads the generated `deploymentSchema` table metadata for
  the table id instead of hard-coding the analyzer's current numeric table
  assignment.
- The table name is checked against generated `TableNames` before constructing
  the ID, keeping source package, generated metadata, and public ID helper
  usage in one consumer path.
- The packed consumer declares `tsx` directly for runtime smokes instead of
  relying on transitive dev-tool availability.

Why it changed:

Package boundaries should prove more than importability for app-facing helper
packages. `flarex-test` is intended to be used from application test code, so a
clean consumer must be able to run the harness against generated Flarex app
code.

Convex references inspected:

- `npm-packages/convex/package.json`
  - installed SDK exports are the consumer boundary.
- Convex test-helper ergonomics remain the mental model for a compact app test
  harness.

Flarex differences:

- Flarex validates the source-mode package through a temp consumer and local
  Miniflare/dev runtime. Convex publishes built artifacts and targets its own
  backend environment.

Known limitations:

- This proves a read-only query invocation from a packed app. Mutation,
  subscription, and identity helper coverage remain future package-boundary
  gates.
- Built NodeNext artifact validation remains future work.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Test SDK And Nitro Fresh-Consumer Boundary

Previous completed checkpoint: `fad789f` Add test SDK and Nitro package
boundaries.

What changed:

- Extended the packed fresh-consumer install gate to include:
  - `flarex-test`,
  - `@flarex/executor-nitro`.
- The temp consumer now installs both packages from local tarballs alongside
  the existing Flarex package graph.
- The fixture override matrix now maps every packed internal package, including
  transitive dependencies such as `flarex-test -> flarex-dev`, to the local
  tarball produced during the test.
- Shared internal package metadata now lives in `packabilityHelpers.ts` so the
  tarball-shape test and the fresh-consumer test do not maintain divergent
  package name/root/tarball lists.
- Added a consumer smoke file that imports the Nitro adapter factory and the
  test SDK public factory/error/type surface from the installed packages, then
  runs both `tsc` and `tsx` from the fresh consumer.

Why it changed:

The previous checkpoint proved tarball shape only. Package boundaries are more
useful when the package can also be installed and resolved from a clean app
graph, because source-mode exports can hide missing dependency or TypeScript
resolution problems until consumed outside the workspace.

Convex references inspected:

- `npm-packages/convex/package.json`
  - Convex package metadata treats exports and installable contents as the SDK
    boundary.
- Convex's npm package flow remains the model: the consumer should import the
  public package, not workspace source paths.

Flarex differences:

- Flarex still validates TypeScript-source tarballs. Convex publishes built SDK
  artifacts.
- `@flarex/executor-nitro` is a Flarex host adapter; Convex does not expose a
  Nitro/Vercel adapter package.

Known limitations:

- The smoke imports `flarex-test` and `@flarex/executor-nitro`, but it does not
  run a complete packed-app invocation through `flarex-test` yet.
- The Nitro adapter smoke proves import/runtime resolution, not an end-to-end
  Nitro server deployment.
- The consumer typecheck uses Flarex's current Vite/Bundler-style source
  package resolution. Built NodeNext artifact validation remains future work.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/internal-packages-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/internal-packages-pack.integration.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Test SDK And Nitro Adapter Tarball Boundaries

Previous completed checkpoint: `339e671` Add packed consumer generated
typecheck gate.

What changed:

- Added explicit package `files` boundaries for:
  - `flarex-test`: `src`,
  - `@flarex/executor-nitro`: `src`.
- Extended `integration/internal-packages-pack.integration.test.ts` to include
  both packages.
- The shared packability gate now proves these tarballs include only their
  exported source entrypoint, exclude tests/config, and avoid local-only
  dependency protocols in packed manifests.

Boundary rule:

Every source-mode package should have an explicit npm `files` surface before it
is used as a dependency in examples, tests, or adapters. Tests and TypeScript
config are repo development surface, not runtime package surface.

Convex references inspected:

- `npm-packages/convex/package.json`
  - Convex controls installable package contents through explicit package
    metadata and exports.

Flarex differences:

- Flarex still publishes TypeScript source in this prototype. Convex publishes
  built artifacts.
- `@flarex/executor-nitro` is a Flarex-specific host adapter; Convex does not
  need a Nitro adapter for its hosted backend.

Known limitations:

- This is tarball-shape coverage only. It does not yet install `flarex-test` or
  `@flarex/executor-nitro` in a fresh consumer fixture.
- Built `dist` package output remains a future boundary.

Verification:

```sh
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/internal-packages-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/internal-packages-pack.integration.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Packed Consumer Typecheck Boundary

Previous completed checkpoint: `395ac9f` Add packed consumer codegen smoke.

What changed:

- The packed consumer command gate now proves normal codegen and generated
  output typechecking, not only dry-run reporting.
- The consumer directly provides packed `flarex`, packed `flarex-dev`, linked
  `typescript`, and linked `@cloudflare/workers-types`.

Boundary rule:

Consumer package graph tests should include the packages that user source and
generated output actually depend on. A passing installed CLI smoke is not enough
if generated output cannot typecheck from the same consumer graph.

Convex references inspected:

- `npm-packages/convex/package.json`
  - package exports and type surfaces are part of the installed SDK contract.
- `packages/flarex-dev/src/generatedTypecheck.ts`
  - Flarex's generated-output typecheck requirements.

Flarex differences:

- This still validates source-mode packages with local dependency links.
  Convex publishes built package artifacts.

Known limitations:

- Deploy/backend push remains a future packed-consumer boundary.
- `flarex-test` and `@flarex/executor-nitro` remain outside this package graph
  gate until their own packed-consumer tests are added.

Verification:

```sh
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Packed Consumer Command Boundary

Previous completed checkpoint: `982396a` Add fresh consumer package install
gate.

What changed:

- The fresh-consumer package graph gate now executes a real installed CLI
  command, not just `--help`.
- The packed `flarex-dev` tarball must be able to analyze a minimal consumer
  `flarex/` source tree and produce dry-run generated file output.
- The consumer also installs packed `flarex` directly, so the source/runtime SDK
  boundary used by `flarex/server` and `flarex/values` is represented explicitly.

Boundary rule:

Package graph gates should prove two things:

- the package manager can install the packed graph outside the monorepo, and
- the installed CLI can execute meaningful user-facing commands from that
  consumer context.

Convex references inspected:

- `npm-packages/convex/package.json`
  - Convex's npm package boundary includes executable SDK/CLI behavior from the
    installed artifact.
- `packages/flarex-dev/test/fixtures.ts`
  - minimal Flarex project shape reused for command execution.

Flarex differences:

- Flarex source-mode packages still require local public dependency links in
  the packed consumer fixture; Convex publishes built artifacts.

Known limitations:

- Dry-run codegen is covered, but generated-output typecheck and deploy are
  still separate future package-boundary gates.
- The test does not yet cover `flarex-test` or `@flarex/executor-nitro`.

Verification:

```sh
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Fresh Consumer Package Graph Boundary

Previous completed checkpoint: `85faa2d` Add remaining package packability
gates.

What changed:

- Added a fresh-consumer install gate that packs the SDK/dev/runtime Flarex
  packages required by `flarex-dev`, installs `flarex-dev` into a temporary
  project, and verifies the installed CLI starts.
- Internal Flarex packages are consumed as tarballs, not workspace links.
- External public runtime dependencies are linked from the local workspace so
  the gate isolates package graph correctness from registry/network behavior.
- The install uses a temp pnpm store in offline mode so only explicit tarball
  and link dependencies are available.

Boundary rule:

Package boundary tests now have two layers:

- Tarball shape: each package exposes only intended files and exports.
- Consumer graph: `flarex-dev` can install from packed Flarex tarballs and run
  outside the monorepo.

Convex references inspected:

- `npm-packages/convex/package.json`
  - packages SDK surface through explicit exports and npm-installable artifact
    layout.

Flarex differences:

- Convex's registry package resolves through published packages. Flarex's local
  test must use tarball overrides until the internal packages are actually
  published.
- `flarex-test` and `@flarex/executor-nitro` are excluded for now because they
  are not part of the `flarex-dev` packed runtime graph.

Known limitations:

- The graph gate does not yet verify built output because Flarex packages still
  publish TypeScript source.
- The gate does not prove external package registry availability.

Verification:

```sh
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Remaining Source Package Tarball Boundaries

Previous completed checkpoint: `e07b1e5` Add internal package packability
gates.

What changed:

- Added explicit package `files` boundaries for:
  - `@flarex/persistence-postgres`: `drizzle` and `src`,
  - `@flarex/freshness`: `src`,
  - `@flarex/executor`: `src`,
  - `@flarex/executor-http`: `src`.
- Extended packability coverage to prove those tarballs contain public export
  targets, exclude development-only entries, and avoid local-only dependency
  protocols in packed manifests.
- The persistence boundary is journal-driven: every Drizzle migration SQL file
  and snapshot listed by `drizzle/meta/_journal.json` must be present in the
  tarball.

Boundary rule:

Internal source-mode packages should publish only their runtime source and
explicit runtime assets. Test files, Vitest config, and TypeScript config are
not package runtime surface. Migration assets are allowed only for persistence
packages whose runtime migration helpers resolve them.

Packability tests enforce this boundary by rejecting test/spec files,
`test`/`tests`/`__tests__` directories, fixture directories, and nested
Vite/Vitest/TypeScript config files unless a package case explicitly allows a
runtime test harness entry.

Convex references inspected:

- `npm-packages/convex/package.json`
  - controls npm package boundaries with explicit `files`.

Flarex differences:

- Flarex persistence currently ships Drizzle SQL migration assets directly in
  the source tarball. Convex publishes a built package surface instead.

Known limitations:

- This does not verify install-time behavior in a fresh consumer yet.
- Future built packages may replace source-mode `files` boundaries with `dist`
  boundaries.

Verification:

```sh
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/cli-pack.integration.test.ts integration/internal-packages-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/cli-pack.integration.test.ts integration/internal-packages-pack.integration.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm --filter @flarex/freshness build
corepack pnpm --filter @flarex/executor build
corepack pnpm --filter @flarex/executor-http build
corepack pnpm --filter @flarex/persistence-postgres pack --dry-run
corepack pnpm --filter @flarex/freshness pack --dry-run
corepack pnpm --filter @flarex/executor pack --dry-run
corepack pnpm --filter @flarex/executor-http pack --dry-run
git diff --check
```

## Source Package Tarball Boundaries

Previous completed checkpoint: `000379c` Add flarex-dev packability gate.

What changed:

- Added explicit package `files` boundaries for:
  - `flarex`: `LICENSE.convex` and `src`,
  - `flarex-backend`: `src` and `test/backendHarness.ts`.
- Added optional peer dependencies for `miniflare` and `vite` because the
  public `flarex-backend/test/backendHarness` export imports those packages.
- Added packability coverage proving those peers are marked optional in the
  packed manifest.
- Added integration coverage proving those tarballs contain their public export
  targets and exclude broad test/config files.

Boundary rule:

Published source-mode packages should expose only the files referenced by their
public package surface. Tests, Vitest config, and TypeScript project config are
not package runtime surface. Existing exported test helpers and test-namespaced
exports must be named and allowed explicitly instead of leaking whole `test/`
directories. If a public test helper imports test/runtime packages, those
packages must be declared as dependencies or peers instead of staying only in
`devDependencies`.

Convex references inspected:

- `npm-packages/convex/package.json`
  - uses explicit `files` to control the npm package boundary.

Flarex differences:

- Flarex still ships TypeScript source in these packages; Convex ships built
  artifacts.
- `flarex-backend` still has public `./test/backendHarness` and
  `./test/sync-protocol` exports. This checkpoint preserves the existing
  exports and limits the package to the exact test helper file plus source
  targets.

Known limitations:

- This does not decide whether `./test/backendHarness` or `./test/sync-protocol`
  should remain public long-term.
- Other internal packages still need the same boundary hardening.

Verification:

```sh
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/cli-pack.integration.test.ts integration/internal-packages-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/cli-pack.integration.test.ts integration/internal-packages-pack.integration.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex build
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex pack --dry-run
corepack pnpm --filter flarex-backend pack --dry-run
git diff --check
```

## DeliveryDO Executor Injection Implementation

Previous completed checkpoint: `f12a7d2` Add live query delivery claim ack
APIs.

What changed:

- Implemented `DeliveryDO` in `packages/flarex-backend` without importing
  executor internals.
- `DeliveryDO` calls executor claim/ack through injected env config:
  - `FLAREX_EXECUTOR` service binding, or
  - `FLAREX_EXECUTOR_URL` external endpoint,
  - `FLAREX_EXECUTOR_TOKEN` optional bearer token.
- Added `DELIVERIES` to backend Miniflare and Wrangler Durable Object bindings.
- Re-exported `DeliveryDO` from the deployable backend wrapper.

Boundary rule preserved:

Cloudflare owns fanout. The executor owns durable delivery-row state. The only
runtime contract between them is HTTP claim/ack.

Convex references inspected:

- `crates/sync/src/state.rs`
- `crates/sync/src/worker.rs`

Known limitations:

- No shared typed HTTP client package exists yet; `DeliveryDO` currently owns
  minimal response parsing.
- No queue/alarm continuation boundary yet.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter flarex-dev typecheck
```

## Executor Injection For DeliveryDO

Previous completed checkpoint: `e4ddeca` Plan DeliveryDO live query fanout.

What changed:

- Added platform-agnostic claim/ack methods to `@flarex/executor`.
- Exposed them through `@flarex/executor-http` and `@flarex/executor-nitro`.
- Kept Cloudflare-specific delivery work out of executor packages.

Boundary rule:

`DeliveryDO` should receive an injected executor client/config later:

```ts
{
  executorUrl,
  capabilityToken,
}
```

It should call the executor over HTTP:

```txt
POST /maintenance/live-queries/claim
POST /maintenance/live-queries/ack
```

It should not import `@flarex/executor`, open Postgres connections, or depend
on Nitro internals.

Convex references inspected:

- `crates/sync/src/state.rs`
- `crates/sync/src/worker.rs`

Flarex difference:

Convex's sync worker does not need an injected executor boundary. Flarex keeps
the boundary explicit because Cloudflare fanout and trusted Postgres execution
are separate runtime deployments.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-nitro typecheck
```

## DeliveryDO Production Boundary

Previous completed checkpoint: `3288183` Wire live query delivery callback
bridge.

Decision:

Production live-query delivery should be split like this:

```txt
@flarex/executor
  owns durable delivery-row claim/ack semantics

@flarex/executor-http / @flarex/executor-nitro
  expose authenticated claim/ack routes

packages/flarex-backend
  owns Cloudflare DeliveryDO, wake route, ConnectionDO fanout

ConnectionDO
  owns per-client sync state and Transition emission
```

Boundary rule:

- Vercel/Nitro may notify Cloudflare after commit.
- Vercel/Nitro should not own an unbounded fanout loop.
- Cloudflare `DeliveryDO` should own bounded fanout and retries because it runs
  next to `ConnectionDO`.
- The direct executor HTTP callback helper remains a test/fallback primitive,
  not the preferred production drain owner.

Convex references inspected:

- `crates/sync/src/state.rs`
- `crates/sync/src/worker.rs`

Flarex difference:

Convex's sync worker is colocated with backend state. Flarex needs an explicit
runtime boundary because the trusted Postgres executor and Cloudflare WebSocket
ownership are separate deployments.

Verification:

```sh
git diff --check
```

## Live-Query Delivery Bridge Boundary

Previous completed checkpoint: `4e4d736` Add ConnectionDO live query delivery
consumer.

What changed:

- `packages/flarex-backend` now owns the Cloudflare-specific delivery route
  and `ConnectionDO` fanout:
  `POST /deployments/:deploymentId/sync/deliver-live-query`.
- `@flarex/executor-http` now owns a framework-neutral HTTP callback helper:
  `createFlarexBackendLiveQueryDelivery(...)`.
- `@flarex/executor-nitro` re-exports that helper for Nitro/Vercel executor
  apps.

Boundary rule:

- Executor core decides when rows can be acked.
- HTTP/Nitro adapter wires a `deliver(...)` callback.
- Cloudflare backend Worker owns Durable Object namespace access.
- `ConnectionDO` owns the live WebSocket session and transition versioning.

Convex references inspected:

- `crates/sync/src/state.rs`
- `crates/sync/src/worker.rs`

Flarex difference:

Convex does not need this package split because its sync worker and backend
execution are part of the same trusted backend. Flarex needs the split so a
trusted Postgres executor can run on Nitro/Vercel while Cloudflare still owns
WebSocket fanout.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-nitro typecheck
```

## Postgres Executor Package Boundary Pivot

Previous completed checkpoint: `beef4d2` Document Postgres multitenant
persistence schema.

The Postgres-authoritative plan changes the package target. The trusted
executor must be framework-neutral core first, not a Nitro app first.

New target packages:

```txt
packages/persistence-postgres
  generic document/index persistence and PGlite/Postgres adapters

packages/executor
  trusted transaction executor core with a stable fetch/direct-call protocol

packages/executor-nitro
  Nitro/Vercel adapter only

packages/flarex-test
  in-process executor harness using PGlite by default
```

`packages/flarex-backend` remains the current Cloudflare DO prototype while the
Postgres executor is introduced. It should not grow new Postgres transaction
logic directly. The refactor path is to extract/port reusable contracts into
executor/postgres packages, then retire the authoritative `PartitionDO` commit
path after the Postgres executor is proven.

Detailed plan: `roadmaps/20-postgres-executor.md`.

Convex references:

- `crates/database/src/transaction.rs`
- `crates/database/src/committer.rs`
- `crates/application/src/application_function_runner/mod.rs`
- `npm-packages/convex/src/cli/lib/dev.ts`

Flarex difference:

- Nitro is a production host adapter for Vercel, while local dev and tests call
  the same executor core in-process.

Verification:

```sh
git diff --check
```

## Problem

The current prototype has a bad package boundary:

```ts
return resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/backend/src/worker.ts");
```

This makes the tooling package reach upward into `apps/backend`. It proves the
local dev path can reuse the real backend Worker, but it is not an acceptable
long-term structure.

## Decision

Keep exactly one real backend implementation and reuse it from dev, tests, and
production deployment.

Target package shape:

```txt
packages/flarex
  public SDK used by app code
  defineSchema, defineTable, query, mutation, v, client

packages/flarex-backend
  actual backend Worker runtime
  RegistryDO, DeploymentDO, PartitionDO, ExecutionDO, SchedulerDO, ConnectionDO
  exports Worker entry and Durable Object classes

packages/flarex-dev
  generator, Vite plugin, local dev runtime
  starts Miniflare using packages/flarex-backend

packages/flarex-test
  test SDK
  reuses the same local runtime core as flarex-dev

packages/flarex-core
  optional later extraction for shared pure contracts
  only create when SDK/backend/dev duplicate real shared logic

apps/backend
  thin deployable Cloudflare Worker wrapper around packages/flarex-backend

apps/example
  normal application using packages/flarex and optionally packages/flarex-dev
  no app-owned Wrangler deployment config
```

## Why

This matches the Convex-like model:

```txt
one backend/runtime implementation
  reused by hosted/backend deployment
  reused by local dev server
  reused by test harness
```

The Vite plugin should not implement a fake backend. It should start the real
backend runtime package in Miniflare. The test SDK should do the same unless a
separate pure mock is intentionally added later.

## Convex References

- `npm-packages/convex/src/cli/lib/localDeployment/run.ts`
  - Convex local dev starts a real local backend process rather than turning
    the application into a backend deployment.
- `npm-packages/convex/src/cli/lib/dev.ts`
  - Convex dev orchestrates codegen, push, watches, and a running backend.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - Generated app files support type-safe function authoring and client APIs;
    they are not app-owned deployment infrastructure.

## Cloudflare Difference

Flarex needs a generated app Worker bundle because user functions execute in a
Cloudflare-compatible runtime. That does not mean the user's app should own a
Wrangler deployment. The generated Worker is a runtime artifact loaded by:

- hosted Flarex platform,
- local dev Miniflare runtime,
- test SDK runtime.

The actual Wrangler deployment target is the Flarex backend/platform Worker.

## Follow-Up Work

1. Add `packages/flarex-core` only when shared pure contracts need extraction.

## Verification

## Implementation Update

Completed the package split:

- renamed the tooling package from `packages/flarex-backend` to
  `packages/flarex-dev`,
- moved the real backend Worker runtime and backend tests from `apps/backend`
  into `packages/flarex-backend`,
- added a thin deployable wrapper at `apps/backend/src/worker.ts`,
- updated `packages/flarex-dev/src/dev.ts` to resolve
  `flarex-backend/worker` instead of `../../../apps/backend/src/worker.ts`,
- updated example app imports to use `flarex-dev` for generation/Vite and
  `flarex-backend` for backend test utilities.

The current runtime path is now:

```txt
packages/flarex-dev
  -> starts generated app Worker Miniflare
  -> starts packages/flarex-backend Worker Miniflare

apps/backend
  -> deployable Wrangler wrapper around packages/flarex-backend
```

Convex reference:

- `npm-packages/convex/src/cli/lib/localDeployment/run.ts`
  - Local dev starts a backend runtime owned by the platform, not by the app.
- `npm-packages/convex/src/cli/lib/dev.ts`
  - Dev tooling orchestrates the backend and generated app code.

Cloudflare difference:

- Flarex packages the backend as a Worker/Durable Object runtime that can be
  loaded by Miniflare in dev/tests and by Wrangler through `apps/backend`.

Verification:

```sh
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
corepack pnpm --filter flarex build
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-dev build
corepack pnpm --filter @flarex/example build
corepack pnpm --filter @flarex/backend build
```

The deployable wrapper now separates local build verification from Wrangler
deployment validation:

```sh
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter @flarex/backend deploy:dry-run
```

`build` typechecks the thin wrapper. `deploy:dry-run` keeps the Wrangler
command for explicit deployment checks without making normal workspace builds
depend on Wrangler.

## Codegen Boundary Update

App codegen no longer accepts `generateWrangler` or `workerName` and never
writes an app-owned Wrangler configuration. `flarex-dev` now explicitly
depends on the public `flarex` SDK because its module analyzer must resolve and
bundle developer imports such as `flarex/server`.

Convex reference:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - Application codegen emits generated developer bindings, not deployment
    configuration for the frontend application.
- `npm-packages/convex/src/cli/lib/components.ts`
  - CLI tooling owns bundling, analysis orchestration, and final codegen.

Cloudflare difference:

- Flarex final codegen additionally emits a generated user-function Worker
  runtime artifact, but Flarex dev/test/hosted infrastructure owns loading it.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example generate
```

## Local Backend Push Coordinator Update

Previous completed checkpoint: `3cbd471` Return codegen analysis from push
start.

Added `LocalBackendPushCoordinator` to `packages/flarex-dev`. This keeps local
dev orchestration separate from both:

- the backend Durable Object runtime in `packages/flarex-backend`, and
- the execution-artifact analyzer adapter in `packages/flarex-dev`.

The coordinator is the local stand-in for a hosted backend artifact service:
it accepts a `SourcePackage`, runs the local execution-artifact analyzer, sends
validated analysis to backend `push/start`, and returns the backend push
status used by final codegen.

Convex reference:

- `npm-packages/convex/src/cli/lib/components.ts`
  - CLI orchestration coordinates source bundling, push, final codegen, and
    activation without making application code own backend runtime details.

Cloudflare difference: local Flarex needs a Node-side coordinator because a
Miniflare backend Worker cannot spawn another Miniflare runtime for candidate
artifact analysis. Hosted Flarex should replace this local coordinator with a
backend Dynamic Worker analyzer service for uploaded source packages.

The package also gained its own Vitest config so `flarex-dev` test files run
serially. This matches `flarex-backend` and keeps package-local Vite/esbuild/
Miniflare tests stable during `pnpm -r test`.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## Backend Analyzer Boundary Update

Previous completed checkpoint: `67b2e04` Move local analysis behind push
coordinator.

`packages/flarex-dev` now names the analyzer dependency explicitly:

```ts
interface BackendSourceAnalyzer {
  analyze(sourcePackage: SourcePackage): Promise<DeploymentAnalysis>;
}
```

`LocalExecutionArtifactBackendAnalyzer` wraps the local Miniflare execution
artifact adapter. `LocalBackendPushCoordinator` depends on this analyzer
interface and posts analyzed candidates to the internal
`/push/start-analyzed` route.

This keeps package responsibilities clearer:

- `flarex-dev` owns local orchestration and local analyzer adapters.
- `flarex-backend` owns Durable Object candidate state and activation.
- Public `StartPushRequest` is source-only and no longer contains analysis.

Convex reference:

- `npm-packages/convex/src/cli/lib/components.ts`
  - CLI orchestration coordinates source push and consumes backend analysis,
    but the analyzed deployment contract is backend-owned.

Cloudflare difference: Flarex still needs a local Node-side analyzer adapter
until the backend platform can load candidate source packages into the hosted
Dynamic Worker analyzer itself.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## Live-Query Trigger Notifier Boundary

Previous completed checkpoint: `5437ca8` Document live query route ownership.

What changed:

- `@flarex/executor` owns the post-commit live-query invalidation hook shape.
- `@flarex/executor-http` owns
  `createFlarexBackendLiveQueryTriggerNotifier(...)`, the HTTP helper that
  calls Cloudflare's scheduler trigger route.
- Executor core still does not import Cloudflare backend code, Worker types, or
  Nitro route code.

Why it changed:

The trusted executor must know when a mutation has committed, but the method
for waking Cloudflare is host-specific. Keeping the notifier injected preserves
the package boundary while letting Nitro/Vercel deployments call the
Cloudflare scheduler.

Convex reference:

- `crates/database/src/committer.rs`
  - commit publication is backend-owned.
- `crates/sync/src/worker.rs`
  - sync scheduling is backend-owned but internal in Convex.

Flarex difference:

- Convex does not need an exported notifier helper. Flarex needs one because
  executor hosting and WebSocket/scheduler hosting are separate.

Known limitations:

- The deployable host still needs to construct the executor with a durable
  freshness store and this trigger notifier.
- Durable retry for failed trigger notification remains future work.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http exec vitest run test/http.test.ts
corepack pnpm --filter @flarex/executor-http typecheck
```

## Local PGlite Executor Host Composition

Previous completed checkpoint: `730d284` Trigger live query invalidation after
commit.

What changed:

- Added `createLocalPGliteExecutorHttpRuntime(...)` in `flarex-dev`.
- Kept `@flarex/executor` framework-neutral.
- Kept HTTP trigger construction in `@flarex/executor-http`.
- Made `flarex-dev` the local composition layer that imports PGlite,
  freshness, executor, and executor HTTP helpers.

Why it changed:

The platform needs one place that assembles the real local/test host without
turning executor core into a Cloudflare or Nitro package. `flarex-dev` is the
right layer for local composition because it already owns local runtime
orchestration and test/dev helpers.

Convex references:

- `npm-packages/convex/src/cli/lib/dev.ts`
  - Convex local dev owns orchestration around the backend, not the database
    core itself.
- `crates/database/src/committer.rs`
  - commit remains backend-owned.
- `crates/sync/src/worker.rs`
  - sync scheduling remains backend-owned.

Flarex differences:

- Convex does not split a local PGlite executor from a Cloudflare scheduler.
  Flarex local composition must wire those boundaries explicitly.

Known limitations:

- Production Nitro/Vercel host construction still needs its own equivalent
  factory/config using real Postgres.
- Durable retry for failed post-commit trigger notification remains future
  work.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/executorHttpRuntime.test.ts
```

## Stale Rerun Fanout Boundary

Previous completed checkpoint: `0139e0d` Wire live query dead-letter
reconnects.

What changed:

- `@flarex/executor` remains the owner of stale subscription rerun and durable
  live-query delivery-row creation.
- `packages/flarex-backend` now owns the Cloudflare consumer:
  `SchedulerDO` calls executor `/maintenance/live-queries/rerun` and wakes the
  deployment `DeliveryDO` only when changed subscriptions are reported.
- The Worker route
  `POST /scheduler/live-query-subscriptions/rerun` is a Cloudflare backend
  maintenance route, not a new executor-core API.

Why it changed:

- This preserves the platform split: trusted Postgres/executor logic decides
  what changed and persists delivery rows; Cloudflare DOs handle connection
  fanout and WebSocket state.

Convex references:

- `crates/sync/src/worker.rs`
  - Convex keeps sync-session update scheduling and transition production
    inside one backend worker.
- `crates/sync/src/state.rs`
  - query-set state owns active query subscriptions and result hashes.
- `npm-packages/convex/src/browser/sync/client.ts`
  - client-side sync consumes transitions and updates local query observers.

Flarex differences:

- Convex does not expose an executor/backend fanout boundary. Flarex must,
  because the executor can run on Nitro/Vercel while WebSockets and `DeliveryDO`
  live in Cloudflare.
- The Cloudflare backend does not inspect or construct changed query payloads;
  it drains durable delivery rows through the existing delivery claim/ack API.

Known limitations:

- Other adapters need their own equivalent rerun consumer if they do not use
  Cloudflare Durable Objects.
- Automatic scheduler continuation for `hasMoreStale` remains future work.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "reruns stale live query subscriptions"
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## Scheduler Rerun Continuation Boundary

Previous completed checkpoint: `0386055` Fan out stale live query reruns.

What changed:

- `packages/flarex-backend` now persists pending stale-rerun continuation state
  inside `SchedulerDO` storage.
- Continuation remains Cloudflare-specific and does not add new executor-core
  APIs.
- Executor remains responsible for stale scan, rerun execution, durable
  delivery-row creation, and the existing claim/ack API.

Why it changed:

- The scheduler needs to continue bounded work when the executor reports
  `hasMoreStale`, but that continuation is runtime orchestration, not
  persistence or transaction semantics.

Convex references:

- `crates/sync/src/worker.rs`
  - sync worker owns update scheduling and retry inside Convex's backend
    runtime.
- `crates/sync/src/state.rs`
  - sync state tracks invalidated queries and subscription refills.

Flarex differences:

- Flarex persists continuation in `SchedulerDO` because execution may be split
  across Cloudflare and Nitro/Vercel. Convex does not expose this boundary.
- The internal `/continue-live-query-reruns` route is a Cloudflare testing and
  alarm hook, not a public executor route.

Known limitations:

- The current scheduler instance stores a single pending rerun job. If future
  trigger routing uses one scheduler DO for many deployments, this must become
  a queue or deterministic per-deployment scheduler naming.
- Retry observability is still only implicit in Durable Object alarm state.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "continues stale live query reruns"
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## Live-Query Trigger Route Boundary

Previous completed checkpoint: `986442c` Continue stale live query reruns.

What changed:

- `packages/flarex-backend` now exposes
  `POST /scheduler/live-query-subscriptions/trigger`.
- The route is a Cloudflare backend boundary that forwards to `SchedulerDO`'s
  existing bounded stale-rerun flow.
- No executor-core API changed.

Why it changed:

- Future freshness projection or commit outbox workers need a stable runtime
  boundary to wake live-query reruns without knowing executor internals or
  `DeliveryDO` mechanics.

Convex references:

- `crates/sync/src/worker.rs`
  - update scheduling is internal to Convex's sync backend.
- `crates/sync/src/state.rs`
  - sync state owns query invalidation and subscription refill.

Flarex differences:

- Flarex has an explicit trigger boundary because the producer may live in
  Cloudflare while stale scan/rerun/delivery-row creation remain executor
  owned.
- The trigger route is an alias into the Cloudflare scheduler flow, not a
  duplicate delivery mechanism.

Known limitations:

- The actual producer hook is still future work.
- The trigger route currently uses the same live-query delivery capability
  token as delivery maintenance routes.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "triggers stale live query reruns"
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## Dead-Letter Reconnect Boundary

Previous completed checkpoint: `038649e` Add live query delivery dead
lettering.

What changed:

- The executor remains responsible for the durable stuck-delivery policy:
  selecting stuck rows, marking them dead-lettered, and returning
  `reconnectConnectionIds`.
- `packages/flarex-backend` now owns the Cloudflare-specific consumer:
  `SchedulerDO` calls the executor maintenance endpoint and then calls
  `ConnectionDO /force-reconnect` for each returned connection name.
- The worker route
  `POST /scheduler/live-query-deliveries/dead-letter` is an authenticated
  Cloudflare backend route, not a new executor-core API.

Why it changed:

- Reconnect fanout is runtime-specific. Keeping it in `flarex-backend` preserves
  the framework-neutral executor boundary while still letting the Cloudflare
  runtime recover stuck sync sessions.

Convex references:

- `npm-packages/convex/src/browser/sync/web_socket_manager.ts`
  - reconnect is driven by WebSocket lifecycle state.
- `npm-packages/convex/src/browser/sync/client.ts`
  - reconnect reissues active query and request state.
- `crates/sync/src/worker.rs`
  - server-side sync session ownership is a backend runtime concern.

Flarex differences:

- Convex has one integrated backend sync runtime. Flarex splits policy
  (`@flarex/executor`) from Cloudflare connection fanout
  (`packages/flarex-backend`).
- The executor does not import Durable Object types or know how to reach a
  `ConnectionDO`.

Known limitations:

- Other hosting adapters still need their own consumer if they support live
  sync without Cloudflare Durable Objects.
- Automatic stuck-delivery scheduling is intentionally not in executor core.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "dead-letters stuck live query deliveries"
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## Delivery Failure Boundary

Previous completed checkpoint: `d1bc1fe` Add live query delivery reconciler.

Boundary decision:

- `@flarex/persistence-postgres` owns the delivery-row failure columns and
  low-level update operation.
- `@flarex/executor` owns validation and the framework-neutral
  `recordLiveQueryDeliveryFailure(...)` API.
- `@flarex/executor-http` exposes the maintenance route for deployed executor
  hosts.
- `packages/flarex-backend` calls that route from `DeliveryDO` when fanout or
  ack fails.

This keeps Cloudflare Durable Objects from owning durable failure history while
still letting them report runtime failures at the correct boundary.

Convex difference:

- Convex does this work inside one backend sync runtime. Flarex preserves the
  same durable-before-deliver principle with explicit executor/edge handoff
  APIs.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter flarex-backend typecheck
```

## Stuck Delivery Read Boundary

Previous completed checkpoint: `b35e2ca` Record live query delivery failures.

Boundary decision:

- `@flarex/persistence-postgres` owns the query over delivery failure columns.
- `@flarex/executor` owns validation/defaulting for `limit` and `minAttempts`.
- `@flarex/executor-http` exposes
  `/maintenance/live-queries/stuck-deliveries`.
- Cloudflare runtime does not own this state; it may call the endpoint later
  for operator tooling or dead-letter policy, but persistence stays executor
  owned.

Convex difference:

- Convex has no equivalent public split because sync workers and durable
  backend state are colocated. Flarex exposes the boundary to preserve the same
  durable-before-deliver principle across runtimes.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-nitro typecheck
```

## Dead-Letter Policy Boundary

Previous completed checkpoint: `14925e0` List stuck live query deliveries.

Boundary decision:

- `@flarex/persistence-postgres` owns the row mutation that marks live-query
  deliveries dead-lettered.
- `@flarex/executor` owns the policy that consumes stuck candidates and
  decides which rows to dead-letter.
- `@flarex/executor-http` exposes maintenance routes for hosted executor
  deployments.
- `packages/flarex-backend` remains unchanged in this checkpoint; a future
  Cloudflare scheduler/connection consumer can use the returned
  `reconnectConnectionIds`.

Convex files inspected:

- `crates/sync/src/worker.rs`
- `npm-packages/convex/src/browser/sync/web_socket_manager.ts`

Flarex difference:

- Convex's sync worker and client websocket manager own retry/reconnect
  behavior without a split maintenance API.
- Flarex must make the executor/Cloudflare boundary explicit because the
  scheduler may run in Cloudflare while the delivery rows live in Postgres.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-nitro typecheck
```

## Executor HTTP Wake Notifier Boundary

Previous completed checkpoint: `bd74849` Add DeliveryDO live query fanout.

What changed:

- `@flarex/executor-http` now owns the reusable backend wake notifier helper.
- `@flarex/executor-nitro` re-exports that helper for Nitro/Vercel hosts.
- Executor core remains Cloudflare-agnostic; it only returns rerun results and
  persists delivery rows through the persistence interface.
- Cloudflare-specific DeliveryDO behavior remains in `flarex-backend`.

Boundary rule:

```txt
@flarex/executor
  owns durable rerun and delivery-row semantics
@flarex/executor-http
  owns HTTP adapter callbacks/notifiers
@flarex/executor-nitro
  re-exports adapter helpers for Nitro deployment
flarex-backend
  owns Durable Object fanout
```

Convex reference:

- `crates/sync/src/worker.rs`
  - one backend component owns rerun and send work in Convex.

Flarex difference:

- Flarex must expose an adapter-level wake contract because the executor and
  Cloudflare fanout runtime are separate deployable units.

Known limitations:

- The direct delivery callback helper still lives beside the preferred wake
  notifier until examples/tests fully migrate.
- No shared package owns delivery route constants yet.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## DeliveryDO Alarm Boundary

Previous completed checkpoint: `9c160d8` Notify DeliveryDO after live query
reruns.

What changed:

- Alarm continuation is implemented entirely in `flarex-backend`'s
  `DeliveryDO`.
- Executor and executor-http package boundaries did not change.
- `DeliveryDO` stores pending drain metadata in Durable Object storage and
  keeps executor access behind the injected claim/ack HTTP/service-binding
  boundary.

Boundary rule:

```txt
Nitro/executor host
  -> notify wake route once
DeliveryDO
  -> repeat bounded claim/fanout/ack through alarms until no rows remain
executor core
  -> persists and acknowledges durable rows only
```

Convex reference:

- `crates/sync/src/worker.rs`
  - sync worker owns ongoing delivery work in Convex.

Flarex difference:

- Flarex moves repeated fanout work to Cloudflare DO alarms because the trusted
  executor can run on serverless Nitro/Vercel and should not keep a loop alive.

Known limitations:

- No shared observability surface exists yet for pending alarm retry state.
- No Cloudflare Queue abstraction is wired yet; alarms are the first
  per-deployment continuation primitive.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "continues DeliveryDO"
git diff --check
```

## SchedulerDO Reconciler Boundary

Previous completed checkpoint: `c8f2f93` Continue DeliveryDO drains with
alarms.

What changed:

- `@flarex/persistence-postgres` owns the SQL/PGlite pending-deployment scan.
- `@flarex/executor` exposes the scan as platform behavior.
- `@flarex/executor-http` exposes the authenticated maintenance route.
- `flarex-backend` owns SchedulerDO, cron wiring, and DeliveryDO wake fanout.

Boundary rule:

```txt
executor packages:
  find deployments with durable pending rows
SchedulerDO:
  wake DeliveryDOs only
DeliveryDO:
  claim, fanout, ack
ConnectionDO:
  client socket transition delivery
```

Convex reference:

- `crates/sync/src/worker.rs`
  - one internal worker owns rerun and send work in Convex.

Flarex difference:

- Flarex deliberately keeps the executor framework-neutral and moves repeated
  wake/fanout recovery to Cloudflare Durable Objects.

Known limitations:

- Route constants are still duplicated string literals across packages.
- SchedulerDO has bounded one-page scans; cursor persistence is future work.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter flarex-backend typecheck
git diff --check
```

## Executor HTTP Boundary Update

Previous completed checkpoint for this roadmap: `c563d88` Make push start
source-only.

The trusted Postgres executor HTTP API now has a dedicated adapter package:
`@flarex/executor-http`.

Package responsibilities:

- `@flarex/executor` owns platform behavior:
  - deployment/package resolution
  - function resolution
  - invoke preparation
  - invoke session creation
- `@flarex/persistence-postgres` owns Drizzle schema, migrations, PGlite, and
  low-level Postgres persistence helpers.
- `@flarex/executor-http` owns the real HTTP API router using Elysia:
  - `GET /health`
  - `POST /invoke/prepare`
  - `POST /invoke/start`
  - `POST /invoke/syscall`
  - `POST /invoke/finish`
  - request shape validation
  - executor error-to-status mapping
- `@flarex/executor-nitro` is only a Nitro/deployment wrapper over the HTTP
  app. It must not regain route semantics as invoke/session APIs grow.

Why this changed:

Nitro file routing is a deployment convenience, but Flarex needs one explicit,
testable platform API surface. Elysia gives us a fetch-compatible router that
can be tested directly and mounted under Nitro using Nitro's documented server
entry approach.

External reference:

- `https://nitro.build/examples/elysia`
  - Nitro supports an Elysia server entry where the Elysia app handles incoming
    requests.

Convex reference:

- `crates/local_backend/src/lib.rs`
  - HTTP surfaces are adapters over backend behavior.
- `crates/application/src/application_function_runner/mod.rs`
  - execution semantics stay below the HTTP layer.

Current update:

- `POST /invoke/start` is now part of `@flarex/executor-http` and maps to
  `executor.beginInvokeSession(...)`.
- `POST /invoke/syscall` is now part of `@flarex/executor-http` and maps to
  `executor.invokeSyscall(...)`.
- `POST /invoke/finish` is now part of `@flarex/executor-http` and maps to
  `executor.finishInvokeSession(...)`.
- Nitro remains a wrapper and must continue delegating route behavior to
  `@flarex/executor-http`.

Known limitations:

- No concrete Nitro `server.ts` host app exists yet.
- `@flarex/executor-http` currently has health, invoke prepare, invoke start,
  invoke syscall, and query invoke finish only.
- API request validation is manual until the route bodies settle.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Backend Artifact Store Boundary Update

Previous completed checkpoint: `873fee7` Add R2 execution artifact store
adapter.

`flarex-backend` now has its own artifact store boundary:
`R2BackendExecutionArtifactStore`. This deliberately avoids importing
`flarex-dev` from hosted backend code.

Current package split:

- `flarex`
  - shared runtime-neutral artifact ref/hash helpers in `flarex/artifacts`.
- `flarex-backend`
  - hosted R2 artifact persistence and public push finish verification.
- `flarex-dev`
  - local in-memory artifact store, local Miniflare execution-artifact runtime,
    and local analyzer service.

Known cleanup:

- The R2 object layout and manifest validation are duplicated between
  `flarex-backend` and `flarex-dev`.
- Once the hosted Dynamic Worker loader and local runtime use the same durable
  store contract, extract the duplicated object-layout code into a shared core
  package or a runtime-neutral `flarex/artifact-store` export.

Convex reference:

- `crates/model/src/source_packages/mod.rs`
  - source package persistence is backend model code, not CLI/dev-tool-only
    code.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Runtime Materializer Package Export Update

Previous completed checkpoint: `f88296c` Authorize artifact runtime calls.

`flarex-backend` now exports `./artifact-runtime` for the hosted runtime Worker
surface. The exported module contains the runtime-service-side materialization
contract and cache:

- `ExecutionArtifactMaterializer`
- `MaterializedExecutionArtifact`
- `CachedExecutionArtifactMaterializer`
- `createExecutionArtifactRuntimeService`

Package responsibility:

- `flarex-backend` owns the backend/runtime contract and cache helper.
- a future hosted runtime Worker imports `flarex-backend/artifact-runtime` and
  supplies the Cloudflare Dynamic Worker materializer.
- `flarex-dev` remains responsible only for local Miniflare simulation.

Convex reference:

- `crates/application/src/module_cache/mod.rs`
  - package/module retrieval is a backend execution concern with explicit cache
    boundaries.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Runtime Capability Boundary Update

Previous completed checkpoint: `c623476` Route invoke through artifact
runtime.

Runtime capability ownership is now split by package:

- `flarex-backend`
  - owns `FLAREX_ARTIFACT_RUNTIME_TOKEN`,
  - attaches the bearer capability when calling the hosted runtime binding.
- generated execution artifact code from `flarex-dev`
  - owns `FLAREX_INTERNAL_TOKEN`,
  - rejects unauthorized `/__flarex_internal/*` requests.

This keeps secret/capability transport out of public client APIs and out of
developer-authored `flarex/` functions.

Known cleanup:

- The generated artifact uses a simple bearer token check. The hosted runtime
  should eventually receive the capability through deployment/runtime secret
  configuration, not through app-facing config.
- Session-scoped syscall authorization is still a separate backend/runtime
  contract.

Convex reference:

- `crates/application/src/application_function_runner/mod.rs`
  - backend runner constructs executor requests with auth and callback token
    material.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Backend Artifact Runtime Boundary Update

Previous completed checkpoint: `804a055` Add backend artifact storage binding.

`flarex-backend` now owns the first hosted execution artifact runtime
interface:

- `BackendExecutionArtifactRuntime`
- `ServiceBindingExecutionArtifactRuntime`
- `ExecutionArtifactInvokePayload`

This keeps hosted invoke orchestration out of `flarex-dev`. `flarex-dev` still
owns local Miniflare runtime simulation, while `flarex-backend` owns hosted
runtime service binding orchestration.

Current split:

- `flarex-backend/src/artifactStore.ts`
  - durable package storage lookup.
- `flarex-backend/src/artifactRuntime.ts`
  - hosted runtime invoke payload and service-binding dispatch.
- `flarex-dev/src/executionArtifact.ts`
  - local Miniflare analyzer/runtime simulation.

Known cleanup:

- Local and hosted runtime payloads should converge into one shared contract
  once the Dynamic Worker adapter is real.
- Runtime authorization belongs in the backend/runtime contract, not in
  `flarex-dev`.

Convex reference:

- `crates/application/src/application_function_runner/mod.rs`
  - backend runner owns source-package resolution and executor request
    construction.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Analyzer Diagnostics Boundary Update

Previous completed checkpoint: `0a57edd` Analyze push source through backend
binding.

The analyzer boundary now carries structured diagnostics as well as deployment
analysis:

```ts
type BackendSourceAnalysisResult = {
  analysis: DeploymentAnalysis;
  diagnostics?: AnalyzerDiagnostic[];
};
```

Package responsibilities remain:

- `flarex-dev` owns the local analyzer implementation and Miniflare execution
  artifact diagnostics capture.
- `flarex-backend` owns the source-only push route, analyzer service binding,
  durable push state, and diagnostics persistence.
- future hosted runtime code should replace the local analyzer service with the
  Dynamic Worker analyzer service while preserving the same response shape.

Convex reference:

- `crates/isolate/src/environment/analyze.rs`
  - backend-controlled analysis owns import-time log collection and failure
    reporting.

Cloudflare difference: diagnostics are structured and explicitly forwarded
across the service binding. Convex's current implementation appends collected
logs into the analysis error text inside the backend isolate.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Execution Artifact Runtime Package Boundary Update

Previous completed checkpoint: `d5e13dd` Store active execution artifact
reference.

The invoke-side execution artifact runtime boundary lives in `flarex-dev` for
now:

- `flarex-backend` owns active deployment metadata and execution sessions.
- `flarex-dev` owns the local Miniflare execution artifact runtime adapter.
- generated app code owns `/__flarex_internal/invoke`, the internal artifact
  entrypoint.

`flarex-dev` deliberately defines a narrow local active-deployment response
type instead of importing `flarex-backend/types`, because the backend type file
also contains Cloudflare Worker binding globals (`DurableObjectNamespace`,
`Fetcher`) that should not leak into the dev package's type environment.

Convex reference:

- `crates/model/src/source_packages/mod.rs`
  - source package identity is a model boundary.
- `crates/application/src/application_function_runner/mod.rs`
  - execution runner code consumes package identity without exposing storage
    internals to user code.

Future package cleanup: a shared runtime-neutral package should own
`ExecutionArtifactRef`, analyzed deployment metadata, and validator JSON types
so backend/dev/sdk packages do not duplicate small structural types.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Shared Artifact Reference Helper Update

Previous completed checkpoint: `363d7e0` Add local execution artifact runtime
invoke.

Execution artifact reference types and hash helpers moved into the
runtime-neutral `flarex/artifacts` subpath.

Package responsibilities now are:

- `flarex/artifacts`: structural source package manifest hashing and
  `ExecutionArtifactRef` validation.
- `flarex-backend`: active deployment state and execution-session ownership.
- `flarex-dev`: local in-memory artifact store and local Miniflare runtime
  adapter.

`flarex-backend` now depends on `flarex` for this shared helper. The workspace
install was refreshed so local package links include that dependency.

Convex reference:

- `crates/model/src/source_packages/mod.rs`
  - source package identity is shared model state used by deployment and
    execution code.
- `crates/model/src/modules/types.rs`
  - module hashes are part of the shared module/source-package contract.

Known follow-up: a future `flarex-core` package may be cleaner than using the
public `flarex` package for backend-facing artifact types. For now the
`flarex/artifacts` subpath is narrow and runtime-neutral.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## R2 Artifact Store Adapter Boundary Update

Previous completed checkpoint: `bccc7cd` Add execution artifact store
boundary.

The Cloudflare-oriented artifact store adapter currently lives in `flarex-dev`
because it is still a development/runtime-contract proof, not a deployed
backend service.

Package responsibilities remain:

- `flarex/artifacts` owns artifact refs and manifest hashing.
- `flarex-dev` owns local and R2-shaped artifact store adapters.
- `flarex-backend` owns active deployment metadata, but is not yet wired to an
  artifact bucket binding.

Convex reference:

- `crates/model/src/source_packages/types.rs`
  - the model stores source package storage key and package hash as metadata.

Known follow-up: when hosted backend bindings are added, move Cloudflare
artifact storage behind a backend/runtime package boundary so `flarex-dev`
does not own hosted infrastructure code.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Architecture Terminology Cleanup

Previous completed checkpoint: `da42b4a` Add analysis import phase prelude.

Updated package-boundary wording so hosted analysis is described as a Dynamic
Worker analyzer service for uploaded source packages, not an external platform
dispatch path. `flarex-dev` remains responsible for the local Miniflare
analyzer implementation; `flarex-backend` remains responsible for the
source-only push API and durable candidate state.

Convex reference:

- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - source/config inputs cross the push boundary; analyzed metadata is produced
    by the backend side of that boundary.

Verification:

```sh
git diff --check
```

## Cold-Isolate Consistency Boundary Update

Previous completed checkpoint: `d1b83a9` Clarify Dynamic Worker source package
architecture.

`LocalExecutionArtifactBackendAnalyzer` now owns the cold-isolate consistency
gate. It runs the local execution-artifact adapter twice and compares the
deployment analysis before the analyzer service returns metadata to the
backend.

Package responsibilities remain:

- `flarex-dev` owns the local double-run analyzer gate.
- `flarex-backend` keeps the source-only push route and durable candidate
  state.
- the hosted Dynamic Worker analyzer service should implement the same
  stability contract before activation.

Convex reference:

- `crates/isolate/src/environment/analyze.rs`
  - stable analysis comes from a controlled import-time environment.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Source Position Metadata Boundary Update

Previous completed checkpoint: `c471b67` Gate analysis on cold isolate
consistency.

Source-position metadata now crosses the analyzer/backend boundary as part of
analyzed function metadata. `flarex-dev` produces the best-effort position from
source-package source maps, `flarex-backend` validates and persists it, and
generated metadata preserves it for runtime/dev tooling.

Convex reference:

- `crates/model/src/modules/module_versions.rs`
  - `AnalyzedFunction` owns optional source position metadata.

Package responsibility:

- `flarex-dev` owns local source-map position extraction.
- `flarex-backend` owns validation and durable persistence.
- a future shared/core package should define the common analyzed-function
  metadata shape so backend and dev packages do not duplicate the type.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Analyzer Service Binding Update

Previous completed checkpoint: `c563d88` Make push start source-only.

The backend analyzer boundary now has two concrete pieces:

- `flarex-backend` exposes a `FLAREX_ANALYZER` service binding in `Env` and
  calls it from public `push/start`.
- `flarex-dev` provides `createLocalAnalyzerService()` for local Miniflare,
  backed by `LocalExecutionArtifactBackendAnalyzer`.

This keeps the package roles aligned:

- `flarex-backend` owns the source-only push API and candidate activation.
- `flarex-dev` owns the local implementation of the analyzer service.
- hosted Flarex can later replace the local analyzer service with the Dynamic
  Worker analyzer service without changing the public push request shape.

Convex reference:

- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - source/config request and backend-produced analysis response are distinct.

Cloudflare difference: the analyzer is a service binding in local dev because
the backend Worker cannot create execution artifacts directly yet.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```
