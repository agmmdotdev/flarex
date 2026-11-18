# Mechanism: bounded admission at the Core application owner

Design status: **Accepted**.
Implementation status: **Implemented**.
Measurement status: **Required gates unmet**; local load only, no production capacity selected.

## Ownership and decision

- Owning slice: [Native root admission](../slices/native-root-admission.md).
- Owner: `packages/persistence-postgres/src/core/applicationOwner.ts`, with the
  limiter in `core/admission.ts`.
- Decision source: owner request to queue requests over the in-flight cap with a
  bounded wait. No guarantee is left unresolved for the default-off owner.
- Consumers: owners that pass `admission`. Omitted, behavior is unchanged. No
  durable data is affected.

## Pinned Convex mechanism

- Revision: `db914cf06e2b06ee985646611b9e12ed7a770318`.
- Source: `crates/application/src/application_function_runner/mod.rs`, the
  function-type limiter.
- Convex takes a permit per function type before beginning the function. It has
  16 permits, unbounded waiters, a 5 or 10 second wait, and refuses with 429
  `TooManyConcurrentRequests`. Waiting is not charged to execution time.

## Current core and proposed direction challenge

- `maximumRequests` bounds retention and the unresolved-request census, not
  throughput. Above it `invoke` refused at once. The 32 is a fixture value.
- The only non-test owner, `apps/executor/src/applicationDO.ts`, sets it to
  `maxRequests + 1` behind an HTTP 503.
- The Application path already uses this limiter above Core. Native framework
  roots had nothing, so 64 closed-loop callers mostly refused.
- Both challengers rejected raising `maximumRequests` alone, waiting while
  holding a snapshot or transaction, reacquiring in nested roots, queueing in the
  committer, and retrying refusals automatically.
- Challengers proposed one limiter per generation. This uses one per owner:
  a granted caller first awaits any reconstruction, and `invoke` re-checks the owner
  state and generation, so a waiter never runs on a retired generation. The active
  bound then also holds across a generation change.

## Why a difference is necessary

Convex's waiter count is unbounded because each waiter is cheap inside a
long-lived multithreaded runner. A Worker isolate has one event loop and a memory
limit, so waiters are bounded, as already recorded in
[DO cache and admission budgets](./do-cache-and-admission-budgets.md).

## Replacement mechanism and implementation

- `makeCoreAdmissionLimiter` moved down from `standard-application-invocation`,
  which depends on persistence. Its callback and open-query limits stayed there.
- `use` takes a permit before selecting a generation, so no snapshot, claim or
  transaction is held while waiting. `useDatabase` and reconciliation do not queue.
- Nested `use` on the same owner skips the queue through a context reference and
  remains subject to the census, so it refuses instead of deadlocking on itself.
- `close` stops the limiter before retiring, failing waiters first.
- Census check and reservation are now synchronous, with no yield between them.
- A granted caller awaits reconstruction before selecting a generation, so a caller
  queued across a kernel stop behaves like one arriving just after it.

## Preserved and changed guarantees

Preserved: omitted `admission` refuses at once as before; settlement, claims and
recovery are untouched. Overflow and wait expiry fail `capacity`, with the
`CoreApplicationAdmissionError` as the cause, and never run the body. Changed for
adopters: callers can wait up to `waitMilliseconds` before command time begins.

## Required witnesses and remaining limits

Witnesses are in `test/core/applicationOwnerScenarios.ts` on PGlite and
ordinary-role PostgreSQL.

- Open gate: the caller's total time is wait, any reconstruction, and `commandMs`.
  Nothing bounds the sum, so an adopter must choose `waitMilliseconds` with that in
  mind. A hung `prepare` holds up to `maxActive` permits per channel until the caller
  is interrupted; queued callers still expire.
- A permit holder awaiting reconstruction during `close` sees an interrupt rather
  than `closed`, as any caller of `recover` does.
- Nesting is detected through fiber context. A detached fiber inherits it and skips
  the queue after its root ends; a Promise edge loses it, so a nested `use` there
  would wait and expire. No adapter source does either.
- Closing a retained host can wait up to `waitMilliseconds` longer for queued borrows.
- No production host adopts this yet, and no capacity is selected.
