# Event Bus

This record tracks fork-specific Event Bus changes for Cloudflare runtime
support. Keep Redis-backed Medusa behavior as the reference point unless a
Cloudflare-specific provider boundary is explicitly documented here.

## Cloudflare Queue Subscriber Filtering

Implementation commit:

- `4fc344b18d Align Cloudflare event queue filtering`

The Cloudflare Event Bus provider now only sends events to the Cloudflare Queue
when the event has a registered concrete subscriber or a wildcard subscriber.

Difference from original Medusa:

- Original Redis Event Bus worker-mode behavior queues only events that have
  subscribers. The Redis-backed HTTP integration spec
  `event-bus/subscriber-registration.spec.ts` asserts this behavior directly.
- The fork's Cloudflare Event Bus provider previously sent every emitted event
  to the Cloudflare Queue, including events with no registered subscribers.
- The Cloudflare provider now preserves interceptor execution, but skips the
  queue send when no concrete or wildcard subscriber is registered.
- Grouped event release uses the same queueing path, so subscriber filtering is
  applied consistently when grouped events are released.
- This does not replace the Redis-backed integration assertion. That unchanged
  spec remains blocked locally until a Redis-compatible service is available.

Affected boundary:

- `@medusajs/event-bus-cloudflare`
- Cloudflare Queue provider parity with Redis Event Bus worker-mode queueing
  behavior.

Validation:

- `@medusajs/event-bus-cloudflare` focused Jest suite passed:

```bash
yarn workspace @medusajs/event-bus-cloudflare test --runInBand
```

Result: 1 suite passing, 7 tests passing.

- `@medusajs/event-bus-cloudflare` build passed.
- Composed Worker import guard passed with 1382 bundled inputs.
- `git diff --check` passed.

Validation note:

- Local Redis is still unavailable on `127.0.0.1:6379`; `redis-server`,
  `valkey-server`, and Docker were not available from the local shell. The
  unchanged Redis-backed HTTP integration spec should be rerun when Redis is
  available.

Next step:

- Continue Event Bus provider parity through package-owned tests and
  Cloudflare Worker proofs while leaving the Redis-backed HTTP integration spec
  unchanged.

## Cloudflare Subscriber Unsubscribe Parity

Implementation commit:

- `81700a0b74 Fix Cloudflare event subscriber unsubscribe`

The Cloudflare Event Bus provider now tracks local wrapped subscribers by their
original subscriber function so unsubscribe works both with and without an
explicit `subscriberId`.

Difference from original Medusa:

- The shared Event Bus API allows `unsubscribe(event, subscriber)` without a
  subscriber context.
- The Cloudflare provider wraps local subscribers before storing them in the
  Worker-safe event emitter. Before this slice, no-context unsubscribe attempted
  to remove the original function from the local emitter, leaving the wrapped
  local handler behind.
- The provider now keeps a typed event-to-subscriber wrapper map and removes the
  wrapped local handler during unsubscribe.
- Unsubscribe by `subscriberId` remains supported for concrete and wildcard
  subscribers.
- Queue-consumer dispatch still uses the registered subscriber map and does not
  re-enqueue events.

Affected boundary:

- `@medusajs/event-bus-cloudflare`
- Local same-isolate subscriber lifecycle for Cloudflare Event Bus.

Validation:

- `@medusajs/event-bus-cloudflare` focused Jest suite passed:

```bash
yarn workspace @medusajs/event-bus-cloudflare test --runInBand
```

Result: 1 suite passing, 9 tests passing.

- `@medusajs/event-bus-cloudflare` build passed.
- `medusa-cloudflare` composed Worker import guard passed with 1382 bundled
  inputs.
- `medusa-cloudflare` typecheck passed.
- `git diff --check` passed.

Next step:

- Continue Event Bus provider parity with Worker queue-consumer proof coverage,
  or retry the unchanged Redis-backed HTTP integration spec once Redis is
  available.

## Worker Queue Consumer Proof Coverage

Implementation commit:

- `af1ae39809 Add event queue consumer worker proof`

The Cloudflare Worker proof suite now covers queue-consumer message handling
for the Cloudflare Event Bus provider.

Difference from original Medusa:

- Original Redis worker-mode behavior is still the reference assertion, but it
  requires a Redis-compatible service to execute locally.
- This fork now validates the Cloudflare Worker queue entrypoint directly for
  Cloudflare Queue semantics:
  - invalid queued messages are acknowledged and not retried;
  - valid queued messages dispatch to registered Event Bus subscribers and are
    acknowledged;
  - subscriber dispatch failures retry the queued message.
- The Worker proof uses the existing Cloudflare Event Bus provider and queue
  handler. It does not add a parallel Event Bus implementation or rewrite the
  Redis-backed HTTP integration spec.
- The worker test harness now uses a Vitest-only config that reuses the shared
  Vite alias/define/optimizeDeps fragment without loading the Cloudflare Vite
  plugin into Vitest dependency optimization.
- The Store remote-query worker proof now sends the static publishable API key
  header and asserts the richer real Store currency response produced after the
  publishable-key middleware runs.

Affected boundary:

- `apps/medusa-cloudflare/src/worker.ts`
- `apps/medusa-cloudflare/src/worker.spec.ts`
- `apps/medusa-cloudflare/vite.config.ts`
- `apps/medusa-cloudflare/vitest.config.ts`

Validation:

- `medusa-cloudflare` typecheck passed.
- `medusa-cloudflare` Worker Vitest suite passed: 1 file, 9 tests.
- `medusa-cloudflare` composed Worker import guard passed with 1382 bundled
  inputs.
- `git diff --check` passed.

Next step:

- Continue Event Bus runtime parity with package-owned Cloudflare subscriber
  behavior or begin the next runtime-boundary slice. Retry the unchanged
  Redis-backed HTTP integration spec only when Redis is available.

## Queued Subscriber Lifecycle Coverage

Implementation commit:

- `a8fd279d3a Cover event queue subscriber lifecycle`

The Cloudflare Event Bus provider suite now covers queued-dispatch subscriber
lifecycle behavior directly inside `@medusajs/event-bus-cloudflare`.

Difference from original Medusa:

- Original Redis worker-mode behavior remains the reference, but local
  validation is still blocked without a Redis-compatible service.
- The fork now validates that Cloudflare queued dispatch respects the same
  subscriber lifecycle state used by the shared Event Bus API:
  - concrete subscribers removed without a `subscriberId` are not invoked by
    queued dispatch;
  - wildcard subscribers removed by `subscriberId` are not invoked by queued
    dispatch;
  - queued events with no remaining subscribers are a no-op and do not
    re-enqueue or log processing.
- This is package-owned coverage over the provider's existing
  `dispatchQueuedEvent` path. It does not add behavior to
  `apps/medusa-cloudflare` and does not replace the Redis-backed integration
  assertion.

Affected boundary:

- `@medusajs/event-bus-cloudflare`
- Cloudflare Queue consumer dispatch parity with subscriber registration and
  unsubscribe state.

Validation:

- `@medusajs/event-bus-cloudflare` focused Jest suite passed:

```bash
yarn workspace @medusajs/event-bus-cloudflare test --runInBand
```

Result: 1 suite passing, 12 tests passing.

- `@medusajs/event-bus-cloudflare` build passed.
- `medusa-cloudflare` composed Worker import guard passed with 1382 bundled
  inputs.
- `git diff --check` passed.

Next step:

- Continue Event Bus parity only if a concrete provider behavior gap is found.
  Otherwise move to the next runtime-boundary slice. Retry the unchanged
  Redis-backed HTTP integration spec only when Redis is available.

## Built Worker Queue Timing In Cart Proof

Implementation commit:

- This commit (`Scope Cart proof DO routing by tenant context`)

The Cart-oriented workerd proof now treats Cloudflare Queue delivery as
asynchronous relative to the request that emits an event.

Difference from original Medusa:

- Redis worker-mode and Cloudflare Queue worker-mode both dispatch subscribers
  outside the HTTP/DO request that emits the event.
- The previous Cart proof assertion expected the product cache invalidation
  subscriber to have run before the Cart scenario response returned. That is
  not a correct guarantee for the built Worker with real Queue dispatch.
- The proof now expects `eventBusProvider` to be `cloudflare-queue` and
  `productCacheInvalidatedByEvent` to remain `false` in the same response.
  Queue consumer behavior remains covered by the separate queue-consumer proof
  in the same workerd run.

Affected boundary:

- `apps/medusa-cloudflare` Cart-oriented Worker proof assertions.
- No Event Bus provider queueing behavior changed in this slice.

Validation:

- `yarn workspace medusa-cloudflare test:cart-do-sqlite` passed and showed the
  queue consumer dispatch happening after the Cart scenario response while the
  dedicated queue-consumer proof still validates subscriber execution.
- Worker bundle Node-only import guard passed with 1532 bundled inputs.

## Grouped Workflow Event Release Proof

Implementation commit:

- `ce01178067` (`Prove grouped event bus release in workerd`)

The Cloudflare Event Bus provider already staged workflow-grouped events and
released them through `releaseGroupedEvents`. This slice extends coverage for
that contract and aligns the Worker static proof event bus with the same
grouped lifecycle expected by Medusa workflows.

Difference from original Medusa:

- Original Medusa's workflow engine expects the Event Bus module to implement
  `emit`, `releaseGroupedEvents`, and `clearGroupedEvents`.
- The fork's Cloudflare provider keeps that contract for Queue-backed dispatch.
- The Worker HTTP proof event bus now mirrors the same lifecycle instead of
  appending grouped workflow events immediately or missing the release method.
- The real unchanged reset-password route now runs through the Fetch adapter in
  Vitest and workerd, completes the workflow, releases the grouped
  `auth.password_reset` event, and exposes the released proof event with the
  original metadata and reset token payload.

Affected boundary:

- `@medusajs/event-bus-cloudflare` grouped event behavior coverage.
- `apps/medusa-cloudflare` static proof Event Bus contract parity.
- Auth reset-password workflow proof through the existing Fetch HTTP adapter.

Validation:

- `yarn workspace @medusajs/event-bus-cloudflare test --runInBand` passed:
  1 suite, 13 tests.
- `yarn workspace @medusajs/event-bus-cloudflare build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare check:imports` passed with 1546 bundled
  inputs.
- `yarn workspace medusa-cloudflare check:runtime-source-imports` passed.
- `yarn workspace medusa-cloudflare check:portable-entrypoints` passed.
- `yarn workspace medusa-cloudflare check:real-module-imports` passed.
- `yarn workspace medusa-cloudflare check:http-proof-manifest` passed.
- `yarn workspace medusa-cloudflare test` passed: 1 file, 14 tests.
- `yarn workspace medusa-cloudflare test:cart-do-sqlite` passed, including
  workerd `POST /auth/user/emailpass/reset-password` and released
  `auth.password_reset` event proof.
- `git diff --check` passed.

Next step:

- Continue from real unchanged workflow/runtime pressure. Workflow execution
  and schedule persistence should be lifted behind shared package-owned
  contracts before broadening app-owned proof behavior.
