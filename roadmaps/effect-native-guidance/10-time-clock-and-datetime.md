# Time, Clock, And DateTime

Status: active cross-cutting implementation guidance.

Evidence snapshot: 2026-07-16 with Effect `4.0.0-beta.90`. Re-check the
installed exports before copying API names after an Effect upgrade.

## Decision

Current time is an Effect capability; a date value is not automatically an
Effect.

Effect-native domain and service code should normally read time through
`DateTime.now` or `Clock.currentTimeMillis`. This makes time controlled by the
Effect Clock and therefore replaceable by `TestClock`. Do not hide `Date.now()`
inside `Effect.sync`; that still bypasses the Effect Clock.

JavaScript `Date` remains valid at a deliberate boundary when a database
driver, Drizzle schema, Cloudflare API, or existing public contract requires a
`Date`. Pure deterministic parsing, formatting, and conversion also do not
need an Effect merely because they involve a date.

## Choose By Ownership

| Need | Preferred representation |
| --- | --- |
| Current UTC instant in Effect code | `yield* DateTime.now` |
| Current epoch milliseconds in Effect code | `yield* Clock.currentTimeMillis` |
| A `Date` required by a foreign API | `yield* DateTime.nowAsDate`, or convert with `DateTime.toDateUtc` at the adapter |
| Sleep, timeout, retry delay, or elapsed duration | Effect time operators, `Schedule`, and `Duration` |
| Pure date arithmetic or ISO formatting | `DateTime.add`, `DateTime.subtract`, `DateTime.formatIso`, and related pure functions |
| Potentially invalid date input | `DateTime.make` returning `Option`, or an Effect Schema decoder matching the exact contract |
| Transaction-authoritative timestamp | Read the Postgres clock inside the owning transaction |
| Cloudflare alarm timestamp | Produce epoch milliseconds, then pass the number at the platform adapter |
| Deterministic test time | Effect-aware test runtime plus `TestClock.setTime` / `TestClock.adjust` |

This is not a repository-wide ban on `new Date(...)`. Review why time exists
and who owns it before replacing syntax.

## Current Time In An Effect Operation

Use `DateTime` when the operation needs an instant and formatting or arithmetic:

```ts
import { DateTime, Effect } from "effect"

const issueLease = Effect.fn("Lease.issue")(function* (leaseMinutes: number) {
  const issuedAt = yield* DateTime.now
  const expiresAt = DateTime.add(issuedAt, { minutes: leaseMinutes })

  return {
    issuedAt: DateTime.formatIso(issuedAt),
    expiresAt: DateTime.formatIso(expiresAt),
  }
})
```

Use `Clock` when the contract naturally uses epoch time, such as a platform
alarm:

```ts
import { Clock, Effect } from "effect"

const scheduleAlarm = Effect.fn("Delivery.scheduleAlarm")(function* (
  delayMilliseconds: number,
) {
  const now = yield* Clock.currentTimeMillis
  yield* alarmPort.setAlarm(now + delayMilliseconds)
})
```

The Cloudflare adapter may still ultimately call `storage.setAlarm(number)`.
The improvement is that domain scheduling reads time from the Effect Clock,
not that the platform API is forced to understand `DateTime`.

Avoid these forms inside Effect-native operations:

```ts
const now = Date.now()
const now = yield* Effect.sync(() => Date.now())
const now = DateTime.nowUnsafe()
```

All three read the live platform clock directly and prevent deterministic
clock control. `DateTime.nowUnsafe` remains appropriate only at a deliberate
non-Effect boundary that explicitly accepts live time.

## Parsing Is Not Current-Time Access

Parsing a supplied value is deterministic. Keep it pure and represent invalid
input explicitly:

```ts
import { DateTime, Option, Result } from "effect"

const parsed = DateTime.make(input)

return Option.match(parsed, {
  onNone: () => Result.fail(new InvalidTimestamp({ input })),
  onSome: (value) => Result.succeed(value),
})
```

Inside an Effect operation, an Effect Schema decoder can keep validation in
the typed failure channel. Installed schemas include UTC DateTime decoders
from strings, epoch milliseconds, and JavaScript `Date` values.

Do not replace a strict Flarex protocol parser mechanically with
`DateTime.make`. `DateTime.make(string)` follows the library's accepted input
semantics, while some Flarex contracts require a canonical UTC ISO string or
an exact encoded representation. Preserve that public rule and change only
the internal representation when equivalence is proven.

Use `@flarex/time` for the shared Flarex epoch-millisecond, canonical
ISO-instant, and four-digit calendar-date value contracts. Its unknown-input
decoders return pure `Result` values; an Effect-native owner may enter its
typed failure channel once with `Effect.fromResult`. Keep stricter wire,
freshness, expiry, authorization, and database-time rules with their owners.
See `roadmaps/time/README.md` for the package and migration boundary.

Do not wrap ordinary date construction in `Effect.try` by default. Prefer a
safe constructor returning `Option` or a typed Schema decoder. Use an unsafe
constructor only after validation or for a trusted constant where invalid
input would be a defect.

## Database Time Is A Separate Authority

Effect Clock is application time. It must not replace Postgres time where the
transaction's correctness depends on the database being the authority.

Flarex currently uses `clock_timestamp()` or `now()` in persistence flows for
lease expiry, stored evidence, scope clocks, and transaction/session state.
Those paths should retain database time when the timestamp participates in
locks, expiry decisions, ordering, or committed evidence. Decode the database
value at the SQL boundary and propagate it without taking a second application
clock reading.

Use Effect Clock for application scheduling around the transaction. Use the
Postgres clock for database-authoritative decisions inside the transaction.
Tests may control these through different mechanisms; `TestClock` cannot fake
Postgres `clock_timestamp()`.

## Platform And Compatibility Boundaries

Direct JavaScript time can remain correct in these bounded cases:

- a Cloudflare Durable Object method that is itself the platform adapter and
  immediately passes epoch milliseconds to an alarm API;
- a Drizzle or `pg` codec whose persisted contract is a JavaScript `Date`;
- a pure conversion helper receiving an explicit epoch or date value;
- an external integration-test watchdog that intentionally measures live wall
  time rather than domain time; and
- a compatibility API whose public type is already `Date`.

Even there, distinguish live-time acquisition from conversion. `new Date(epoch)`
does not read current time; `new Date()` does. The first may be a harmless
boundary conversion while the second introduces an implicit clock dependency.

Record a temporary manual clock port only when a non-Effect consumer still
requires it. Once the connected operation is Effect-native, prefer the
installed Clock service rather than maintaining a parallel `now: () => Date`
abstraction.

## Repository Evidence And Review Focus

The current repository contains several different categories that should not
be counted as one debt total:

- backend Durable Object alarm and heartbeat code reads `Date.now()` at
  platform edges;
- executor and protocol code uses `new Date(epoch)` for deterministic ISO
  conversion and canonical-input checks;
- executor health code owns a small manual clock port;
- persistence code often carries JavaScript `Date` because Drizzle/Postgres
  column contracts use it; and
- correctness-sensitive persistence flows deliberately read the database
  clock inside transactions.

Reviewers should report live-clock reads inside an Effect-native domain or
service flow, ad hoc manual clocks duplicating Effect Clock, nondeterministic
tests, and unsafe parsing of untrusted input. They should not report every
`Date` value, epoch conversion, database clock, platform adapter, or test
watchdog as an Effect violation.

## Adoption Checklist

For a future approved touched flow:

1. classify each occurrence as live-time acquisition, pure conversion,
   parsing, database authority, platform adapter, or compatibility contract;
2. replace domain/service live-time reads with `DateTime.now` or
   `Clock.currentTimeMillis`;
3. keep pure transformations pure and make invalid input explicit;
4. preserve database-authoritative timestamps and platform boundary types;
5. replace sleep-based timing tests with Effect-aware `TestClock` tests when
   the behavior is owned by Effect time; and
6. prove encoded timestamps, time zones, expiry boundaries, and database
   transaction behavior remain unchanged.

## Primary References

- [Effect DateTime API](https://effect-ts.github.io/effect/effect/DateTime.ts.html)
- [Effect Clock API](https://effect-ts.github.io/effect/effect/Clock.ts.html)
- [Effect TestClock API](https://effect-ts.github.io/effect/effect/TestClock.ts.html)
