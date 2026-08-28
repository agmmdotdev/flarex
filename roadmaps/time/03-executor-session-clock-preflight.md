# Executor Session Clock Preflight

Status: ECLK01-B0 characterization complete; runtime migration not started.

Evidence snapshot: 2026-08-29 with Effect `4.0.0-beta.90`.

## Scope

This gate covers session lifecycle time in `packages/executor`: direct begin,
finish, abort, and stale-abort operations plus the retry orchestration that
composes them. It also records the existing package-local Promise callers in
maintenance and live-query reruns so that a later implementation does not add
nested Effect runtimes.

It does not authorize changes in `apps`, host composition, persistence
implementations, PostgreSQL transaction clocks, OCC allocation, commit
execution, outbox behavior, live-query invalidation policy, or public executor
types.

## Current Call Graph

```text
createFlarexExecutor Promise facade
  -> begin / finish / abort / abort-stale
  -> runInvokeWithRetries
       -> begin
       -> caller runAttempt and syscalls
       -> finish
       -> best-effort abort on failure

maintenance -> abort-stale Promise operation
live-query rerun -> retry Promise operation
```

The executor captures one configured legacy `Clock` per instance. Session
operations are Promise-based and call that same capability at their existing
observation points.

## Observation Contract

| Operation | Required order and reads | Date contract |
| --- | --- | --- |
| Begin | Prepare invoke, allocate the session ID, then read once before insert | Calls `getTime()` on the configured `Date`; the resulting number becomes `beginTs` |
| Finish query | Require active session, resolve its engine, list document/table/index reads, then read once before metadata finish | Passes the configured `Date` object to persistence by identity |
| Finish mutation | Require active session and resolve its engine, then read once immediately before commit | Passes the configured `Date` object to the app-data engine by identity; invalidation runs only after commit |
| Abort | Require active session, then read once before metadata abort | Passes the configured `Date` object to persistence by identity |
| Abort stale | Validate limit, load deployment, and verify project, then read once before persistence | Passes the configured `Date` object to persistence by identity |

Failures before the listed observation point take no clock reading. A future
implementation must preserve configured `Date` method dispatch, exact thrown
cause identity, and the identity of values handed to Promise adapters. It must
not eagerly capture one timestamp for an executor instance, request, retry
loop, or maintenance sweep.

## Retry Contract

The retry loop validates `maxAttempts` before creating a session. Each
observation remains lazy and belongs to the operation that requests it.

| Attempt outcome | Clock observations |
| --- | --- |
| Successful attempt | Begin, then finish: two reads |
| Caller attempt failure | Begin, then best-effort abort: two reads |
| Pre-observation finish failure | Begin, then best-effort abort: two reads; finish does not acquire time before its prerequisites succeed |
| Post-observation finish or commit failure | Begin, attempted finish, then best-effort abort: three reads |
| Retried post-observation OCC conflict | Three reads for the failed attempt; the next attempt starts with a fresh begin read |

Abort failure, including a clock failure, is deliberately swallowed so the
original caller or commit failure remains authoritative. Query failures do not
retry. Mutation OCC failures retry only through the existing classifier, and
the final conflict remains the cause of `InvokeRetryExhaustedError`.

## ECLK01-B0: Characterization

The first bounded slice adds no runtime path. Package tests now pin:

- no begin clock read when preparation or ID allocation fails;
- one begin observation on success plus exact `clock.now()` and configured
  `Date.getTime()` failure identity;
- exact configured `Date` identity at query finish, mutation finish, direct
  abort, and stale abort;
- no finish clock read for an inactive session;
- no stale-abort clock read before project verification succeeds;
- operation-labelled begin/finish/abort observations for one failed OCC attempt
  followed by success and for two exhausted OCC attempts;
- no finish observation when query read collection fails, while begin and
  best-effort abort still each observe once;
- exact final OCC identity in `InvokeRetryExhaustedError.lastError`; and
- original caller- and OCC-error identity when the best-effort abort clock also
  fails.

These tests are migration authority for observation order and error precedence,
not authority to change persistence, OCC, or retry policy.

## ECLK01-B1: Effect Session Operations

The next implementation gate must replace the active session/retry core rather
than add a comparison path.

Required design:

1. Keep a private executor-instance session capability because multiple
   executors with different persistence, ID, invalidation, and legacy-clock
   values may coexist. Do not globalize those values in a singleton Context
   service or create a Layer without a lifecycle need.
2. Supply one lazy `Effect<Date>` observation to the capability. The native
   form uses the installed Effect Clock and constructs a fresh plain `Date` at
   each existing observation point. The compatibility form executes the exact
   configured `clock.now()` call at the executor composition boundary through
   `Effect.try`. Its private typed `ConfiguredSessionClockError` carries the
   original thrown cause. Only a public Promise compatibility boundary unwraps
   that cause, by identity, to retain the current rejection contract.
3. Implement named Effect operations for begin, finish, abort, stale abort, and
   the full retry loop. The retry operation calls the Effect session operations
   directly; it must not invoke their Promise wrappers.
4. Keep one Effect runner at each public Promise entrypoint. Maintenance and
   live-query callers may retain the same Promise wrappers until their own
   connected gates, but every wrapper must delegate to the same active Effect
   operation rather than preserve a second business implementation.
5. Inventory the existing domain and foreign Promise failures before coding.
   Keep known domain errors typed and preserve them by identity. Map raw
   Promise rejection once at its owner and project it back to the existing
   public rejection only at the compatibility boundary. Do not expose
   `unknown` as the reusable Effect error channel or turn expected failures
   into defects merely to make the bridge compile. Best-effort abort cleanup
   may fold only the abort operation's typed failure channel; interruption and
   defects remain authoritative Causes and must not be swallowed by broad Cause
   recovery. Every foreign Promise or synchronous compatibility failure that
   the current abort path suppresses must therefore enter that typed channel at
   its owner.
6. Preserve retry classification, abort-error suppression, invalidation order,
   persistence call order, session and commit state, OCC inputs, and all
   public result shapes.

`@flarex/time` remains a pure value package. This gate adds no generic clock,
Layer, database codec, timestamp brand, or session policy to it.

## Completion Evidence

ECLK01-B1 requires focused session and retry tests, Effect `TestClock` coverage
for direct and multi-attempt observations, executor typecheck, core and exact
changed-lines lint, the full executor suite, and the existing real-Postgres
retry lane when its configured database is available. If precise internal
failure channels cannot retain the current public error identities, stop and
preflight that contract change instead of adding a fallback or dual path.
