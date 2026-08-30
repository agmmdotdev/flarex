# Executor Live-Query Delivery Clock Preflight

Status: ECLK01-F complete.

## Scope

This package-only gate covers `@flarex/executor` live-query delivery timing:
claim observations and derived lease expiry, acknowledgement observations,
batch claim and acknowledgement composition, and dead-letter evidence time.

It does not change `apps`, executor HTTP or Nitro adapters, persistence
implementations, database schemas, live-query lease and freshness timing,
delivery identifier policy, public executor types, or PostgreSQL
transaction-time authority.

## Authority And Existing Order

The executor clock supplies application observations passed to persistence.
PostgreSQL continues to own claim eligibility, transaction time, locking,
stored lease comparison, committed evidence, and delivery ordering. This gate
does not move a claim, expiry, or acknowledgement decision out of persistence.

The existing operation order is:

- claim: validate the page limit and lease duration, read one claim time,
  capture the persistence operation, project its input, derive a fresh
  `claimExpiresAt` from that same observation, then claim the page;
- acknowledge: capture the persistence operation, read the acknowledgement
  input, select explicit `deliveredAt` or one clock observation, read the
  optional claim owner, then mark the selected deliveries;
- run a batch: choose the claim owner, claim with one observation, return
  immediately for an empty page, deliver a nonempty page, then acknowledge it
  with a separate observation unless `deliveredAt` is explicit; and
- dead-letter stuck deliveries: normalize the reason, list the page, return
  immediately when empty, group rows by deployment, select explicit
  `deadLetteredAt` or one clock observation, mark every group sequentially
  with that shared Date, then project reconnect evidence.

Every failure stops later work. Invalid claim policy suppresses time and
persistence. Empty batch and dead-letter pages suppress acknowledgement and
dead-letter time respectively. Delivery failure suppresses acknowledgement.

## Compatibility Contract

- `FlarexExecutorConfig.clock` remains the public compatibility clock.
- Each configured `clock.now()` call retains its placement, count, returned
  Date identity, and thrown-cause identity.
- Claim and acknowledgement remain distinct observations; they are never
  collapsed into one batch timestamp.
- `claimedAt` and `deadLetteredAt` pass through by identity. Derived
  `claimExpiresAt` remains a newly allocated Date.
- Explicit `deliveredAt` and `deadLetteredAt` values suppress only their own
  clock read and pass through by identity.
- Persistence method lookup retains its original position and receiver.
- Validation, delivery, persistence, projection, and clock failures retain
  their public Promise rejection identity and first-failure order.
- Dead-letter groups retain sequential marking and share one selected Date.
- The `Date.now()` delivery claim-owner fallback remains unchanged. It is
  compatibility identifier spelling and requires a separate identity-policy
  decision.

## Effect Design

`liveQueryDeliveries.ts` owns named Effect operations for claim,
acknowledgement, batch delivery, and stuck-delivery dead-lettering. Narrow
adapters map throwing synchronous work and Promise rejections once to typed
internal failures. `LiveQueryDeliveryPolicyError` remains directly typed. The
public executor boundary unwraps configured-clock and foreign causes,
preserving the existing Promise facade and rejection identity.

The package-local `makeExecutorTimeEffect` remains the shared clock mechanic.
The delivery owner supplies its configured-clock error and boundary
projection. The executor composition root creates one lazy time Effect per
executor instance. This lifecycle-free multi-instance capability is a plain
Effect value, not a singleton Context service or Layer.

The existing non-time delivery Promise operations remain their owners. The
dead-letter Effect uses the existing stuck-page operation through a bounded
Promise adapter; there is no nested Effect runtime or second active clock path.

## Completion Gate

Completion requires:

- Effect `TestClock` coverage proving separate claim and acknowledgement
  observations and one shared dead-letter observation;
- coverage for empty and explicit-timestamp no-read branches;
- configured-clock and explicit-Date identity coverage;
- validation, method lookup, delivery, clock, and persistence failure-order
  coverage;
- focused delivery tests, the full executor suite, executor typecheck, core
  lint, changed-lines lint, and exact staged-diff lint; and
- both required final reviewers with no unresolved findings.

Real PostgreSQL is required only if this gate changes database clock,
transaction, locking, claim/expiry comparison, ordering, or isolation
semantics. It must not make those changes.

## Implemented Result

`liveQueryDeliveries.ts` now owns named Effect operations, typed
configured-clock and foreign failures, and one Promise compatibility runner
for claim, acknowledgement, batch delivery, and stuck-delivery dead-lettering.
The executor composition root creates one lazy delivery-time Effect per
executor and runs each public time-connected entrypoint exactly once.

Claim and acknowledgement observations remain separate. Empty batches do not
read acknowledgement time, delivery failure stops acknowledgement, and empty
dead-letter pages do not read dead-letter time. Explicit acknowledgement and
dead-letter timestamps suppress their corresponding reads and retain Date
identity. Claim expiry remains a fresh Date derived from the one claim
observation, while all deployment groups in one dead-letter pass share one
selected Date. Validation and persistence-method failure precedence, configured
clock failure identity, and the original persistence receiver are pinned.

Focused delivery/live-query validation passed 44 tests. The full serial
executor suite passed 459 tests with 6 skipped, alongside executor typecheck,
core lint, and changed-lines lint. `FLAREX_POSTGRES_DATABASE_URL` was not
configured; the real-PostgreSQL lane was not required because no database
clock, transaction, lock, claim/expiry comparison, ordering, or isolation
behavior changed.
