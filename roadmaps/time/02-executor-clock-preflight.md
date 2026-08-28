# Executor Clock Ownership Preflight

Status: implementation gate frozen; runtime migration not started.

Evidence snapshot: 2026-08-28 with Effect `4.0.0-beta.90`.

## Scope

This preflight covers the exported `Clock` capability and its consumers inside
`packages/executor`. It does not authorize changes in `apps`, backend or Durable
Object composition, persistence implementations, protocol timestamp grammar,
or database clock authority.

The current package contract is:

```ts
export interface Clock {
  now(): Date;
}

export interface FlarexExecutorConfig {
  clock?: Clock;
  // ...
}
```

`createFlarexExecutor` captures `config.clock ?? defaultClock` once and exposes
Promise-based executor operations. The injected port is therefore a public
compatibility and test contract. It is not interchangeable with Effect Clock
until the Promise composition boundary, failure behavior, and observation
semantics have been proven.

`@flarex/time` remains a pure temporal-value package. It must not gain `now`, a
Context service, a Layer, or an executor-specific compatibility adapter.

## Consumer Classification

| Executor owner | Existing observation semantics | Authority | Disposition |
| --- | --- | --- | --- |
| Health | Persistence check completes first; one clock read formats the response timestamp | Application observation and public compatibility | First bounded compatibility proof |
| Invoke sessions and retries | Begin, finish, and abort observations cross persistence and OCC boundaries; retries may take several observations across attempts | Application lifecycle time with persistence consequences | Defer as one connected session-family gate |
| Session maintenance | Validation precedes time acquisition; a normal deployment pass takes one cutoff observation and one separate finish observation | Application cutoff and lifecycle time | Defer; do not collapse the two reads |
| Outbox delivery | Empty pages do not read time; a successful delivery uses an explicit override or one later observation before persistence | Application delivery evidence | Defer; preserve override and failure order |
| Live-query connections and subscriptions | Lease, close, expiry, and stale cutoffs use caller overrides or injected time; some operations derive several fields from one shared `Date` | Application lease and cutoff time | Defer as one connected lease-family gate |
| Live-query deliveries | Claim and acknowledgement have distinct observations; empty and override branches suppress some reads | Application lease and delivery evidence | Defer as one connected delivery-family gate |

These values may be persisted, but that does not transfer transaction-time
authority away from PostgreSQL. Any persistence operation whose correctness is
defined by database time, locking, expiry, ordering, or one transaction-wide
observation remains database-owned.

## Retained And Separate Boundaries

- Executor scheduler operations already use Effect Clock, including monotonic
  observations where elapsed time is the contract. They are not legacy `Clock`
  consumers and require no migration here.
- Transaction-grant verification accepts a trusted epoch-millisecond
  observation and applies stricter protocol skew, lifetime, and expiry rules.
  That security boundary must not be weakened into a generic executor clock.
- The live-query delivery identifier fallback uses `Date.now()` as part of a
  compatibility identity spelling. It is not a time-authority migration and
  needs a separate identifier-policy decision.
- Direct platform observations in hosts, Durable Objects, watchdogs, and tests
  remain outside this package gate.

## Migration Invariants

Every executor clock migration must preserve:

1. the public Promise API and exported `FlarexExecutorConfig.clock` contract
   until an explicit compatibility-removal gate passes;
2. validation, persistence, delivery, and failure order;
3. the exact number and placement of time observations on each branch;
4. branches where an explicit timestamp suppresses a live clock read;
5. fields deliberately derived from one shared observation;
6. typed failure and unexpected-defect policy at the existing boundary; and
7. PostgreSQL and platform authority without a dual clock path.

New Effect-native executor operations use installed Effect Clock directly.
During migration, the legacy clock may be adapted only at the existing executor
composition boundary. Do not construct a runtime inside each business
operation, hide a live read inside `Effect.sync`, publish a second executor API,
or retain parallel active implementations.

## ECLK01-A: Health Clock Compatibility Proof

The first implementation gate is limited to executor health reporting. It
must characterize the existing legacy contract before activating one internal
Effect-native health operation.

Required compatibility evidence:

- the persistence health check runs once and completes before time acquisition;
- a persistence rejection still produces degraded health data rather than
  failing the health call;
- exactly one time observation occurs per health call;
- a valid observation produces the same ISO timestamp;
- invalid `Date` values and a throwing legacy `now` preserve the current public
  rejection and cause behavior;
- the Effect-native operation is deterministic under Effect `TestClock`; and
- the public `health(): Promise<FlarexHealth>` method and injected `Clock`
  remain the sole supported compatibility surface.

The implementation must replace the active health path in the same slice; it
must not leave an unused or comparison implementation. If the installed Effect
Clock cannot preserve the legacy injected-clock behavior without narrowing the
public contract, stop with the characterization evidence and preflight that
contract change separately.

## Explicit Exclusions

ECLK01-A does not change sessions, retries, maintenance, outbox delivery,
live-query leases or deliveries, public exports, `@flarex/time`, database
schemas or codecs, PostgreSQL time, application code, or host composition.

Completion requires focused executor health tests, package typecheck, and the
configured core and changed-lines lint gates. Later executor families require
their own gate with branch-level observation and persistence evidence.
