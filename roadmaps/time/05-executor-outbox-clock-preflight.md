# Executor Outbox Delivery Clock Preflight

Status: ECLK01-D complete.

## Scope

This package-only gate covers the `@flarex/executor` outbox delivery batch and
the list/mark operations it composes. It makes those operations Effect-native
internally while retaining the public Promise facade.

It does not change `apps`, executor HTTP or Nitro adapters, persistence
implementations, PostgreSQL transaction clocks, outbox row shape or authority,
delivery retry policy, freshness projection, live-query delivery, or public
executor types.

## Authority And Existing Order

The outbox row remains authoritative Postgres evidence created with the commit.
The later `deliveredAt` value is application delivery evidence supplied either
by the caller or by the executor clock. This gate does not replace commit time,
transaction ordering, or database ownership with Effect Clock.

The existing batch order is:

1. validate the page limit;
2. list undelivered events;
3. return immediately when the page is empty;
4. invoke the caller delivery handler;
5. snapshot the deployment ID used by the mark;
6. project the listed event keys;
7. use the exact explicit `deliveredAt` value when present, otherwise read the
   executor clock once; and
8. mark only those event keys delivered with the snapshot deployment ID and
   that Date.

Every failure stops the later steps. In particular, invalid input and listing
failure perform no delivery or clock read; an empty page performs no delivery,
clock read, or mark; delivery failure performs no clock read or mark; and clock
failure performs no mark. A failing second deployment-ID read stops before
event-key projection, timestamp selection, or mark.

## Compatibility Contract

- A configured executor `Clock` retains exact `clock.now()` dispatch count and
  ordering. Its thrown cause remains the public Promise rejection by identity.
- A configured Date returned by `clock.now()` is passed to persistence by
  identity. No new Date validation, parsing, cloning, or normalization is
  introduced.
- An explicit `deliveredAt` suppresses the clock read and is passed to
  persistence by identity.
- Empty pages suppress the handler, clock read, and mark operation.
- Delivery-handler and persistence failures retain their original public
  rejection identity.
- The deployment ID used for marking is captured immediately after delivery,
  before event-key projection and timestamp selection.
- Event order, cursor projection, first-failure behavior, and public input and
  result allocation remain unchanged.

## Effect Design

`outbox.ts` owns named Effect operations for list, mark, and delivery batch.
The batch composes list and mark directly and maps the handler Promise once at
its foreign boundary. One outbox-owned tagged failure classifies list, handler,
and mark failures internally; the public executor boundary unwraps the cause.

A small package-local time adapter owns the exact native-Effect-Clock versus
configured-Clock mechanics. Session and outbox owners retain their distinct
typed failures and Promise projection policy. The adapter is total construction
of a lazy Effect and does not become `@flarex/time`, a Context service, or a
Layer.

The executor composition root creates one lazy outbox time Effect per executor
instance and one runner at each public Promise entrypoint. The outbox operations
are lifecycle-free and intentionally remain explicit values because multiple
executors with different configured clocks may coexist.

## Completion Gate

Completion requires:

- Effect `TestClock` coverage for a native successful delivery;
- coverage proving empty pages and explicit timestamps suppress time reads;
- configured-clock and explicit-Date identity coverage;
- failure-order coverage for list, handler, clock, and mark failures;
- focused outbox tests, the full executor suite, executor typecheck, core lint,
  changed-lines lint, and exact staged-diff lint; and
- both required final reviewers with no unresolved findings.

Real PostgreSQL is required only if this gate changes database clock,
transaction, lock, ordering, or isolation semantics. This gate must not make
those changes.

## Implemented Result

`outbox.ts` owns the named list, mark, and delivery-batch Effect operations,
its typed foreign/clock failures, and its Promise compatibility runner. The
executor composition root creates one lazy outbox time Effect per executor and
runs each public outbox entrypoint once.

The batch now composes list, delivery, timestamp selection, and mark without a
nested runtime. Native time is TestClock-controlled. Empty pages, invalid
input, list failure, handler failure, and explicit delivery timestamps retain
their no-clock branches. Configured and explicit Dates retain identity at the
persistence boundary, and list, handler, clock, and mark failures retain their
public cause identity and ordering.
