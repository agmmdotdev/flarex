# Services, Layers, And Runtime Ownership

## Dependency Injection Is Broader Than Layers

The repository already uses explicit ports and construction factories. Passing
a persistence capability into `createX(persistence)` is dependency injection:
dependencies are visible, substitutable, and testable. Its lack of a Layer is
not automatically a defect.

Keep an explicit port when it is small, lifecycle-free, local to one
composition site, and clearer as a normal parameter. Promote it to an Effect
service when one or more of these are true:

- it is a shared application capability used by several operations;
- its methods should expose typed Effect failures or requirements;
- it owns acquisition, release, configuration, pooling, or other lifecycle;
- hosts and tests need different implementations;
- it participates in a larger application Layer graph; or
- construction order and missing dependencies should be checked in `R`.

Do not create one global dependency container. Build the smallest local graph
owned by the application, Worker, Durable Object, server, or test boundary.

## Target Service Shape

A service contract should make its Effect channels exact, and its Layer should
close implementation dependencies:

```ts
class JournalStore extends Context.Service<JournalStore, {
  readonly load: (key: JournalKey) =>
    Effect.Effect<JournalRow, JournalReadError>
}>()("JournalStore") {
  static readonly layer = Layer.effect(
    JournalStore,
    Effect.gen(function* () {
      const sql = yield* SqlDriver
      return JournalStore.of({
        load: Effect.fn("JournalStore.load")(function* (key) {
          return yield* sql.loadJournal(key)
        }),
      })
    }),
  )
}
```

This is a shape, not a mandate to convert every explicit port. Flarex's
deployment and registry subsystems already provide useful local evidence for
service/Layer composition; future persistence work should reuse the decision
principle, not copy those files mechanically.

## Construction And Scope

- Use `Layer.succeed` for an already-created lifecycle-free capability.
- Use `Layer.effect` for effectful construction. In the installed Effect v4,
  construction runs in the Layer's Scope.
- Acquire pools, clients, subscriptions, and background resources with a
  matching release path owned by Scope.
- Do not capture request-, Worker-, or Durable Object-scoped state in a global
  Layer.
- Keep branded process-local capabilities and WeakMap membership at the
  lifecycle that owns them; a Layer does not make global capture safe.

## Runtime Runners

There should be one explicit runner at each real executable or foreign callback
boundary. Domain and service code must not call `runPromise` to escape a typed
failure or requirement channel.

Long-lived hosts should build a lifecycle-owned runtime or Context once when
they own resourceful Layers and dispose it at the same host lifecycle. A
Promise callback required by Drizzle, Cloudflare, Vitest, or another platform
may be a legitimate runtime bridge, but the bridge belongs in the adapter and
must preserve transaction, cancellation, and cleanup semantics.

## Concurrency

- Create Effect concurrency primitives effectfully when already inside an
  Effect operation; avoid unsafe constructors merely for convenience.
- Keep fibers structured, scoped, supervised, joined, or explicitly
  interrupted.
- Make uninterruptible regions as small as the atomicity requirement permits.
- Document why a database or journal operation must be uninterruptible and how
  timeout or host cancellation is handled.

Concurrency constructs are not only implementation style. For journal
serialization, transaction publication, and resource release, their placement
is part of correctness and must be covered by focused tests.
