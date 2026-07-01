# Sync And Subscriptions

## Public Scheduler Route-Service Boundary Effects

Previous completed checkpoint: `1ce303d` Type public execution route boundary.

What changed:

- Scheduler route compatibility readers and parse wrappers now recover through
  named Effect HTTP adapter helpers.
- Public scheduler route mapping exposes a named adapter effect for typed
  `SchedulerRouteError` failures.
- Public scheduler service-binding dispatch now shares one named
  `dispatchPublicSchedulerEffect(...)` helper with operation-specific failure
  sources.

Why it changed:

Public scheduler routes connect live-query maintenance request decoding,
payload validation, and SchedulerDO service-binding dispatch. Naming the route
adapter and dispatch helper keeps request failures typed until the HTTP edge
and dispatch failures typed at the service-binding edge.

Known limitations:

- Public Worker route matching, SchedulerDO maintenance behavior, continuation
  state, DeliveryDO, ConnectionDO/live-query fanout, PartitionDO SQL/OCC,
  executor-http, protocol schemas, and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/publicSchedulerRouteBoundary.test.ts test/publicSchedulerDispatchBoundary.test.ts test/schedulerRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/publicSchedulerRouteBoundary.test.ts test/publicSchedulerDispatchBoundary.test.ts test/schedulerRouteBoundary.test.ts test/publicExecutionDispatchBoundary.test.ts test/deploymentHttpApiRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Scheduler Route Decoder Ownership

Previous completed checkpoint: `a976927` Own delivery connection route decoders.

What changed:

- Scheduler delivery reconcile, connection reconcile, rerun subscriptions,
  dead-letter deliveries, and cleanup connections routes now expose
  decode-named route payload boundaries.
- Scheduler request decoders call `decode*RoutePayload(...)` functions directly
  after the shared JSON body Effect boundary succeeds.
- Parse-named Effect helpers remain as compatibility wrappers, but newly
  migrated SchedulerDO and public scheduler request paths prefer the
  decode-named route payload functions.
- Typed scheduler payload failures still propagate unchanged until the existing
  SchedulerDO or public Worker route adapter maps them to HTTP responses.

Why it changed:

The scheduler route family already shared typed source decoders in
`scheduler/Requests.ts`, but request decoders still flowed through parse-named
compatibility helpers. This checkpoint makes route payload ownership explicit
across the SchedulerDO and public scheduler maintenance route family while
preserving existing HTTP mapping behavior.

Convex source files inspected:

- None for this checkpoint. This is Cloudflare-specific scheduler route adapter
  wiring around Flarex live-query maintenance.

How Flarex differs from Convex:

- Flarex uses Cloudflare scheduler routes to reconcile delivery wakes, cleanup
  expired live-query connections, rerun stale subscriptions, trigger
  subscription reruns, and dead-letter stuck delivery rows. This checkpoint
  keeps that route shape while tightening the Effect request decoder boundary.

Known limitations:

- SchedulerDO maintenance behavior, continuation state, DeliveryDO,
  ConnectionDO/live-query fanout, PartitionDO SQL/OCC, executor-http, protocol
  schemas, and `ValidatorJson` are unchanged.
- These route payload functions still delegate to the existing manual payload
  decoders; the payload shapes are not moved into the protocol package yet.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/schedulerRouteBoundary.test.ts packages/flarex-backend/test/publicSchedulerRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Delivery And Connection Route Decoder Ownership

Previous completed checkpoint: `ea9c8ca` Own invoke route decoders.

What changed:

- DeliveryDO wake, public wake-delivery, public live-query delivery,
  ConnectionDO invalidation, and ConnectionDO live-query delivery routes now
  expose decode-named route payload boundaries.
- Request decoders call `decode*RoutePayload(...)` functions directly after the
  shared JSON body Effect boundary succeeds.
- Parse-named Effect helpers remain as compatibility wrappers, but newly
  migrated request paths prefer the decode-named route payload functions.
- Typed payload failures still propagate unchanged until the existing delivery,
  public sync, or ConnectionDO route adapter maps them to HTTP responses.

Why it changed:

The wake and live-query routes already shared typed payload source decoders, but
request decoders still flowed through parse-named compatibility helpers. This
checkpoint makes the route payload ownership explicit across the related
DeliveryDO, public Worker sync callback, and ConnectionDO route family while
preserving existing HTTP mapping behavior.

Convex source files inspected:

- None for this checkpoint. This is Cloudflare-specific route adapter wiring
  around Flarex live-query sync and delivery callbacks.

How Flarex differs from Convex:

- Flarex uses Cloudflare Worker and Durable Object routes to wake delivery
  drains, fan out materialized live-query changes, and invalidate active
  WebSocket queries. This checkpoint keeps that Cloudflare routing shape while
  tightening the Effect request decoder boundary.

Known limitations:

- DeliveryDO drain semantics, ConnectionDO WebSocket state, SchedulerDO
  maintenance behavior, PartitionDO SQL/OCC, executor-http, protocol schemas,
  and `ValidatorJson` are unchanged.
- These route payload functions still delegate to the existing manual payload
  decoders; the payload shapes are not moved into the protocol package yet.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deliveryRouteBoundary.test.ts packages/flarex-backend/test/publicDeliveryWakeRouteBoundary.test.ts packages/flarex-backend/test/publicLiveQueryDeliveryRouteBoundary.test.ts packages/flarex-backend/test/connectionRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Scheduler Maintenance Payload Validation Boundary

Previous completed checkpoint: `d4e5712` Share delivery wake payload validation.

What changed:

- Scheduler maintenance request payload validation now lives in the shared
  `scheduler/Requests.ts` source boundary.
- Delivery reconcile, connection reconcile, rerun/trigger subscriptions,
  dead-letter deliveries, and cleanup connections now emit
  `SchedulerRoutePayloadError` from named Effect decoders at the payload source.
- Internal SchedulerDO routes and public Worker scheduler routes continue to
  share the same request decoders, while malformed JSON remains
  `RequestJsonError`.
- Cleanup route project ID fallback no longer catches a throwing `HttpError`
  helper; missing or invalid `projectId` is emitted as a typed payload failure.
- Scheduler route adapters still map typed payload failures to the same HTTP
  400 response shape at the adapter edge.

Why it changed:

Scheduler maintenance routes had a large route-local validation block covering
multiple shared public/internal request shapes. This checkpoint moves that
payload validation and the typed payload failure to the scheduler source
boundary, leaving route files responsible for request JSON reads and HTTP
conversion.

Convex source files inspected:

- None for this checkpoint. This is Cloudflare-specific scheduler maintenance
  route payload validation around Flarex live-query delivery and cleanup.

How Flarex differs from Convex:

- Flarex uses a Cloudflare SchedulerDO plus public Worker scheduler routes to
  reconcile deliveries, clean expired connections, rerun stale subscriptions,
  and dead-letter stuck deliveries. This checkpoint keeps that route ownership
  while making the maintenance payload validation shared and typed.

Known limitations:

- SchedulerDO maintenance behavior, continuation state, DeliveryDO,
  ConnectionDO/live-query fanout, PartitionDO SQL/OCC, executor-http, protocol
  schemas, and `ValidatorJson` are unchanged.
- The shared scheduler request decoders still use the existing manual payload
  rules; they do not move these route shapes into the protocol package yet.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/schedulerRouteBoundary.test.ts packages/flarex-backend/test/publicSchedulerRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/sync.test.ts -t "routes expired live query connection cleanup through SchedulerDO|reports malformed executor cleanup payloads through SchedulerDO|reconciles expired live query connection deployment scans through SchedulerDO|reconciles lost live query wake notifications through SchedulerDO|dead-letters stuck live query deliveries and reconnects affected connections|rejects invalid live query dead-letter envelopes at the public scheduler boundary|triggers stale live query reruns and fans out changed results" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Delivery Wake Payload Validation Boundary

Previous completed checkpoint: `92596fe` Share live query delivery payload validation.

What changed:

- Delivery wake request payload validation now lives in the shared
  `delivery/WakeRequest.ts` source boundary.
- Internal DeliveryDO wake routes and public Worker wake-delivery routes now
  propagate `DeliveryWakePayloadError` from that shared payload source instead
  of keeping a route-local validation tag.
- The public wake-delivery boundary still injects the deployment ID from the
  route, overriding any body `deploymentId`, before using the shared payload
  decoder.
- Malformed JSON remains `RequestJsonError`, while payload shape failures map
  to HTTP 400 only at the delivery wake route adapter edges.

Why it changed:

DeliveryDO wake and public wake-delivery parsed the same wake payload shape, but
validation lived in route boundary files. This checkpoint moves wake payload
validation and the typed payload failure to the delivery source boundary, keeps
public route ownership explicit, and preserves the existing HTTP response
mapping.

Convex source files inspected:

- None for this checkpoint. This is Cloudflare-specific delivery wake payload
  validation around Flarex live-query delivery routes.

How Flarex differs from Convex:

- Flarex wakes a Cloudflare DeliveryDO to claim, fan out, acknowledge, and
  continue live-query delivery batches. This checkpoint keeps that wake route
  shape while making its payload validation shared and typed.

Known limitations:

- DeliveryDO drain semantics, pending drain state, SchedulerDO wake behavior,
  ConnectionDO/live-query fanout, PartitionDO SQL/OCC, executor-http, protocol
  schemas, and `ValidatorJson` are unchanged.
- The shared wake decoder still uses the existing manual wake payload rules; it
  does not move the shape into the protocol package yet.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deliveryRouteBoundary.test.ts packages/flarex-backend/test/publicDeliveryWakeRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/sync.test.ts -t "wakes DeliveryDO to claim, fanout, and ack live query deliveries|reports DeliveryDO fanout target validation failures with a 400 detail|rejects malformed DeliveryDO wake JSON at the delivery route boundary|rejects invalid DeliveryDO wake envelopes at the delivery route boundary" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Live Query Delivery Payload Validation Boundary

Previous completed checkpoint: `f062df2` Type ConnectionDO route dispatch boundary.

What changed:

- Live-query delivery request body validation now has a shared typed Effect
  boundary, `decodeLiveQueryDeliveryChangesFromBody(...)`, in
  `liveQueryDelivery.ts`.
- Public Worker live-query delivery routes and ConnectionDO live-query delivery
  routes now propagate `LiveQueryDeliveryChangePayloadError` from that shared
  payload source instead of wrapping the same parser failures in separate
  route-local validation errors.
- ConnectionDO invalidation query ID validation remains a route-specific
  `ConnectionRouteValidationError`, and malformed JSON remains
  `RequestJsonError`.
- Public and ConnectionDO route adapters still map typed payload failures to
  the same HTTP 400 response shape at the adapter edge.

Why it changed:

The public live-query delivery route and ConnectionDO delivery route parsed the
same payload shape but emitted different route-local validation tags for the
same parser failures. This checkpoint moves the payload failure tag to the
payload source, preserves route-specific JSON/invalidation failures, and keeps
HTTP conversion at the existing adapter edges.

Convex source files inspected:

- None for this checkpoint. This is Cloudflare-specific live-query delivery
  payload validation for Flarex sync routes.

How Flarex differs from Convex:

- Flarex delivers live-query result changes through public Worker and
  ConnectionDO routes that fan out to Cloudflare WebSocket sessions. This
  checkpoint keeps that Cloudflare route ownership explicit while sharing the
  payload decoder used by both routes.

Known limitations:

- Live-query delivery fanout semantics, ConnectionDO state,
  SchedulerDO/DeliveryDO behavior, PartitionDO SQL/OCC, executor-http, protocol
  schemas, and `ValidatorJson` are unchanged.
- The shared decoder still wraps the existing payload parser; it does not yet
  replace the payload shape with a protocol package schema.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/liveQueryDelivery.test.ts packages/flarex-backend/test/publicLiveQueryDeliveryRouteBoundary.test.ts packages/flarex-backend/test/connectionRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/sync.test.ts -t "reruns a subscribed query when a partition commit overlaps its read set|routes expired live query connection cleanup through SchedulerDO|triggers stale live query reruns and fans out changed results" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## ConnectionDO Route Dispatch Boundary

Previous completed checkpoint: `996d830 Use decoded deployment metadata for activation writes`.

What changed:

- ConnectionDO invalidation and live-query delivery operation calls now run
  through named Effect boundaries in `connection/RouteDispatchBoundary.ts`.
- ConnectionDO keeps JSON route selection and typed request decoding in the
  existing route boundary, while operation Promise failures are mapped at the
  dispatch source.
- Operation failures remain typed as `ConnectionRouteOperationError` values
  from `invalidate` and `deliver-live-query`.
- Direct tests cover success forwarding and typed failure mapping for both
  connection route operations.

Why it changed:

ConnectionDO already decoded `/invalidate` and `/deliver/live-query` request
bodies through typed Effect route boundaries, but each branch still wrapped its
handler Promise inline. This checkpoint moves those operation calls into a
dedicated dispatch boundary so request decoding, operation failure mapping, and
the final HTTP adapter edge are separate and directly testable.

Convex source files inspected:

- None for this checkpoint. This is Cloudflare Durable Object route adapter
  wiring for Flarex live-query sync.

How Flarex differs from Convex:

- Flarex uses ConnectionDO routes to invalidate live queries and deliver live
  query changes to WebSocket sessions. Convex does not expose this as the same
  Cloudflare Durable Object route pair.

Known limitations:

- ConnectionDO WebSocket state, sync protocol parsing, live query delivery
  semantics, SchedulerDO/DeliveryDO behavior, PartitionDO SQL/OCC,
  executor-http, protocol schemas, and `ValidatorJson` are unchanged.
- The dispatch handlers are explicit function dependencies rather than Effect
  services/layers.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/connectionRouteBoundary.test.ts packages/flarex-backend/test/connectionRouteDispatchBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/sync.test.ts -t "reruns a subscribed query when a partition commit overlaps its read set|routes expired live query connection cleanup through SchedulerDO|triggers stale live query reruns and fans out changed results" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## SchedulerDO Maintenance Route Effect Boundary

Previous completed checkpoint: `c5da9c5` Type execution JSON route boundary.

What changed:

- SchedulerDO now routes live-query maintenance endpoints through
  `Effect.fn("SchedulerDO.route")`.
- Delivery reconcile, connection reconcile, dead-letter deliveries, cleanup
  connections, rerun subscriptions, continue deliveries, continue reruns, and
  continue connection cleanup share one Durable Object dispatcher and the
  existing `runSchedulerRoute(...)` adapter edge.
- Each branch continues to use its existing typed request decoder, pending-state
  decoder, executor-maintenance boundary, delivery-wake boundary,
  force-reconnect boundary, runtime consistency errors, and route-operation
  mapping.

Why it changed:

SchedulerDO already had typed Effect route helpers for each maintenance branch,
but `fetch()` still selected every internal path separately. This checkpoint
groups those related maintenance routes behind one named Effect boundary while
leaving the maintenance algorithms and continuation state unchanged.

Convex source files inspected:

- None for this checkpoint. This is Cloudflare-specific live-query maintenance
  adapter wiring.

How Flarex differs from Convex:

- Flarex uses a Cloudflare Durable Object scheduler to scan executor
  maintenance routes, wake DeliveryDO, reconnect ConnectionDO, and resume
  bounded continuations. This checkpoint keeps that Cloudflare route ownership
  explicit while moving path selection into the typed Effect adapter shape.

Known limitations:

- SchedulerDO delivery scans, connection cleanup scans, rerun scans,
  dead-letter scans, retry/alarm scheduling, in-flight coalescing, continuation
  storage, DeliveryDO, ConnectionDO, and executor calls are unchanged.
- PartitionDO SQL/OCC behavior, public Worker scheduler routing,
  executor-http, protocol schemas, and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/schedulerRouteBoundary.test.ts packages/flarex-backend/test/schedulerMaintenanceBoundary.test.ts packages/flarex-backend/test/publicSchedulerRouteBoundary.test.ts packages/flarex-backend/test/publicWorkerRouteDispatchError.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/sync.test.ts -t "routes expired live query connection cleanup through SchedulerDO|reports malformed executor cleanup payloads through SchedulerDO|reconciles expired live query connection deployment scans through SchedulerDO|reconciles lost live query wake notifications through SchedulerDO|dead-letters stuck live query deliveries and reconnects affected connections|maps invalid live query dead-letter reconnect targets to scheduler 502 responses|rejects malformed live query dead-letter JSON|rejects invalid live query dead-letter envelopes at the public scheduler boundary|triggers stale live query reruns and fans out changed results" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## DeliveryDO JSON Route Effect Boundary

Previous completed checkpoint: `1ab1b0d` Type connection JSON route boundary.

What changed:

- DeliveryDO now routes its JSON endpoints through
  `Effect.fn("DeliveryDO.route")`.
- `/wake` and `/continue` share one route adapter runner while continuing to
  use the existing typed wake decoder, pending-drain decoder, drain failure
  response mapper, and operation-failure mapper.
- Only the two JSON paths enter the route Effect, so health responses and alarm
  continuation behavior stay owned by the existing DeliveryDO branches.

Why it changed:

DeliveryDO wake and continue routes already used typed Effect helpers, but
`fetch()` still selected each route separately. This checkpoint groups the
related JSON route dispatch behind one named Effect boundary while leaving the
drain loop, retry persistence, and alarm behavior unchanged.

Convex source files inspected:

- None for this checkpoint. This is Cloudflare Durable Object adapter wiring
  around Flarex live-query delivery routes.

How Flarex differs from Convex:

- Flarex drains live-query delivery rows through Cloudflare Durable Object
  routes and executor maintenance calls. This checkpoint keeps those
  Cloudflare-specific delivery routes explicit while moving route selection
  closer to the typed Effect adapter shape.

Known limitations:

- DeliveryDO alarm handling, drain in-flight coalescing, claim/fanout/ack
  internals, retry scheduling, and executor calls remain otherwise unchanged.
- The JSON dispatcher intentionally does not own the full DeliveryDO lifecycle.
- ConnectionDO, SchedulerDO, PartitionDO SQL/OCC behavior, public Worker
  routing, executor-http, protocol schemas, and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deliveryRouteBoundary.test.ts packages/flarex-backend/test/deliveryExecutorBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/sync.test.ts -t "wakes DeliveryDO to claim, fanout, and ack live query deliveries|reports DeliveryDO fanout target validation failures with a 400 detail|rejects malformed DeliveryDO wake JSON at the delivery route boundary|rejects invalid DeliveryDO wake envelopes at the delivery route boundary|records DeliveryDO fanout failures before retrying pending rows|records DeliveryDO claim failures|records DeliveryDO ack failures after successful fanout|continues DeliveryDO draining from pending alarm state when more deliveries remain|returns structured DeliveryDO continue failures from pending drain state" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## ConnectionDO JSON Route Effect Boundary

Previous completed checkpoint: `bbf4ea8` Type deployment store active
validation.

What changed:

- ConnectionDO now routes its JSON internal endpoints through
  `Effect.fn("ConnectionDO.route")`.
- `/invalidate` and `/deliver/live-query` share one route adapter runner while
  continuing to use their existing typed body decoders and operation-failure
  mapping.
- Only the two JSON paths enter the route Effect, so WebSocket upgrades,
  heartbeat, force-reconnect, and health behavior remain owned by the existing
  imperative branches.

Why it changed:

Connection route body parsing had already moved to typed Effect decoders, but
ConnectionDO `fetch()` still selected each JSON route and ran each branch
through a local adapter call. This checkpoint groups those related JSON routes
behind one named Effect boundary without touching the WebSocket lifecycle.

Convex source files inspected:

- None for this checkpoint. This is Cloudflare Durable Object adapter wiring
  around Flarex's sync connection routes.

How Flarex differs from Convex:

- Flarex hosts live sync sessions in Cloudflare Durable Objects and receives
  internal invalidation/delivery calls over DO `fetch()` routes. This
  checkpoint keeps that DO route shape explicit while moving route validation
  failures into typed Effect channels.

Known limitations:

- WebSocket message handling, heartbeat lease refresh, force-reconnect, and
  executor subscription cleanup remain promise-based methods.
- The JSON dispatcher intentionally does not own the full ConnectionDO
  `fetch()` lifecycle yet.
- DeliveryDO, SchedulerDO, PartitionDO SQL/OCC behavior, public Worker
  routing, executor-http, protocol schemas, and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/connectionRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/sync.test.ts -t "rejects malformed invalidation JSON at the connection route boundary|rejects invalid invalidation envelopes at the connection route boundary|delivers materialized live query changes to active WebSocket connections|rejects malformed live query delivery JSON at the connection route boundary|rejects invalid live query delivery envelopes at the connection route boundary|refreshes executor connection leases from ConnectionDO heartbeat|records WebSocket query subscriptions through the configured executor|removes executor subscriptions for the whole connection when a WebSocket closes" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Public Worker Scheduler Route Effect Boundary

Previous completed checkpoint: `3744729` Type public partition route boundary.

What changed:

- Public Worker scheduler routing now runs through
  `Effect.fn("Worker.routePublicScheduler")` with one
  `Effect.runPromise(...)` adapter edge for all top-level public scheduler
  endpoints.
- Delivery reconcile, connection reconcile, dead-letter deliveries, connection
  cleanup, subscription rerun, and subscription trigger branches reuse the
  existing typed scheduler helpers instead of running branch-local runtime
  boundaries.
- Public dispatch-source coverage now includes every scheduler forwarding
  source in one grouped test.

Why it changed:

The scheduler request boundaries and maintenance internals were already typed,
but the public Worker router still had six separate runtime edges for the
public scheduler endpoints. This checkpoint keeps authorization, route-body
decoding, validation, and forwarding failures typed until one Worker adapter
mapper.

Known limitations:

- SchedulerDO maintenance internals, pending continuation state, DeliveryDO
  and ConnectionDO behavior, and executor maintenance contracts are unchanged.
- Public path matching remains method/exact-path based in the top-level Worker
  route; unknown scheduler paths and wrong methods still use the generic
  Worker 404.
- PartitionDO SQL/OCC, public deployment push, invoke, execution, partition
  routes, executor-http, generated HttpApi routes, protocol schemas, and
  `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicSchedulerRouteBoundary.test.ts packages/flarex-backend/test/publicLiveQueryDeliveryAuthorization.test.ts packages/flarex-backend/test/publicWorkerRouteDispatchError.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/sync.test.ts -t "routes expired live query connection cleanup through SchedulerDO|rejects malformed live query delivery reconcile JSON at the scheduler route boundary|rejects unauthorized live query delivery reconcile before parsing JSON|rejects invalid live query delivery reconcile envelopes at the public scheduler boundary|triggers stale live query reruns and fans out changed results|rejects malformed live query subscription rerun JSON|rejects malformed live query subscription trigger JSON|dead-letters stuck live query deliveries and reconnects affected connections|rejects malformed live query dead-letter JSON" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## SchedulerDO Dead-Letter Reconnect Effect Boundary

Previous completed checkpoint: `bdacecb Type scheduler rerun boundary`.

What changed:

- SchedulerDO dead-letter delivery handling now executes through an
  Effect-returning service path instead of a Promise route callback.
- Executor dead-letter stuck delivery scans share the typed scheduler
  maintenance boundary.
- ConnectionDO force-reconnect calls use a typed scheduler-to-connection
  boundary that preserves non-OK reconnect responses as per-connection failed
  results while keeping request failures, malformed successful payloads, and
  invalid connection targets typed until the SchedulerDO adapter edge.

Why it changed:

The rerun checkpoint removed the last non-dead-letter SchedulerDO maintenance
route group from the Promise callback pattern. Dead-letter handling still mixed
executor scans, ConnectionDO force-reconnect calls, reconnect deduplication, and
result aggregation in async methods. This checkpoint applies the same typed
boundary shape while preserving the existing public dead-letter response
contract.

Convex source files inspected:

- None for this checkpoint. This is Cloudflare-specific SchedulerDO,
  executor maintenance, and ConnectionDO orchestration.

How Flarex differs from Convex:

- Flarex dead-letters stuck live-query deliveries through executor maintenance
  and then asks per-connection Durable Objects to reconnect affected sessions.
  Non-OK reconnect responses are reported per connection, while invalid
  scheduler targets remain route-level consistency failures.

Known limitations:

- PartitionDO SQL/OCC logic is unchanged.
- The next migration slice should leave SchedulerDO maintenance unless new
  maintenance routes appear, and move to the next Worker/DO service boundary
  that can keep typed errors until one adapter edge.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/schedulerMaintenanceBoundary.test.ts test/schedulerForceReconnectBoundary.test.ts test/schedulerResponses.test.ts test/schedulerRouteBoundary.test.ts
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "dead-letters stuck live query deliveries|invalid live query dead-letter reconnect|malformed live query dead-letter|unauthorized live query dead-letter|invalid live query dead-letter envelopes"
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## SchedulerDO Rerun Subscriptions Effect Boundary

Previous completed checkpoint: `7fc9d53 Type scheduler delivery reconcile boundary`.

What changed:

- SchedulerDO rerun-subscriptions and continue-reruns routes now execute through
  Effect-returning service paths instead of Promise route callbacks.
- Stale live-query subscription rerun executor calls share the typed scheduler
  maintenance boundary.
- Pending rerun continuation state, executor rerun failures, invalid rerun
  payloads, DeliveryDO wake failures, storage operation failures, retry
  scheduling, alarm refresh, and global rerun in-flight coalescing stay typed
  until the SchedulerDO adapter edge.

Why it changed:

The delivery reconcile checkpoint removed the largest SchedulerDO dependency on
Promise callbacks, but rerun subscriptions still mixed executor rerun decoding,
DeliveryDO wake calls, continuation persistence, and retry scheduling in async
methods. This checkpoint applies the same typed boundary shape while preserving
the route response contract and no-change rerun behavior.

Convex source files inspected:

- None for this checkpoint. This is Cloudflare-specific SchedulerDO,
  executor maintenance, and DeliveryDO orchestration.

How Flarex differs from Convex:

- Flarex computes stale live-query reruns through executor maintenance and then
  asks DeliveryDO to fan out changed results. A no-change rerun is a successful
  scheduler result that intentionally skips DeliveryDO wake.

Known limitations:

- Dead-letter reconnect handling remains async-method based and is the next
  SchedulerDO maintenance route group to migrate.
- PartitionDO SQL/OCC logic is unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/schedulerMaintenanceBoundary.test.ts test/schedulerDeliveryWakeBoundary.test.ts test/schedulerResponses.test.ts test/schedulerRouteBoundary.test.ts
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "subscription rerun|stale live query reruns|continue-live-query-reruns|rerun continuation|rerun fanout"
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## SchedulerDO Delivery Reconcile/Wake Effect Boundary

Previous completed checkpoint: `028439d Type scheduler connection cleanup boundary`.

What changed:

- SchedulerDO delivery reconcile and continue-deliveries routes now execute
  through Effect-returning service paths instead of Promise route callbacks.
- Pending deployment scans share the typed scheduler maintenance boundary, and
  DeliveryDO wake calls use a typed scheduler-to-delivery wake boundary.
- Pending delivery continuation state, storage operation failures, pending scan
  failures, wake request/response failures, continuation cursor consistency,
  retry scheduling, alarm refresh, and in-flight coalescing stay typed until the
  SchedulerDO adapter edge.

Why it changed:

Connection cleanup had already proven the SchedulerDO maintenance pattern. The
delivery reconcile path has the same long-running continuation shape but also
needs to preserve DeliveryDO drain failure envelopes as per-deployment results
instead of turning them into route failures.

Convex source files inspected:

- None for this checkpoint. This is Cloudflare-specific SchedulerDO, DeliveryDO,
  and executor maintenance orchestration.

How Flarex differs from Convex:

- Flarex coordinates live-query delivery across executor HTTP scans, SchedulerDO
  alarms/storage, and per-deployment DeliveryDO wake calls. DeliveryDO non-OK
  drain envelopes are operational results for a deployment, not adapter-level
  route failures.

Known limitations:

- The live-query rerun route still uses the SchedulerDO wake compatibility
  wrapper and should be migrated in the next SchedulerDO rerun checkpoint.
- Dead-letter reconnect handling remains async-method based.
- PartitionDO SQL/OCC logic is unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/schedulerMaintenanceBoundary.test.ts test/schedulerDeliveryWakeBoundary.test.ts test/schedulerResponses.test.ts test/schedulerRouteBoundary.test.ts
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "delivery reconcile|pending delivery|pending deployment|continue-live-query-deliveries"
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Live Query Delivery Target Service Boundary

Previous completed checkpoint: `2165c08 Type scheduler runtime failures`.

What changed:

- Live-query delivery deployment and connection target checks now emit typed
  `LiveQueryDeliveryTargetError` failures.
- Shared delivery fanout groups deliveries by connection through a named
  Effect boundary before sending to ConnectionDO instances.
- Public Worker delivery callbacks still return the same 400 target-validation
  response, while DeliveryDO wake/continue keeps its existing drain-failure
  envelope with a 400 fanout detail.

Why it changed:

The live-query delivery body and response payload boundaries were already
typed, but target validation in shared fanout still threw adapter-shaped
`HttpError` values. This checkpoint moves that post-decode service validation
into a typed failure channel while preserving the two existing adapter
contracts that consume it.

Convex source files inspected:

- None for this checkpoint. This is Flarex-specific Cloudflare delivery
  fanout validation.

How Flarex differs from Convex:

- Flarex fans live-query changes across named Cloudflare ConnectionDO
  instances. The backend must validate that executor-provided delivery rows are
  scoped to the route deployment before fanout.

Known limitations:

- DeliveryDO orchestration remains async-method based; this checkpoint only
  types the shared target-validation/fanout grouping boundary.
- PartitionDO SQL/OCC logic is unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/liveQueryDelivery.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/sync.test.ts -t "target does not match|fanout target validation" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## SchedulerDO Runtime Consistency Error Boundary

Previous completed checkpoint: `9f8e11a Type scheduler response failures`.

What changed:

- Added typed scheduler runtime failures for continuation cursor consistency
  and dead-letter reconnect target validation.
- Delivery reconcile and expired connection cleanup scans now emit typed
  `SchedulerContinuationCursorError` failures when an executor scan reports
  `hasMore` without `nextCursor`.
- Dead-letter force-reconnect fanout now emits
  `SchedulerConnectionTargetError` for invalid connection ids before the
  SchedulerDO adapter maps it to the preserved 502 response.

Why it changed:

SchedulerDO had already moved request, pending-state, and executor response
failures into typed boundaries, but a few local runtime consistency checks
still threw `HttpError` directly from service logic. This checkpoint removes
those remaining adapter-shaped scheduler failures without changing
continuation persistence, retry/alarm behavior, executor calls, or fanout
semantics.

Convex source files inspected:

- None for this checkpoint. This is Cloudflare-specific scheduler runtime
  consistency handling.

How Flarex differs from Convex:

- Flarex must validate scheduler continuation cursors and Cloudflare Durable
  Object connection names because batched maintenance spans executor HTTP
  calls, SchedulerDO storage, alarms, and per-connection Durable Objects.

Known limitations:

- Full SchedulerDO orchestration is still async-method based; this checkpoint
  only moves local scheduler consistency failures into typed runtime errors.
- PartitionDO SQL/OCC logic is unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/schedulerRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/sync.test.ts -t "continuation cursor inconsistencies|invalid live query dead-letter reconnect targets" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## SchedulerDO Executor Response Service Boundary

Previous completed checkpoint: `7c66a94 Type scheduler pending state`.

What changed:

- SchedulerDO executor response helpers now preserve typed
  `SchedulerResponseError` and `SchedulerResponsePayloadError` failures instead
  of mapping them to `HttpError` inside service helper methods.
- SchedulerDO route execution now maps scheduler route, pending-state,
  executor-response, payload, and operation failures at the Durable Object
  adapter edge.
- Per-deployment delivery reconcile and connection cleanup summaries still
  report the same 502-style status/message when executor response decoding
  fails.

Why it changed:

SchedulerDO had typed response decoders, but most service helpers immediately
converted those failures into adapter-shaped `HttpError`s. This checkpoint
moves scheduler maintenance closer to a typed service boundary without changing
live-query delivery, cleanup, rerun, retry, or alarm behavior.

Convex source files inspected:

- None for this checkpoint. This is Cloudflare scheduler/executor response
  plumbing, not a Convex semantic port.

How Flarex differs from Convex:

- Flarex splits live-query maintenance across executor HTTP endpoints,
  SchedulerDO, DeliveryDO, and ConnectionDO. Typed response failures model
  those internal service calls before the Cloudflare adapter converts them to
  HTTP responses.

Known limitations:

- SchedulerDO orchestration is still async-method based; this checkpoint only
  removes early HTTP mapping from executor response helpers.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/schedulerRouteBoundary.test.ts packages/flarex-backend/test/schedulerResponses.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/sync.test.ts -t "reports malformed executor cleanup payloads|reports executor failures during expired live query connection cleanup|reconciles expired live query connection deployment scans through SchedulerDO" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## SchedulerDO Pending Continuation State Boundary

Previous completed checkpoint: `62988f1 Type delivery pending drain state`.

What changed:

- Added `scheduler/PendingState.ts` for typed SchedulerDO persisted
  continuation state validation.
- Delivery reconcile, connection cleanup, and live-query rerun continuation
  reads now use typed pending-state decoders through the same boundary.
- Corrupt scheduler pending state now fails with `SchedulerPendingStateError`
  until the SchedulerDO adapter maps it to the preserved `500` response.

Why it changed:

SchedulerDO persists continuation state for long-running live-query delivery
reconcile, expired connection cleanup, and subscription rerun work. Those
stored states were still decoded by local helpers that threw `HttpError`
directly. This checkpoint makes scheduler continuation validation a typed
Effect boundary while preserving retry, alarm, executor response, and
continuation behavior.

Convex source files inspected:

- None for this checkpoint. This slice is internal Cloudflare Durable Object
  scheduler persisted state cleanup, not a Convex semantic port.

How Flarex differs from Convex:

- Flarex stores scheduler continuation state in Durable Object storage so
  Cloudflare alarms can resume batched sync maintenance work. Convex's
  scheduler internals do not map directly to this DO alarm/continuation shape.

Known limitations:

- SchedulerDO still has separate response-body and route-operation failure
  boundaries; this checkpoint only moves persisted continuation-state decoding.
- Delivery wake failure aggregation, executor maintenance response decoders,
  and PartitionDO SQL/OCC logic are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/schedulerRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## DeliveryDO Pending Drain State Boundary

Previous completed checkpoint: `df1e0fc Type stored push row validation`.

What changed:

- Added `delivery/PendingDrainState.ts` for typed pending drain state
  validation.
- DeliveryDO `/continue` now validates persisted drain continuation state
  through the same typed pending-state boundary exposed by
  `decodePendingDeliveryDrainFromStorage(...)`.
- Corrupt pending state now fails with `DeliveryPendingDrainStateError` until
  the DeliveryDO adapter maps it to the preserved `500` response.

Why it changed:

Delivery claim/ack/fanout response payloads were already typed, but persisted
continuation state still threw `HttpError(500, ...)` directly from helper
functions. This checkpoint keeps stored DeliveryDO state validation in a typed
Effect channel while preserving continuation, retry, and alarm behavior.

Known limitations:

- SchedulerDO pending continuation state still has its own remaining storage
  validation surface.
- Delivery target validation and claim/fanout/ack failure aggregation are
  unchanged.
- PartitionDO SQL/OCC logic is unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deliveryRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/sync.test.ts -t "continues DeliveryDO" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## ConnectionDO Fanout Payload Effect Boundary

Previous completed checkpoint: `401a08d` Type delivery scheduler payloads.

What changed:

- ConnectionDO live-query fanout result payload validation now emits typed
  `LiveQueryDeliveryResultPayloadError` failures.
- `deliverLiveQueryChangesToConnections(...)` now decodes the downstream
  response status and successful result payload inside one Effect bridge per
  ConnectionDO fanout call.
- The existing `liveQueryDeliveryResultFromUnknown(...)` parser remains as a
  compatibility wrapper that maps the typed payload failure back to
  `HttpError(502, ...)`.

Why it changed:

The previous payload checkpoint typed DeliveryDO claim/ack and SchedulerDO
maintenance result payloads, but ConnectionDO fanout still threw from
`liveQueryDelivery.ts` after the response-status boundary succeeded. This
closes the remaining successful payload parser on the live-query delivery
fanout path without changing skip accounting or stale-result compatibility.

Known limitations:

- Delivery request body validation still uses the existing compatibility parser
  for `LiveQueryDeliveryChange` values.
- Delivery target validation still maps invalid route/deployment scope to the
  existing adapter-shaped `HttpError(400, ...)`.
- PartitionDO SQL/OCC logic is unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/liveQueryDelivery.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Delivery And Scheduler Response Payload Effect Boundaries

Previous completed checkpoint: `6e0450a` Type public worker paths.

What changed:

- Live-query delivery claim and ack successful payload validation now runs
  through typed Effect decoders in `liveQueryDeliveryResponses.ts`.
- Scheduler executor and ConnectionDO successful payload validation now runs
  through typed Effect decoders in `scheduler/Responses.ts` for pending scans,
  rerun results, expired-connection scans, dead-letter scans, force reconnect,
  and connection cleanup.
- `DeliveryDO` and `SchedulerDO` map those typed payload failures back to the
  same `HttpError(502, ...)` adapter shape before their route-level handling.

Why it changed:

The previous response-boundary checkpoints typed non-OK status and JSON-read
failures but left successful delivery and scheduler payload validation as
throwing compatibility parsers. This checkpoint makes the response contract
failure source typed while preserving delivery retry, ack, fanout, scheduler
continuation, alarm, and reconnect behavior.

Known limitations:

- DO continuation storage parsers still throw `HttpError(500, ...)` for corrupt
  stored state and remain a separate migration surface.
- `validateConnectionId(...)` still guards dead-letter reconnect targets with
  an adapter-shaped `HttpError(502, ...)`; it is not a successful response
  payload parser.
- PartitionDO SQL/OCC logic is unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/liveQueryDeliveryResponses.test.ts packages/flarex-backend/test/schedulerResponses.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Backend Response JSON Effect Boundary

Previous completed checkpoint: `47af99a` Type SchedulerDO route operation
failures.

What changed:

- Live-query delivery response decoders and scheduler response decoders now use
  the shared backend response JSON boundary.
- Partition transaction response decoding also shares the same JSON read
  boundary while preserving existing `PartitionResponseError` shape.
- Malformed response bodies still become `null` for compatibility with current
  non-OK response handling.

Why it changed:

The sync and subscription paths had multiple response decoders that duplicated
the same JSON-read fallback. Centralizing the read boundary makes the transport
failure typed without changing delivery, scheduler, transaction, or OCC
behavior.

Known limitations:

- Delivery and scheduler successful payload validation remains the existing
  compatibility parser/cast behavior.
- PartitionDO SQL/OCC logic is not part of this checkpoint.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/httpResponseJson.test.ts packages/flarex-backend/test/liveQueryDelivery.test.ts packages/flarex-backend/test/schedulerResponses.test.ts packages/flarex-backend/test/transaction.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## SchedulerDO Route Operation Effect Boundary

Previous completed checkpoint: `4f2a30d` Type ExecutionDO route operation
failures.

What changed:

- `SchedulerDO` delivery reconcile, connection reconcile, dead-letter,
  cleanup, rerun, and continuation route operations now emit typed
  `SchedulerRouteOperationError` failures for post-decode defects.
- Scheduler fetch routes now run one Effect pipeline per route and map typed
  request and operation failures at the Durable Object adapter edge.
- Post-decode route work now uses `Effect.tryPromise(...)` instead of untyped
  `Effect.promise(...)`.

Why it changed:

Scheduler route bodies already decoded through typed Effect boundaries, but the
route helpers converted validation failures inside the pipeline and ran
scheduler orchestration work through an untyped promise adapter. This keeps the
existing scheduler workflows intact while moving route failures into typed
channels until the single HTTP adapter edge.

Known limitations:

- Scheduler reconciliation, continuation persistence, retry alarm scheduling,
  executor maintenance calls, DeliveryDO wake fanout, and ConnectionDO
  reconnect behavior remain the existing SchedulerDO workflow.
- Scheduler response payload compatibility parsers remain separate migration
  surfaces after the existing response decode boundary.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/schedulerRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## DeliveryDO Route Operation Effect Boundary

Previous completed checkpoint: `ef864c0` Type ConnectionDO route operation
failures.

What changed:

- `DeliveryDO.fetch()` now routes `/wake` and `/continue` through one adapter
  helper that maps typed route, operation, and structured drain failures.
- Wake and pending-drain continuation route work now uses
  `Effect.tryPromise(...)` with `DeliveryRouteOperationError` for unexpected
  post-decode failures.
- Existing structured drain failures still return the same JSON `500` response
  bodies.

Why it changed:

The delivery route adapter was the next sync hot-path boundary after
ConnectionDO. This moves route execution defects into the typed Effect channel
without changing delivery claim, fanout, ack, retry, or continuation semantics.

Known limitations:

- DeliveryDO still owns mutable drain state and retry alarm scheduling directly.
- Claim/fanout/ack domain extraction remains a later service-layer migration.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deliveryRouteBoundary.test.ts packages/flarex-backend/test/publicDeliveryWakeRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
git diff --check
```

## Scheduler Response Effect Boundaries

Previous completed checkpoint: `1fb88f8` Type live query delivery responses
with Effect.

What changed:

- SchedulerDO executor-maintenance responses now pass through named Effect
  response decoders before existing payload parsers run.
- The migrated responses cover live-query rerun, connection cleanup, expired
  connection deployment scan, dead-letter scan, pending deployment scan, and
  successful delivery wake / force-reconnect JSON bodies.
- Non-OK executor-maintenance responses still map to `HttpError(502, ...)` with
  the existing message text.
- Delivery wake and force-reconnect non-OK text handling remain unchanged.

Why it changed:

SchedulerDO coordinates several live-query maintenance flows and had the last
large backend cluster of inline JSON response reads. This checkpoint gives that
workflow a typed response boundary while preserving scheduler routing, alarm,
continuation, and orchestration behavior.

Known limitations:

- Successful scheduler payloads still use the existing compatibility parsers.
- Generated runtime-worker source and executor-http request bodies remain
  separate follow-up slices.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/schedulerResponses.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Live Query Delivery Response Effect Boundaries

Previous completed checkpoint: `fb563e3` Type backend internal responses with
Effect.

What changed:

- `DeliveryDO` claim and ack executor responses now pass through named Effect
  response decoders before the existing claim/ack payload parsers run.
- `deliverLiveQueryChangesToConnections(...)` now decodes ConnectionDO fanout
  responses through the same live-query delivery response boundary family.
- Non-OK downstream responses become typed `LiveQueryDeliveryResponseError`
  values before the adapter maps them back to the existing `HttpError(502, ...)`
  shape.
- Added focused tests for typed claim/ack success, typed fanout failure, and
  adapter-edge `HttpError` mapping.

Why it changed:

Live-query delivery has multiple downstream response boundaries in one workflow:
executor claim/ack and per-connection fanout. The migration now gives that
workflow one typed response boundary module while leaving delivery retry,
acknowledgement, skip-reason, and persistence behavior unchanged.

Known limitations:

- SchedulerDO maintenance response reads remain a separate follow-up slice.
- Claim, ack, and connection result payload parsers remain the existing
  compatibility parsers after response decoding.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/liveQueryDelivery.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## SchedulerDO Effect Route Adapters

Previous completed checkpoint: `678cc30` Route sync DO fetch edges through
Effect.

What changed:

- `SchedulerDO.fetch()` now routes delivery reconcile, connection reconcile,
  dead-letter deliveries, cleanup connections, and rerun subscriptions through
  named `Effect.fn` helpers.
- Those helpers consume the existing typed scheduler route decoders directly
  instead of the Promise compatibility readers.
- Scheduler continuation POST routes now use named `Effect.fn` helpers for the
  fetch edge while preserving their current JSON response behavior.

Boundary decision:

This checkpoint converts only the `SchedulerDO` fetch adapter edge. Scheduler
state, continuation persistence, retry/alarm scheduling, executor maintenance
HTTP calls, delivery wake fanout, connection cleanup, rerun orchestration, and
dead-letter/reconnect behavior remain in the existing `SchedulerDO` methods.

Preserved behavior:

- Malformed JSON and scheduler route validation failures still map through the
  existing `errorResponse(...)` JSON body shape.
- Scheduler operation failures still flow to the existing fetch-level
  `errorResponse(...)` adapter.
- Public Worker scheduler authorization and forwarding, executor maintenance
  contracts, continuation alarms, executor-http routes, protocol schemas, and
  `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm exec vitest run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/schedulerRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
git diff --check
```

## Connection And Delivery DO Effect Route Adapters

Previous completed checkpoint: `66139fe` Route executor HTTP bodies through
Effect.

What changed:

- `ConnectionDO.fetch()` now routes `/invalidate` through
  `ConnectionDO.routeInvalidation`, a named `Effect.fn` that decodes with the
  existing typed connection invalidation route boundary.
- `ConnectionDO.fetch()` now routes `/deliver/live-query` through
  `ConnectionDO.routeLiveQueryDelivery`, reusing the typed internal
  live-query delivery decoder before invoking the existing delivery logic.
- `DeliveryDO.fetch()` now routes `/wake` through `DeliveryDO.routeWake`,
  using the typed wake decoder directly instead of the compatibility Promise
  reader.
- `DeliveryDO.fetch()` now routes `/continue` through
  `DeliveryDO.routeContinue`, sharing the drain-result response mapping used by
  `/wake`.

Boundary decision:

This checkpoint converts only the Durable Object fetch edges. It does not move
WebSocket sync state, active-query transition logic, delivery claim/fanout/ack
logic, executor maintenance contracts, or retry alarm behavior into new
services. `ConnectionDO` and `DeliveryDO` still own their current mutable DO
state and operational workflows.

Preserved behavior:

- Malformed JSON and typed route validation failures still map through the
  existing `errorResponse(...)` JSON body shape.
- `DeliveryDrainFailureError` still returns the structured `500` drain failure
  response for `/wake` and `/continue`.
- Non-route operation failures keep their existing propagation behavior.
- WebSocket upgrade, heartbeat, force reconnect, alarm continuation, public
  Worker forwarding, scheduler routes, executor-http routes, protocol schemas,
  and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm exec vitest run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/connectionRouteBoundary.test.ts packages/flarex-backend/test/deliveryRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
git diff --check
```

## Delivery Payload Effect Boundary

Current Effect migration checkpoint: delivery payload route bodies are moving
to typed Effect decoders across public Worker delivery routes, `DeliveryDO`,
and `ConnectionDO`.

What is changing:

- `packages/flarex-backend/src/delivery/RouteBoundary.ts` now exposes
  Effect-returning wake decoders with `DeliveryWakeRouteValidationError`.
- `packages/flarex-backend/src/delivery/PublicWakeRouteBoundary.ts` exposes
  public wake-delivery Effect decoders that keep route `deploymentId`
  authoritative over the body.
- `packages/flarex-backend/src/liveQueryDelivery/RouteBoundary.ts` exposes
  Effect-returning public live-query delivery decoders with
  `LiveQueryDeliveryRouteValidationError`.
- `packages/flarex-backend/src/connection/RouteBoundary.ts` exposes typed
  Effect decoders for invalidation and internal live-query delivery payloads.
- `packages/flarex-backend/src/worker.ts` routes public delivery fanout and
  wake-delivery endpoints through `Effect.fn` helpers before delivery work.

Why it is changing:

The delivery path is split across public Worker routes, `DeliveryDO`, and
`ConnectionDO`. Moving the whole payload edge together avoids another tiny
parser-only checkpoint and makes request JSON failures, payload validation
failures, and downstream delivery `HttpError`s explicit at adapter edges.

Preserved behavior:

- Malformed JSON still maps to `400` with the shared JSON-body message.
- Invalid delivery and wake request bodies still map to `400` with the same
  validation messages.
- Public wake-delivery still uses the route deployment id over any body
  deployment id.
- Unauthorized delivery requests are still rejected before body parsing.
- Downstream live-query fanout target validation still returns the existing
  `HttpError` response semantics.

Verification plan:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm exec vitest run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deliveryRouteBoundary.test.ts packages/flarex-backend/test/publicDeliveryWakeRouteBoundary.test.ts packages/flarex-backend/test/publicLiveQueryDeliveryRouteBoundary.test.ts packages/flarex-backend/test/connectionRouteBoundary.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
git diff --check
```

## Scheduler Route Effect Boundary

Completed checkpoint: `98df22e` Route public scheduler through Effect.

What is changing:

- `packages/flarex-backend/src/scheduler/RouteBoundary.ts` now exposes
  Effect-returning decoders for delivery reconciliation, connection
  reconciliation, dead-letter delivery maintenance, connection cleanup, and
  live-query subscription rerun bodies.
- `packages/flarex-backend/src/scheduler/PublicRouteBoundary.ts` re-exports
  public Effect decoders and the scheduler route error-to-HTTP adapter.
- `packages/flarex-backend/src/worker.ts` routes public scheduler maintenance
  endpoints through `Effect.fn` helpers before forwarding to `SchedulerDO`.

Why it is changing:

The scheduler routes are transport boundaries with repeated JSON/body parsing.
This checkpoint keeps existing compatibility readers while making the migrated
Worker path prefer typed JSON and validation failures before the final HTTP
adapter mapping.

Preserved behavior:

- Malformed JSON still maps to `400` with the shared JSON-body message.
- Invalid scheduler request bodies still map to `400` with the existing field
  validation messages.
- Cleanup requests still resolve `projectId` from the body or
  `FLAREX_PROJECT_ID`.
- The public trigger-subscriptions route still forwards to the same internal
  rerun path.

Verification plan:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm exec vitest run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/schedulerRouteBoundary.test.ts packages/flarex-backend/test/publicSchedulerRouteBoundary.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
git diff --check
```

## Packed Consumer Postgres Subscription

Previous completed checkpoint: `9b0486f` Cover packed test SDK Postgres invoke
flow.

What changed:

- Extended the packed fresh-consumer test SDK script for
  `executorTransport: "postgres"` to subscribe with `client.onUpdate(...)`.
- Reused a shared generated live-query assertion helper so legacy and Postgres
  packed sync smokes keep the same wait/error/cleanup behavior.
- The packed script now proves the Postgres/PGlite executor path can deliver
  the initial live query result and a mutation-triggered live query update from
  a clean installed consumer package graph.

Why it changed:

The sync system had workspace E2E coverage and packed legacy subscription
coverage. The missing developer-facing proof was packed Postgres subscription
delivery, which exercises the forward sync path through the same public client
surface app tests use.

Convex references inspected:

- `npm-packages/convex/src/browser/sync/client.ts`
  - Convex clients subscribe to queries and receive updated results through the
    sync protocol.
- `crates/sync/src/state.rs`
  - active query state emits updates only when rerun results change.

Flarex differences:

- Flarex's local Postgres subscription test routes through PGlite, the trusted
  executor, Miniflare, and Cloudflare-shaped sync delivery. Convex does not
  expose this split to the test harness.

Known limitations:

- This is a local package-boundary smoke, not a hosted WebSocket deployment
  test.
- Identity-aware subscriptions and auth transitions remain future work.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Packed Consumer Test SDK Live Query

Previous completed sync checkpoint: `a738186` Cover packed test SDK mutation
flow.

What changed:

- Extended the packed fresh-consumer test SDK smoke with a public
  `FlarexClient.onUpdate(...)` subscription.
- The temp consumer now observes the initial generated query result, performs a
  client mutation over the sync path, and asserts the subscription receives the
  live query update without assuming result ordering or exact callback counts.

Why it changed:

The example app already covered live query updates from workspace source. The
packed consumer boundary also needs to prove the installed `flarex-test`
package can expose a working WebSocket-backed client for application tests.

Convex references inspected:

- `npm-packages/convex/src/browser/sync/client.ts`
  - Convex's installed client is responsible for live query subscription
    updates.
- `crates/sync/src/state.rs`
  - Convex tracks query subscriptions and transitions through sync state.

Flarex differences:

- Flarex runs this through the local dev runtime and test SDK WebSocket bridge.
  Convex keeps this inside the hosted backend sync service.

Known limitations:

- This is a packed-consumer proof for the legacy/local dev sync path. The
  packed test SDK still does not exercise Postgres executor delivery.
- It asserts client-visible updates, not internal delivery-row or ConnectionDO
  state.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Public Client Postgres Delivery E2E

Previous completed sync checkpoint: `07b0e38` Harden invoke write-shape
invalidation.

What changed:

- Extended the example sync E2E so the same public `FlarexClient` scenario runs
  against both:
  - the legacy backend/DO path, and
  - the Postgres executor path with durable delivery through Cloudflare
    `DeliveryDO`.
- The Postgres case proves this end-to-end chain:

```txt
FlarexClient.onUpdate()
  -> ConnectionDO records the live query through the executor
  -> FlarexClient.mutation() runs over /sync
  -> Postgres executor commits the write
  -> live-query invalidation reruns the query
  -> durable delivery row wakes DeliveryDO
  -> DeliveryDO fans out to ConnectionDO
  -> client receives the updated query result
```

Why it changed:

The internal sync pieces were covered separately, but the public-client path
needed a real integration check. This is the first example-level proof that the
Postgres-authoritative path can still feel like Convex live queries from the
client API.

Convex references inspected:

- `crates/sync/src/state.rs`
- `crates/sync/src/worker.rs`
- `npm-packages/convex/src/browser/sync/client.ts`

Flarex differences:

- Convex keeps subscription state, query reruns, and fanout inside the backend
  sync worker. Flarex splits those responsibilities across the trusted
  executor, durable delivery rows, `DeliveryDO`, `ConnectionDO`, and the
  public `FlarexClient`.

Known limitations:

- The E2E proves the local PGlite executor lane, not real Postgres.
- The test observes the client-visible update, but it does not yet assert
  delivery-row claim/ack internals directly.
- Claim leases and retry visibility remain separate hardening work.

Verification:

```sh
corepack pnpm --filter @flarex/example test -- sync-e2e.test.ts
```

## DeliveryDO Wake Route Implementation

Previous completed checkpoint: `f12a7d2` Add live query delivery claim ack
APIs.

What changed:

- Added `DeliveryDO` as the Cloudflare-side live-query delivery worker.
- Added `POST /deployments/:deploymentId/sync/wake-delivery`.
- Wake requests route to `delivery:{deploymentId}` and drain bounded batches
  through executor claim/ack.
- Delivery fanout reuses the existing materialized payload path into
  `ConnectionDO`, so client-visible protocol remains
  `Transition(QueryUpdated)`.
- Added sync test coverage for claim -> fanout -> ack.

Why it changed:

This is the first real implementation of the notify-only design: Vercel/Nitro
can notify Cloudflare, and Cloudflare owns the delivery work next to live
connections.

Convex references inspected:

- `crates/sync/src/state.rs`
- `crates/sync/src/worker.rs`

Flarex differences:

- Convex's sync worker owns the whole transition/fanout lifecycle. Flarex
  splits it into executor claim/ack plus Cloudflare `DeliveryDO` fanout.

Known limitations:

- Wake is still an explicit HTTP route; post-commit notification wiring is not
  implemented yet.
- `DeliveryDO` does not use alarms or queues yet.
- No claim lease support yet.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test -- sync.test.ts
```

## DeliveryDO Claim/Ack Prelude

Previous completed checkpoint: `e4ddeca` Plan DeliveryDO live query fanout.

What changed:

- Added executor claim/ack APIs that `DeliveryDO` will call later:
  - claim pending `live_query_deliveries`,
  - ack rows only after successful Cloudflare fanout.
- Exposed the APIs through HTTP/Nitro without any Cloudflare dependency.
- Kept the existing direct callback bridge as a compatibility path while the
  `DeliveryDO` implementation is still pending.

Why it changed:

The sync architecture needs Cloudflare to own fanout while the executor remains
the durable source of truth. This prelude creates the injected executor
contract before adding `DeliveryDO`.

Convex references inspected:

- `crates/sync/src/state.rs`
- `crates/sync/src/worker.rs`

Flarex differences:

- Convex keeps this inside the sync worker. Flarex has a runtime boundary:
  `DeliveryDO` will use claim/ack over HTTP to bridge executor durability and
  Cloudflare WebSocket fanout.

Known limitations:

- No `DeliveryDO` yet.
- No wake route yet.
- No lease/visibility timeout yet.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test -- liveQueries.test.ts
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test -- http.test.ts
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test -- health.test.ts
```

## DeliveryDO Notify-Only Fanout Decision

Previous completed checkpoint: `3288183` Wire live query delivery callback
bridge.

Decision:

Move the live-query delivery drain loop to Cloudflare. The Vercel/Nitro
executor should write durable delivery rows and send only a wake-up notification
to Cloudflare:

```txt
Vercel/Nitro executor
  -> commit mutation in Postgres
  -> insert live_query_deliveries rows
  -> notify Cloudflare: deployment has pending deliveries

Cloudflare DeliveryDO
  -> serialize delivery work per deployment
  -> claim/fetch pending delivery rows from executor
  -> fanout materialized results to ConnectionDO
  -> ack delivered rows through executor
  -> requeue itself if hasMore

ConnectionDO
  -> own per-client query state
  -> emit Transition(QueryUpdated)
```

Why it changed:

The previous bridge allowed a Nitro/Vercel executor to call Cloudflare directly
with delivery payloads. That is useful as a primitive, but it puts drain-loop
pressure on a serverless executor host. Vercel functions should not run
unbounded loops, and frequent polling/cron would make cost follow idle time.

The new rule is:

```txt
notification = wake-up signal
Postgres live_query_deliveries = durable source of truth
DeliveryDO = bounded fanout worker
```

Vercel sends a small wake-up after commit. If the wake-up is duplicated,
`DeliveryDO` claims only undelivered rows. If the wake-up is lost, fallback cron
or a later mutation can wake the same deployment and the rows remain durable in
Postgres.

Convex references inspected:

- `crates/sync/src/state.rs`
  - `SyncState::complete_fetch` tracks result hashes and suppresses unchanged
    query transitions.
- `crates/sync/src/worker.rs`
  - sync worker single-flights transition production and emits
    `ServerMessage::Transition` after changed results are computed.

Flarex differences:

- Convex can keep query recomputation, transition state, and fanout inside one
  backend sync worker. Flarex splits the trusted transaction executor from
  Cloudflare WebSocket ownership, so Cloudflare needs a `DeliveryDO` to play
  the fanout-worker role close to `ConnectionDO`.
- `DeliveryDO` should not own Postgres credentials or database semantics. It
  calls executor claim/ack APIs; the trusted executor remains the authority for
  durable delivery rows.

Known limitations:

- Current code still has the direct callback bridge from executor HTTP to the
  backend route. That remains useful for tests and a fallback path, but it is no
  longer the preferred production drain owner.
- Claim/ack APIs do not exist yet; the current maintenance route combines
  list, deliver, and ack through a callback.
- `DeliveryDO` is not implemented yet.
- Fallback wake-up scheduling is not designed yet.

First implementation plan:

1. Add executor core claim/ack primitives over `live_query_deliveries` without
   fanout callbacks:
   - `claimLiveQueryDeliveryBatch({ deploymentId, limit })`
   - `ackLiveQueryDeliveries({ deploymentId, deliveryIds, deliveredAt })`
2. Expose those through `@flarex/executor-http` and `@flarex/executor-nitro`
   as internal authenticated routes.
3. Add `DeliveryDO` in `packages/flarex-backend` with a wake endpoint and a
   bounded drain loop that calls claim, fans out to `ConnectionDO`, then acks.
4. Add a Worker route:
   `POST /deployments/:deploymentId/sync/wake-delivery`.
5. Keep the existing direct callback route during the transition until
   DeliveryDO is proven by tests.

Verification:

```sh
git diff --check
```

## Postgres Invoke Trigger Bridge

Previous completed checkpoint: `b5b82f4` Add artifact OCC retry boundary.

What changed:

- The trusted Postgres invoke integration now proves a real `/invoke/finish`
  mutation commit updates the freshness mirror and calls the injected live-query
  trigger hook.
- `@flarex/executor-nitro` now re-exports
  `createFlarexBackendLiveQueryTriggerNotifier`, giving hosted Nitro/Vercel
  executors a public helper for waking the Cloudflare scheduler trigger route.
- Detailed route and executor notes for this slice are recorded in
  [20-postgres-executor.md](20-postgres-executor.md) and
  [05-sync-protocol-implementation.md](05-sync-protocol-implementation.md).

Convex references:

- `crates/sync/src/worker.rs`
  - backend invalidation wakes query rerun work.
- `crates/sync/src/state.rs`
  - active query state is refreshed and changed results are delivered.
- `crates/database/src/committer.rs`
  - commit is the publication boundary for subscription-visible writes.

Flarex difference:

- Convex schedules invalidation inside one backend runtime. Flarex keeps the
  executor framework-neutral and relies on a host-injected trigger notifier to
  cross from Postgres commit to Cloudflare scheduler work.

Known limitations:

- Trigger notification is best effort and host-injected.
- Follow-up coverage should assert every successful mutation commit shape
  triggers invalidation, not only the insert path covered in the integration.

Verification:

- `corepack pnpm exec vitest run --config integration/vitest.config.ts integration/invoke.integration.test.ts`
- `corepack pnpm --filter @flarex/executor-nitro test`
- `corepack pnpm --filter @flarex/executor-nitro typecheck`

## Invoke Write-Shape Invalidation Hardening

Previous completed checkpoint: `ab62339` Wire invoke commits to live query
triggers.

What changed:

- Added adapter-level coverage that committed insert, patch, replace, delete,
  and multi-write mutation sessions all update freshness and call the injected
  live-query trigger hook.
- Added no-write mutation coverage proving commits with no writes do not wake
  live-query rerun work.
- Fixed the HTTP invoke syscall route to accept `replace`, matching executor
  core and generated `ctx.db.replace` behavior.

Convex references:

- `crates/sync/src/worker.rs`
  - committed writes wake sync work independent of the specific write shape.
- `crates/sync/src/state.rs`
  - active query results are refreshed after backend invalidation.
- `crates/database/src/committer.rs`
  - write publication and subscription visibility happen at commit.

Flarex differences:

- Flarex's sync trigger path crosses the executor HTTP/Nitro boundary before
  reaching Cloudflare scheduler and connection Durable Objects.
- Because of that split, the external syscall route must explicitly stay in
  sync with all executor-supported write operations.

Known limitations:

- End-to-end scheduler rerun and DeliveryDO fanout still need a separate
  integration slice.

Verification:

- `corepack pnpm --filter @flarex/executor-http test -- http.test.ts`
- `corepack pnpm exec vitest run --config integration/vitest.config.ts integration/invoke.integration.test.ts --testNamePattern "write shape"`
- `corepack pnpm typecheck`
- `corepack pnpm test`
- `corepack pnpm test:integration`
- `corepack pnpm build`
- `git diff --check`

## Indexed Freshness Query Hardening

Previous completed checkpoint: `120dcaa` Implement indexed live query freshness.

What changed:

- Hardened the Postgres indexed freshness check used by live-query
  subscription classification so key lower/upper bounds are evaluated in SQL.
- Kept the semantics from the previous checkpoint: index ranges detect
  membership changes, while returned document reads detect same-key content
  updates.
- Added persistence coverage that exercises matching and non-matching index
  ranges before freshness/subscription code consumes the helper.

Why it changed:

Indexed live queries can become hot fanout paths. A subscription scan that
loads every post-read write for an index would be too expensive once many
clients subscribe to common ranges. This narrows the freshness check before
building more scheduler/delivery behavior on top of it.

Convex references inspected:

- `crates/database/src/reads.rs`
  - subscription invalidation uses indexed interval overlap rather than broad
    table invalidation.
- `crates/sync/src/state.rs`
  - sync state reruns only invalidated subscriptions and dedupes unchanged
    results.

Flarex differences:

- Convex subscriptions wait on invalidation futures maintained by the backend.
  Flarex currently reruns by scanning persisted subscription rows and checking
  freshness against Postgres/PGlite history.
- The Cloudflare delivery/fanout layer is still downstream of this freshness
  decision.

Known limitations:

- Real Postgres query-plan validation is still needed.
- Query-cache/VersionDO mirrors are not implemented yet.

Verification:

```sh
corepack pnpm --filter @flarex/freshness test
corepack pnpm --filter @flarex/executor exec vitest run test/sessions.test.ts test/liveQueries.test.ts --testTimeout=30000
```

## Indexed Live Query Freshness Update

Previous completed checkpoint: `ccc5dea` Harden executor sync integration.

What changed:

- `@flarex/freshness` now classifies Postgres-backed index read sets by asking
  durable index history whether the subscribed range changed after the observed
  timestamp.
- Indexed query syscalls now record returned documents with exact observed
  revisions, so a patch to returned content also marks the subscription stale
  even when the indexed key does not change.
- Index read sets are no longer automatically placed in the unsupported bucket
  when the store has durable index history.
- The unsupported bucket remains explicit for stores that cannot prove index
  freshness.

Why it changed:

The sync path was already recording indexed query reads, but stale-subscription
classification could not act on them. That meant ordinary Convex-style
`withIndex` live queries could subscribe but would not rerun from real
freshness checks. This update makes indexed list queries participate in the
same stale/rerun path as document and table reads.

Convex references inspected:

- `crates/database/src/reads.rs`
  - index interval read sets are used both for transaction conflicts and
    subscription invalidation.
- `crates/sync/src/state.rs`
  - sync state reruns invalidated subscriptions and suppresses unchanged
    results by hashing query output.

Flarex differences:

- Convex subscriptions wait on backend-owned invalidation futures. Flarex's
  current Postgres executor scans persisted subscription rows and classifies
  them through a freshness store.
- Convex's read-set model naturally includes both interval dependencies and
  document observations. Flarex mirrors that by storing the index interval plus
  returned document reads in the invoke session.
- Flarex's durable delivery rows and ConnectionDO fanout remain separate from
  the freshness classification step.

Known limitations:

- Memory freshness still treats index reads as unsupported.
- Search/vector query freshness is still unsupported.
- The current check detects stale subscriptions; it does not yet maintain a
  Cloudflare-side query cache for serving updated indexed results without an
  executor rerun.

Verification:

```sh
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor exec vitest run test/liveQueries.test.ts --testTimeout=30000
corepack pnpm --filter @flarex/executor exec vitest run test/sessions.test.ts test/liveQueries.test.ts --testTimeout=30000
```

## Executor-Owned WebSocket Subscription Registry

Previous completed checkpoint: `09eb59c` feat: enhance live query subscription
handling and executor integration.

What changed:

- Recorded the executor-backed `/sync` subscription boundary introduced in
  `09eb59c`.
- `ConnectionDO` now records active WebSocket queries with the configured
  executor through `/live-query-subscriptions/record` and removes them through
  `/live-query-subscriptions/remove`.
- In executor-backed mode, successful mutations no longer run the old immediate
  PartitionDO rerun path; committed writes flow through freshness invalidation,
  scheduler rerun, durable delivery rows, and ConnectionDO fanout.
- Existing delivery/reconcile/dead-letter sync tests now account for the
  subscription registry call that happens during query setup.
- The local dev integration test now uses a supported table-scan query so the
  full durable fanout path can be proven before index freshness is hardened.
- Subscription registry writes now carry `projectId` and validate deployment
  ownership through the executor before mutating durable subscription rows.
- Mutation commit applies freshness before returning, but external trigger
  delivery is decoupled so a WebSocket mutation response is sent before the
  later live-query transition.

Why it changed:

The Postgres executor is the forward authoritative sync path. WebSocket
subscriptions must be discoverable by the executor's stale-subscription scan;
keeping them only in PartitionDO state would leave the durable scheduler path
unable to find real client subscriptions.

Convex references inspected:

- `crates/sync/src/worker.rs`
  - backend-owned sync workers rerun invalidated queries from authoritative
    subscription state.
- `crates/sync/src/state.rs`
  - query result hashes suppress unchanged transitions.
- `crates/database/src/committer.rs`
  - write publication and sync invalidation are downstream of a successful
    commit.

Flarex differences:

- Convex keeps subscription and invalidation work inside the Rust backend.
  Flarex splits it across `ConnectionDO`, executor HTTP maintenance routes,
  `SchedulerDO`, `DeliveryDO`, and durable Postgres/PGlite rows.
- Convex has an integrated scheduler; Flarex's external trigger notification
  is intentionally asynchronous after durable freshness is applied so mutation
  responses keep Convex-style ordering ahead of subscription transitions.

Known limitations:

- Index/range freshness remains unsupported for the full durable fanout test;
  the integration uses a table read until index freshness semantics are
  completed.
- Subscription record/remove are currently HTTP executor endpoints. The hosted
  production adapter still needs the same routes wired through Nitro/Vercel.

Verification:

```sh
pnpm --filter flarex-backend test -- sync.test.ts
pnpm --filter flarex-dev test -- dev.test.ts
```

## Stale Rerun To WebSocket Fanout

Previous completed checkpoint: `0139e0d` Wire live query dead-letter
reconnects.

What changed:

- `SchedulerDO` now exposes internal
  `POST /rerun/live-query-subscriptions`.
- The public Worker exposes authenticated
  `POST /scheduler/live-query-subscriptions/rerun`.
- The scheduler calls the executor
  `/maintenance/live-queries/rerun` route and validates the rerun result shape.
- When the executor reports changed subscriptions, the scheduler wakes the
  deployment's `DeliveryDO`, which claims durable live-query delivery rows,
  fans them out to `ConnectionDO`, and acks them through the executor.
- Added a Miniflare sync test proving this path sends a `QueryUpdated`
  `Transition` over an active `/sync` WebSocket.

Why it changed:

- The executor already records changed stale-rerun results as durable
  `live_query_deliveries` rows. The missing sync boundary was the Cloudflare
  consumer that turns a successful rerun into `DeliveryDO` drain and
  `ConnectionDO` fanout.

Convex references:

- `crates/sync/src/worker.rs`
  - `ModifyQuerySet` and invalidated query work schedule query updates that
    become `Transition` messages.
- `crates/sync/src/state.rs`
  - active query state tracks subscriptions, invalidation futures, result
    hashes, and state modifications.
- `npm-packages/convex/src/browser/sync/client.ts`
  - the browser sync client applies `Transition` messages and notifies query
    listeners.
- `npm-packages/convex/src/browser/sync/remote_query_set.ts`
  - remote query results are updated from `QueryUpdated` modifications.

Flarex differences:

- Convex performs stale query rerun and transition production inside its sync
  worker. Flarex splits the path: executor rerun records durable delivery rows,
  then Cloudflare `DeliveryDO` drains those rows into `ConnectionDO`.
- The route remains manual/authenticated for this checkpoint; automatic cron or
  alarm scheduling is still out of scope.

Known limitations:

- `hasMoreStale` is reported but no automatic continuation is scheduled yet.
- The test uses a fake executor service binding to prove the Cloudflare fanout
  path. Executor core tests already cover durable delivery-row creation during
  changed stale reruns.
- Range/index freshness remains unsupported for real stale detection.

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

## Bounded Stale Rerun Continuation

Previous completed checkpoint: `0386055` Fan out stale live query reruns.

What changed:

- `SchedulerDO` now persists a bounded pending stale-rerun job when executor
  rerun maintenance returns `hasMoreStale: true`.
- `SchedulerDO` schedules an alarm for continuation and exposes internal
  `POST /continue-live-query-reruns` for deterministic tests.
- `SchedulerDO.alarm()` resumes the same pending rerun and uses backoff retry
  state if the executor or delivery wake path fails.
- Added a sync integration test proving a first rerun with `hasMoreStale`
  persists continuation, and a later continue call reruns with the same bounds
  and delivers the next `QueryUpdated` transition.

Why it changed:

- The manual rerun route was correct for one bounded page. Large deployments
  need the scheduler to preserve progress pressure without running an
  unbounded loop in one Worker request.

Convex references:

- `crates/sync/src/worker.rs`
  - Convex schedules query updates when the query set changes or active
    subscriptions invalidate.
- `crates/sync/src/state.rs`
  - active query state tracks invalidations and refills subscriptions after
    query reruns.
- `npm-packages/convex/src/browser/sync/client.ts`
  - clients consume `Transition` messages and keep observing query changes.

Flarex differences:

- Convex does this inside a long-lived backend sync worker. Flarex must persist
  bounded continuation state in `SchedulerDO` because the Cloudflare runtime
  cannot rely on an unbounded server loop.
- The continuation repeats the same executor `/maintenance/live-queries/rerun`
  call and then wakes `DeliveryDO`; it does not inspect query payloads itself.

Known limitations:

- No global cron or commit-triggered wake path exists yet.
- The scheduler persists one pending stale-rerun job per scheduler DO. Future
  trigger fanout may need per-deployment scheduler names or a queue if multiple
  deployments share a scheduler instance.
- Range/index freshness remains unsupported for real stale detection.

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

## Live-Query Trigger Boundary

Previous completed checkpoint: `986442c` Continue stale live query reruns.

What changed:

- Added public authenticated Worker route
  `POST /scheduler/live-query-subscriptions/trigger`.
- The trigger route forwards to the existing bounded `SchedulerDO`
  stale-rerun flow instead of creating a second fanout path.
- Updated the one-page fanout integration test to call the trigger route and
  prove it produces a `QueryUpdated` `Transition` over an active `/sync`
  WebSocket.

Why it changed:

- Freshness projection and future commit/outbox producers need a stable
  Cloudflare boundary to request live-query reruns. Naming the route as a
  trigger separates producer intent from the existing operator-oriented rerun
  route while keeping the behavior identical and bounded.

Convex references:

- `crates/sync/src/worker.rs`
  - backend sync workers schedule updates after query-set changes or
    invalidations.
- `crates/sync/src/state.rs`
  - sync state owns invalidated query tracking until a rerun refills the
    subscription.
- `npm-packages/convex/src/browser/sync/client.ts`
  - clients observe query changes through normal `Transition` messages.

Flarex differences:

- Convex does not expose a trigger route because the backend sync worker owns
  invalidation scheduling. Flarex exposes this explicit Cloudflare route so a
  future freshness projector can wake `SchedulerDO` across the executor/backend
  split.

Known limitations:

- This checkpoint adds the trigger boundary only. It does not yet wire the
  freshness projector or commit outbox producer to call it automatically.
- Trigger routing still targets the shared `scheduler:live-query-deliveries`
  DO; future per-deployment scheduler naming may be needed for high-volume
  producer fanout.

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

## Live-Query Route Ownership Matrix

Previous completed checkpoint: `48d7261` Add live query trigger route.

What changed:

- Recorded the ownership rules for the current sync/live-query routes.
- Separated implemented route mechanics from not-yet-wired production trigger
  owners.
- Chose mutation-owned invalidation as the next sync implementation slice.

Route ownership:

| Route or DO endpoint | Owner | Trigger timing | Status |
| --- | --- | --- | --- |
| `GET /deployments/:deploymentId/sync` | Flarex client SDK | Client starts, reconnects, or refreshes auth/session state | Partly implemented through `ConnectionDO` WebSocket path |
| `ConnectionDO` query registration | `ConnectionDO` | Client adds/removes a live query over `/sync` | Partly implemented; durable registry integration is still incomplete |
| `POST /invoke` and `POST /deployments/:deploymentId/invoke` | Generated client/server API or runtime bridge | Explicit query/mutation invocation | Implemented for current executor path |
| mutation commit invalidation | Trusted executor | Only after a mutation commits successfully | Missing production owner logic |
| `POST /scheduler/live-query-subscriptions/trigger` | Trusted executor commit/freshness producer | After commit marks one deployment's subscriptions stale | Route implemented; automatic caller missing |
| `POST /scheduler/live-query-subscriptions/rerun` | Operator/test/maintenance tooling | Manual bounded stale-subscription rerun | Implemented as maintenance route |
| `SchedulerDO /rerun/live-query-subscriptions` | Backend Worker only | Internal forwarding from trigger/rerun route | Implemented |
| executor `/maintenance/live-queries/rerun` | `SchedulerDO` | Scheduler processes one bounded stale-subscription page | Implemented |
| `POST /deployments/:deploymentId/sync/wake-delivery` | Executor rerun or delivery notifier | After durable delivery rows exist | Implemented; notification hook exists but is not yet commit-owned |
| `DeliveryDO /wake` | Backend Worker only | Internal forwarding from wake route | Implemented |
| `DeliveryDO /continue` and `DeliveryDO.alarm()` | `DeliveryDO` | Previous drain had more work or a retryable failure | Implemented |
| `ConnectionDO /deliver/live-query` | `DeliveryDO` or direct backend delivery helper | After delivery rows are claimed and materialized payloads are ready | Implemented |
| `POST /scheduler/live-query-deliveries/reconcile` | Cloudflare scheduled handler or operator | Lost wake recovery for pending delivery rows | Implemented as fallback |
| `POST /scheduler/live-query-deliveries/dead-letter` | Scheduled/operator maintenance | Stuck delivery rows exceed policy | Implemented as maintenance |

Target production hot path:

```txt
successful mutation commit
  -> executor records committed write/outbox metadata
  -> executor marks matching live_query_subscriptions stale
  -> executor notifies Cloudflare trigger route
  -> SchedulerDO reruns stale subscriptions
  -> executor writes durable live_query_deliveries rows
  -> SchedulerDO/notification wakes DeliveryDO
  -> DeliveryDO claims, fans out, and acks
  -> ConnectionDO emits Transition(QueryUpdated)
```

Why it changed:

The previous checkpoints proved the lower sync pipeline, but the system is not
live until mutation commit owns the invalidation trigger. Tests and manual
routes can prove fanout mechanics, but production correctness requires a
single owner that runs only after a successful commit.

Convex references inspected:

- `crates/sync/src/worker.rs`
  - sync worker owns query invalidation, rerun pressure, and transition
    production.
- `crates/sync/src/state.rs`
  - active query state stores subscriptions, invalidation futures, result
    hashes, and transition dedupe.
- `crates/database/src/committer.rs`
  - commits validate reads before publishing writes and append write-log data
    for subscriptions.

Flarex differences:

- Convex keeps invalidation scheduling internal to the backend database/sync
  worker. Flarex must expose internal service boundaries because the trusted
  Postgres executor, Cloudflare scheduler, delivery worker, and WebSocket
  owner can be separate deployments.
- Flarex route ownership must be explicit: clients own `/sync`, the executor
  owns post-commit invalidation, `SchedulerDO` owns bounded reruns,
  `DeliveryDO` owns fanout drain, and scheduler maintenance owns recovery.

Known limitations:

- Mutation commit does not yet mark durable live-query rows stale.
- Mutation commit does not yet call
  `/scheduler/live-query-subscriptions/trigger`.
- Registry writes from `ConnectionDO` still need hardening before a full
  WebSocket-to-mutation integration test can be authoritative.
- Index/range invalidation remains coarse or unsupported.

First implementation plan:

1. Audit the successful mutation finish path and identify the exact committed
   write/outbox metadata available after OCC validation.
2. Add executor-core tests that fail until successful mutation commit marks
   affected live-query subscriptions stale.
3. Add an injected post-commit trigger notifier to the executor layer, keeping
   the core framework-neutral and making HTTP/Nitro only adapter wiring.
4. Wire the notifier to the existing Cloudflare trigger route in the host
   configuration.
5. Add an integration test proving mutation commit causes a WebSocket
   `Transition` without manually calling scheduler routes.

Verification:

```sh
git diff --check
```

## Mutation-Owned Live-Query Invalidation Hook

Previous completed checkpoint: `5437ca8` Document live query route ownership.

What changed:

- Added a framework-neutral executor `liveQueryInvalidation` hook that runs
  after successful mutation commit.
- The hook can project committed writes into a supplied freshness mirror and
  then call an injected trigger notifier.
- Added `createFlarexBackendLiveQueryTriggerNotifier(...)` in
  `@flarex/executor-http` for hosts that need to call Cloudflare
  `POST /scheduler/live-query-subscriptions/trigger`.
- Added executor tests proving:
  - successful mutation commit updates freshness and notifies,
  - retrying after an OCC conflict notifies only for the successful attempt,
  - OCC failures do not notify or update freshness, and
  - trigger failures are reported through `onError` without failing an already
    committed mutation.
- Added HTTP helper tests proving the trigger notifier posts the expected
  scheduler route, body, and bearer token.

Why it changed:

The lower sync route chain already existed, but no production owner fired it.
This checkpoint makes the trusted executor the post-commit owner without
importing Cloudflare code into executor core.

Convex references inspected:

- `crates/database/src/committer.rs`
  - commits publish writes only after read validation succeeds.
- `crates/sync/src/worker.rs`
  - backend sync work is scheduled from backend-owned invalidation state.
- `crates/sync/src/state.rs`
  - invalidated queries are rerun before client-visible transitions are sent.

Flarex differences:

- Convex can keep commit, invalidation, rerun, and fanout inside one backend.
  Flarex splits them: executor commit updates a freshness mirror and calls a
  host-injected Cloudflare trigger notifier; `SchedulerDO` and `DeliveryDO`
  finish the route to `ConnectionDO`.
- The post-commit trigger is best-effort. If notifying Cloudflare fails, the
  mutation remains committed and `onError` receives the failure. A durable
  trigger retry/outbox remains future work.

Known limitations:

- The full Dynamic Worker hosted mutation path is not wired in this checkpoint.
  Current tests prove executor-owned post-commit invalidation and the existing
  backend trigger-to-WebSocket path separately.
- `ConnectionDO` still has a legacy same-partition mutation refresh path; the
  Postgres executor trigger path should replace that when the hosted runtime
  path is connected.
- Index/range invalidation remains unsupported or coarse.

Verification:

```sh
corepack pnpm --filter @flarex/executor exec vitest run test/sessions.test.ts test/liveQueries.test.ts
corepack pnpm --filter @flarex/executor-http exec vitest run test/http.test.ts
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor-http typecheck
```

## Local Mutation Trigger Wiring

Previous completed checkpoint: `730d284` Trigger live query invalidation after
commit.

What changed:

- Added local PGlite host wiring so executor HTTP mutation finish now calls the
  Cloudflare live-query trigger notifier automatically.
- Added a test that no longer manually calls scheduler routes; it finishes a
  mutation over executor HTTP and observes the trigger request produced by the
  host wiring.

Why it changed:

The route and executor hook existed separately. Sync only becomes event-driven
when a real host connects successful mutation commit to the scheduler trigger.

Convex references inspected:

- `crates/sync/src/worker.rs`
  - invalidation work is backend-scheduled.
- `crates/sync/src/state.rs`
  - active query transitions happen after rerun.
- `crates/database/src/committer.rs`
  - commit publication precedes sync invalidation.

Flarex differences:

- Convex does not need an HTTP trigger request. Flarex local host now makes the
  request because executor and Cloudflare scheduler are split.

Known limitations:

- The local test stops at trigger notification. Existing backend tests still
  prove trigger-to-WebSocket fanout separately.
- A full browser/app WebSocket mutation through Dynamic Worker user code into
  the Postgres executor remains the next integration gap.

Verification:

```sh
corepack pnpm --filter flarex-dev exec vitest run test/executorHttpRuntime.test.ts
```

## Live-Query Delivery Failure Observability

Previous completed checkpoint: `d1bc1fe` Add live query delivery reconciler.

What changed:

- Added durable failure metadata to live-query delivery rows.
- Added executor-level failure reporting so Cloudflare delivery failures are
  visible in Postgres state.
- Wired `DeliveryDO` to report fanout and ack failures after rows are claimed.
- Added tests proving a failed delivery remains pending and records attempt
  metadata.

Sync invariant:

```text
failed delivery report != delivered ack
```

The client may still need the update. Therefore the row must remain pending
until successful fanout plus ack, or until a future explicit dead-letter policy
forces reconnect/resubscribe behavior.

Convex references:

- `crates/sync/src/worker.rs`
  - query result transitions are backend-owned work.
- `npm-packages/convex/src/browser/sync/client.ts`
  - clients consume query updates as result replacement transitions.

Flarex differences:

- Convex does not expose a separate delivery failure ledger because sync is
  backend-internal.
- Flarex needs delivery attempt metadata because updates cross from the
  executor to Cloudflare `DeliveryDO` and then to `ConnectionDO`.

Known limitations:

- Duplicate updates remain possible if fanout succeeds and ack fails. This is
  acceptable for result-replacement query updates but must be documented before
  event-style streams exist.
- Dead-lettering is not implemented yet.

Verification:

```sh
corepack pnpm --filter @flarex/executor test -- liveQueries.test.ts
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "records DeliveryDO fanout failures"
```

## Stuck Delivery Maintenance Read Path

Previous completed checkpoint: `b35e2ca` Record live query delivery failures.

What changed:

- Added a read-only maintenance path for stuck live-query delivery candidates.
- The endpoint surfaces rows that are still pending, have not been
  dead-lettered, and have an old enough `last_attempted_at`.
- This gives operators and future scheduler code a safe way to inspect stuck
  live updates before any automatic dead-letter behavior exists.

Sync invariant:

```text
listing a stuck delivery must not change delivery state
```

Convex references:

- `crates/sync/src/worker.rs`
  - Convex keeps sync retry processing internal to the backend.
- `npm-packages/convex/src/browser/sync/client.ts`
  - clients consume query-result replacement transitions, so retry visibility
    can remain backend-owned.

Flarex differences:

- Flarex needs an explicit maintenance read API because failure state is
  stored in the Postgres executor while delivery execution happens in
  Cloudflare.
- The API is framework-neutral and not part of app developer APIs.

Known limitations:

- No dead-letter mutation exists yet.
- No dashboard/metrics view consumes this endpoint yet.

Verification:

```sh
corepack pnpm --filter @flarex/executor test -- liveQueries.test.ts
corepack pnpm --filter @flarex/executor-http test
```

## Dead-Letter And Reconnect Candidate Policy

Previous completed checkpoint: `14925e0` List stuck live query deliveries.

What changed:

- Added executor policy `deadLetterStuckLiveQueryDeliveries(...)`.
- The policy consumes `listStuckLiveQueryDeliveries(...)`, marks the selected
  retryable rows dead-lettered, and returns affected `reconnectConnectionIds`.
- Added explicit dead-letter primitive
  `markLiveQueryDeliveriesDeadLettered(...)` for operator/admin use.
- Added HTTP maintenance routes:
  - `/maintenance/live-queries/dead-letter`
  - `/maintenance/live-queries/dead-letter-stuck`

Correctness rule:

```text
dead-lettering is explicit policy, not failed delivery ack
```

The policy only runs after rows are already observable as stuck candidates.
Dead-lettering stops retrying those specific delivery rows and returns the
connections that must be reconnected or resubscribed by a future Cloudflare
consumer.

Convex files inspected:

- `crates/sync/src/worker.rs`
  - sync worker retries and transition production are backend-owned.
- `crates/sync/src/state.rs`
  - query subscriptions are part of the sync state machine.
- `npm-packages/convex/src/browser/sync/web_socket_manager.ts`
  - browser reconnect behavior is owned by the sync client websocket manager.

Flarex differences:

- Convex can rely on client websocket reconnect semantics and backend sync
  ownership without exposing a dead-letter maintenance API.
- Flarex exposes executor maintenance APIs because durable delivery state is in
  Postgres while connection fanout is in Cloudflare Durable Objects.

Known limitations:

- The Cloudflare consumer that sends a reconnect/fatal message to
  `ConnectionDO` is not implemented in this checkpoint.
- This does not delete dead-lettered rows or publish metrics yet.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test -- liveQueries.test.ts
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
```

## Rerun-To-DeliveryDO Wake Contract

Previous completed checkpoint: `bd74849` Add DeliveryDO live query fanout.

What changed:

- The executor HTTP/Nitro rerun route can now notify the backend wake route
  after changed live-query results are persisted as durable delivery rows.
- The preferred sync delivery path is now wake notification plus DeliveryDO
  claim/fanout/ack, not direct executor-to-socket fanout.

Convex references:

- `crates/sync/src/worker.rs`
  - sync worker owns active query reruns and client transition sends.
- `crates/sync/src/state.rs`
  - query state advances after completed backend fetches.

Flarex differences:

- Convex keeps this internal to one sync backend. Flarex splits the work across
  the Postgres executor and Cloudflare ConnectionDO/DeliveryDO, so the wake
  route is the explicit handoff.

Known limitations:

- No continuation mechanism exists yet for `hasMore` delivery rows.
- No periodic reconciler exists yet if wake notifications fail repeatedly.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Dead-Lettered Delivery Reconnect Consumer

Previous completed checkpoint: `038649e` Add live query delivery dead
lettering.

What changed:

- `ConnectionDO` now exposes an internal `POST /force-reconnect` endpoint.
- The endpoint unregisters active subscription state, clears tracked queries,
  and closes all active WebSockets with close code `1012`.
- `SchedulerDO` now consumes the executor
  `/maintenance/live-queries/dead-letter-stuck` response and calls the named
  `ConnectionDO` instances returned in `reconnectConnectionIds`.
- The public worker exposes authenticated
  `POST /scheduler/live-query-deliveries/dead-letter` for operator or future
  scheduler use.
- A Miniflare sync test opens a real WebSocket, dead-letters one stuck delivery
  through the scheduler route, and verifies that the affected connection is
  closed for client resubscription.

Why it changed:

- Dead-lettering a stuck outbox row protects durable delivery state, but the
  client also needs to resubscribe so it is not left trusting a possibly stale
  result. The reconnect consumer is the first Cloudflare-side boundary that
  turns executor policy into sync-session recovery.

Convex references:

- `npm-packages/convex/src/browser/sync/web_socket_manager.ts`
  - normal socket closure enters the reconnect path.
- `npm-packages/convex/src/browser/sync/client.ts`
  - on reconnect, the client resets remote query state and reissues its query
    set.
- `npm-packages/convex/src/browser/sync/remote_query_set.ts`
  - remote query state is connection-local and advances through `Transition`
    versions.
- `crates/sync/src/worker.rs`
  - Convex sync workers own query-set messages and mutation/query execution for
    a live session.

Flarex differences:

- Convex does not need a dead-letter reconnect route because its sync worker
  and backend delivery path run inside the same backend architecture. Flarex has
  a durable executor outbox plus Cloudflare `ConnectionDO`, so the executor
  returns reconnect targets and the scheduler performs the DO calls.
- Flarex deliberately closes the socket instead of sending `FatalError`.
  Convex clients treat `FatalError` as terminal, while ordinary closure lets
  the client reconnect and resubmit active queries.

Known limitations:

- The route is manual/authenticated for this checkpoint. Automatic cron/alarm
  wiring for recurring stuck-delivery cleanup is still a follow-up.
- `hasMore` and `nextCursor` are returned after bounded batch processing, but
  follow-up draining is not yet scheduled automatically.
- Reconnecting an inactive `ConnectionDO` is considered a successful no-op; it
  proves the stale session is no longer active, not that a browser received a
  close event.

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

## DeliveryDO Alarm Continuation

Previous completed checkpoint: `9c160d8` Notify DeliveryDO after live query
reruns.

What changed:

- `DeliveryDO` now persists pending drain state when a bounded drain returns
  `hasMore: true`.
- The pending state contains only `deploymentId`, `limit`, `maxBatches`, and a
  retry attempt counter.
- `DeliveryDO.alarm()` resumes the same drain path from persisted state.
- The continuation deliberately does not persist executor cursors; each alarm
  claims the next undelivered rows from the executor after previous rows were
  acked.
- Added an internal DO `/continue` path so tests can exercise the same
  persisted continuation logic without relying on Miniflare's alarm scheduler.

Convex references:

- `crates/sync/src/worker.rs`
  - bounded sync work is owned by the backend worker.
- `crates/sync/src/state.rs`
  - query state progresses only after completed fetch/send transitions.

Flarex differences:

- Convex's sync worker runs continuously inside the backend. Flarex uses a
  Cloudflare Durable Object alarm because Vercel/Nitro should only notify and
  Cloudflare should own repeated WebSocket fanout work.

Known limitations:

- Alarm retry state is simple exponential backoff; no queue dead-letter or
  observability table exists yet.
- The internal `/continue` route is test/harness-only and is not exposed by the
  public Worker route.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "continues DeliveryDO"
git diff --check
```

## Lost-Wake Sync Reconciler

Previous completed checkpoint: `c8f2f93` Continue DeliveryDO drains with
alarms.

What changed:

- Added the fallback sync path for lost live-query wake notifications.
- SchedulerDO scans the executor for deployments with undelivered
  `live_query_deliveries`.
- SchedulerDO wakes the corresponding per-deployment DeliveryDO.
- DeliveryDO remains the only component that talks to ConnectionDO and acks
  delivery rows.

Sync behavior:

```txt
normal:
  executor rerun -> wake DeliveryDO
fallback:
  SchedulerDO scan -> wake DeliveryDO
always:
  DeliveryDO -> ConnectionDO fanout -> executor ack
```

Convex references:

- `crates/sync/src/worker.rs`
  - sync worker processes query updates inside the backend.
- `crates/sync/src/state.rs`
  - client-visible transitions come from backend-maintained query state.

Flarex differences:

- Flarex has to model wake recovery explicitly because sync fanout runs in
  Cloudflare while durable query delivery rows live behind the executor API.

Known limitations:

- SchedulerDO does not yet store a cursor for multi-page scans.
- The scheduler route uses the existing live-query delivery capability token
  when configured; platform-level ops auth is still future work.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "reconciles lost live query"
git diff --check
```

## Executor Delivery Callback Bridge

Previous completed checkpoint: `4e4d736` Add ConnectionDO live query delivery
consumer.

What changed:

- Added backend Worker route:
  `POST /deployments/:deploymentId/sync/deliver-live-query`.
- The route parses materialized live-query delivery payloads, validates that
  each `connectionId` is scoped to the route deployment, groups deliveries by
  connection, and forwards each group to the named `ConnectionDO`.
- Added optional bearer protection through
  `FLAREX_LIVE_QUERY_DELIVERY_TOKEN`.
- Extracted shared backend live-query delivery parsing/routing helpers into
  `packages/flarex-backend/src/liveQueryDelivery.ts`.
- Added `createFlarexBackendLiveQueryDelivery(...)` in
  `@flarex/executor-http` and re-exported it from `@flarex/executor-nitro` so
  a Nitro/Vercel executor can use the Cloudflare backend Worker as its delivery
  fanout callback.
- Added tests proving:
  - the backend Worker route reaches the active `ConnectionDO` and emits a
    `QueryUpdated` transition,
  - the executor helper posts the expected payload and auth header,
  - a failed backend fanout response rejects the callback, preserving the core
    executor's ack-after-success behavior.
- Increased the sync WebSocket test helper timeout so full workspace test runs
  do not fail only because multiple packages are executing concurrently.

Why it changed:

The durable `live_query_deliveries` table should only be acked after socket
fanout succeeds. The executor core already performs `deliver(...)` before
marking rows delivered. This checkpoint adds the production-shaped callback:

```txt
Nitro/Vercel executor maintenance route
  -> createFlarexBackendLiveQueryDelivery()
  -> Cloudflare backend Worker route
  -> named ConnectionDO
  -> WebSocket Transition(QueryUpdated)
```

Convex references inspected:

- `crates/sync/src/state.rs`
  - `SyncState::complete_fetch` updates query result hashes and suppresses
    unchanged results.
- `crates/sync/src/worker.rs`
  - sync worker emits `ServerMessage::Transition` after changed query results
    are available.

Flarex differences:

- Convex keeps transition computation and socket fanout inside the sync worker.
  Flarex splits the path because the trusted Postgres executor may run outside
  Cloudflare while WebSockets live in `ConnectionDO`.
- The callback carries materialized query results; the Cloudflare Worker does
  not access Postgres or rerun user code.

Known limitations:

- Delivery scheduling is still manually invoked through the maintenance route;
  no cron/queue runner is wired yet.
- `ConnectionDO` active query state is still in memory and needs durable
  hibernation restoration.
- Delivery payloads still do not include logs, query errors, or updated
  journals.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test -- sync.test.ts
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test -- http.test.ts
corepack pnpm --filter @flarex/executor-nitro typecheck
```

## Postgres Authority Pivot

Previous completed checkpoint: `e80e176` Plan Postgres executor package
boundaries.

The forward sync design is Postgres commit/outbox driven. `ConnectionDO` can
remain the WebSocket session owner, but `PartitionDO` read-set registration and
same-partition reruns are now legacy prototype behavior.

New sync work should assume:

```txt
trusted Postgres transaction
  -> commitVersion
  -> outbox/change event
  -> Cloudflare freshness/cache mirrors
  -> affected query reruns with required freshness
  -> ConnectionDO transition fanout
```

Public clients should eventually stop sending `partitionKey`; query and
mutation messages should look Convex-like. The older partition-local sync notes
below remain as implementation history for the current code.

Future Cloudflare cache/freshness layers now have a dedicated roadmap:
`roadmaps/21-cloudflare-freshness-cache.md`.

Verification:

```sh
git diff --check
```

## Local Live-Query Rerun Execution Host

Previous completed checkpoint: `92c38cf` Wire live query rerun route to invoke
bridge.

What changed:

- Added a concrete local execution callback for
  `runLiveQuerySubscriptionWithInvoke(...)`.
- The callback runs the subscribed query inside the materialized source-package
  artifact and binds `ctx.db` to the executor-owned session.
- Added coverage that a live-query rerun sends only `/invoke/syscall` to the
  trusted Postgres executor. It reuses the session supplied by the executor
  retry loop and does not start or finish a nested transaction.

Why it matters for sync:

The rerun path is now shaped like the intended Convex-style live-query engine:

```txt
stale live-query subscription
  -> executor begin query session
  -> materialized user query runs with syscall-backed ctx.db
  -> executor finish records read set/result
  -> registry stores new result hash
  -> future connection fanout publishes transition
```

Convex references:

- `crates/sync/src/worker.rs`
  - active queries are rerun and compared before transitions are emitted.
- `crates/database/src/subscription.rs`
  - query read dependencies determine invalidation.
- `crates/isolate/src/environment/udf/syscall.rs`
  - query code reads through backend-owned syscalls.

Flarex differences:

- Convex's sync worker and function runner are part of one backend. Flarex
  splits query execution across a Cloudflare artifact runtime and the trusted
  Postgres executor.
- The current helper is local/dev infrastructure. A hosted platform runtime
  must later provide the same callback against real Dynamic Worker artifacts.

Known limitations:

- Maintenance rerun HTTP wiring exists, but the dev server does not yet inject
  this concrete callback into that route.
- No `ConnectionDO` fanout consumes rerun results yet.
- Index/range freshness is still incomplete, so many indexed subscriptions can
  still be classified as unsupported by the freshness checker.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- runtimeMaterializer.test.ts
corepack pnpm --filter flarex-backend typecheck
```

## Local HTTP Maintenance Rerun Wiring

Previous completed checkpoint: `3f441a8` Add local live query execution host.

What changed:

- Added `createLocalExecutorHttpRuntime(...)` in `flarex-dev`.
- The helper creates an `@flarex/executor-http` handler with a concrete
  `liveQueryRerun.executeQuery` callback.
- The callback resolves the active deployment package through the executor,
  materializes the stored source package, runs the subscribed query, and sends
  `ctx.db` reads back through the same executor HTTP handler as
  `/invoke/syscall`.
- Added a regression test that exercises
  `/maintenance/live-queries/rerun` end to end through the local runtime.

Why it matters for sync:

The stale-query maintenance route can now run real query code in local/dev
instead of requiring tests or callers to inject a fake callback:

```txt
POST /maintenance/live-queries/rerun
  -> executor scans stale subscriptions
  -> executor begins query session
  -> local materialized artifact runs query
  -> /invoke/syscall returns read data
  -> executor receives rerun value/read set
```

Convex references:

- `crates/sync/src/worker.rs`
  - sync worker reruns active queries and compares results.
- `crates/application/src/application_function_runner/mod.rs`
  - backend-owned execution coordinates function lookup and transaction state.
- `crates/isolate/src/environment/udf/syscall.rs`
  - user query code reaches storage only through syscalls.

Flarex differences:

- Convex keeps this path inside one backend. Flarex local/dev uses
  `@flarex/executor-http` plus a Miniflare materialized execution artifact, so
  the syscall path crosses an internal HTTP-style boundary.
- The helper is framework-neutral local infrastructure. Hosted production still
  needs the equivalent Dynamic Worker artifact runtime.

Known limitations:

- `ConnectionDO` fanout still does not consume rerun results.
- The helper requires a local `projectId` and active package metadata that
  includes module source text. A manifest-only package cannot be materialized
  locally.
- Index/range freshness support is still incomplete.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- executorHttpRuntime.test.ts
git diff --check
```

## PGlite Live-Query Rerun Integration

Previous completed checkpoint: `3efd2a0` Wire local executor live query
reruns.

What changed:

- Added a PGlite-backed integration test for local live-query reruns.
- The test registers and activates a real source package through
  `@flarex/executor`.
- It seeds a document through the executor's mutation invoke/session path,
  projects the commit outbox event into the Postgres freshness mirror, records
  a stale live-query subscription, and reruns it through
  `/maintenance/live-queries/rerun`.
- The rerun executes user query code in the materialized artifact and updates
  the durable live-query subscription row with the fresh result.

Why it matters for sync:

This proves the forward sync rerun path against durable local storage instead
of a fake executor:

```txt
PGlite persistence
  -> committed document + outbox event
  -> Postgres freshness mirror
  -> live_query_subscriptions stale row
  -> executor HTTP maintenance rerun
  -> materialized query artifact
  -> /invoke/syscall
  -> updated live_query_subscriptions result
```

Convex references:

- `crates/sync/src/worker.rs`
  - stale active queries are rerun and their results drive transitions.
- `crates/database/src/subscription.rs`
  - read dependencies determine whether a query is stale.
- `crates/database/src/write_log.rs`
  - committed writes feed freshness/subscription invalidation.

Flarex differences:

- Convex keeps this inside backend sync state. Flarex uses explicit Postgres
  persistence rows, outbox/freshness projection, and a Cloudflare-shaped
  materialized artifact runtime.

Known limitations:

- The test covers document-read freshness, not index/range freshness.
- Connection fanout is still future work.
- JSON `null` result persistence was fixed in the next checkpoint so nullable
  query results can stay valid JSON values without becoming SQL `NULL`.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- executorHttpRuntime.test.ts
git diff --check
```

## JSON Null Live-Query Results

Previous completed checkpoint: `170a4a0` Add PGlite live query rerun
integration.

What changed:

- Fixed `live_query_subscriptions.args_json` and `result_json` writes so
  JavaScript `null` is stored as JSONB `null`, not SQL `NULL`.
- Restored the PGlite live-query rerun integration test to use
  `resultJson: null` for the stale result.
- Added a direct PGlite persistence regression that inserts, lists, and checks
  SQL storage for JSON null live-query args/results.

Why it matters for sync:

Convex-style queries can legitimately return `null`, and one-shot or live query
args can also be `null`. The live-query registry must preserve those as JSON
values because the column is intentionally not nullable; SQL `NULL` would mean
"missing registry value", not "query returned JSON null".

Convex references:

- `npm-packages/convex/src/values/value.ts`
  - `null` is a valid Convex value.
- `crates/sync/src/worker.rs`
  - query results are stored and compared for transitions.

Flarex differences:

- Flarex stores active live-query results in Postgres JSONB rows. Drizzle/PGlite
  need an explicit JSONB null SQL expression to avoid inserting SQL `NULL`.

Known limitations:

- This fix is scoped to the live-query registry. Other JSONB/not-null columns
  that need to distinguish JSON null from SQL NULL should receive the same
  helper when a valid API path can pass `null`.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter flarex-dev test -- executorHttpRuntime.test.ts
git diff --check
```

## ConnectionDO Live-Query Delivery Consumer

Previous completed checkpoint: `3c9952e` Add live query delivery maintenance route.

What changed:

- Added internal `ConnectionDO` endpoint:
  - `POST /deliver/live-query`
- The endpoint accepts materialized `LiveQueryChange` payloads grouped as:

```ts
{
  deliveries: Array<{
    deploymentId,
    connectionId,
    queryId,
    functionPath,
    argsJson,
    resultJson,
    previousResultHash,
    resultHash,
  }>
}
```

- Active `ConnectionDO` instances now turn accepted deliveries into sync
  `Transition` messages with `QueryUpdated` modifications.
- Delivery application is idempotent against the active query `resultHash`:
  duplicate `resultHash` payloads are skipped, and stale
  `previousResultHash` payloads are skipped.
- Added Miniflare sync tests proving:
  - a materialized delivery reaches the active WebSocket without rerunning user
    code,
  - stale delivery rows are skipped and do not overwrite newer socket state.

Why it matters for sync:

The previous checkpoint exposed durable delivery rows through an HTTP/Nitro
maintenance route, but no socket owner could consume them. This checkpoint adds
the first real fanout consumer:

```txt
live_query_deliveries
  -> maintenance deliver callback
  -> ConnectionDO /deliver/live-query
  -> WebSocket Transition(QueryUpdated)
```

Convex references:

- `crates/sync/src/state.rs`
  - `complete_fetch` tracks query result hashes and suppresses unchanged
    modifications.
- `crates/sync/src/worker.rs`
  - emits `ServerMessage::Transition` after changed query results have been
    computed.

Flarex differences:

- Convex keeps this inside one sync worker state machine. Flarex splits it:
  the Postgres executor materializes changed query results, while
  `ConnectionDO` owns the WebSocket session and transition versions.
- The delivery endpoint does not rerun queries. It only publishes already
  materialized results from trusted executor delivery rows.

Known limitations:

- The Nitro delivery maintenance route is not yet wired to call
  `ConnectionDO` by name.
- `ConnectionDO` query state is still in memory; durable WebSocket hibernation
  restoration for query state is not implemented.
- Logs, error transitions, and journal updates are still not carried in
  `LiveQueryChange`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test -- sync.test.ts
```

## Live-Query Delivery Maintenance Endpoint

Previous completed checkpoint: `3f96fa6` Add durable live query delivery outbox.

What changed:

- Added `POST /maintenance/live-queries/deliver` to `@flarex/executor-http`.
- Added `maintenanceLiveQueryDeliveryPath` so hosts can customize the route.
- Added `liveQueryDelivery: { deliver }` adapter config. The handler calls
  `executor.runLiveQueryDeliveryBatch(...)` with the configured delivery
  function.
- Added validation for `{ deploymentId, limit? }`.
- Added Nitro passthrough coverage for the same route.

Why it matters for sync:

The prior checkpoint created durable delivery rows but had no adapter-level way
to drain them. This endpoint is the first framework-neutral fanout boundary:

```txt
live_query_deliveries
  -> POST /maintenance/live-queries/deliver
  -> runLiveQueryDeliveryBatch(...)
  -> injected deliver(deliveries)
  -> mark rows delivered after successful handler return
```

Convex references:

- `crates/sync/src/worker.rs`
  - sends `ServerMessage::Transition` after the sync state computes changed
    query results.
- `crates/sync/src/state.rs`
  - `complete_fetch` hashes query results and suppresses unchanged
    modifications.

Flarex differences:

- Convex emits transitions from the sync worker directly. Flarex externalizes
  the fanout step because Postgres execution, Nitro/Vercel maintenance, and
  Cloudflare `ConnectionDO` socket ownership are separate components.
- This route still does not define the WebSocket protocol. It only drains
  already-materialized delivery rows through an injected delivery callback.

Known limitations:

- No `ConnectionDO` implementation consumes this endpoint yet.
- No delivery lease/claim protocol exists; concurrent callers can still deliver
  at-least-once.
- The route is deployment-scoped, not project-authorized beyond the executor
  capability token.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test -- http.test.ts
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test -- health.test.ts
```

## Durable Live-Query Delivery Outbox

Previous completed checkpoint: `99ed29d` Add live query change delivery payload.

What changed:

- Added durable `live_query_deliveries` Postgres/PGlite storage with:
  - `deployment_id`
  - `delivery_id`
  - `connection_id`
  - `query_id`
  - `payload_json`
  - `delivered_at`
  - `created_at`
- Added low-level persistence helpers to insert, list undelivered, and mark
  live-query deliveries delivered.
- Added `recordLiveQueryRerunResult(...)` so a refreshed
  `live_query_subscriptions` row and its delivery row are stored by one
  persistence operation.
- Updated `rerunLiveQuerySubscription(...)` and
  `rerunStaleLiveQuerySubscriptions(...)` so changed result hashes create a
  durable delivery row, while unchanged reruns only refresh the subscription
  result/read set.
- Added executor delivery-queue APIs:
  - `listUndeliveredLiveQueryDeliveries(...)`
  - `markLiveQueryDeliveriesDelivered(...)`
  - `runLiveQueryDeliveryBatch(...)`
- Kept `deliverChanges(...)` as an optional immediate callback, but the durable
  delivery row is now the safer handoff point.

Why it matters for sync:

The previous checkpoint could produce a `LiveQueryChange` payload but delivery
was callback-only. If callback delivery failed after the subscription result was
persisted, the changed result could be lost because the next scan would see the
query as already refreshed.

The current flow is now:

```txt
stale live-query row
  -> rerun query
  -> compare result hash
  -> atomically persist refreshed subscription result + delivery row
  -> optional immediate callback
  -> future ConnectionDO/WebSocket consumer reads live_query_deliveries
  -> mark delivery delivered after successful socket fanout
```

Convex references:

- `crates/sync/src/state.rs`
  - `result_hash` is used to deduplicate unchanged query results before
    producing client-facing modifications.
- `crates/sync/src/worker.rs`
  - invalidated queries are rerun, subscriptions are refilled, and transitions
    are emitted only after the sync state has the next result.

Flarex differences:

- Convex keeps query state, invalidation, result comparison, and transition
  emission inside the integrated sync worker. Flarex separates those concerns:
  Postgres stores subscription results and delivery rows, while future
  Cloudflare `ConnectionDO` instances own sockets.
- This is an outbox-style queue for changed live-query results, not the commit
  outbox used for write freshness projection.

Known limitations:

- No `ConnectionDO` or WebSocket consumer reads `live_query_deliveries` yet.
- There is no lease/claim protocol for multiple fanout workers. Current batch
  semantics are at-least-once and acknowledge only after the injected deliver
  handler succeeds.
- `LiveQueryChange` still omits logs and error-transition details.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/persistence-postgres test -- pglite.test.ts
corepack pnpm --filter @flarex/executor test -- liveQueries.test.ts
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-http test -- http.test.ts
corepack pnpm --filter @flarex/executor-nitro test -- health.test.ts
corepack pnpm --filter flarex-dev test -- executorHttpRuntime.test.ts
```

## Changed-Result Delivery Payload

Previous completed checkpoint: `84b9422` Preserve JSON null live query values.

What changed:

- Added a stable `LiveQueryChange` payload in `@flarex/executor`.
- `rerunStaleLiveQuerySubscriptions(...)` now returns a `changes` array derived
  only from changed reruns.
- Added an optional `deliverChanges(changes)` callback on stale rerun
  maintenance.
- Wired `deliverChanges` through `@flarex/executor-http` live-query rerun
  config.
- Updated executor, HTTP, Nitro, and PGlite-backed local runtime tests so
  unchanged reruns are not delivered and changed reruns have a stable delivery
  shape:

```ts
{
  deploymentId,
  connectionId,
  queryId,
  functionPath,
  argsJson,
  resultJson,
  previousResultHash,
  resultHash,
}
```

Why it matters for sync:

The rerun engine can now produce the exact data the next fanout layer needs,
without binding executor core to `ConnectionDO` or any specific WebSocket
runtime:

```txt
stale subscription rerun
  -> changed result detected by hash
  -> LiveQueryChange payload
  -> optional delivery callback
  -> future ConnectionDO/WebSocket transition fanout
```

Convex references:

- `crates/sync/src/worker.rs`
  - sync worker compares query results and emits transitions only when needed.
- `crates/sync/src/state.rs`
  - active query state maps client query IDs to result transitions.

Flarex differences:

- Convex emits transitions inside its integrated sync worker. Flarex first
  exposes a framework-neutral change payload because the trusted executor,
  Cloudflare socket ownership, and hosted artifact runtime are separate
  components.

Known limitations:

- This does not send WebSocket messages yet.
- Delivery callback failures are surfaced to the maintenance caller, but the
  rerun result has already been persisted. A durable delivery outbox may be
  needed before production fanout.
- Query logs and error transitions are not represented yet.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test -- liveQueries.test.ts
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test -- http.test.ts
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test -- health.test.ts
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- executorHttpRuntime.test.ts
git diff --check
```

## Read-Set Freshness Checker

Previous completed checkpoint: `3913b02` Add freshness delivery handler.

What changed:

- Added `checkReadSetFreshness(...)` for document/table read dependencies.
- The checker returns:
  - `fresh` when all supported dependencies are still at or before their
    observed timestamps,
  - `stale` when a document/table version is newer than the observed timestamp,
    and
  - `unsupported` when index/range dependencies are present.
- Added durable Postgres-backed checker coverage.

Why it matters for sync:

Live query sync needs to know whether a saved query result is still valid after
new commits arrive. This gives the first concrete dependency check for
document and whole-table reads. A future scheduler can use it before rerunning
queries and publishing new results.

Convex references:

- `crates/database/src/subscription.rs`
  - committed writes invalidate read dependencies.
- `crates/sync/src/worker.rs`
  - sync workers process invalidated queries into client transitions.
- `crates/database/src/write_log.rs`
  - write-log metadata supplies committed freshness.

Flarex differences:

- Convex keeps this logic inside backend subscription state. Flarex needs a
  package-level checker because freshness, query execution, and connection
  fanout are separate pieces.

Known limitations:

- Index/range reads are unsupported.
- No query rerun scheduler uses the checker yet.
- No `ConnectionDO` fanout uses the checker yet.

Verification:

```sh
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
git diff --check
```

## Durable Live-Query Registry

Previous completed checkpoint: `7eee662` Add executor read-set freshness adapter.

What changed:

- Added a Postgres-backed `live_query_subscriptions` table.
- Added persistence helpers:
  - `upsertLiveQuerySubscription(...)`,
  - `deleteLiveQuerySubscription(...)`,
  - `listLiveQuerySubscriptions(...)`.
- The row key is `{deploymentId, connectionId, queryId}`.
- Each row stores function path, args, query `beginTs`, timestamped read set,
  last result, result hash, and update time.
- Added PGlite tests for migration, upsert/list/update/delete behavior.

Why it matters for sync:

This is the durable representation of an active live query:

```txt
connection + query id
  -> function path + args
  -> last result + result hash
  -> read set + beginTs
```

Future schedulers can list active queries, check their read sets against the
freshness mirror, rerun stale queries, and send transitions to connection owners.

Convex references:

- `crates/sync/src/worker.rs`
  - tracks active client query state and produces transitions.
- `crates/database/src/subscription.rs`
  - stores read dependencies for invalidation.

Flarex differences:

- Convex keeps active query state inside its backend/sync machinery. Flarex
  stores this explicitly in Postgres because executor, freshness projection,
  Cloudflare socket ownership, and rerun scheduling are separate components.

Known limitations:

- No scheduler consumes this registry yet.
- No `ConnectionDO` writes or deletes these rows yet.
- No query rerun updates the stored result hash yet.
- Index/range read sets may be stored, but freshness still reports them as
  unsupported.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
git diff --check
```

## Executor Live-Query Registry Writer

Previous completed checkpoint: `f32cc4f` Add durable live query registry.

What changed:

- Added executor methods:
  - `recordLiveQuerySubscription(...)`,
  - `removeLiveQuerySubscription(...)`.
- Recording converts the query read set plus `beginTs` into a timestamped
  freshness read set.
- Recording computes a deterministic result fingerprint before upserting the
  live-query row.
- Added executor tests for record, replace, remove, richer observed timestamps,
  and stable result fingerprints.

Why it matters for sync:

The durable registry is now populated through executor behavior instead of only
being a low-level table. A future `ConnectionDO` or HTTP sync layer can call the
executor after a successful query run:

```txt
query execution result
  -> recordLiveQuerySubscription(...)
  -> durable live_query_subscriptions row
```

Convex references:

- `crates/sync/src/worker.rs`
  - active query results are tracked and compared before publishing
    transitions.
- `crates/database/src/subscription.rs`
  - query dependencies are registered after execution.

Flarex differences:

- Convex keeps this inside the integrated sync worker. Flarex exposes explicit
  executor helpers because Cloudflare connection ownership and the trusted
  executor are split.

Known limitations:

- No `ConnectionDO` or sync HTTP route calls these methods yet.
- No stale-query scheduler consumes the registry yet.
- Result fingerprints suppress nothing yet; they are only stored for the future
  rerun path.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Stale Live-Query Scanner

Previous completed checkpoint: `d438453` Add executor live query registry writer.

What changed:

- Added `findStaleLiveQuerySubscriptions(...)` to `@flarex/executor`.
- The scanner lists live-query subscription rows for a deployment and checks
  each stored read set against a supplied freshness mirror.
- The result is grouped into `fresh`, `stale`, and `unsupported` entries.
- Added executor tests for fresh, stale document/table, and unsupported
  index/range subscriptions.

Why it matters for sync:

This is the first read-only scheduler primitive:

```txt
live_query_subscriptions
  -> freshness mirror
  -> fresh | stale | unsupported
```

The next scheduler/rerun step can consume the `stale` list without needing to
know how registry rows map to freshness validation.

Convex references:

- `crates/sync/src/worker.rs`
  - sync workers identify query updates before emitting transitions.
- `crates/database/src/subscription.rs`
  - dependency invalidation determines whether a query is stale.

Flarex differences:

- Convex keeps stale-query discovery inside its backend worker. Flarex exposes a
  framework-neutral executor helper because persistence, freshness projection,
  and Cloudflare connection fanout are separate runtime pieces.

Known limitations:

- The scanner does not rerun queries.
- The scanner does not update stored results or result hashes.
- The scanner does not notify `ConnectionDO`.
- Index/range dependencies are classified as `unsupported`.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Single Live-Query Rerun Primitive

Previous completed checkpoint: `47bd722` Add stale live query scanner.

What changed:

- Added `rerunLiveQuerySubscription(...)` to `@flarex/executor`.
- The helper accepts one stored subscription and a caller-supplied `runQuery`
  callback.
- It refreshes the durable registry row with the callback's new value, begin
  timestamp, and read set.
- It returns `changed: true` when the stable result hash changed and
  `changed: false` when only freshness/read-set state was refreshed.

Why it matters for sync:

This creates the narrow rerun unit needed after stale-query scanning:

```txt
stale subscription row
  -> runQuery callback
  -> refreshed live_query_subscriptions row
  -> changed flag for future fanout
```

The next batch scheduler can compose scanner results with this single-row rerun
without knowing the registry write details.

Convex references:

- `crates/sync/src/worker.rs`
  - stale query work reruns user query logic and compares results before
    publishing transitions.
- `crates/database/src/subscription.rs`
  - rerun refreshes dependency state for future invalidation.

Flarex differences:

- Convex runs this inside its backend worker. Flarex accepts an injected
  `runQuery` callback so Nitro, tests, or future Cloudflare sync can provide the
  actual execution bridge.

Known limitations:

- No batch scheduler calls this yet.
- No WebSocket or `ConnectionDO` fanout happens yet.
- The callback must supply a valid new read set; Dynamic Worker integration is
  still separate.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Batch Stale Live-Query Rerun

Previous completed checkpoint: `d69a73e` Add live query rerun primitive.

What changed:

- Added `rerunStaleLiveQuerySubscriptions(...)` to `@flarex/executor`.
- The helper scans live-query registry rows, reruns only stale rows, and returns
  changed, unchanged, unsupported, and `hasMoreStale` buckets.
- Added optional `limit` support so future schedulers can process stale work in
  small batches.
- Added executor tests proving limited changed reruns and unchanged reruns.

Why it matters for sync:

This is the first complete scheduler core loop without fanout:

```txt
registry scan
  -> stale rows
  -> rerun stale rows
  -> changed rows ready for future fanout
```

Convex references:

- `crates/sync/src/worker.rs`
  - sync workers batch/process query updates and publish transitions.
- `crates/database/src/subscription.rs`
  - dependency invalidation supplies the stale set.

Flarex differences:

- Convex does scan/rerun/fanout inside the integrated backend. Flarex keeps this
  as a framework-neutral executor helper so Nitro, scheduled workers, and
  future Cloudflare sync can share it.

Known limitations:

- No WebSocket or `ConnectionDO` fanout happens yet.
- No scheduled route calls this helper yet.
- Unsupported index/range subscriptions are returned but not repaired.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Live-Query Rerun Maintenance Route

Previous completed checkpoint: `2b91699` Add batch stale live query rerun.

What changed:

- Added `POST /maintenance/live-queries/rerun` to `@flarex/executor-http`.
- Exposed the same route through the Nitro adapter.
- The route accepts `{ deploymentId, limit? }`.
- The route requires configured live-query rerun dependencies:
  - a freshness store, and
  - a `runQuery(subscription)` callback.
- Added HTTP and Nitro tests for the configured route, invalid input,
  missing configuration, and method handling.

Why it matters for sync:

The scheduler core now has a service boundary:

```txt
cron / scheduler
  -> POST /maintenance/live-queries/rerun
  -> rerunStaleLiveQuerySubscriptions(...)
```

This keeps fanout separate while making stale-query reruns callable by Nitro,
Vercel cron, local tests, or future scheduled workers.

Convex references:

- `crates/sync/src/worker.rs`
  - backend worker is the callable runtime boundary for processing stale query
    work.
- `crates/application/src/api.rs`
  - server APIs expose backend operations while keeping execution internals
    behind trusted boundaries.

Flarex differences:

- Convex owns this inside its backend worker. Flarex exposes an HTTP/Nitro route
  because scheduler hosting is deliberately framework-neutral.

Known limitations:

- The route does not implement real Dynamic Worker query execution yet.
- The route does not fan out changed results to connected clients yet.
- The route returns 501 until a freshness store and `runQuery` callback are
  configured.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Live-Query Partition Routing Metadata

Previous completed checkpoint: `196cef9` Add live query rerun maintenance
route.

What changed:

- Added nullable `partition_key` to durable `live_query_subscriptions`.
- Threaded `partitionKey` through:
  - `@flarex/persistence-postgres` upsert/list records,
  - `executor.recordLiveQuerySubscription(...)`, and
  - rerun recording so refreshed subscriptions keep their route.
- Added PGlite and executor tests proving insert, update, list, and rerun
  preservation.

Why it matters for sync:

The stale-query rerun route needs to turn a stored subscription back into a
real query invocation. The subscription already had function path and args, but
Flarex query sessions also need the resolved partition key. Persisting it with
the subscription makes the next invoke-backed rerun bridge deterministic.

Convex references:

- `npm-packages/convex/src/browser/sync/client.ts`
  - client query-set messages carry enough identity for the backend to run the
    subscribed query again.
- `crates/sync/src/worker.rs`
  - backend sync workers own rerun scheduling and routing inside the trusted
    backend.

Flarex differences:

- Convex does not expose or persist a user-visible `partitionKey` because its
  backend owns routing and execution together. Flarex currently keeps
  partition routing explicit, so durable subscription rows must carry the key
  needed by the trusted executor.

Known limitations:

- Existing rows may have `partition_key = null`; invoke-backed rerun should
  reject those with a clear error until they are refreshed by the client.
- The actual subscription-to-invoke runner is still the next step.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Invoke-Backed Live-Query Rerun Bridge

Previous completed checkpoint: `21de98d` Persist live query partition keys.

What changed:

- Added `executor.runLiveQuerySubscriptionWithInvoke(...)`.
- The bridge turns a stored live-query subscription into a real query invoke
  session using:
  - `subscription.functionPath`,
  - `subscription.argsJson`, and
  - `subscription.partitionKey`.
- The host still supplies `executeQuery(attempt, subscription)` so Dynamic
  Worker execution remains outside the trusted executor package.
- The executor owns session begin, syscall routing, finish, read-set
  accumulation, and returned `{ value, beginTs, readSet }`.
- `runInvokeWithRetries(...)` now returns `beginTs`, which live-query freshness
  needs when recording the refreshed read set.

Why it matters for sync:

This closes the first half of the stale-query rerun gap. The maintenance route
can now be wired to a real query-session runner instead of a fully ad hoc
`runQuery(subscription)` callback. The remaining host-specific part is the
Dynamic Worker user-code call.

Convex references:

- `crates/sync/src/worker.rs`
  - stale active queries are rerun by backend-owned sync workers.
- `crates/isolate/src/environment/udf/syscall.rs`
  - user code reaches the database through a syscall boundary while backend
    services own transaction state.
- `crates/application/src/application_function_runner/mod.rs`
  - application function execution is coordinated by the backend runner.

Flarex differences:

- Convex runs the query and syscall bridge inside one backend. Flarex keeps
  user-code execution host-supplied so the Dynamic Worker runtime can execute
  bundled app code while the Postgres executor owns query sessions.
- Old subscription rows with `partition_key = null` are rejected before a
  session starts.

Known limitations:

- The HTTP/Nitro maintenance route still accepts an injected `runQuery`; wiring
  it to this bridge plus the Dynamic Worker host is the next step.
- Changed results are still not fanned out to WebSocket clients.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-nitro typecheck
git diff --check
```

## Live-Query Rerun Route Uses Invoke Bridge

Previous completed checkpoint: `895e221` Add invoke backed live query rerun
bridge.

What changed:

- `@flarex/executor-http` live-query rerun config now accepts
  `executeQuery(attempt, subscription)` instead of raw
  `runQuery(subscription)`.
- `POST /maintenance/live-queries/rerun` now requires `projectId`.
- The route calls `executor.rerunStaleLiveQuerySubscriptions(...)` with a
  `runQuery` implementation backed by
  `executor.runLiveQuerySubscriptionWithInvoke(...)`.
- Nitro inherits the same route behavior through the shared HTTP adapter.
- Added HTTP/Nitro tests for bridge wiring, missing `projectId`, and
  subscription rerun bridge errors.

Why it matters for sync:

The hosted maintenance route now uses the real Flarex query-session boundary
for reruns. The only injected part is the Dynamic Worker execution callback,
which is the correct split for the current architecture.

Convex references:

- `crates/sync/src/worker.rs`
  - stale active-query work is owned by the backend worker.
- `crates/application/src/application_function_runner/mod.rs`
  - backend services coordinate function execution.

Flarex differences:

- Convex does not need an HTTP adapter-level `executeQuery` callback because
  its backend runner and sync worker are colocated. Flarex keeps the host
  callback explicit so Nitro/Vercel and Dynamic Worker execution can be wired
  separately.

Known limitations:

- The real Dynamic Worker host implementation is not wired yet.
- The route returns changed/unchanged rows but still does not fan out changed
  results to connected WebSocket clients.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Executor Read-Set Freshness Adapter

Previous completed checkpoint: `bd78a7b` Add read-set freshness checker.

What changed:

- Added `readSetToFreshnessReadSet(...)` in `@flarex/freshness`.
- The adapter accepts executor-shaped read sets and applies a session snapshot
  timestamp as the default `observedTs`.
- If a richer internal read already has `observedTs`, the adapter preserves it.
- Index/range reads are carried through with timestamps, but still evaluate as
  `unsupported` until range freshness exists.

Why it matters for sync:

The executor can already return query read sets. The freshness checker requires
timestamps. This adapter gives the future live-query registry a simple bridge:

```txt
finished query readSet + query beginTs
  -> freshness readSet
  -> checkReadSetFreshness(...)
```

Convex references:

- `crates/database/src/subscription.rs`
  - read dependencies are stored with the query/subscription.
- `crates/sync/src/worker.rs`
  - stale queries are rerun from their stored dependency state.

Flarex differences:

- Convex keeps the read dependency and timestamp metadata inside the backend
  transaction/subscription machinery. Flarex exposes a small adapter because
  the executor and Cloudflare sync/cache layers are separate packages.

Known limitations:

- This is only a conversion helper; no live-query registry consumes it yet.
- Public executor read sets currently do not expose per-document `observedTs`,
  so callers using that shape should pass the query `beginTs`.
- Index/range freshness still returns `unsupported`.

Verification:

```sh
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
git diff --check
```

## Reusable Freshness Delivery Handler

Previous completed checkpoint: `f0fd56f` Add durable freshness store.

What changed:

- Added reusable delivery-handler helpers in `@flarex/freshness`.
- The Postgres helper creates the durable mirror store and applies outbox
  events through the existing projector.
- Executor tests now use the helper for normal outbox-to-freshness projection.

Why it matters for sync:

This gives future sync schedulers a single handler to plug into
`runOutboxDeliveryBatch(...)`. It keeps replay/idempotency in the freshness
store and acknowledgement in the executor dispatcher.

Convex references:

- `crates/sync/src/worker.rs`
  - sync worker code owns the committed-change processing loop.
- `crates/database/src/subscription.rs`
  - committed write metadata drives dependency invalidation.

Flarex differences:

- Flarex needs this exported handler because the scheduler/dispatcher and
  freshness projection are separate deployable/runtime concerns.

Known limitations:

- No live query rerun or `ConnectionDO` fanout uses the handler yet.
- No range/index freshness exists yet.
- No scheduler invokes the handler yet.

Verification:

```sh
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Durable Document And Table Freshness

Previous completed checkpoint: `0f896fd` Test outbox freshness pipeline.

What changed:

- Added durable Postgres/PGlite storage for processed freshness event keys,
  document freshness versions, and table freshness versions.
- Added a durable freshness store adapter that satisfies the same
  `FreshnessMirrorStore` interface used by the in-memory projector tests.
- Added tests proving replay idempotency survives a new store instance over the
  same PGlite persistence.

Why it matters for sync:

Live query reruns need a durable source for "what changed since this query read
its dependencies?" Document and whole-table dependencies now have that source.
This is still not full sync, but it is the first durable invalidation state.

Convex references:

- `crates/database/src/write_log.rs`
  - committed writes are durable and replayable.
- `crates/database/src/subscription.rs`
  - subscriptions compare read dependencies against committed writes.
- `crates/sync/src/worker.rs`
  - sync workers consume committed changes to produce client transitions.

Flarex differences:

- Convex stores this in its integrated database/subscription machinery. Flarex
  stores explicit freshness projection rows because execution and Cloudflare
  sync/cache are separate runtime pieces.

Known limitations:

- No live query rerun or `ConnectionDO` fanout consumes the durable freshness
  rows yet.
- No range/index freshness exists yet.
- No minimum-freshness protocol exists for cached query responses yet.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
git diff --check
```

## Outbox To Freshness Pipeline Test

Previous completed checkpoint: `97d0f0f` Add freshness mirror projector.

What changed:

- Added executor tests that run the outbox dispatcher with
  `applyOutboxEventsToFreshnessMirror(...)` as the delivery handler.
- Proved dispatch updates document/table freshness versions before marking the
  outbox event delivered.
- Proved a crash after projection but before acknowledgement is safe: replay
  skips the already processed freshness event and then acknowledges the outbox
  row.

Why it matters for sync:

This validates the first full internal sync invalidation handoff:

```txt
committed outbox event
  -> dispatcher
  -> freshness mirror
  -> delivered acknowledgement
```

Future live query reruns can build on this mirror knowing replay does not
double-apply document/table versions.

Convex references:

- `crates/sync/src/worker.rs`
  - committed changes are processed by worker logic before clients observe
    transitions.
- `crates/database/src/subscription.rs`
  - read dependency invalidation depends on committed write metadata.
- `crates/database/src/write_log.rs`
  - write-log entries are the durability source.

Flarex differences:

- Convex's worker and write-log are internal. Flarex crosses package/runtime
  boundaries, so it tests the dispatcher/projector handoff explicitly.

Known limitations:

- No live query rerun or `ConnectionDO` fanout consumes the mirror yet.
- No range/index freshness exists yet.
- The mirror used here is in-memory only.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
git diff --check
```

## Freshness Projector Core

Previous completed checkpoint: `5526aa2` Add outbox dispatcher core.

What changed:

- Added `@flarex/freshness` with
  `applyOutboxEventsToFreshnessMirror(...)`.
- The projector turns commit outbox events into document/table freshness
  versions.
- The mirror store owns event idempotency by `(deploymentId, ts, sequence)`.

Why it matters for sync:

Subscriptions and live queries need a compact way to ask "did anything I read
change since my last result?" This package starts that path for document and
whole-table dependencies. Future query rerun code can compare recorded read
dependencies against the freshness mirror before publishing client transitions.

Convex references:

- `crates/database/src/subscription.rs`
  - read dependencies are invalidated by committed writes.
- `crates/sync/src/worker.rs`
  - committed changes drive client sync transitions.
- `crates/database/src/write_log.rs`
  - write-log entries provide committed freshness.

Flarex differences:

- Convex can directly use backend write-log/subscription internals. Flarex
  needs a separate projector because outbox dispatch and Cloudflare connection
  ownership are separate components.

Known limitations:

- No `ConnectionDO` or query rerun logic consumes the mirror yet.
- No range/index freshness is implemented.
- No durable mirror store exists yet.

Verification:

```sh
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
git diff --check
```

## Outbox Dispatcher Core

Previous completed checkpoint: `2683fe0` Add outbox delivery primitives.

What changed:

- Added executor-core `runOutboxDeliveryBatch(...)`, which wraps the
  undelivered outbox list, injected delivery handler, and delivered
  acknowledgement into one framework-neutral operation.
- The handler is only acknowledged after it succeeds. If it throws, events
  remain undelivered for retry.
- Added tests proving successful delivery, failure preservation, empty batches,
  and invalid limit rejection.

Why it matters for sync:

Sync now has a concrete internal extension point:

```txt
runOutboxDeliveryBatch({
  deliver(events) {
    // update freshness mirrors and notify connection owners
  }
})
```

That keeps WebSocket/Cloudflare-specific fanout out of the trusted executor
core while still centralizing the at-least-once delivery semantics.

Convex references:

- `crates/sync/src/worker.rs`
  - committed database changes are processed by sync worker logic.
- `crates/database/src/subscription.rs`
  - committed write metadata drives subscription invalidation.

Flarex differences:

- Convex can keep sync worker delivery close to its backend internals. Flarex
  must let the delivery target be injected because the consumer can be a
  Cloudflare DO, scheduled worker, or test sink.
- This requires idempotent consumers. A replay is possible if the process
  crashes after applying a batch but before acknowledging it.

Known limitations:

- No connection fanout or query rerun consumer exists yet.
- No multi-dispatcher claim/lease semantics exist yet.
- Query-range invalidation is still not encoded precisely.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Outbox Delivery Boundary

Previous completed checkpoint: `b4f98a4` Write commit outbox events.

What changed:

- Added executor-accessible primitives for sync workers to page undelivered
  commit outbox events and mark them delivered after applying them.
- The delivery marker uses `outbox.delivered_at`; no new schema is required for
  the first single-dispatcher implementation.
- Tests now prove undelivered events can be listed, acknowledged, hidden from
  future undelivered batches, and still visible in the full outbox history.

Why it matters for sync:

This is the first concrete bridge from the trusted Postgres executor toward
Cloudflare live sync. The future sync worker can now be shaped around:

```txt
read undelivered Postgres outbox events
  -> update freshness/subscription state
  -> mark events delivered
```

Convex references:

- `crates/sync/src/worker.rs`
  - sync workers consume committed changes and publish client transitions.
- `crates/database/src/write_log.rs`
  - committed write-log entries are the durable source of sync invalidation.
- `crates/database/src/subscription.rs`
  - subscriptions are invalidated from committed write metadata.

Flarex differences:

- Convex keeps sync workers close to the write log. Flarex must explicitly
  acknowledge delivered outbox events because the producer is Postgres and the
  consumer will run separately in Cloudflare/Nitro infrastructure.

Known limitations:

- No dispatcher loop or `ConnectionDO` consumer exists yet.
- This is not a multi-dispatcher lease protocol. Concurrent dispatchers can
  still race until claim/lease semantics are added.
- Query-range invalidation is still coarse and needs a dependency encoding
  layer.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Postgres Commit Outbox Source

Previous completed checkpoint: `c71110d` Expose ctx db replace.

What changed:

- The Postgres executor commit path now writes a durable outbox event for each
  successful mutation commit.
- The event includes commit timestamp, source, changed table ids, changed
  document ids, and write summary.
- Failed commits do not create outbox rows.

Why it matters for sync:

The forward sync design is Postgres-authoritative. `ConnectionDO` and future
sync workers should consume committed outbox events rather than relying on the
legacy `PartitionDO` subscription state. This gives Cloudflare sync/freshness
components a replayable commit stream.

Convex references:

- `crates/database/src/write_log.rs`
  - Convex's committed write log is the freshness source.
- `crates/sync/src/worker.rs`
  - sync workers process committed changes into client transitions.
- `crates/database/src/subscription.rs`
  - subscriptions depend on committed write information.

Flarex differences:

- Convex keeps write-log and sync workers in its backend. Flarex uses a
  Postgres outbox because trusted execution, WebSocket connection DOs, and
  cache/freshness DOs are separate runtime components.

Known limitations:

- No outbox dispatcher or `ConnectionDO` consumer is wired yet.
- Outbox events are coarse document/table summaries. Query-range invalidation
  still needs a dependency encoding layer.
- No retention, delivery claim, or retry policy exists yet.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Current Decision

Subscriptions should be read-set based, inspired by Convex. A query result
should be accompanied by a read token. Later writes invalidate subscriptions
whose read set overlaps the write log.

## Implemented So Far

`ConnectionDO` accepts WebSocket connections for `/deployments/:deploymentId/sync`.
It now parses a Convex-style `ModifyQuerySet` message, enforces query-set base
versions, executes `Add` query modifications through the active backend
deployment invoke path, emits `Transition` messages with `QueryUpdated`,
`QueryFailed`, and `QueryRemoved`, and registers successful query read sets with
the owning `PartitionDO`.

`PartitionDO` stores partition-local sync subscription registrations, checks
new commits against registered read sets with the same overlap logic used by
OCC, and notifies the owning `ConnectionDO` to rerun invalidated queries.
`ConnectionDO` fingerprints query results, refreshes read-set registrations on
unchanged reruns, and suppresses `QueryUpdated` when the query result did not
change.
It also accepts Convex-style `Mutation` messages over `/sync`, executes them
sequentially per connection, emits `MutationResponse`, and reruns active
queries on the same partition after successful mutations.

A detailed implementation plan now lives in
[`05-sync-protocol-implementation.md`](./05-sync-protocol-implementation.md).
Future sync work should keep implementation records in this domain instead of
spreading live-sync decisions across unrelated roadmap files.

## Convex References

- `npm-packages/convex/src/browser/sync/protocol.ts`
  Defines the client and server wire message names Flarex should keep where
  practical.
- `npm-packages/convex/src/browser/sync/local_state.ts`
  Maintains query-set versions and produces `ModifyQuerySet` messages.
- `npm-packages/convex/src/browser/sync/client.ts`
  Connects public client subscribe/mutation/action operations to the sync
  WebSocket.
- `crates/local_backend/src/subs/mod.rs`
  Owns Convex's WebSocket upgrade and socket worker split.
- `crates/sync/src/worker.rs`
  Runs query-set modification handling, mutation queueing, query execution,
  and transition emission.
- `crates/sync/src/state.rs`
  Documents the state model of query-set version plus timestamp plus active
  subscriptions.
- `crates/database/src/subscription.rs`
  Tracks subscribers to read sets and invalidates them from write-log updates.
- `crates/application/src/api.rs`
  `SubscriptionClient`, `ApplicationSubscription`, and token handling.
- `crates/database/src/write_log.rs`
  Token refresh and stale-read checks.

## Cloudflare Difference

Convex can keep subscription managers close to the process-local write log.
Flarex needs subscription routing across `ConnectionDO` and one or more
`PartitionDO` instances. Cross-shard queries must subscribe to all partitions or
projections they read.

The client package must also adapt Convex's hosted sync assumptions. Convex's
browser client connects to `/api/{version}/sync`, uses Convex auth/component
metadata, and does not expose a shard route in query subscriptions. Flarex's
first client must connect to the Flarex backend `/sync` route and include
`partitionKey` in query and mutation messages until generated routing can infer
it.

## Client Sync Fork Plan

The next sync implementation step is client-side. It should closely port the
Convex browser sync client layering instead of creating an unrelated Flarex
WebSocket wrapper.

### Files To Mirror In `packages/flarex`

```txt
packages/flarex/src/sync/protocol.ts
packages/flarex/src/sync/localState.ts
packages/flarex/src/sync/baseClient.ts
packages/flarex/src/sync/simpleClient.ts
```

These files should be derived from these Convex references:

- `npm-packages/convex/src/browser/sync/protocol.ts`
- `npm-packages/convex/src/browser/sync/local_state.ts`
- `npm-packages/convex/src/browser/sync/client.ts`
- `npm-packages/convex/src/browser/simple_client.ts`

### Required First Behavior

- `LocalSyncState`-style query-set state:
  - stable query IDs
  - query tokens based on function path, args, and Flarex partition route
  - query-set version increments for `Add` and `Remove`
  - subscriber deduplication for identical query subscriptions
  - `Remove` only when the final subscriber unsubscribes
- `BaseFlarexClient`-style transport:
  - open WebSocket against the Flarex sync URL
  - send `ModifyQuerySet` for subscribe/unsubscribe
  - send `Mutation` for live mutation calls
  - ingest `Transition`, `MutationResponse`, and `FatalError`
  - maintain local query results and failed query errors
- public `FlarexClient` live API:

```ts
const unsubscribe = client.onUpdate(
  api.lessons.list,
  args,
  result => {
    // result changed
  },
  error => {
    // query failed
  },
  { partitionKey: userId },
);

const result = await client.mutation(api.lessons.complete, args, {
  partitionKey: userId,
});
```

Keep the existing HTTP `query()` invoke path and an explicit HTTP mutation
escape hatch while adding this live path.

### Tests For The First Slice

- subscribing to a query sends one `ModifyQuerySet` `Add`
- subscribing twice to the same path/args/partition dedupes into one backend
  query and two callbacks
- unsubscribing once keeps the query active; unsubscribing the final listener
  sends `Remove`
- receiving `Transition.QueryUpdated` stores the local result and calls
  listeners
- receiving `Transition.QueryFailed` stores a local error and calls error
  listeners
- calling `mutation()` sends a sync `Mutation` and resolves/rejects from
  `MutationResponse`
- `partitionKey` is present in `AddQuery` and `Mutation`

## Known Limitations

- Subscription invalidation is partition-local only.
- Subscription state is still in `ConnectionDO` memory; durable WebSocket
  hibernation/recovery is not implemented.
- Action execution over `/sync` is not implemented yet.
- No cross-shard subscription aggregation exists yet.
- `partitionKey` is still required in `AddQuery` and existing-root Flarex
  `Mutation` messages. Create-root mutation references are the exception: they
  omit `partitionKey` and the backend validates `partitionCreateRoot` metadata
  before execution.
- The client-side sync stack exists and has real example-app E2E coverage, but
  production reconnect/backoff, auth refresh, transition chunks, action-over-sync,
  and paginated reactive sync are still missing.

## Client Sync SDK Update

Previous completed checkpoint: `6ca1454` Plan Convex-style sync client port.

Implemented the first client-side live sync slice in `packages/flarex`:

- `src/sync/protocol.ts`
  - client-side mirror of Flarex `/sync` messages using Convex names:
    `ModifyQuerySet`, `Add`, `Remove`, `Transition`, `QueryUpdated`,
    `QueryFailed`, `QueryRemoved`, `Mutation`, and `MutationResponse`
- `src/sync/localState.ts`
  - Convex-style local query-set state with query IDs, query tokens,
    query-set version increments, subscription deduplication, and final
    subscriber `Remove`
- `src/sync/baseClient.ts`
  - minimal WebSocket base client that sends query-set modifications and sync
    mutations, ingests transitions, stores local query results/errors, and
    resolves mutation responses
- `src/sync/simpleClient.ts`
  - public live-query option and unsubscribe shapes
- `src/client.ts`
  - `FlarexClient.onUpdate(...)` live query API
  - initial opt-in `mutation(..., { transport: "sync" })` path, later promoted
    to the default mutation transport in the next checkpoint

Convex references used:

- `npm-packages/convex/src/browser/sync/protocol.ts`
- `npm-packages/convex/src/browser/sync/local_state.ts`
- `npm-packages/convex/src/browser/sync/client.ts`
- `npm-packages/convex/src/browser/simple_client.ts`

Cloudflare and Flarex differences:

- Query tokens include `partitionKey` because Flarex subscriptions are
  partition-routed for now.
- The live client connects to the Flarex deployment sync URL, not Convex's
  `/api/{version}/sync`.
- `packages/flarex` mirrors protocol types locally instead of importing
  backend-only `packages/flarex-backend` code.
- The base client intentionally does not yet port Convex auth refresh,
  component paths, reconnect/backoff, transition chunks, optimistic updates,
  or paginated reactive sync.
- Public `mutation()` now defaults to sync transport. HTTP `/invoke` remains
  available through `transport: "http"` for direct one-shot tests and
  compatibility paths.

Verification:

- `corepack pnpm --filter flarex typecheck`
- `corepack pnpm --filter flarex test`
- `corepack pnpm --filter flarex build`

## Real App Sync E2E Update

Previous completed checkpoint: `be78189` Add Convex-style sync client slice.

Added real app sync coverage through `apps/example/flarex/sync-e2e.test.ts`.
The test runs against `flarex-test`, which now provides a Miniflare-backed
WebSocket constructor and `t.client()` helper.

Tested path:

```txt
generated api.lessons.list
  -> FlarexClient.onUpdate
  -> /__flarex_dev/sync
  -> backend /deployments/:deploymentId/sync
  -> ConnectionDO
  -> active execution artifact
  -> PartitionDO read set registration

generated api.lessons.complete
  -> FlarexClient.mutation(...)
  -> ConnectionDO mutation queue
  -> active execution artifact mutation
  -> PartitionDO commit
  -> same-partition subscribed query rerun
  -> Transition.QueryUpdated
```

Convex references:

- `npm-packages/convex/src/browser/sync/client_node_test_helpers.ts`
  - SDK sync tests use a real Node WebSocket bridge and transition queue.
- `npm-packages/convex/src/cli/lib/networkTest.ts`
  - Convex validates real deployment WebSocket connectivity by constructing a
    `BaseConvexClient` and subscribing to a system query.
- `crates/sync/src/worker.rs`
  - mutations over sync are queued and followed by transition generation.

Cloudflare difference:

- The Flarex example test uses Miniflare Durable Objects and the active
  execution artifact, so it covers Cloudflare routing and source-package
  execution instead of only protocol messages.
- The Vite dev server middleware still needs explicit WebSocket upgrade
  support before browser dev apps can connect through Vite itself.

Verification:

- `corepack pnpm --filter flarex-dev typecheck`
- `corepack pnpm --filter flarex-test typecheck`
- `corepack pnpm --filter @flarex/example test`
- `corepack pnpm --filter flarex-dev test`
- `corepack pnpm --filter flarex-dev build`
- `corepack pnpm --filter flarex-test test`
- `corepack pnpm --filter flarex-test build`
- `corepack pnpm --filter @flarex/example typecheck`
- `corepack pnpm --filter @flarex/example build`

## Sync Mutation Default Update

Previous completed checkpoint: `8d500ed` Add real app sync E2E coverage.

`FlarexClient.mutation()` now follows Convex's public client behavior more
closely: mutations go through the sync client by default.

```ts
await client.mutation(api.lessons.complete, args, {
  partitionKey,
});
```

The direct HTTP invoke path is still available as an explicit escape hatch:

```ts
await client.mutation(api.lessons.complete, args, {
  partitionKey,
  transport: "http",
});
```

`query()` remains HTTP one-shot for now. Live queries continue to use
`onUpdate(...)`.

Convex reference:

- `npm-packages/convex/src/browser/simple_client.ts`
  - `ConvexClient.mutation()` delegates to the base sync client.
- `npm-packages/convex/src/browser/sync/client.ts`
  - `BaseConvexClient.mutation()` enqueues a sync `Mutation` message.

Cloudflare difference:

- Flarex still requires explicit/generated `partitionKey` for existing-root
  mutation routing.
- Create-root mutation references omit `partitionKey`; the backend resolves
  the new partition after active metadata validation and root id allocation.
- The HTTP mutation path remains public because it is useful for tests,
  tooling, and compatibility while sync reconnect/auth semantics are still
  incomplete.

Verification:

- `corepack pnpm --filter flarex typecheck`
- `corepack pnpm --filter flarex test`
- `corepack pnpm --filter @flarex/example test`
- `corepack pnpm --filter flarex build`
- `corepack pnpm --filter @flarex/example typecheck`
- `corepack pnpm --filter @flarex/example build`

## Watch Query API Update

Previous completed checkpoint: `04fc3cb` Default client mutations to sync
transport.

`FlarexClient` now exposes a Convex-style `watchQuery()` primitive:

```ts
const watch = client.watchQuery(api.lessons.list, { userId }, { partitionKey });

const unsubscribe = watch.onUpdate(() => {
  const result = watch.localQueryResult();
});
```

`watchQuery()` is inert until `watch.onUpdate()` is called, matching Convex's
public watch semantics. The existing value-callback `client.onUpdate(...)`
method now wraps `watchQuery()` instead of managing its own subscription state.

The SDK tests now cover:

- watch creation does not open a WebSocket or subscribe
- `watch.onUpdate()` sends `ModifyQuerySet Add`
- `watch.localQueryResult()` reads the cached result after `QueryUpdated`
- watch unsubscribe sends `Remove`
- duplicate watch subscriptions dedupe into one backend query

Convex references:

- `npm-packages/convex/src/react/client.ts`
  - `watchQuery()` returns a stateless watch with `onUpdate()` and
    `localQueryResult()`.
- `npm-packages/convex/src/browser/sync/client.ts`
  - the base sync client owns subscribe and local query result lookup.

Cloudflare difference:

- `partitionKey` remains required on `watchQuery()` options until routing can
  be inferred from generated schema placement metadata.
- `localQueryLogs()` is not implemented yet because the first Flarex sync
  client stores result/error state but not query logs.

Verification:

- `corepack pnpm --filter flarex typecheck`
- `corepack pnpm --filter flarex test`
- `corepack pnpm --filter flarex build`
- `corepack pnpm --filter @flarex/example test`
- `corepack pnpm --filter @flarex/example typecheck`
- `corepack pnpm --filter @flarex/example build`

## Last Update

Added Convex-style `watchQuery()` as the primitive live-query API and refactored
`FlarexClient.onUpdate(...)` to wrap it. This prepares the SDK for React hooks
without adding a separate subscription model.

Previous completed checkpoint: `04fc3cb` Default client mutations to sync
transport.

Validation:

- `corepack pnpm --filter flarex typecheck`
- `corepack pnpm --filter flarex test`
- `corepack pnpm --filter flarex build`
- `corepack pnpm --filter @flarex/example test`
- `corepack pnpm --filter @flarex/example typecheck`
- `corepack pnpm --filter @flarex/example build`

## Postgres-Authoritative Sync Design Note

Previous completed checkpoint: `d40b5ba` Remove legacy SDK route APIs.

Created a non-roadmap design note for the Postgres-authoritative sync/cache
alternative:

- [postgres-authoritative-sync.md](../design-notes/postgres-authoritative-sync.md)

The finding recorded there is that Hyperdrive can reduce ordinary read load,
but it cannot prove live-query freshness by itself. A Postgres-authoritative
Flarex mode would need a committed outbox/CDC stream and Cloudflare-side
freshness mirrors such as `VersionDO`, `DocCacheDO`, and eventually
`QueryCacheDO`.

Convex references:

- `npm-packages/convex/src/react/client.ts`
  - `useQuery` and `watchQuery` subscribe through the sync client.
- `npm-packages/convex/src/browser/simple_client.ts`
  - one-shot `query()` can be implemented as subscribe, receive first result,
    and unsubscribe.
- `npm-packages/convex/src/browser/sync/client.ts`
  - active query subscriptions are tracked through the client query-set
    protocol.

Cloudflare difference: Flarex may use Hyperdrive and replicated Cloudflare
SQLite caches for read performance, but live-query correctness must come from
versioned commit/outbox metadata, not cache revalidation. A cached result can
only be published as a live update when its observed version satisfies the
subscription's required freshness.

Known limitations:

- This was originally recorded as an alternative authority model. After the
  Postgres executor pivot, it is the forward sync authority model, but the
  implementation is still not built.
- Range freshness for indexed/list queries remains the hardest part.
- Cache detection of staleness does not automatically provide the fresh row or
  query result; the runtime still needs no-cache fallback, replicated row
  images, or query-cache rebuilds.

Verification:

```sh
git diff --check
```
